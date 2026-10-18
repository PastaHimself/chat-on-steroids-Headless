import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { faultGate, makeTempDir, removeTempDir } from './helpers.js';
import type { GoalObjectivesSnapshot, GoalSwitchesSnapshot } from '../src/main/goal.js';

vi.mock('electron', () => ({
  app: { getPath: () => '', getVersion: () => '0.0.0' },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value: string) => Buffer.from(value),
    decryptStringAsync: async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false })
  }
}));

const { defaultConfig, initConfigPath, saveConfig } = await import('../src/main/config.js');
const { initDurableStore, resetDurableForTests, flushDurable, readDurable, writeDurableNow } = await import('../src/main/durable.js');
const { initSessionStore, resetSessionStoreForTests } = await import('../src/main/session/store.js');
const goal = await import('../src/main/goal.js');
const SOURCE = 'control-source';
const TARGET = 'control-target';
let directory: string;
let releaseWrites: Array<() => void>;
let operations: Promise<unknown>[];

beforeEach(async () => {
  directory = await makeTempDir('cos-goal-control-');
  releaseWrites = []; operations = [];
  initConfigPath(directory); initDurableStore(directory); initSessionStore(directory);
  goal.resetGoalStateForTests();
  await saveConfig({ ...defaultConfig(), goal: { ...defaultConfig().goal, enabled: false, backend: 'templates' } });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected provider call'); }));
});
afterEach(async () => {
  for (const release of releaseWrites) release();
  await Promise.all(operations);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await flushDurable();
  goal.resetGoalStateForTests(); resetSessionStoreForTests(); resetDurableForTests();
  await removeTempDir(directory);
});

/** Pause the real durable writer immediately before its rename, without replacing its queue. */
function delayedWrite(name: string, reject = false) {
  const gate = faultGate(), rename = fs.rename.bind(fs);
  let first = true;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (first && path.basename(String(to)) === `${name}.json`) {
      first = false;
      await gate.hold();
      if (reject) throw new Error(`Rejected ${name} rename`);
    }
    return rename(from, to);
  });
  releaseWrites.push(gate.release);
  return gate;
}
function observe<T>(operation: Promise<T>) {
  const result = operation.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  operations.push(result);
  return result;
}
async function storedControls() {
  await flushDurable();
  const switches = await readDurable<GoalSwitchesSnapshot>(goal.GOAL_SWITCHES_STATE);
  const objectives = await readDurable<GoalObjectivesSnapshot>(goal.GOAL_OBJECTIVES_STATE);
  return { switches: switches?.switches ?? [], objectives: objectives?.objectives ?? [] };
}

it('withholds switch send authority and published snapshots until the actual rename succeeds', async () => {
  const gate = delayedWrite(goal.GOAL_SWITCHES_STATE);
  const save = observe(goal.setGoalSwitchNow(SOURCE, 'loop', true, true));
  await gate.entered;
  expect(goal.goalArmedFor(SOURCE)).toBe(false);
  expect(goal.automaticFinishEnabled(SOURCE)).toBe(false);
  expect(goal.snapshotGoalSwitches().switches).toEqual([]);
  expect(await readDurable(goal.GOAL_SWITCHES_STATE)).toBeNull();
  gate.release();
  expect((await save).value).toEqual({ enabled: true, mode: 'loop' });
  expect(goal.goalSwitchFor(SOURCE)).toMatchObject({ own: true, enabled: true, mode: 'loop', afterTurn: true });
  expect((await storedControls()).switches).toContainEqual(expect.objectContaining({ conversationId: SOURCE, enabled: true }));
});

it('withholds objective-based activation until its actual rename succeeds', async () => {
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE);
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Finish the accepted task'));
  await gate.entered;
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  expect(goal.goalArmedFor(SOURCE)).toBe(false);
  expect(goal.snapshotGoalObjectives().objectives).toEqual([]);
  gate.release();
  expect((await save).value).toBe('Finish the accepted task');
  expect(goal.goalArmedFor(SOURCE)).toBe(true);
  expect((await storedControls()).objectives).toEqual([{ conversationId: SOURCE, objective: 'Finish the accepted task' }]);
});

