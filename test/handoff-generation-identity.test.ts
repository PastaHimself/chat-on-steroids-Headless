import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { recordChatObservations, resetRecorderForTests } from '../src/main/session/recorder.js';
import { appendEvent, flushSessions, initSessionStore, readHandoffResponse, readEvents, resetSessionStoreForTests } from '../src/main/session/store.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let directory: string;
const chat = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const token = 'exact-handoff-token';
const anchor = 'native-handoff-question';
const provider = '11111111-2222-4333-8444-555555555555';
const text = 'TASK\nPreserve the original work and verify the remaining implementation.';
beforeEach(async () => {
  directory = await makeTempDir('cos-handoff-identity-');
  initConfigPath(directory); initSessionStore(directory);
  await saveConfig(defaultConfig());
});
afterEach(async () => {
  await flushSessions(); resetRecorderForTests(); resetSessionStoreForTests(); await removeTempDir(directory);
});
async function begin() {
  const result = await recordChatObservations(chat, [
    { kind: 'user_message', time: 1, messageId: anchor, text: `[[CLF-HANDOFF:${token}]]\nWrite a handoff.` },
    { kind: 'turn_start', time: 2, turnId: 'original-generation' }
  ]);
  return result.sessionId!;
}
async function restart() {
  await flushSessions(); resetRecorderForTests(); resetSessionStoreForTests(); initSessionStore(directory);
}
const final = (turnId?: string) => ({ kind: 'assistant_message' as const, time: 4, messageId: 'canonical-final',
  providerMessageId: provider, text, final: true, state: 'final' as const, ...(turnId ? { turnId } : {}) });

it.each([false, true])('recovers an unidentified final only by its exact durable terminal UUID (restart=%s)', async cold => {
  const id = await begin();
  await recordChatObservations(chat, [final(), { kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed', providerMessageId: provider }]);
  if (cold) await restart();
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'complete', text, messageId: 'canonical-final' });
});

it.each(['absent', 'different-final', 'failed', 'unnamed-boundary'] as const)('refuses a genuinely unproved final (%s)', async mode => {
  const id = await begin();
  await recordChatObservations(chat, [final()]);
  await appendEvent(id, { kind: 'turn_end', source: 'extension', time: 5,
    ...(mode !== 'unnamed-boundary' ? { turnId: 'original-generation' } : {}),
    outcome: mode === 'failed' ? 'failed' : 'completed',
    ...(mode === 'absent' ? {} : { providerMessageId: mode === 'different-final' ? randomUUID() : provider }) });
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'ambiguous', reason: 'generation-unidentified' });
});

it('retains strict generation ownership without needing native UUID recovery', async () => {
  const id = await begin();
  await recordChatObservations(chat, [final('original-generation'), { kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed' }]);
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'complete', text });
});

it('collects the same final after late exact evidence arrives without changing old records', async () => {
  const id = await begin();
  await recordChatObservations(chat, [final()]);
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ reason: 'generation-unidentified' });
  await restart();
  await recordChatObservations(chat, [{ kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed', providerMessageId: provider }]);
  for (let n = 0; n < 3; n++) expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'complete', text });
});

it('refuses two generations even when both claim the same terminal UUID', async () => {
  const id = await begin();
  await recordChatObservations(chat, [final(),
    { kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed', providerMessageId: provider },
    { kind: 'turn_start', time: 6, turnId: 'regenerated' },
    { kind: 'turn_end', time: 7, turnId: 'regenerated', outcome: 'completed', providerMessageId: provider }]);
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'ambiguous' });
});

it('does not borrow terminal proof across a newer authored question', async () => {
  const id = await begin();
  await recordChatObservations(chat, [final(),
    { kind: 'user_message', time: 5, messageId: 'different-question', text: 'Do another task.' },
    { kind: 'turn_start', time: 6, turnId: 'other-generation' },
    { kind: 'turn_end', time: 7, turnId: 'other-generation', outcome: 'completed', providerMessageId: provider }]);
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ reason: 'generation-unidentified' });
});

