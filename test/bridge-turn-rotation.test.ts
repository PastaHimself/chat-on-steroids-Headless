/**
 * #1402 through the real bridge: an attributed tool result in a turn that has run past
 * `ui.rotateTurnMinutes` files exactly one automatic continue into that turn; a younger turn,
 * a Pro turn and a Goal chat get none.
 */
import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    getSelectedStorageBackend: vi.fn(() => 'unknown'),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value, 'utf8')),
    decryptStringAsync: vi.fn(async (buffer: Buffer) => ({ result: buffer.toString('utf8'), shouldReEncrypt: false }))
  },
  clipboard: {},
  shell: {}
}));

const { defaultConfig, initConfigPath, saveConfig } = await import('../src/main/config.js');
const { APP_VERSION, BRIDGE_PROTOCOL } = await import('../src/main/version.js');
const { initSecretsPath, setSecret } = await import('../src/main/secrets.js');
const { resetBridgeForTests, shutdownBridge, startBridge, sessionInputActivity } = await import('../src/main/bridge.js');
const { flushDurable, initDurableStore, writeDurableSoon } = await import('../src/main/durable.js');
const { findSessionByConversation, initSessionStore, resetSessionStoreForTests } = await import('../src/main/session/store.js');
const { recordToolCall, resetRecorderForTests } = await import('../src/main/session/recorder.js');
const { listInputs, resetInputForTests, claimBrowserInput, authorizeBrowserInput, acknowledgeBrowserInput } = await import('../src/main/session/input.js');
const { resetTurnRotationForTests } = await import('../src/main/turn-rotation.js');
const { setGoalSwitchNow, resetGoalStateForTests } = await import('../src/main/goal.js');
const { makeTempDir, removeTempDir } = await import('./helpers.js');

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const MINUTE = 60_000;

let dir: string;
let base: string;
let token: string | null = null;
let requestSerial = 0;

function request(
  method: string,
  path: string,
  options: { body?: unknown; auth?: string | null } = {}
): Promise<{ status: number; body: any }> {
  const url = new URL(path, base);
  const payload = options.body === undefined ? null : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    origin: EXTENSION_ORIGIN,
    'x-extension-version': APP_VERSION,
    'x-extension-protocol': String(BRIDGE_PROTOCOL)
  };
  if (payload !== null) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(payload));
  }
  const auth = options.auth === undefined ? token : options.auth;
  if (auth) headers.authorization = `Bearer ${auth}`;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
        });
      }
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function pair(): Promise<void> {
  const reply = await request('POST', '/pair', { auth: null });
  expect(reply.status).toBe(200);
  token = reply.body.token;
}

async function events(chat: string, items: unknown[]): Promise<any> {
  const reply = await request('POST', '/events', { body: { conversationId: chat, events: items } });
  expect(reply.status).toBe(200);
  return reply.body;
}

async function attributedCall(chat: string): Promise<void> {
  const requestId = `rotation_trace_${++requestSerial}`;
  await events(chat, [{ kind: 'tool_evidence', time: Date.now(),
    calls: [{ messageId: `m-${requestSerial}`, tool: 'read', order: 0, answered: false, requestId }] }]);
  await recordToolCall({ tool: 'read', args: { paths: ['/project/a.ts'] }, content: [{ type: 'text', text: 'ok' }],
    outcome: 'ok', durationMs: 1, startedAt: Date.now(), requestId });
}

async function turnFor(chat: string, turnId: string, ageMinutes: number, model = 'GPT-6 Sol'): Promise<string> {
  await events(chat, [
    { kind: 'model_selection', model, reasoningEffort: 'high', time: Date.now() - ageMinutes * MINUTE },
    { kind: 'turn_start', time: Date.now() - ageMinutes * MINUTE, turnId }
  ]);
  const session = await findSessionByConversation(chat);
  expect(session?.activeTurnId).toBe(turnId);
  return session!.id;
}

/** The fire-and-forget rotation settles within the serial outbox; give it a few ticks. */
async function rotationsFor(sessionId: string): Promise<Array<{ turnId?: string; text: string }>> {
  await new Promise(resolve => setTimeout(resolve, 150));
  return (await listInputs()).filter(row => row.sessionId === sessionId && row.purpose === 'rotation')
    .map(row => ({ turnId: row.queuedTurn?.turnId, text: row.text }));
}