it('does not erase a newer Goal reply when an older durable acceptance fails', async () => {
  const gate = delayedWrite(goal.GOAL_REPLIES_STATE, true);
  const older = observe(goal.acceptGoalReplyNow({
    conversationId: SOURCE, sessionId: 'session-one', replyId: 'reply-one',
    turnId: 'turn-one', eventSeq: 1, blocked: false, handledOnly: true
  }));
  await gate.entered;
  const newer = observe(goal.acceptGoalReplyNow({
    conversationId: SOURCE, sessionId: 'session-one', replyId: 'reply-two',
    turnId: 'turn-two', eventSeq: 2, blocked: false, handledOnly: true
  }));
  expect(goal.snapshotGoalReplies().replies).toContainEqual(expect.objectContaining({ replyId: 'reply-two' }));
  gate.release();
  expect((await older).error).toBeInstanceOf(Error);
  expect((await newer).error).toBeUndefined();
  expect(goal.snapshotGoalReplies().replies).toContainEqual(expect.objectContaining({ replyId: 'reply-two' }));
  await flushDurable();
  const persisted = await readDurable<import('../src/main/goal.js').GoalRepliesSnapshot>(goal.GOAL_REPLIES_STATE);
  expect(persisted?.replies).toContainEqual(expect.objectContaining({ replyId: 'reply-two' }));
});

it('does not consume the one native Stop claim when its durable write fails', async () => {
  const acceptedAt = Date.now();
  goal.restoreGoalSwitches({ version: 1, savedAt: acceptedAt, switches: [
    { conversationId: SOURCE, enabled: true, mode: 'goal', at: acceptedAt }
  ] });
  goal.restoreGoalReplies({ version: 1, savedAt: acceptedAt, replies: [
    { conversationId: SOURCE, sessionId: 'session-one', replyId: 'reply-stop', turnId: 'turn-one',
      eventSeq: 1, acceptedAt, state: 'pending', listenUntil: acceptedAt - 1 }
  ] });
  const gate = delayedWrite(goal.GOAL_REPLIES_STATE, true);
  const claim = observe(goal.claimGoalRecoveryStopNow(SOURCE, 'reply-stop', acceptedAt));
  await gate.entered;
  gate.release();
  expect((await claim).error).toBeInstanceOf(Error);
  const pending = goal.snapshotGoalReplies().replies.find(reply => reply.replyId === 'reply-stop');
  expect(pending?.state).toBe('pending');
  expect(pending?.recoveryStopClaimed).toBeUndefined();
  expect(await goal.claimGoalRecoveryStopNow(SOURCE, 'reply-stop', acceptedAt)).toBe(true);
});

it('retains the newest Goal obligation through 4 to 72 simulated hours and restart restores', async () => {
  const start = Date.now();
  goal.restoreGoalSwitches({ version: 1, savedAt: start, switches: [
    { conversationId: SOURCE, enabled: true, mode: 'goal', at: start }
  ] });
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    for (const [index, hours] of [4, 8, 12, 24, 48, 72].entries()) {
      vi.setSystemTime(start + hours * 60 * 60_000);
      await goal.acceptGoalReplyNow({ conversationId: SOURCE, sessionId: 'session-one',
        replyId: `reply-${hours}`, turnId: `turn-${hours}`, eventSeq: index + 1, blocked: false });
      expect(goal.goalPendingReplyFor(SOURCE)?.replyId).toBe(`reply-${hours}`);
      goal.restoreGoalReplies(goal.snapshotGoalReplies());
      expect(goal.pendingGoalReplies().filter(row => row.conversationId === SOURCE)).toHaveLength(1);
      expect(goal.goalPendingReplyFor(SOURCE)?.replyId).toBe(`reply-${hours}`);
    }
  } finally {
    vi.useRealTimers();
  }
});

