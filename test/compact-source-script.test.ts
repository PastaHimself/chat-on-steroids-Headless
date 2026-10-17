import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

/**
 * Run the shipped page-side function, not a reimplementation of its failure policy.
 * The recorder is an IIFE, so isolate this one declaration with its page dependencies
 * stubbed. All scenarios remain pre-Send; no ChatGPT or local backend is contacted.
 */
const content = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const start = content.indexOf('  async function runNativeCompaction(');
const end = content.indexOf('\n  const CONTINUATION_MARKER', start);
if (start < 0 || end < 0) throw new Error('native compaction boundary moved');
const nativeSource = '(' + content.slice(start, end).trim() + ')';
const CHAT = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz123456';
const PROMPT = '[[CLF-HANDOFF:' + TOKEN + ']] Summarize the exact recorded work.';

function page(options: {
  automatic?: boolean;
  draft?: string;
  editor?: boolean;
  insertion?: boolean;
  send?: 'not-ready' | 'authorized-but-no-receipt';
  afterPermit?: 'missing' | 'empty' | 'human-draft' | 'attachment' | 'source-changed';
} = {}) {
  const editor = options.editor === false ? null : {
    isConnected: true,
    textContent: options.draft ?? '',
    getAttribute: () => null
  };
  let currentEditor = editor;
  let sourceOwned = true;
  const reported = vi.fn(async (_id: string, _token: string, _reason: string, _current: () => boolean) => undefined);
  const retired = vi.fn(async (_id: string, _token: string, _reason: string, _current: () => boolean) => undefined);
  const messages = vi.fn(() => [{ role: 'user', id: 'question-before' }]);
  const ask = vi.fn(async (body: Record<string, unknown>) => {
    if (body.sourceAttempt === true) {
      if (options.afterPermit === 'missing') currentEditor = null;
      if (options.afterPermit === 'empty' || options.afterPermit === 'human-draft' || options.afterPermit === 'attachment') {
        currentEditor = {
          isConnected: true,
          textContent: options.afterPermit === 'human-draft' ? 'human-owned draft' : '',
          getAttribute: () => null
        };
      }
      if (options.afterPermit === 'source-changed') sourceOwned = false;
      return { ok: true, data: { allowed: true } };
    }
    if (body.sourceDispatch === true) return { ok: true, data: { armed: true } };
    throw new Error('unexpected backend request');
  });
  const clear = vi.fn(() => undefined);
  const context = {
    alive: true, conversationId: CHAT, epoch: 2, nativeRun: 1,
    nativeBusy: true, nativePhase: 'prompting', pressedAt: 1, localError: '',
    job: { automatic: options.automatic !== false },
    CLF_DOM: {
      conversationId: () => CHAT,
      composer: () => currentEditor,
      composerVisible: () => true,
      hasComposerAttachments: () => options.afterPermit === 'attachment' && currentEditor !== null,
      messages,
      insertPrompt: (prompt: string, _mention: boolean, onFailure: (why: string) => void) => {
        if (options.insertion === false) { onFailure('native_edit_rejected'); return false; }
        if (currentEditor) currentEditor.textContent = prompt;
        return true;
      },
      clearPromptExact: clear
    },
    t: (_key: string, fallback: string, detail?: string) => detail ? fallback.replace('$1', detail) : fallback,
    renderControl: vi.fn(), pullActivity: vi.fn(), rememberUserSend: vi.fn(),
    // The full recorder suite exercises receipt matching; these pre-Send cases
    // never obtain a native message to compare.
    matchesSubmittedBootstrap: vi.fn(),
    waitPageView: vi.fn(async () => null),
    INTERRUPT_WAIT_MS: 1,
    handoffResidue: () => false,
    retireUnsentCompaction: retired,
    reportPendingCompaction: reported,
    ask,
    sendSubmittedText: vi.fn(async (
      current: () => boolean, _clear: boolean, beforeSend: (current: () => boolean) => Promise<boolean>,
      _onWithdraw: unknown, _matches: unknown
    ) => {
      if (options.send === 'authorized-but-no-receipt') await beforeSend(current);
      // Native Send was not observed. Only the durable dispatch claim can make
      // that ambiguous; a disabled/unmounted Send is still definitely pre-Send.
      return false;
    })
  };
  const run = runInNewContext(nativeSource, context) as (
    prompt: string, token: string, id: string, epoch: number, run: number, same: () => boolean
  ) => Promise<void>;
  return { context, editor, getCurrentEditor: () => currentEditor, reported, retired, ask, clear,
    run: (prompt = PROMPT) => run(prompt, TOKEN, CHAT, 2, 1, () => sourceOwned) };
}

