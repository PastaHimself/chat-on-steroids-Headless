import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';
import { StateStore } from '../discord/src/state.js';
import { bootstrap, authorized, safeText, type Bootstrap } from '../discord/src/config.js';
import { ControlClient } from '../discord/src/api.js';
import { definitions, commands, helpDescription } from '../discord/src/commands.js';
import { DiscordController } from '../discord/src/bot.js';
import { Notifications, recordedFinal } from '../discord/src/notifications.js';

const admin = '111111111111111111', other = '222222222222222222', guild = '333333333333333333', channel = '444444444444444444';
let dir: string; let store: StateStore; let config: Bootstrap;
const session = 'abcdef12-1234-1234-1234-123456789abc';
function interaction(name: string, values: Record<string, any> = {}, user = admin): any {
  return { id: String(BigInt('555555555555555555') + BigInt(Math.floor(Math.random() * 100000))), commandName: name,
    user: { id: user }, guildId: guild, channelId: channel, options: {
      getString: (key: string) => values[key] ?? null, getBoolean: (key: string) => values[key] ?? null, getInteger: (key: string) => values[key] ?? null,
      getFocused: () => ({ name: 'command', value: '' }) },
    isAutocomplete: () => false, isChatInputCommand: () => true, isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => false,
    deferred: false, replied: false, deferReply: vi.fn(async function(this: any) { this.deferred = true; }), editReply: vi.fn(async () => undefined), reply: vi.fn(async () => undefined), respond: vi.fn(async () => undefined) };
}
function backend() {
  const request = vi.fn(async (route: string): Promise<any> => {
    if (route === '/v1/remote/health') return { components: [{ id: 'recovery', state: 'available' }], serviceAvailable: true, taskReadiness: 'unknown' };
    if (route === '/v1/health') return { ok: true, actions: { enabled: true } };
    if (route === '/v1/status') return { bridge: { running: true, present: true, paired: true }, connection: { state: 'connected' } };
    if (route.startsWith('/v1/remote/settings')) return { actionsAllowed: true, permissions: { send: true, configure: true, plan: true, workers: true } };
    if (route.startsWith('/v1/remote/projects')) return { projects: [{ id: randomUUID(), name: 'approved' }] };
    if (route.startsWith('/v1/remote/models')) return { state: 'ready', models: [{ id: 'observed', label: 'Observed model', efforts: ['high'] }] };
    if (route.startsWith('/v1/remote/resources')) return { memory: { totalBytes: 8 * 1024 ** 3 } };
    if (route === '/v1/remote/plans') return { plans: [] };
    if (route.startsWith('/v1/sessions?')) return { sessions: [{ id: session, title: 'Recorded session', origin: null, updatedAt: 1 }], nextCursor: null, total: 1 };
    if (route.endsWith('/controls')) return { automation: 'goal', loopAfterTurn: false, objective: 'Keep objective' };
    if (route.endsWith('/taskplan')) return { plan: null };
    if (route.includes('/events?')) return { events: [], total: 0, nextFrom: 1 };
    if (route.includes('/workers')) return { agents: [] };
    if (route.startsWith('/v1/sessions/')) return { session: { id: session, title: 'recorded', updatedAt: 1, origin: null, model: 'observed' }, live: { activeTurnId: 'turn-1', automation: 'goal' } };
    if (route.startsWith('/v1/inputs?')) return { inputs: [] };
    if (route.startsWith('/v1/log')) return { entries: [] };
    throw new Error(`Unhandled test route ${route}`);
  });
  const action = vi.fn(async (_name: string, id: string) => ({ inputId: id, sessionId: session, accepted: true, delivery: 'pending' }));
  return { request, action };
}
beforeEach(async () => {
  dir = await makeTempDir('cos-discord-test-'); store = new StateStore(path.join(dir, 'bot')); await store.load();
  config = { token: 'test-token-kept-private-12345', applicationId: admin, admins: [admin], guilds: [guild], channels: [channel], apiDirectory: dir, dataDirectory: store.directory };
  await store.update(state => { state.settings.defaultSession = session; });
});
afterEach(async () => { await removeTempDir(dir); vi.restoreAllMocks(); });
describe('Discord commands and authorization', () => {
  it('registers the complete implemented command set with real definitions and correct option order', () => {
    expect(commands.map(row => row.name).sort()).toEqual(definitions.map(row => row.name).sort());
    expect(new Set(commands.map(row => row.name)).size).toBe(commands.length);
    for (const command of commands) {
      expect(helpDescription(command.name)).toContain(command.description);
      let optional = false;
      for (const option of command.options ?? []) { const required = 'required' in option && option.required; if (!required) optional = true; if (required) expect(optional).toBe(false); }
    }
    expect(commands.map(row => row.name)).toEqual(expect.arrayContaining(['setup', 'help', 'goal', 'loop', 'plan', 'taskplan', 'workerlogs', 'compact', 'ask']));
  });
  it('fails closed without local administrator/guild bootstrap and never trusts Discord roles', () => {
    expect(() => bootstrap({})).toThrow();
    const settings = store.snapshot().settings;
    expect(authorized(config, settings, other, guild, channel, 'admin')).toBe(false);
    expect(authorized(config, settings, admin, null, channel, 'read')).toBe(false);
    expect(authorized(config, settings, admin, other, channel, 'read')).toBe(false);
    expect(authorized(config, settings, admin, guild, other, 'read')).toBe(false);
    expect(authorized(config, { ...settings, users: { [other]: ['read'] } }, other, guild, channel, 'send')).toBe(false);
  });
  it('denies unauthorized slash commands before any backend request', async () => {
    const api = backend(); const controller = new DiscordController(config, store, api as unknown as ControlClient);
    const request = interaction('ask', { prompt: 'run a command' }, other); await controller.handle(request);
    expect(api.action).not.toHaveBeenCalled(); expect(api.request).not.toHaveBeenCalled(); expect(request.reply).toHaveBeenCalled();
  });
  it('acknowledges privately, uses durable UUID admission and never duplicates a Discord interaction', async () => {
    const api = backend(); const controller = new DiscordController(config, store, api as unknown as ControlClient);
    const request = interaction('ask', { prompt: 'inspect' }); await controller.handle(request); await controller.handle(request);
    expect(request.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(api.action).toHaveBeenCalledOnce();
    expect(api.action.mock.calls[0]).toEqual(['ask', expect.stringMatching(/^[0-9a-f-]{36}$/), expect.objectContaining({ sessionId: session, text: 'inspect', delivery: 'after-turn' })]);
    const restarted = new StateStore(store.directory); await restarted.load();
    expect(restarted.snapshot().interactions[request.id]?.state).toBe('done');
  });
  it('keeps the same local Discord association when provider conversation metadata changes', async () => {
    const api = backend(); const controller = new DiscordController(config, store, api as unknown as ControlClient);
    await controller.command(interaction('select', { session }));
    expect(store.snapshot().selected[admin]).toBe(session);
    api.request.mockResolvedValueOnce({ session: { id: session, conversationId: 'new-provider-id', title: 'resumed', updatedAt: 1 } });
    await controller.command(interaction('status'));
    expect(store.snapshot().selected[admin]).toBe(session);
  });
  it('shows source and replacement send evidence when Compact & Resume needs attention', async () => {
    const api = backend();
    const original = api.request;
    api.request = vi.fn(async (route: string) => {
      if (route === `/v1/sessions/${session}?live=1`) return {
        session: { id: session, title: 'recorded', updatedAt: 1, origin: null, model: 'observed' },
        live: {
          activeTurnId: null, automation: 'goal', job: {
            stage: 'handoff-pending', sourceSend: 'not-attempted',
            destinationSend: 'not-attempted', needsAttention: true, error: 'composer_missing'
          }
        }
      };
      return original(route);
    });
    const controller = new DiscordController(config, store, api as unknown as ControlClient);
    const result = await controller.command(interaction('status'));
    const description = result.embeds[0].toJSON().description ?? '';
    expect(description).toContain('Handoff Send: not-attempted');
    expect(description).toContain('Replacement Send: not-attempted');
    expect(description).toContain('Compaction needs attention: composer_missing');
    expect(description).toContain('Recovery: Compact & Resume needs attention');
    expect(description).toContain('Never manually resend an unconfirmed handoff');
  });
  it('discovers help from registered definitions and hides administrator commands from read-only users', async () => {
    await store.update(state => { state.settings.users[other] = ['read']; });
    const controller = new DiscordController(config, store, backend() as unknown as ControlClient);
    const help = await controller.command(interaction('help', {}, other));
    const options = help.components.flatMap((row: any) => row.toJSON().components.flatMap((component: any) => component.options ?? []));
    expect(options.some((row: any) => row.value === 'setup')).toBe(false);
    expect(options.some((row: any) => row.value === 'goal')).toBe(false);
    await expect(controller.command(interaction('help', { command: 'setup' }, other))).rejects.toThrow('unavailable');
  });
  it('saves next-send model preferences while distinguishing requested and observed selections', async () => {
    const controller = new DiscordController(config, store, backend() as unknown as ControlClient);
    await controller.command(interaction('model', { model: 'observed' }));
    await controller.command(interaction('reasoning', { effort: 'high' }));
    expect(store.snapshot().selection[`${admin}:${session}`]).toEqual({ model: 'observed', reasoning: 'high' });
    await expect(controller.command(interaction('model', { model: 'invented' }))).rejects.toThrow('account-observed');
    await expect(controller.command(interaction('reasoning', { effort: 'unsupported' }))).rejects.toThrow('unavailable');
  });
  it('requires an owner-bound confirmation before destructive supported operations', async () => {
    const api = backend(); const controller = new DiscordController(config, store, api as unknown as ControlClient);
    const result = await controller.command(interaction('stop'));
    expect(result.components[0].toJSON().components[0].label).toBe('Confirm'); expect(api.action).not.toHaveBeenCalled();
    const viewId = result.components[0].toJSON().components[0].custom_id.split(':')[0];
    expect(() => store.getView(viewId, other, guild, channel)).toThrow('another person');
  });
  it('rechecks the action grant on confirmations without granting unrelated history read access', async () => {
    await store.update(state => { state.settings.users[other] = ['send']; });
    const api = backend(), controller = new DiscordController(config, store, api as unknown as ControlClient);
    const result = await controller.command(interaction('stop', {}, other));
    const customId = result.components[0].toJSON().components[0].custom_id;
    const click = () => ({ ...interaction('stop', {}, other), customId, isChatInputCommand: () => false, isButton: () => true });
    await store.update(state => { state.settings.users[other] = []; });
    await controller.handle(click()); expect(api.action).not.toHaveBeenCalled();
    await store.update(state => { state.settings.users[other] = ['send']; });
    await controller.handle(click()); expect(api.action).toHaveBeenCalledOnce();
    expect(authorized(config, store.snapshot().settings, other, guild, channel, 'read')).toBe(false);
  });
});
describe('setup and persistent state', () => {
  it('persists incomplete setup without publishing settings and refuses stale drafts', async () => {
    const controller = new DiscordController(config, store, backend() as unknown as ControlClient);
    const result = await controller.command(interaction('setup'));
    expect(store.snapshot().setup[admin]).toBeTruthy(); expect(store.snapshot().settings.progress).toBe(false);
    const viewId = result.components[0].toJSON().components[0].custom_id.split(':')[0];
    const view = store.getView(viewId, admin, guild, channel);
    await store.update(state => { state.setup[admin]!.revision++; });
    await expect((controller as any).setupComponent(interaction('setup'), viewId, 'setup-save', view)).rejects.toThrow('Setup changed');
    const restart = new StateStore(store.directory); await restart.load(); expect(restart.snapshot().setup[admin]!.revision).toBe(1);
  });
  it('validates and commits setup only after the explicit finish confirmation', async () => {
    const api = backend(), controller = new DiscordController(config, store, api as unknown as ControlClient);
    await controller.command(interaction('setup'));
    await store.update(state => { state.setup[admin]!.settings.frequencySeconds = 45; });
    const request = interaction('setup');
    const finish = await (controller as any).setupPanel(request, 'finish');
    const viewId = finish.components[1].toJSON().components[0].custom_id.split(':')[0];
    expect(store.snapshot().settings.frequencySeconds).toBe(30);
    await (controller as any).setupComponent(request, viewId, 'setup-save', store.getView(viewId, admin, guild, channel));
    expect(store.snapshot().settings.frequencySeconds).toBe(45); expect(store.snapshot().setup[admin]).toBeUndefined();
  });
  it('refuses an old administrator draft after another administrator publishes settings', async () => {
    config.admins.push(other);
    const controller = new DiscordController(config, store, backend() as unknown as ControlClient);
    await controller.command(interaction('setup', {}, other));
    await controller.command(interaction('setup'));
    const first = await (controller as any).setupPanel(interaction('setup'), 'finish');
    const id = first.components[1].toJSON().components[0].custom_id.split(':')[0];
    await (controller as any).setupComponent(interaction('setup'), id, 'setup-save', store.getView(id, admin, guild, channel));
    const stale = await (controller as any).setupPanel(interaction('setup', {}, other), 'finish');
    const staleId = stale.components[1].toJSON().components[0].custom_id.split(':')[0];
    await expect((controller as any).setupComponent(interaction('setup', {}, other), staleId, 'setup-save', store.getView(staleId, other, guild, channel))).rejects.toThrow('Published settings changed');
  });
  it('rejects corrupted bot state and preserves published settings on a failed write', async () => {
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(store.update(state => { state.settings.progress = true; })).rejects.toThrow();
    expect(store.snapshot().settings.progress).toBe(false); rename.mockRestore();
    await fs.writeFile(path.join(store.directory, 'state.json'), '{broken');
    await expect(new StateStore(store.directory).load()).rejects.toThrow('invalid');
  });
  it('redacts credentials and prevents mention expansion', () => {
    expect(safeText('token=secret Bearer abcdefghijklmnopqrstuvwxyz ' + config.token, [config.token])).not.toContain(config.token);
    expect(safeText('sk-' + 'a'.repeat(40))).toContain('[redacted]');
  });
});
describe('control transport and notifications', () => {
  it('uses only authenticated loopback and reloads the endpoint/token after backend restart', async () => {
    await fs.writeFile(path.join(dir, 'endpoint.json'), JSON.stringify({ protocol: 1, port: 12345 }));
    await fs.writeFile(path.join(dir, 'token'), 'a'.repeat(43));
    const transport = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    const client = new ControlClient(dir, transport as typeof fetch);
    await client.request('/v1/health');
    await fs.writeFile(path.join(dir, 'endpoint.json'), JSON.stringify({ protocol: 1, port: 23456 }));
    await fs.writeFile(path.join(dir, 'token'), 'b'.repeat(43));
    await client.request('/v1/health');
    expect(transport.mock.calls.map((row: any) => row[0])).toEqual(['http://127.0.0.1:12345/v1/health', 'http://127.0.0.1:23456/v1/health']);
    expect((transport.mock.calls as any)[1][1].headers.authorization).toBe('Bearer ' + 'b'.repeat(43));
    await expect(client.request('https://external.test')).rejects.toThrow('Invalid control route');
  });
  it('does not infer success from idle state, interim prose, old finals or a missing completion record', () => {
    const monitor = { activeTurnId: 'turn', createdAt: 100 }, live = { activeTurnId: null };
    const final = { kind: 'assistant_message', final: true, turnId: 'turn', time: 101, seq: 5 };
    expect(recordedFinal([final], monitor, live)).toBeNull();
    expect(recordedFinal([{ ...final, final: false }, { kind: 'turn_end', turnId: 'turn', outcome: 'completed' }], monitor, live)).toBeNull();
    expect(recordedFinal([final, { kind: 'turn_end', turnId: 'turn', outcome: 'completed' }], monitor, { activeTurnId: 'turn' })).toBeNull();
    expect(recordedFinal([final, { kind: 'turn_end', turnId: 'turn', outcome: 'completed' }], monitor, live)).toEqual(final);
  });
  it('never duplicates an unconfirmed Discord notification creation after restart', async () => {
    const key = randomUUID();
    await store.update(state => {
      state.settings.progress = true; state.settings.notificationChannel = channel;
      state.monitors[key] = { sessionId: session, channelId: channel, messageId: null, from: 0, lastUpdate: 0, signature: '', pendingSignature: 'creation-may-have-succeeded',
        activeTurnId: null, inputId: randomUUID(), createdAt: 1, notifiedFinal: null };
    });
    const send = vi.fn(), edit = vi.fn(), recent = vi.fn(async () => []);
    const notifications = new Notifications(config, store, backend() as unknown as ControlClient, { channel: async () => ({ guildId: guild, send, edit, recent }) });
    await notifications.tick(); notifications.stop(); expect(recent).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();
    expect(store.snapshot().monitors[key]!.from).toBe(0);
  });
  it('retains exact completion evidence across event pages and confirms a final once', async () => {
    const key = randomUUID(), inputId = randomUUID();
    await store.update(state => {
      state.settings.finalResults = true; state.settings.notificationChannel = channel;
      state.monitors[key] = { sessionId: session, channelId: channel, messageId: null, from: 0, lastUpdate: 0, signature: '', activeTurnId: null, inputId, createdAt: 100, notifiedFinal: null };
    });
    let page = 0;
    const api = { request: vi.fn(async (route: string) => {
      if (route.includes('/events?')) return page === 0 ? { nextFrom: 100, events: [
        { kind: 'user_message', inputId, inputDelivery: 'sent', seq: 1, time: 101 },
        { kind: 'turn_start', turnId: 'exact-turn', seq: 2, time: 102 },
        { kind: 'assistant_message', final: true, turnId: 'exact-turn', seq: 99, time: 103, message: { text: 'Recorded result' } }] } :
        { nextFrom: 101, events: [{ kind: 'turn_end', turnId: 'exact-turn', outcome: 'completed', seq: 100, time: 104 }] };
      if (route.startsWith('/v1/inputs')) return { inputs: [] }; // finished outbox rows may have been evicted
      return { session: { id: session, title: 'task', updatedAt: 104 }, live: { activeTurnId: null } };
    }) };
    const send = vi.fn(async () => ({ id: '666666666666666666' })), edit = vi.fn(async () => undefined);
    const notifications = new Notifications(config, store, api as unknown as ControlClient, { channel: async () => ({ guildId: guild, send, edit, recent: async () => [] }) });
    await (notifications as any).update(key); expect(send).not.toHaveBeenCalled();
    expect(store.snapshot().monitors[key]).toMatchObject({ from: 100, deliveryConfirmed: true, activeTurnId: 'exact-turn' });
    page = 1; await (notifications as any).update(key); await (notifications as any).update(key);
    expect(send).toHaveBeenCalledOnce(); expect(edit).not.toHaveBeenCalled();
    expect(store.snapshot().monitors[key]!.notifiedFinal).toBe('exact-turn:99'); notifications.stop();
  });
  it('does not let a notification read overwrite a newly monitored input', async () => {
    const key = randomUUID(), inputId = randomUUID(), newInput = randomUUID();
    await store.update(state => {
      state.settings.progress = true; state.settings.notificationChannel = channel;
      state.monitors[key] = { sessionId: session, channelId: channel, messageId: null, from: 0, lastUpdate: 0, signature: '', activeTurnId: null, inputId, createdAt: 100, notifiedFinal: null };
    });
    const api = backend();
    const original = api.request.getMockImplementation()!;
    api.request.mockImplementation(async route => {
      if (route.includes('/events?')) {
        await store.update(state => { state.monitors[key]!.inputId = newInput; state.monitors[key]!.createdAt = 200; });
        return { events: [], nextFrom: 90 };
      }
      return original(route);
    });
    const send = vi.fn(), notifications = new Notifications(config, store, api as unknown as ControlClient,
      { channel: async () => ({ guildId: guild, send, edit: vi.fn(), recent: async () => [] }) });
    await expect((notifications as any).update(key)).rejects.toThrow('changed');
    expect(send).not.toHaveBeenCalled(); expect(store.snapshot().monitors[key]).toMatchObject({ inputId: newInput, from: 0, createdAt: 200 }); notifications.stop();
  });
});

it('processes more than 2,000 bot receipts across archive cycles and preserves unresolved work', async () => {
  const first = '666666666666666666';
  await store.update(state => {
    for (let index = 0; index < 1600; index++) state.interactions[String(BigInt(first) + BigInt(index))] =
      { operationId: randomUUID(), state: 'done', createdAt: 1, fingerprint: 'a'.repeat(64) };
    state.interactions['777777777777777777'] = { operationId: randomUUID(), state: 'started', createdAt: 1 };
  });
  await Promise.all([store.upkeep(), store.upkeep()]);
  expect(Object.keys(store.snapshot().interactions)).toEqual(['777777777777777777']);
  expect(await store.archive.get(first)).toMatchObject({ outcome: 'done' });
  await store.update(state => {
    for (let index = 1600; index < 2200; index++) state.interactions[String(BigInt(first) + BigInt(index))] =
      { operationId: randomUUID(), state: 'done', createdAt: 1, fingerprint: 'a'.repeat(64) };
  });
  await store.upkeep(); const restarted = new StateStore(store.directory); await restarted.load();
  expect(await restarted.archive.get(first)).toMatchObject({ outcome: 'done' });
  expect(Object.keys(restarted.snapshot().interactions)).toHaveLength(1);
}, 120_000);

it('offers owner-bound operation inspection and never resends an uncertain receipt', async () => {
  const operation = randomUUID(), api = backend(), request = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (route: string) => route.startsWith('/v1/remote/operations?')
    ? { operations: [{ id: operation, action: 'ask', state: 'unconfirmed', createdAt: 1 }], nextCursor: null }
    : route === `/v1/remote/operations/${operation}` ? { id: operation, action: 'ask', state: 'unconfirmed', sessionId: session } : request(route));
  const controller = new DiscordController(config, store, api as unknown as ControlClient);
  const list = await controller.command(interaction('operations'));
  const choose = list.components[0].toJSON().components[0].custom_id;
  const viewId = choose.split(':')[0];
  const receipt = await (controller as any).component({ ...interaction('operations'), values: [operation] }, viewId, 'choose', store.getView(viewId, admin, guild, channel));
  const check = receipt.components[0].toJSON().components[0].custom_id, checkView = check.split(':')[0];
  await (controller as any).component(interaction('operation'), checkView, 'receipt', store.getView(checkView, admin, guild, channel));
  expect(api.action).not.toHaveBeenCalled();
  const stolen = { ...interaction('operations', {}, other), customId: choose, values: [operation], isChatInputCommand: () => false, isStringSelectMenu: () => true };
  await controller.handle(stolen); expect(api.action).not.toHaveBeenCalled(); expect(stolen.reply).toHaveBeenCalled();
});