it.each([false, true])('never restores a cleared switch after a delayed save (rename rejected=%s)', async reject => {
  await goal.setGoalSwitchNow(SOURCE, 'goal', true);
  const gate = delayedWrite(goal.GOAL_SWITCHES_STATE, reject);
  const save = observe(goal.setGoalSwitchNow(SOURCE, 'loop', true));
  await gate.entered;
  goal.clearGoalSwitch(SOURCE);
  gate.release();
  expect((await save).error).toBeInstanceOf(Error);
  expect(goal.goalSwitchFor(SOURCE)).toMatchObject({ own: false, enabled: false });
  const stored = await storedControls();
  expect(stored.switches).toEqual([]);
  goal.restoreGoalSwitches({ version: 1, savedAt: 1, switches: stored.switches });
  expect(goal.goalArmedFor(SOURCE)).toBe(false);
});

it.each([false, true])('moves only the accepted switch and never resurrects its source (rename rejected=%s)', async reject => {
  await goal.setGoalSwitchNow(SOURCE, 'goal', true, false);
  const gate = delayedWrite(goal.GOAL_SWITCHES_STATE, reject);
  const save = observe(goal.setGoalSwitchNow(SOURCE, 'loop', true, true));
  await gate.entered;
  expect(goal.moveGoalSwitch(SOURCE, TARGET)).toBe(true);
  expect(goal.goalSwitchFor(TARGET)).toMatchObject({ enabled: true, mode: 'goal', afterTurn: false });
  expect(goal.goalSwitchFor(SOURCE).own).toBe(false);
  gate.release();
  expect((await save).error).toBeInstanceOf(Error);
  const stored = await storedControls();
  expect(stored.switches).toEqual([expect.objectContaining({ conversationId: TARGET, enabled: true, mode: 'goal', afterTurn: false })]);
  goal.restoreGoalSwitches({ version: 1, savedAt: 1, switches: stored.switches });
  expect(goal.goalSwitchFor(SOURCE).own).toBe(false);
  expect(goal.goalSwitchFor(TARGET).mode).toBe('goal');
});

it('retires even a not-yet-started source save when synchronous resume movement has no accepted row', async () => {
  const gate = delayedWrite(goal.GOAL_SWITCHES_STATE);
  const blocker = observe(goal.setGoalSwitchNow('unrelated-control', 'goal', true));
  await gate.entered;
  const source = observe(goal.setGoalSwitchNow(SOURCE, 'loop', true));
  expect(goal.moveGoalSwitch(SOURCE, TARGET)).toBe(false);
  gate.release();
  expect((await blocker).error).toBeUndefined();
  expect((await source).error).toBeInstanceOf(Error);
  expect(goal.goalSwitchFor(SOURCE).own).toBe(false);
  expect((await storedControls()).switches).toEqual([expect.objectContaining({ conversationId: 'unrelated-control' })]);
});

it('master clear retires queued enables even when their overrides have never been published', async () => {
  const gate = delayedWrite(goal.GOAL_SWITCHES_STATE);
  const first = observe(goal.setGoalSwitchNow(SOURCE, 'goal', true));
  await gate.entered;
  const second = observe(goal.setGoalSwitchNow(TARGET, 'loop', true));
  goal.clearAllGoalSwitches();
  gate.release();
  expect((await first).error).toBeInstanceOf(Error);
  expect((await second).error).toBeInstanceOf(Error);
  expect((await storedControls()).switches).toEqual([]);
  expect(goal.goalArmedFor(SOURCE)).toBe(false);
  expect(goal.goalArmedFor(TARGET)).toBe(false);
});

it('preserves a newer explicit Off after an earlier write rejects', async () => {
  await goal.setGoalSwitchNow(SOURCE, 'loop', true, true);
  const gate = delayedWrite(goal.GOAL_SWITCHES_STATE, true);
  const older = observe(goal.setGoalSwitchNow(SOURCE, 'loop', true, false));
  await gate.entered;
  const off = observe(goal.setGoalSwitchNow(SOURCE, 'loop', false));
  gate.release();
  expect((await older).error).toBeInstanceOf(Error);
  expect((await off).value).toEqual({ enabled: false, mode: 'loop' });
  expect(goal.goalSwitchFor(SOURCE)).toMatchObject({ own: true, enabled: false, mode: 'loop', afterTurn: true });
  expect((await storedControls()).switches).toContainEqual(expect.objectContaining({ conversationId: SOURCE, enabled: false, afterTurn: true }));
});