beforeAll(async () => {
  dir = await makeTempDir('clf-bridge-rotation-');
  initConfigPath(dir);
  initSecretsPath(dir);
  initSessionStore(dir);
  initDurableStore(dir);
  const config = defaultConfig();
  await saveConfig({ ...config, sessions: { ...config.sessions, record: true }, ui: { ...config.ui, rotateTurnMinutes: 30 } });
  const port = await startBridge();
  expect(port).not.toBeNull();
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await shutdownBridge();
  resetSessionStoreForTests();
  await removeTempDir(dir);
});

beforeEach(async () => {
  resetBridgeForTests();
  resetRecorderForTests();
  resetInputForTests();
  resetTurnRotationForTests();
  resetGoalStateForTests();
  writeDurableSoon('bridge-commands', null);
  await flushDurable();
  await setSecret('bridgeToken', '');
  token = null;
  await pair();
});

describe('turn rotation (#1402)', () => {
  it('simulates 24.8 hours of fresh-turn receipt cycles without duplicate prompts or changing the session', async () => {
    const chat = 'f0f00003-1111-4111-8111-000000000007';
    let clock = Date.now();
    const date = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const started = performance.now(), cpu = process.cpuUsage(), memory = process.memoryUsage();
    let sessionId: string | null = null;
    try {
      for (let cycle = 0; cycle < 48; cycle++) {
        const turn = `g-simulated-${cycle}`, page = `synthetic-page-${cycle}`;
        await events(chat, [{ kind: 'user_message', time: clock, messageId: `synthetic-question-${cycle}`, text: 'Continue the same synthetic task.' }]);
        const current = await turnFor(chat, turn, 0, 'gpt-6-thinking');
        if (sessionId === null) sessionId = current;
        expect(current).toBe(sessionId);
        clock += 31 * MINUTE;
        await attributedCall(chat);
        let rows = await listInputs();
        await vi.waitFor(async () => {
          rows = await listInputs();
          expect(rows.filter(row => row.sessionId === current && row.queuedTurn?.turnId === turn)).toHaveLength(1);
        });
        const row = rows.find(row => row.sessionId === current && row.queuedTurn?.turnId === turn)!;
        expect(await claimBrowserInput(row.id, page, chat, true)).not.toBeNull();
        expect(await authorizeBrowserInput(row.id, page, chat)).toBe(true);
        expect(await acknowledgeBrowserInput(row.id, page, chat, `synthetic-receipt-${cycle}`)).toBe(true);
        expect(await claimBrowserInput(row.id, page, chat, true)).toBeNull();
        await events(chat, [{ kind: 'turn_end', time: ++clock, turnId: turn, outcome: 'interrupted', continued: true }]);
      }
      const rows = (await listInputs()).filter(row => row.sessionId === sessionId && row.purpose === 'rotation');
      expect(rows).toHaveLength(48);
      expect(new Set(rows.map(row => row.id)).size).toBe(48);
      expect(rows.every(row => row.state === 'sent' && row.deliveredAt !== undefined)).toBe(true);
      const used = process.cpuUsage(cpu), after = process.memoryUsage();
      console.info('Simulated fresh-turn soak', { simulatedHours: 24.8, cycles: 48,
        elapsedMs: Math.round(performance.now() - started), cpuMs: Math.round((used.user + used.system) / 1000),
        heapDeltaBytes: after.heapUsed - memory.heapUsed, rssDeltaBytes: after.rss - memory.rss });
    } finally { date.mockRestore(); }
  });
  it('files one automatic continue into a turn older than 30 minutes, after its tool result', async () => {
    const chat = 'f0f00003-1111-4111-8111-000000000001';
    const sessionId = await turnFor(chat, 'g-rot-old-1', 31);
    await attributedCall(chat);
    const rows = await rotationsFor(sessionId);
    expect(rows).toEqual([{ turnId: 'g-rot-old-1', text: expect.stringContaining('Continue the task from where you are.') }]);
    await attributedCall(chat);
    expect(await rotationsFor(sessionId)).toHaveLength(1);
  });

  it.each(['off', 'goal', 'loop'] as const)('moves batched successor activity to its exact fresh turn (%s)', async mode => {
    const chat = `f0f00003-1111-4111-8111-0000000000${mode === 'off' ? '08' : mode === 'goal' ? '09' : '10'}`;
    const sessionId = await turnFor(chat, 'old-batched-turn', 1);
    if (mode !== 'off') await setGoalSwitchNow(chat, mode, true);
    await attributedCall(chat);
    await events(chat, [
      { kind: 'turn_end', time: Date.now(), turnId: 'old-batched-turn', outcome: 'interrupted', continued: true },
      { kind: 'turn_start', time: Date.now() + 1, turnId: 'fresh-batched-turn' }
    ]);
    await events(chat, [{ kind: 'assistant_message', time: Date.now() + 2, turnId: 'fresh-batched-turn',
      messageId: 'fresh-progress', text: 'Finishing the same task.', state: 'streaming' }]);
    expect(sessionInputActivity((await findSessionByConversation(chat))!)).toMatchObject({ possible: true, exact: true });
    await events(chat, [
      { kind: 'assistant_message', time: Date.now() + 3, turnId: 'fresh-batched-turn',
        messageId: 'fresh-progress', text: 'The requested work is complete.', state: 'final', final: true },
      { kind: 'turn_end', time: Date.now() + 4, turnId: 'fresh-batched-turn', outcome: 'completed' }
    ]);
    expect(sessionInputActivity((await findSessionByConversation(chat))!)).toMatchObject({ possible: false, exact: false });
    expect((await findSessionByConversation(chat))!.id).toBe(sessionId);
    // Replaying the old end and final cannot spend a newer source's grant.
    await events(chat, [{ kind: 'turn_start', time: Date.now() + 5, turnId: 'newest-turn' }]);
    await events(chat, [{ kind: 'assistant_message', time: Date.now() + 3, turnId: 'fresh-batched-turn',
      messageId: 'fresh-progress', text: 'The requested work is complete.', state: 'final', final: true }]);
    expect(sessionInputActivity((await findSessionByConversation(chat))!)).toMatchObject({ possible: true, exact: true });
  });

  it('cannot resurrect a successor after its final arrives during outbox revocation', async () => {
    const chat = 'f0f00003-1111-4111-8111-000000000011';
    await turnFor(chat, 'race-old-turn', 1);
    await attributedCall(chat);
    const input = await import('../src/main/session/input.js');
    const revoke = input.revokeSilenceInputs;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const paused = vi.spyOn(input, 'revokeSilenceInputs').mockImplementationOnce(async id => {
      enter(); await gate; return revoke(id);
    });
    let first: Promise<unknown> | undefined;
    try {
      first = events(chat, [
        { kind: 'turn_end', time: Date.now(), turnId: 'race-old-turn', outcome: 'interrupted', continued: true },
        { kind: 'turn_start', time: Date.now() + 1, turnId: 'race-fresh-turn' }
      ]);
      await entered;
      await events(chat, [
        { kind: 'assistant_message', time: Date.now() + 2, turnId: 'race-fresh-turn',
          messageId: 'race-fresh-final', text: 'The requested work is complete.', state: 'final', final: true },
        { kind: 'turn_end', time: Date.now() + 3, turnId: 'race-fresh-turn', outcome: 'completed' }
      ]);
      release(); await first;
      expect(sessionInputActivity((await findSessionByConversation(chat))!)).toMatchObject({ possible: false, exact: false });
    } finally { release(); await first; paused.mockRestore(); }
  });

  it('leaves a younger turn alone', async () => {
    const chat = 'f0f00003-1111-4111-8111-000000000002';
    const sessionId = await turnFor(chat, 'g-rot-young-1', 10);
    await attributedCall(chat);
    expect(await rotationsFor(sessionId)).toEqual([]);
  });

  it('leaves Pro turns alone, which think long on purpose', async () => {
    const chat = 'f0f00003-1111-4111-8111-000000000003';
    const sessionId = await turnFor(chat, 'g-rot-pro-1', 45, 'GPT-6 Pro');
    await attributedCall(chat);
    expect(await rotationsFor(sessionId)).toEqual([]);
  });

  it.each(['goal', 'loop'] as const)('leaves a chat with %s on alone, which decides on turn ends', async (which) => {
    const chat = `f0f00003-1111-4111-8111-00000000000${which === 'goal' ? 4 : 6}`;
    const sessionId = await turnFor(chat, `g-rot-${which}-1`, 31);
    await setGoalSwitchNow(chat, which, true);
    await attributedCall(chat);
    expect(await rotationsFor(sessionId)).toEqual([]);
  });

  it('is off at 0 minutes', async () => {
    const config = defaultConfig();
    await saveConfig({ ...config, sessions: { ...config.sessions, record: true }, ui: { ...config.ui, rotateTurnMinutes: 0 } });
    try {
      const chat = 'f0f00003-1111-4111-8111-000000000005';
      const sessionId = await turnFor(chat, 'g-rot-off-1', 90);
      await attributedCall(chat);
      expect(await rotationsFor(sessionId)).toEqual([]);
    } finally {
      await saveConfig({ ...config, sessions: { ...config.sessions, record: true }, ui: { ...config.ui, rotateTurnMinutes: 30 } });
    }
  });
});