it.each([false, true])('enriches an already completed boundary with late exact terminal proof once (restart=%s)', async cold => {
  const id = await begin();
  await recordChatObservations(chat, [final(), { kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed' }]);
  if (cold) await restart();
  const proof = { kind: 'turn_end' as const, time: 6, turnId: 'original-generation', outcome: 'completed' as const, providerMessageId: provider };
  const result = await recordChatObservations(chat, [proof]);
  expect(result.activity.terminal).toBe(false);
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'complete', text });
  const ends = await readEvents(id, { kinds: ['turn_end'] });
  await recordChatObservations(chat, [proof]);
  expect(await readEvents(id, { kinds: ['turn_end'] })).toEqual(ends);
});

it.each(['new-question', 'reopened', 'failed', 'conflicting-proof'] as const)('does not enrich an obsolete or contradictory completed boundary (%s)', async mode => {
  const id = await begin();
  await recordChatObservations(chat, [final(), { kind: 'turn_end', time: 5, turnId: 'original-generation',
    outcome: mode === 'failed' ? 'failed' : 'completed', ...(mode === 'conflicting-proof' ? { providerMessageId: randomUUID() } : {}) }]);
  if (mode === 'new-question') await recordChatObservations(chat, [{ kind: 'user_message', time: 6, messageId: 'new-user', text: 'Next task.' }]);
  if (mode === 'reopened') await appendEvent(id, { kind: 'turn_start', time: 6, turnId: 'original-generation', source: 'app' });
  await restart();
  const before = await readEvents(id, { kinds: ['turn_end'] });
  await recordChatObservations(chat, [{ kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed', providerMessageId: provider }]);
  expect(await readEvents(id, { kinds: ['turn_end'] })).toEqual(before);
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'ambiguous' });
});

it.each([false, true])('refuses a final that contradicts the latest native terminal UUID (named=%s)', async named => {
  const id = await begin();
  await recordChatObservations(chat, [final(named ? 'original-generation' : undefined),
    { kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed', providerMessageId: randomUUID() }]);
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'ambiguous' });
});

it.each(['different-uuid', 'no-uuid', 'still-open'] as const)('never reuses terminal proof across a same-id reopen (%s)', async mode => {
  const id = await begin();
  await recordChatObservations(chat, [{ kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed', providerMessageId: provider }]);
  // Publication ordering owns lifecycle, even if a replay carries an older timestamp.
  await appendEvent(id, { kind: 'turn_start', source: 'app', time: 2, turnId: 'original-generation' });
  if (mode !== 'still-open') await appendEvent(id, { kind: 'turn_end', source: 'extension', time: 3,
    turnId: 'original-generation', outcome: 'completed', ...(mode === 'different-uuid' ? { providerMessageId: randomUUID() } : {}) });
  await recordChatObservations(chat, [final()]);
  await restart();
  expect((await readHandoffResponse(id, chat, anchor, token)).status).not.toBe('complete');
});

it('does not capture an old named final after a same-id reopen without fresh final content', async () => {
  const id = await begin();
  await recordChatObservations(chat, [final('original-generation'), { kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed' }]);
  await appendEvent(id, { kind: 'turn_start', source: 'app', time: 2, turnId: 'original-generation' });
  await appendEvent(id, { kind: 'turn_end', source: 'extension', time: 3, turnId: 'original-generation', outcome: 'completed' });
  expect((await readHandoffResponse(id, chat, anchor, token)).status).not.toBe('complete');
});

it('captures fresh final content after a same-id reopen and restart', async () => {
  const id = await begin();
  await recordChatObservations(chat, [final('original-generation'), { kind: 'turn_end', time: 5,
    turnId: 'original-generation', outcome: 'completed', providerMessageId: provider }]);
  await appendEvent(id, { kind: 'turn_start', source: 'app', time: 2, turnId: 'original-generation' });
  await restart();
  const fresh = { ...final('original-generation'), time: 7, text: `${text}\nFresh work after reopening.` };
  await recordChatObservations(chat, [fresh, { kind: 'turn_end', time: 8,
    turnId: 'original-generation', outcome: 'completed', providerMessageId: provider }]);
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'complete', text: fresh.text });
});

it.each([false, true])('ignores only an independently recorded pre-handoff turn end (restart=%s)', async cold => {
  const earlier = await recordChatObservations(chat, [
    { kind: 'user_message', time: 1, messageId: 'earlier-question', text: 'Original task' },
    { kind: 'turn_start', time: 2, turnId: 'interrupted-before-handoff' }
  ]);
  const id = earlier.sessionId!;
  await recordChatObservations(chat, [
    { kind: 'user_message', time: 3, messageId: anchor, text: `[[CLF-HANDOFF:${token}]]\nWrite a handoff.` },
    { kind: 'turn_start', time: 4, turnId: 'handoff-generation' },
    { ...final('handoff-generation'), time: 5 },
    { kind: 'turn_end', time: 6, turnId: 'handoff-generation', outcome: 'completed', providerMessageId: provider }
  ]);
  await appendEvent(id, { kind: 'turn_end', source: 'extension', time: 7,
    turnId: 'interrupted-before-handoff', outcome: 'interrupted' });
  if (cold) await restart();
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'complete', text });
});

it('does not discard a competing generation merely because its start was lost', async () => {
  const id = await begin();
  await recordChatObservations(chat, [final('original-generation'),
    { kind: 'turn_end', time: 5, turnId: 'original-generation', outcome: 'completed', providerMessageId: provider }]);
  await appendEvent(id, { kind: 'turn_end', source: 'extension', time: 6,
    turnId: 'unknown-generation-after-reload', outcome: 'completed', providerMessageId: randomUUID() });
  expect(await readHandoffResponse(id, chat, anchor, token)).toMatchObject({ status: 'ambiguous', reason: 'multiple-generations' });
});