it('an Off captured from the published mode cannot be defeated by an unaccepted mode switch', async () => {
  await goal.setGoalSwitchNow(SOURCE, 'goal', false);
  const gate = delayedWrite(goal.GOAL_SWITCHES_STATE);
  const enable = observe(goal.setGoalSwitchNow(SOURCE, 'loop', true));
  await gate.entered;
  expect(goal.goalSwitchFor(SOURCE)).toMatchObject({ enabled: false, mode: 'goal' });
  const off = observe(goal.setGoalSwitchNow(SOURCE, 'goal', false));
  gate.release();
  expect((await enable).error).toBeInstanceOf(Error);
  expect((await off).value).toEqual({ enabled: false, mode: 'goal' });
  expect((await storedControls()).switches).toEqual([expect.objectContaining({ conversationId: SOURCE, enabled: false, mode: 'goal' })]);
  await goal.setGoalSwitchNow(SOURCE, 'loop', true);
  // An already accepted different mode retains the existing two-switch semantics.
  await goal.setGoalSwitchNow(SOURCE, 'goal', false);
  expect(goal.goalSwitchFor(SOURCE)).toMatchObject({ enabled: true, mode: 'loop' });
});

it('bounds rebasing and repair under unrelated concurrent changes without accepting the proposal', async () => {
  const rename = fs.rename.bind(fs); let count = 0;
  const watched = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (path.basename(String(to)) === `${goal.GOAL_OBJECTIVES_STATE}.json`) {
      count++;
      goal.setGoalObjective(TARGET, `Concurrent accepted edit ${count}`);
    }
    return rename(from, to);
  });
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Unaccepted proposal'));
  expect((await save).error).toMatchObject({ message: expect.stringContaining('kept changing') });
  expect(count).toBeLessThanOrEqual(12);
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  watched.mockRestore();
  expect((await storedControls()).objectives).toEqual([{ conversationId: TARGET, objective: `Concurrent accepted edit ${count}` }]);
});

it.each([false, true])('retargets an in-flight objective save on move when its write succeeds (rename rejected=%s)', async reject => {
  await goal.setGoalObjectiveNow(SOURCE, 'Accepted original objective');
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE, reject);
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Replacement objective'));
  await gate.entered;
  expect(goal.moveGoalObjective(SOURCE, TARGET)).toBe(true);
  expect(goal.goalObjectiveFor(TARGET)).toBe('Accepted original objective');
  gate.release();
  const result = await save;
  if (reject) expect(result.error).toBeInstanceOf(Error);
  else expect(result.value).toBe('Replacement objective');
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  const stored = await storedControls();
  expect(stored.objectives).toEqual([{
    conversationId: TARGET,
    objective: reject ? 'Accepted original objective' : 'Replacement objective'
  }]);
  goal.restoreGoalObjectives({ version: 1, savedAt: 1, objectives: stored.objectives });
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  expect(goal.goalObjectiveFor(TARGET)).toBe(reject ? 'Accepted original objective' : 'Replacement objective');
});

it('moves a pending objective save even when the source has no accepted row yet', async () => {
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE);
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'First accepted objective'));
  await gate.entered;
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  expect(goal.moveGoalObjective(SOURCE, TARGET)).toBe(true);
  expect(goal.goalObjectiveFor(TARGET)).toBe('');
  gate.release();
  expect((await save).value).toBe('First accepted objective');
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  expect(goal.goalObjectiveFor(TARGET)).toBe('First accepted objective');
  expect((await storedControls()).objectives).toEqual([
    { conversationId: TARGET, objective: 'First accepted objective' }
  ]);
});

it('retargets a queued objective save before its first durable write starts', async () => {
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE);
  const blocker = observe(goal.setGoalObjectiveNow('unrelated-control', 'Unrelated objective'));
  await gate.entered;
  const source = observe(goal.setGoalObjectiveNow(SOURCE, 'Queued source objective'));
  expect(goal.moveGoalObjective(SOURCE, TARGET)).toBe(true);
  gate.release();
  expect((await blocker).value).toBe('Unrelated objective');
  expect((await source).value).toBe('Queued source objective');
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  expect(goal.goalObjectiveFor(TARGET)).toBe('Queued source objective');
  expect((await storedControls()).objectives).toEqual(expect.arrayContaining([
    { conversationId: 'unrelated-control', objective: 'Unrelated objective' },
    { conversationId: TARGET, objective: 'Queued source objective' }
  ]));
});

