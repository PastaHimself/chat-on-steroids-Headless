import { randomUUID } from 'node:crypto';
import { authorized, type Bootstrap } from './config.js';
import { ControlClient } from './api.js';
import { StateStore } from './state.js';
import { panel } from './ui.js';
import type { NotificationTransport } from './notifications.js';

/** Alerts have their own cadence and survive backend outages. They never retry backend mutations. */
export class HealthAlerts {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private running = false;
  constructor(readonly config: Bootstrap, readonly store: StateStore, readonly api: ControlClient,
    readonly transport: NotificationTransport, readonly report: (message: string) => void = () => undefined) {}
  start(): void { if (!this.timer && !this.stopped) this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, 1000); }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const snapshot = this.store.snapshot(), channelId = snapshot.settings.notificationChannel;
      if (!snapshot.settings.operationalAlerts || !channelId) return;
      if (!authorized(this.config, snapshot.settings, this.config.admins[0]!, this.config.guilds[0]!, channelId, 'read')) return;
      let problems: Array<{ id: string; detail: string; action: string }>;
      try {
        const health = await this.api.request('/v1/remote/health', undefined, 5000);
        problems = health.components.filter((row: any) => row.state === 'attention');
      } catch { problems = [{ id: 'backend', detail: 'The authenticated backend could not be reached.', action: 'Inspect the managed target and service journal locally.' }]; }
      const priorTransport = snapshot.health.episodes[`${channelId}:transport`];
      if ((snapshot.health.lastSeen > 0 && Date.now() - snapshot.health.lastSeen > 90_000) || (priorTransport && !priorTransport.reported))
        problems.push({ id: 'transport', detail: 'Health observation was interrupted; the bot has reconnected.', action: 'Inspect recent operation receipts for work submitted during the outage.' });
      await this.store.update(state => {
        if (!state.settings.operationalAlerts || state.settings.notificationChannel !== channelId) return;
        const failing = new Set(problems.map(row => `${channelId}:${row.id}`));
        for (const problem of problems) {
          const key = `${channelId}:${problem.id}`;
          let episode = state.health.episodes[key];
          if (!episode || episode.recovered) {
            if (!episode && Object.keys(state.health.episodes).length >= 40) throw new Error('Health alert episode capacity reached');
            episode = { id: randomUUID(), channelId, failures: 0, successes: 0, reported: false, recovered: false, messageId: null, pending: false, detail: '' };
            state.health.episodes[key] = episode;
          }
          episode.failures++; episode.successes = 0; episode.detail = `${problem.detail}\n${problem.action}`.slice(0, 1000);
        }
        for (const [key, episode] of Object.entries(state.health.episodes)) if (episode.channelId === channelId && !failing.has(key)) {
          episode.successes++; episode.failures = 0;
        }
        state.health.lastSeen = Date.now();
      });
      for (const [key, episode] of Object.entries(this.store.snapshot().health.episodes)) {
        if (this.stopped || episode.channelId !== channelId || episode.recovered) continue;
        const recovery = episode.reported && episode.successes >= 2;
        if ((!episode.reported && episode.failures >= 2) || recovery || episode.pending)
          await this.publish(key, episode.id, recovery).catch(() => this.report('Health alert publication is pending; uncertain message creation is not repeated.'));
      }
    } catch { this.report('Health observation could not be persisted; no alert was claimed as delivered.'); }
    finally { this.running = false; if (!this.stopped) this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, 30_000); }
  }
  private async publish(key: string, episodeId: string, recovery: boolean): Promise<void> {
    const episode = this.store.snapshot().health.episodes[key];
    if (!episode || episode.id !== episodeId) return;
    const channel = await this.transport.channel(episode.channelId);
    if (this.stopped) return;
    if (!this.config.guilds.includes(channel.guildId)) throw new Error('Health channel is outside the authorized guilds');
    const marker = `CoS health ${episodeId}`;
    let messageId = episode.messageId;
    if (!messageId && episode.pending) {
      messageId = (await channel.recent()).find(row => row.marker === marker)?.id ?? null;
      if (!messageId) throw new Error('Health alert creation is uncertain');
    }
    await this.store.update(state => {
      const row = state.health.episodes[key];
      if (!row || row.id !== episodeId || !state.settings.operationalAlerts || state.settings.notificationChannel !== row.channelId ||
          !authorized(this.config, state.settings, this.config.admins[0]!, channel.guildId, row.channelId, 'read')) throw new Error('Health alert authorization changed');
      row.pending = true;
    });
    const payload = panel(recovery ? 'Chat On Steroids — Recovered' : 'Chat On Steroids — Action needed',
      recovery ? 'The previously reported condition cleared in two consecutive health checks.' : episode.detail);
    payload.embeds[0]!.setFooter({ text: marker });
    if (messageId) await channel.edit(messageId, payload);
    else messageId = (await channel.send({ ...payload, nonce: episodeId.replaceAll('-', '').slice(0, 25), enforceNonce: true })).id;
    await this.store.update(state => {
      const row = state.health.episodes[key]; if (!row || row.id !== episodeId) return;
      row.messageId = messageId; row.pending = false; row.reported = true; row.recovered = recovery;
    });
  }
}