describe('automatic Compact & Resume native pre-Send recovery (PR #5 follow-up)', () => {
  it('persists a missing handoff instruction without abandoning or claiming Send', async () => {
    const f = page();
    await f.run('');
    expect(f.reported).toHaveBeenCalledOnce();
    expect(f.reported.mock.calls[0]?.[2]).toContain('did not send the handoff instruction');
    expect(f.retired).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it('reports a provider/editor insertion refusal on the existing ticket', async () => {
    const f = page({ insertion: false });
    await f.run();
    expect(f.reported).toHaveBeenCalledOnce();
    expect(f.reported.mock.calls[0]?.[1]).toBe(TOKEN);
    expect(f.reported.mock.calls[0]?.[2]).toContain('native_edit_rejected');
    expect(f.retired).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it('reports an absent composer rather than interpreting a recovery ACK as source Send', async () => {
    const f = page({ editor: false });
    await f.run();
    expect(f.reported).toHaveBeenCalledOnce();
    expect(f.reported.mock.calls[0]?.[2]).toContain('composer_missing');
    expect(f.retired).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it('persists a native Send-readiness failure without arming an ambiguous dispatch', async () => {
    const f = page({ send: 'not-ready' });
    await f.run();
    expect(f.reported).toHaveBeenCalledOnce();
    expect(f.reported.mock.calls[0]?.[2]).toContain('Send button or message box was not ready');
    expect(f.retired).not.toHaveBeenCalled();
    expect(f.ask).toHaveBeenCalledWith(expect.objectContaining({ sourceAttempt: true, token: TOKEN }));
    expect(f.ask.mock.calls.some(([request]) => request.sourceDispatch === true)).toBe(false);
    expect(f.context.rememberUserSend).toHaveBeenCalledWith(true, expect.any(Function));
    expect(f.context.sendSubmittedText.mock.calls[0]?.[4]).toBe(f.context.matchesSubmittedBootstrap);
  });

  it('retains the existing draft and safely abandons automatic pre-Send custody', async () => {
    const f = page({ draft: 'my unsent human message', insertion: false });
    await f.run();
    expect(f.editor?.textContent).toBe('my unsent human message');
    expect(f.retired).toHaveBeenCalledOnce();
    expect(f.reported).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
  });

  it('keeps manual refusal terminal, not an automatic pending retry', async () => {
    const f = page({ automatic: false, insertion: false });
    await f.run();
    expect(f.retired).toHaveBeenCalledOnce();
    expect(f.reported).not.toHaveBeenCalled();
  });

  it('keeps an automatic ticket when React removes the editor after sourceAttempt but before Send', async () => {
    const f = page({ afterPermit: 'missing' });
    await f.run();
    expect(f.ask).toHaveBeenCalledWith(expect.objectContaining({ sourceAttempt: true, token: TOKEN }));
    expect(f.reported).toHaveBeenCalledOnce();
    expect(f.retired).not.toHaveBeenCalled();
    expect(f.ask.mock.calls.some(([request]) => request.sourceDispatch === true)).toBe(false);
  });

  it('keeps an automatic ticket after a post-permit empty editor remount', async () => {
    const f = page({ afterPermit: 'empty' });
    await f.run();
    expect(f.reported).toHaveBeenCalledOnce();
    expect(f.retired).not.toHaveBeenCalled();
    expect(f.ask.mock.calls.some(([request]) => request.sourceDispatch === true)).toBe(false);
  });

  it('retires only an unsent ticket when a human draft replaces the editor after authorization', async () => {
    const f = page({ afterPermit: 'human-draft' });
    await f.run();
    expect(f.getCurrentEditor()?.textContent).toBe('human-owned draft');
    expect(f.retired).toHaveBeenCalledOnce();
    expect(f.reported).not.toHaveBeenCalled();
    expect(f.ask.mock.calls.some(([request]) => request.sourceDispatch === true)).toBe(false);
  });

  it('does not send the handoff with an attached user file after editor remount', async () => {
    const f = page({ afterPermit: 'attachment' });
    await f.run();
    expect(f.retired).toHaveBeenCalledOnce();
    expect(f.reported).not.toHaveBeenCalled();
    expect(f.ask.mock.calls.some(([request]) => request.sourceDispatch === true)).toBe(false);
  });

  it('still retires the pre-Send ticket when the owning source chat changed', async () => {
    const f = page({ afterPermit: 'source-changed' });
    await f.run();
    expect(f.retired).toHaveBeenCalledOnce();
    expect(f.reported).not.toHaveBeenCalled();
    expect(f.ask.mock.calls.some(([request]) => request.sourceDispatch === true)).toBe(false);
  });

  it('never reports an ambiguous post-dispatch send as safely retryable', async () => {
    const f = page({ send: 'authorized-but-no-receipt' });
    await f.run();
    expect(f.ask).toHaveBeenCalledWith(expect.objectContaining({
      sourceDispatch: true, token: TOKEN, before: 'question-before'
    }));
    expect(f.reported).not.toHaveBeenCalled();
    expect(f.retired).not.toHaveBeenCalled();
    expect(f.context.nativePhase).toBe('waiting');
  });
});