it.each(['set', 'clear'] as const)('a newer synchronous %s supersedes an in-flight objective save', async mutation => {
  await goal.setGoalObjectiveNow(SOURCE, 'Accepted baseline');
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE);
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Obsolete replacement'));
  await gate.entered;
  if (mutation === 'set') goal.setGoalObjective(SOURCE, 'Newer synchronous objective');
  else goal.clearGoalObjective(SOURCE);
  gate.release();
  expect((await save).error).toBeInstanceOf(Error);
  expect(goal.goalObjectiveFor(SOURCE)).toBe(mutation === 'set' ? 'Newer synchronous objective' : '');
  const stored = await storedControls();
  expect(stored.objectives).toEqual(mutation === 'set'
    ? [{ conversationId: SOURCE, objective: 'Newer synchronous objective' }]
    : []);
});

it.each(['set', 'clear', 'move'] as const)('rebases a durable objective save around another chat\'s synchronous %s', async mutation => {
  const neighbor = 'neighbor-control';
  const moved = 'neighbor-control-moved';
  await goal.setGoalObjectiveNow(neighbor, 'Neighbor before');
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE);
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Source accepted objective'));
  await gate.entered;
  if (mutation === 'set') goal.setGoalObjective(neighbor, 'Neighbor after');
  if (mutation === 'clear') goal.clearGoalObjective(neighbor);
  if (mutation === 'move') expect(goal.moveGoalObjective(neighbor, moved)).toBe(true);
  gate.release();
  expect((await save).value).toBe('Source accepted objective');
  const rows = (await storedControls()).objectives;
  expect(rows).toContainEqual({ conversationId: SOURCE, objective: 'Source accepted objective' });
  if (mutation === 'set') expect(rows).toContainEqual({ conversationId: neighbor, objective: 'Neighbor after' });
  if (mutation === 'clear') expect(rows.some(row => row.conversationId === neighbor)).toBe(false);
  if (mutation === 'move') {
    expect(rows.some(row => row.conversationId === neighbor)).toBe(false);
    expect(rows).toContainEqual({ conversationId: moved, objective: 'Neighbor before' });
  }
});

it('restore fences an in-flight objective completion and repairs disk to the restored projection', async () => {
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE);
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Stale pending objective'));
  await gate.entered;
  goal.restoreGoalObjectives({
    version: 1,
    savedAt: 1,
    objectives: [{ conversationId: TARGET, objective: 'Restored objective' }]
  });
  gate.release();
  expect((await save).error).toBeInstanceOf(Error);
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  expect(goal.goalObjectiveFor(TARGET)).toBe('Restored objective');
  expect((await storedControls()).objectives).toEqual([
    { conversationId: TARGET, objective: 'Restored objective' }
  ]);
});

it('reset fences an in-flight objective completion from repopulating fresh state', async () => {
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE);
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Stale pending objective'));
  await gate.entered;
  goal.resetGoalStateForTests();
  gate.release();
  expect((await save).error).toBeInstanceOf(Error);
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  expect((await storedControls()).objectives).toEqual([]);
});

it.each([false, true])('never restores a cleared objective after its delayed save (rename rejected=%s)', async reject => {
  await goal.setGoalObjectiveNow(SOURCE, 'Accepted objective');
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE, reject);
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Unaccepted objective'));
  await gate.entered;
  goal.clearGoalObjective(SOURCE);
  gate.release();
  expect((await save).error).toBeInstanceOf(Error);
  expect(goal.goalObjectiveFor(SOURCE)).toBe('');
  expect((await storedControls()).objectives).toEqual([]);
});

