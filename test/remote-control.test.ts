import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';

vi.mock('electron', () => ({ app: { on: vi.fn(), getPath: () => '', getVersion: () => 'test', getAppPath: () => process.cwd(), isPackaged: false },
  safeStorage: { isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptStringAsync: async (value: string) => Buffer.from(value),
    decryptStringAsync: async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false }) },
  BrowserWindow: class {}, shell: { openExternal: vi.fn(), openPath: vi.fn() }, nativeTheme: {} }));
vi.mock('../src/main/connection.js', async original => ({ ...await original<typeof import('../src/main/connection.js')>(), connect: vi.fn(async () => undefined) }));
vi.mock('../src/main/browser-startup.js', async original => ({ ...await original<typeof import('../src/main/browser-startup.js')>(), wakeBrowserUrl: vi.fn(async () => undefined) }));
vi.mock('../src/main/bridge.js', async original => ({ ...await original<typeof import('../src/main/bridge.js')>(), startBridge: vi.fn(async () => true) }));
const planner = vi.hoisted(() => ({ draft: vi.fn<(...args: any[]) => Promise<string[]>>() }));
vi.mock('../src/main/goal.js', async original => ({ ...await original<typeof import('../src/main/goal.js')>(), draftTaskPlan: planner.draft }));
const config = await import('../src/main/config.js');
const durable = await import('../src/main/durable.js');
const sessions = await import('../src/main/session/store.js');
const input = await import('../src/main/session/input.js');
const startInput = await import('../src/main/session/start-input.js');
const models = await import('../src/main/chat-models.js');
const remote = await import('../src/main/remote-control.js');
const agents = await import('../src/main/agents.js');
let directory: string; let session: string;
const action = async (name: string, body: object) => remote.serveRemoteAction(`/v1/remote/${name}`, body);
const read = (route: string) => remote.serveRemoteRead(route, new URLSearchParams());

