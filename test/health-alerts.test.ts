import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { HealthAlerts } from '../discord/src/health-alerts.js';
import { StateStore } from '../discord/src/state.js';
import { makeTempDir, removeTempDir } from './helpers.js';
let directory: string, store: StateStore, alerts: HealthAlerts;
const admin = '111111111111111111', guild = '222222222222222222', channel = '333333333333333333', message = '444444444444444444';
const config: any = { admins: [admin], guilds: [guild], channels: [channel] };
const request = vi.fn(), send = vi.fn(), edit = vi.fn(), recent = vi.fn();
const transport: any = { channel: vi.fn(async () => ({ guildId: guild, send, edit, recent })) };
beforeEach(async () => {
  directory = await makeTempDir('cos-health-alerts-'); store = new StateStore(path.join(directory, 'bot')); await store.load();
  await store.update(state => { state.settings.notificationChannel = channel; state.settings.operationalAlerts = true; });
  request.mockReset().mockResolvedValue({ components: [{ id: 'storage', state: 'attention', detail: 'Low storage', action: 'Free space' }] });
  send.mockReset().mockResolvedValue({ id: message }); edit.mockReset().mockResolvedValue(undefined); recent.mockReset().mockResolvedValue([]);
  alerts = new HealthAlerts(config, store, { request } as any, transport);
});
afterEach(async () => { alerts.stop(); vi.restoreAllMocks(); await removeTempDir(directory); });
it('persists a two-failure episode, deduplicates after restart and reports two-check recovery', async () => {
  await alerts.tick(); expect(send).not.toHaveBeenCalled(); await alerts.tick(); expect(send).toHaveBeenCalledOnce();
  alerts.stop(); const restarted = new StateStore(store.directory); await restarted.load();
  alerts = new HealthAlerts(config, restarted, { request } as any, transport); await alerts.tick(); expect(send).toHaveBeenCalledOnce();
  request.mockResolvedValue({ components: [{ id: 'provider', state: 'unknown' }] });
  await alerts.tick(); expect(edit).not.toHaveBeenCalled(); await alerts.tick(); expect(edit).toHaveBeenCalledOnce();
  await alerts.tick(); expect(send).toHaveBeenCalledOnce(); expect(edit).toHaveBeenCalledOnce();
});
it('keeps uncertain message creation fenced and resumes only from exact message proof', async () => {
  send.mockRejectedValueOnce(new Error('transport lost after submission')); await alerts.tick(); await alerts.tick();
  await alerts.tick(); expect(send).toHaveBeenCalledOnce();
  const episode = Object.values(store.snapshot().health.episodes)[0]!;
  recent.mockResolvedValue([{ id: message, marker: `CoS health ${episode.id}` }]);
  await alerts.tick(); expect(send).toHaveBeenCalledOnce(); expect(edit).toHaveBeenCalledOnce();
});
it('stays quiet when alerts are disabled or channel permission is revoked', async () => {
  await store.update(state => { state.settings.operationalAlerts = false; }); await alerts.tick(); expect(request).not.toHaveBeenCalled();
  await store.update(state => { state.settings.operationalAlerts = true; }); config.channels = ['555555555555555555'];
  await alerts.tick(); expect(request).not.toHaveBeenCalled(); config.channels = [channel];
});
it('reports a backend outage and bot downtime after reconnect without claiming provider sign-in', async () => {
  request.mockRejectedValue(new Error('offline'));
  await store.update(state => { state.health.lastSeen = Date.now() - 120000; });
  await alerts.tick(); await alerts.tick(); expect(send).toHaveBeenCalledTimes(2);
  expect(Object.keys(store.snapshot().health.episodes)).toEqual(expect.arrayContaining([`${channel}:backend`, `${channel}:transport`]));
});