it('does not mistake an objective clear-and-restore for unchanged ownership', async () => {
  await goal.setGoalObjectiveNow(SOURCE, 'Original objective');
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE);
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Obsolete replacement'));
  await gate.entered;
  goal.clearGoalObjective(SOURCE);
  goal.setGoalObjective(SOURCE, 'Original objective');
  gate.release();
  expect((await save).error).toBeInstanceOf(Error);
  expect(goal.goalObjectiveFor(SOURCE)).toBe('Original objective');
  expect((await storedControls()).objectives).toEqual([{ conversationId: SOURCE, objective: 'Original objective' }]);
});

it('serializes a newer objective save without exposing either unfinished write', async () => {
  await goal.setGoalObjectiveNow(SOURCE, 'Accepted baseline');
  const gate = delayedWrite(goal.GOAL_OBJECTIVES_STATE, true);
  const older = observe(goal.setGoalObjectiveNow(SOURCE, 'Rejected first save'));
  await gate.entered;
  const newer = observe(goal.setGoalObjectiveNow(SOURCE, 'Accepted newer save'));
  expect(goal.goalObjectiveFor(SOURCE)).toBe('Accepted baseline');
  gate.release();
  expect((await older).error).toBeInstanceOf(Error);
  expect((await newer).value).toBe('Accepted newer save');
  expect(goal.goalObjectiveFor(SOURCE)).toBe('Accepted newer save');
  expect((await storedControls()).objectives).toEqual([{ conversationId: SOURCE, objective: 'Accepted newer save' }]);
});

it('rebases a valid switch save around an unrelated synchronous clear without losing either change', async () => {
  await goal.setGoalSwitchNow(TARGET, 'goal', true);
  const gate = delayedWrite(goal.GOAL_SWITCHES_STATE);
  const save = observe(goal.setGoalSwitchNow(SOURCE, 'loop', true, true));
  await gate.entered;
  goal.clearGoalSwitch(TARGET);
  gate.release();
  expect((await save).value).toEqual({ enabled: true, mode: 'loop' });
  expect((await storedControls()).switches).toEqual([expect.objectContaining({ conversationId: SOURCE, enabled: true, mode: 'loop', afterTurn: true })]);
  expect(goal.goalSwitchFor(TARGET).own).toBe(false);
});

it('does not evict an accepted Off during an uncommitted helper registration at capacity', async () => {
  await saveConfig({ ...defaultConfig(), goal: { ...defaultConfig().goal, enabled: true } });
  goal.restoreGoalSwitches({ version: 1, savedAt: 1, switches: Array.from({ length: 400 }, (_, index) => ({
    conversationId: `accepted-off-${index}`, enabled: false, mode: 'goal', at: index + 1
  })) });
  await writeDurableNow(goal.GOAL_SWITCHES_STATE, goal.snapshotGoalSwitches());
  const gate = delayedWrite(goal.GOAL_SWITCHES_STATE, true);
  const registration = observe(goal.registerGoalDecisionChat('unaccepted-helper'));
  await gate.entered;
  expect(goal.goalSwitchFor('accepted-off-0')).toMatchObject({ own: true, enabled: false });
  expect(goal.goalArmedFor('accepted-off-0')).toBe(false);
  expect(goal.isGoalDecisionChat('unaccepted-helper')).toBe(false);
  gate.release();
  expect((await registration).error).toBeInstanceOf(Error);
  expect((await storedControls()).switches).toHaveLength(400);
  expect(goal.goalSwitchFor('accepted-off-0').enabled).toBe(false);
});

it('rechecks movement during the corrective write before returning the original failure', async () => {
  await goal.setGoalSwitchNow(SOURCE, 'goal', true, true);
  const failed = faultGate(), repair = faultGate(), rename = fs.rename.bind(fs);
  releaseWrites.push(failed.release, repair.release);
  let writes = 0;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (path.basename(String(to)) === `${goal.GOAL_SWITCHES_STATE}.json`) {
      writes++;
      if (writes === 1) { await failed.hold(); throw new Error('Original switch save failed'); }
      if (writes === 2) await repair.hold();
    }
    return rename(from, to);
  });
  const save = observe(goal.setGoalSwitchNow(SOURCE, 'loop', true, false));
  await failed.entered;
  failed.release();
  await repair.entered;
  expect(goal.moveGoalSwitch(SOURCE, TARGET)).toBe(true);
  repair.release();
  expect((await save).error).toMatchObject({ message: 'Original switch save failed' });
  // Do not flush: returning the error already joins the successful corrective write.
  const stored = await readDurable<GoalSwitchesSnapshot>(goal.GOAL_SWITCHES_STATE);
  expect(stored?.switches).toEqual([expect.objectContaining({ conversationId: TARGET, enabled: true, mode: 'goal', afterTurn: true })]);
  expect(goal.goalSwitchFor(SOURCE).own).toBe(false);
  expect(writes).toBe(3);
});