beforeEach(async () => {
  directory = await makeTempDir('cos-remote-test-'); config.initConfigPath(directory); durable.initDurableStore(directory); sessions.initSessionStore(directory);
  input.resetInputForTests(); startInput.resetInputStartupForTests(); agents.resetAgentsForTests(); models.resetChatModelsForTests();
  await config.saveConfig({ ...config.defaultConfig(), controlApi: { enabled: true, allowActions: true } });
  const created = await sessions.createSession({ conversationId: 'remote-primary' }); session = created.id;
  vi.stubEnv('COS_REMOTE_PERMISSIONS', 'send,configure,plan,workers');
  planner.draft.mockReset();
  agents.onSwarmPersistNow(snapshot => durable.writeDurableNow('swarm', snapshot));
});
afterEach(async () => {
  startInput.stopInputStartup(); await durable.flushDurable(); await sessions.flushSessions();
  input.resetInputForTests(); sessions.resetSessionStoreForTests(); durable.resetDurableForTests(); agents.resetAgentsForTests();
  vi.unstubAllEnvs(); await removeTempDir(directory);
});
describe('authenticated remote service adapters', () => {
  it('requires both allowActions and the separate local permission grant', async () => {
    vi.stubEnv('COS_REMOTE_PERMISSIONS', '');
    await expect(action('automation', { id: randomUUID(), sessionId: session, automation: 'goal' })).rejects.toMatchObject({ status: 403 });
    vi.stubEnv('COS_REMOTE_PERMISSIONS', 'configure');
    await config.updateConfig(value => ({ ...value, controlApi: { enabled: true, allowActions: false } }));
    await expect(action('automation', { id: randomUUID(), sessionId: session, automation: 'goal' })).rejects.toMatchObject({ code: 'actions_disabled' });
  });
  it('validates strictly before admission and prevents duplicate or conflicting mutations', async () => {
    const id = randomUUID();
    await expect(action('automation', { id, sessionId: session, automation: 'goal', unknown: true })).rejects.toMatchObject({ code: 'invalid_body' });
    const result = await action('automation', { id, sessionId: session, automation: 'loop', afterTurn: true });
    expect(result?.status).toBe(202);
    expect(await action('automation', { id, sessionId: session, automation: 'loop', afterTurn: true })).toMatchObject({ body: { replayed: true } });
    await expect(action('automation', { id, sessionId: session, automation: 'off' })).rejects.toMatchObject({ code: 'id_conflict' });
  });
  it('preserves objectives when changing Goal/Loop and durably projects actual engine state', async () => {
    await action('objective', { id: randomUUID(), sessionId: session, objective: 'Implement and verify everything', mode: 'goal' });
    await action('automation', { id: randomUUID(), sessionId: session, automation: 'loop' });
    const controls: any = await read(`/v1/sessions/${session}/controls`);
    expect(controls.objective).toBe('Implement and verify everything'); expect(controls.automation).toBe('loop');
    await action('automation', { id: randomUUID(), sessionId: session, automation: 'off' });
    expect(await read(`/v1/sessions/${session}/controls`)).toMatchObject({ automation: 'off', objective: 'Implement and verify everything' });
  });
  it('admits prompts through the real durable outbox and preserves delivery uncertainty', async () => {
    const id = randomUUID();
    const reply: any = await action('ask', { id, sessionId: session, text: 'Run meaningful tests', delivery: 'after-turn' });
    expect(reply.body.result).toMatchObject({ inputId: id, sessionId: session, accepted: true, delivery: 'pending' });
    expect((await input.listInputs()).find(row => row.id === id)?.text).toBe('Run meaningful tests');
    await action('ask', { id, sessionId: session, text: 'Run meaningful tests', delivery: 'after-turn' });
    expect((await input.listInputs()).filter(row => row.id === id)).toHaveLength(1);
    const ledger = JSON.parse(await fs.readFile(path.join(directory, 'state', 'remote-control.json'), 'utf8'));
    ledger.operations[0].state = 'started'; delete ledger.operations[0].result;
    await durable.writeDurableNow('remote-control', ledger);
    expect(await action('ask', { id, sessionId: session, text: 'Run meaningful tests', delivery: 'after-turn' })).toMatchObject({ status: 409, body: { error: 'operation_unconfirmed' } });
    expect((await input.listInputs()).filter(row => row.id === id)).toHaveLength(1);
  });
  it('creates the real reserved local session through the existing opening lifecycle', async () => {
    const id = randomUUID(); const result: any = await action('new', { id, prompt: 'Inspect this project' });
    const local = result.body.result.sessionId;
    expect(local).toBeTruthy(); expect((await sessions.getSession(local))?.conversationId).toBeNull();
    expect((await input.listInputs()).find(row => row.id === id)).toMatchObject({ opening: true, sessionId: local });
  });
  it('refuses direct worker/helper conversation mutation', async () => {
    const worker = await sessions.createSession({ conversationId: 'remote-worker', origin: { kind: 'worker', fromSessionId: session, agentId: 'worker-1', task: 'review' } });
    await expect(action('ask', { id: randomUUID(), sessionId: worker.id, text: 'Bypass the prime' })).rejects.toMatchObject({ code: 'session_not_controllable' });
    await expect(action('automation', { id: randomUUID(), sessionId: worker.id, automation: 'loop' })).rejects.toMatchObject({ code: 'session_not_controllable' });
  });
  it('keeps composer approval separate from durable update_plan and rejects stale approval', async () => {
    planner.draft.mockResolvedValue(['Implement the entire objective', 'Verify the implementation']);
    const id = randomUUID(); await action('plan', { id, sessionId: session, prompt: 'Complete task' });
    await vi.waitFor(async () => { expect(await read(`/v1/remote/plans/${id}`)).toMatchObject({ state: 'approval', revision: 1 }); });
    expect(await read(`/v1/sessions/${session}/taskplan`)).toMatchObject({ plan: null });
    expect((await input.listInputs()).filter(row => row.purpose !== 'decision')).toHaveLength(0);
    await expect(action('plan-approve', { id: randomUUID(), planId: id, revision: 0 })).rejects.toMatchObject({ code: 'stale_plan' });
    const approvedId = randomUUID(); await action('plan-approve', { id: approvedId, planId: id, revision: 1 });
    expect((await input.listInputs()).find(row => row.id === approvedId)).toMatchObject({ objective: 'Complete task', text: 'Implement the entire objective', stages: ['Verify the implementation'], mode: 'finish' });
    await expect(action('plan-approve', { id: randomUUID(), planId: id, revision: 2 })).rejects.toMatchObject({ code: 'plan_not_awaiting_approval' });
  });
  it('edits one raw stage without copying redacted display text into untouched stages', async () => {
    const untouched = 'Preserve this instruction ' + 'x'.repeat(4500);
    planner.draft.mockResolvedValue(['Replace me', untouched]);
    const id = randomUUID(); await action('plan', { id, sessionId: session, prompt: 'Keep the full objective' });
    await vi.waitFor(async () => { expect(await read(`/v1/remote/plans/${id}`)).toMatchObject({ state: 'approval' }); });
    await action('plan-edit', { id: randomUUID(), planId: id, revision: 1, index: 0, text: 'Revised first stage' });
    const raw = await durable.readDurableStrict<any>('remote-control');
    expect(raw.plans[0].stages).toEqual(['Revised first stage', untouched]);
    vi.stubEnv('COS_REMOTE_PERMISSIONS', 'plan');
    await expect(action('plan-approve', { id: randomUUID(), planId: id, revision: 2 })).rejects.toMatchObject({ code: 'remote_permission_disabled' });
  });
  it('never replays a corrupted admission ledger or an unavailable model', async () => {
    await fs.mkdir(path.join(directory, 'state'), { recursive: true });
    await fs.writeFile(path.join(directory, 'state', 'remote-control.json'), '{broken');
    await expect(action('new', { id: randomUUID(), prompt: 'test' })).rejects.toThrow('Cannot read durable');
    expect(await input.listInputs()).toHaveLength(0);
    await fs.rm(path.join(directory, 'state', 'remote-control.json'));
    await expect(action('new', { id: randomUUID(), model: 'invented-model' })).rejects.toMatchObject({ code: 'model_unavailable' });
    expect(await input.listInputs()).toHaveLength(0);
  });
  it('does not leak custom prompts, keys or local paths in safe settings', async () => {
    await config.updateConfig(value => ({ ...value, compaction: { ...value.compaction, handoffPrompt: 'private custom text' } }));
    expect(JSON.stringify(await read('/v1/remote/settings'))).not.toContain('private custom text');
  });
});