it('leaves only accepted objective state retryable when the corrective write also fails', async () => {
  await goal.setGoalObjectiveNow(SOURCE, 'Accepted objective');
  const rename = fs.rename.bind(fs);
  const proposed: string[] = [];
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (path.basename(String(to)) === `${goal.GOAL_OBJECTIVES_STATE}.json`) {
      const snapshot = JSON.parse(await fs.readFile(from, 'utf8')) as GoalObjectivesSnapshot;
      proposed.push(snapshot.objectives[0]!.objective);
      if (proposed.length <= 2) throw new Error('Disk temporarily unavailable');
    }
    return rename(from, to);
  });
  const save = observe(goal.setGoalObjectiveNow(SOURCE, 'Rejected replacement'));
  expect((await save).error).toMatchObject({ message: 'Disk temporarily unavailable' });
  expect(goal.goalObjectiveFor(SOURCE)).toBe('Accepted objective');
  expect((await storedControls()).objectives).toEqual([{ conversationId: SOURCE, objective: 'Accepted objective' }]);
  expect(proposed).toEqual(['Rejected replacement', 'Accepted objective', 'Accepted objective']);
});

it('publishes combined objective, mode and reply rows only after all three durable commits', async () => {
  const { createSession } = await import('../src/main/session/store.js');
  const session = await createSession({ conversationId: SOURCE });
  const gate = delayedWrite('goal-replies');
  const saved = observe(goal.saveCombinedGoalControlsNow(session.id, SOURCE,
    { mode: 'loop', enabled: true, objective: 'Whole objective', active: true }, async () => undefined));
  await gate.entered;
  expect(goal.goalObjectiveFor(SOURCE)).toBe(''); expect(goal.goalSwitchFor(SOURCE).enabled).toBe(false);
  gate.release(); expect((await saved).error).toBeUndefined();
  expect(goal.goalObjectiveFor(SOURCE)).toBe('Whole objective'); expect(goal.goalSwitchFor(SOURCE).mode).toBe('loop');
  expect(await readDurable('goal-control-journal')).toMatchObject({ state: 'committed' });
});

it('repairs a combined save from current accepted owners after concurrent compaction', async () => {
  const { createSession } = await import('../src/main/session/store.js');
  const session = await createSession({ conversationId: SOURCE });
  await goal.setGoalObjectiveNow(SOURCE, 'Accepted objective');
  const gate = delayedWrite('goal-objectives');
  const saved = observe(goal.saveCombinedGoalControlsNow(session.id, SOURCE,
    { mode: 'loop', enabled: true, objective: 'Stale new objective', active: false }, async () => undefined));
  await gate.entered; goal.moveGoalObjective(SOURCE, TARGET); goal.moveGoalSwitch(SOURCE, TARGET); gate.release();
  expect((await saved).error).toBeDefined();
  expect(goal.goalObjectiveFor(SOURCE)).toBe(''); expect(goal.goalObjectiveFor(TARGET)).toBe('Accepted objective');
  expect(await readDurable('goal-control-journal')).toMatchObject({ state: 'superseded' });
  expect((await storedControls()).objectives).toEqual([{ conversationId: TARGET, objective: 'Accepted objective' }]);
});

it('restores an interrupted combined transaction before traffic and preserves unrelated owners', async () => {
  const { createSession } = await import('../src/main/session/store.js');
  const { stageGoalControlJournal, recoverGoalControlJournal } = await import('../src/main/goal-control-journal.js');
  const session = await createSession({ conversationId: SOURCE });
  const next = { conversationId: SOURCE, enabled: true, mode: 'loop', afterTurn: false, at: 1 };
  await stageGoalControlJournal(session.id, SOURCE, [null, null, null], [next, { conversationId: SOURCE, objective: 'Restored intent' }, null]);
  await writeDurableNow(goal.GOAL_SWITCHES_STATE, { version: 1, switches: [next] });
  await writeDurableNow(goal.GOAL_OBJECTIVES_STATE, { version: 1, objectives: [{ conversationId: TARGET, objective: 'Unrelated accepted work' }] });
  await recoverGoalControlJournal();
  expect(await readDurable(goal.GOAL_OBJECTIVES_STATE)).toMatchObject({ objectives: [
    { conversationId: TARGET, objective: 'Unrelated accepted work' }, { conversationId: SOURCE, objective: 'Restored intent' }
  ] });
  expect(await readDurable('goal-control-journal')).toMatchObject({ state: 'committed' });
});

it('refuses ambiguous recovery rather than overriding newer accepted Goal state', async () => {
  const { createSession } = await import('../src/main/session/store.js');
  const { stageGoalControlJournal, recoverGoalControlJournal } = await import('../src/main/goal-control-journal.js');
  const session = await createSession({ conversationId: SOURCE });
  await stageGoalControlJournal(session.id, SOURCE, [null, null, null], [null, { conversationId: SOURCE, objective: 'Old pending intent' }, null]);
  await writeDurableNow(goal.GOAL_OBJECTIVES_STATE, { version: 1, objectives: [{ conversationId: SOURCE, objective: 'Newer accepted intent' }] });
  await expect(recoverGoalControlJournal()).rejects.toThrow('newer change');
  expect(await readDurable(goal.GOAL_OBJECTIVES_STATE)).toMatchObject({ objectives: [{ conversationId: SOURCE, objective: 'Newer accepted intent' }] });
});

it('supersedes a failed initial journal write so its background retry cannot revive rejected intent', async () => {
  const { createSession } = await import('../src/main/session/store.js');
  const session = await createSession({ conversationId: SOURCE });
  const gate = delayedWrite('goal-control-journal', true);
  const saved = observe(goal.saveCombinedGoalControlsNow(session.id, SOURCE,
    { mode: 'loop', enabled: true, objective: 'Never accepted', active: false }, async () => undefined));
  await gate.entered; gate.release(); expect((await saved).error).toBeDefined();
  await flushDurable();
  expect(goal.goalObjectiveFor(SOURCE)).toBe(''); expect(goal.goalSwitchFor(SOURCE).enabled).toBe(false);
  expect(await readDurable('goal-control-journal')).toMatchObject({ state: 'superseded' });
  expect(goal.goalControlRecoveryNeeded()).toBe(false);
});

it.each(['worker', 'helper'] as const)('permits durable Off recovery for a %s while refusing activation and preserving helper identity', async kind => {
  const { createSession, setSessionOrigin } = await import('../src/main/session/store.js');
  const { recoverGoalControlJournal } = await import('../src/main/goal-control-journal.js');
  const session = await createSession({ conversationId: SOURCE });
  await setSessionOrigin(session.id, { kind, fromSessionId: null, agentId: kind === 'worker' ? 'worker-1' : null, task: '' }, kind);
  if (kind === 'helper') await goal.registerGoalDecisionChat(SOURCE);
  await goal.saveCombinedGoalControlsNow(session.id, SOURCE, { mode: 'goal', enabled: false, active: false }, async () => undefined);
  const journal = await readDurable<Record<string, unknown>>('goal-control-journal');
  await writeDurableNow('goal-control-journal', { ...journal, state: 'pending' });
  await recoverGoalControlJournal();
  expect(await readDurable('goal-control-journal')).toMatchObject({ state: 'committed' });
  expect((await storedControls()).switches).toContainEqual(expect.objectContaining({ conversationId: SOURCE, enabled: false,
    ...(kind === 'helper' ? { role: 'decision' } : {}) }));
  expect(goal.isGoalDecisionChat(SOURCE)).toBe(kind === 'helper');
  await expect(goal.saveCombinedGoalControlsNow(session.id, SOURCE, { mode: 'loop', enabled: true, active: true }, async () => undefined)).rejects.toThrow('conversation_changed');
});
