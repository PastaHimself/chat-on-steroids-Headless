import { createHash } from 'node:crypto';
import { ButtonStyle } from 'discord.js';
import { ControlClient } from './api.js';
import { StateStore } from './state.js';
import { safeText, type Bootstrap } from './config.js';
import { buttons, panel, sessionDescription } from './ui.js';

export interface NotificationTransport {
  channel(id: string): Promise<{ guildId: string; send(payload: any): Promise<{ id: string }>;
    edit(messageId: string, payload: any): Promise<void>; recent(): Promise<Array<{ id: string; marker: string | null }>> }>;
}
/** Completion is recorded turn evidence, never the disappearance of text or an expired activity badge. */
export function recordedFinal(events: any[], monitor: { activeTurnId: string | null; createdAt: number }, live: any): any | null {
  if (live?.activeTurnId || live?.stopPending || live?.job?.busy || !monitor.activeTurnId) return null;
  const final = events.findLast(event => event.kind === 'assistant_message' && event.final === true &&
    event.turnId === monitor.activeTurnId && event.time >= monitor.createdAt);
  const end = events.findLast(event => event.kind === 'turn_end' && event.turnId === monitor.activeTurnId && event.outcome === 'completed');
  return final && end ? final : null;
}

export class Notifications {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private backoff = new Map<string, { failures: number; until: number }>();
  constructor(readonly config: Bootstrap, readonly store: StateStore, readonly api: ControlClient, readonly transport: NotificationTransport,
    private readonly report: (message: string) => void = () => undefined) {}
  start(): void { if (!this.timer && !this.stopped) this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, 1000); }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const state = this.store.snapshot();
      if (!state.settings.progress && !state.settings.finalResults) return;
      for (const key of this.backoff.keys()) if (!state.monitors[key]) this.backoff.delete(key);
      const due = Object.entries(state.monitors).filter(([key, monitor]) =>
        Date.now() - monitor.lastUpdate >= state.settings.frequencySeconds * 1000 && (this.backoff.get(key)?.until ?? 0) <= Date.now()).map(([key]) => key);
      if (!due.length) return;
      const health = await this.api.request('/v1/remote/health', undefined, 5000);
      if (health.components.some((row: any) => row.id === 'recovery' && row.state === 'attention')) return;
      const queue = await this.api.request('/v1/inputs?limit=100', undefined, 5000).catch(() => ({ inputs: [] }));
      let index = 0;
      const poll = async () => {
        while (!this.stopped && index < due.length) {
          const key = due[index++]!;
          try { await this.update(key, queue); this.backoff.delete(key); }
          catch {
            const failures = (this.backoff.get(key)?.failures ?? 0) + 1;
            this.backoff.set(key, { failures, until: Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(failures, 5)) });
            this.report(`Notification update pending for monitor ${key}; backend or Discord unavailable. No backend mutation was retried.`);
          }
        }
      };
      await Promise.all([poll(), poll()]);
    } catch {
      const until = Date.now() + 30_000;
      for (const key of Object.keys(this.store.snapshot().monitors)) this.backoff.set(key, { failures: 1, until });
      this.report('Notification health observation unavailable; publications remain held.');
    } finally {
      this.running = false;
      if (!this.stopped) this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, 15_000);
    }
  }
  private async update(key: string, queue?: any): Promise<void> {
    const state = this.store.snapshot(), monitor = state.monitors[key]; if (!monitor) return;
    const owns = (row: typeof monitor | undefined) => row?.inputId === monitor.inputId && row?.createdAt === monitor.createdAt && row?.from === monitor.from;
    if (state.settings.notificationChannel !== monitor.channelId ||
      (this.config.channels.length && !this.config.channels.includes(monitor.channelId)) ||
      (state.settings.channels.length && !state.settings.channels.includes(monitor.channelId))) return;
    const path = `/v1/sessions/${monitor.sessionId}`;
    let detail = await this.api.request(`${path}?live=1`, undefined, 5000);
    const page: { events: any[]; nextFrom: number } = { events: [], nextFrom: monitor.from };
    const deadline = Date.now() + 10_000;
    for (let count = 0; count < 5 && !this.stopped; count++) {
      const next = await this.api.request(`${path}/events?from=${page.nextFrom}&limit=100`, undefined, 5000);
      if (!Number.isSafeInteger(next.nextFrom) || next.nextFrom < page.nextFrom) throw new Error('Invalid event cursor');
      page.events.push(...next.events);
      const moved = next.nextFrom > page.nextFrom; page.nextFrom = next.nextFrom;
      if (!moved || next.events.length < 100 || Date.now() >= deadline) break;
    }
    queue ??= await this.api.request('/v1/inputs?limit=100', undefined, 5000);
    const input = queue.inputs.find((row: any) => row.id === monitor.inputId);
    let turn = monitor.activeTurnId;
    // Only an admitted monitored input's observed user message grants its exact reply identity.
    const question = page.events.findLast((event: any) => event.kind === 'user_message' && event.inputId === monitor.inputId);
    const questionSeq = question?.seq ?? monitor.questionSeq;
    const deliveryConfirmed = monitor.deliveryConfirmed || input?.delivery === 'sent' || input?.delivery === 'confirmed' || question?.inputDelivery === 'sent' || question?.inputDelivery === 'confirmed';
    const turnStart = page.events.find((event: any) => event.kind === 'turn_start' && event.time >= monitor.createdAt);
    if (!turn && turnStart) turn = turnStart.turnId;
    const finalEvent = page.events.findLast((event: any) => event.kind === 'assistant_message' && event.final === true && event.turnId === turn && event.time >= monitor.createdAt);
    const candidate = finalEvent ? { seq: finalEvent.seq, time: finalEvent.time, turnId: finalEvent.turnId, text: finalEvent.message?.text?.slice(0, 4000) ?? '' } : monitor.final;
    const completed = page.events.findLast((event: any) => event.kind === 'turn_end' && event.turnId === turn && event.outcome === 'completed');
    const completedTurnId = completed?.turnId ?? monitor.completedTurnId;
    const synthetic = [...page.events];
    if (candidate && !finalEvent) synthetic.push({ ...candidate, kind: 'assistant_message', final: true, message: { text: candidate.text } });
    if (completedTurnId && !completed) synthetic.push({ kind: 'turn_end', turnId: completedTurnId, outcome: 'completed' });
    if (candidate && completedTurnId) detail = await this.api.request(`${path}?live=1`, undefined, 5000);
    const final = questionSeq !== undefined && deliveryConfirmed ? recordedFinal(synthetic, { ...monitor, activeTurnId: turn }, detail.live) : null;
    const finalKey = final ? `${turn}:${final.seq}` : null;
    const completion = finalKey && finalKey !== monitor.notifiedFinal;
    const summaries = [...monitor.tools ?? [], ...page.events.filter((event: any) => event.kind === 'tool_call' && event.time >= monitor.createdAt && event.turnId === turn)
      .map((event: any) => `${event.tool?.summary?.title ?? 'Tool call'} · ${event.tool?.outcome ?? 'recorded'}`)].slice(-4).map(row => row.slice(0, 500));
    const title = detail.live?.activeTurnId ? 'Chat On Steroids — Working' : final ? 'Chat On Steroids — Recorded turn completed' : 'Chat On Steroids — Waiting';
    const description = `${sessionDescription(detail)}\n\nInput: ${monitor.inputId}\nObserved reply turn: ${turn ?? 'not yet attributed'}\nInput proof: ${input?.delivery ?? (deliveryConfirmed ? 'sent (recorded exact receipt)' : 'outbox record not retained')}\n${summaries.join('\n')}${final && state.settings.finalResults ? `\n\nRecorded final response:\n${final.message?.text ?? ''}` : ''}`;
    const signature = createHash('sha256').update(JSON.stringify([title, description])).digest('hex');
    // If a page is cut at 100, never advance past unseen revisions. Each returned nextFrom is the owner cursor.
    const notify = (state.settings.progress || (completion && state.settings.finalResults)) && signature !== monitor.signature;
    if (!notify) {
      await this.store.update(next => {
        const row = next.monitors[key]; if (!row) return;
        if (!owns(row)) throw new Error('Monitor was replaced while reading events');
        // Keep completion evidence unread until a final notification can be durably checkpointed.
        row.from = page.nextFrom; row.activeTurnId = turn; row.lastUpdate = Date.now();
        row.questionSeq = questionSeq; row.deliveryConfirmed = deliveryConfirmed; row.final = candidate; row.completedTurnId = completedTurnId; row.tools = summaries;
      });
      return;
    }
    const channel = await this.transport.channel(monitor.channelId);
    if (this.stopped) return;
    if (!this.config.guilds.includes(channel.guildId)) throw new Error('Notification channel is outside the authorized guilds');
    const marker = `CoS monitor ${key}`;
    let messageId = monitor.messageId;
    if (!messageId && monitor.pendingSignature) {
      // A crashed POST may have created a message. Search bounded history, never blindly duplicate it.
      messageId = (await channel.recent()).find(row => row.marker === marker)?.id ?? null;
      if (!messageId) throw new Error('Notification creation is unconfirmed; recover its message ID locally before continuing');
    }
    const admin = this.config.admins[0]!;
    let view = monitor.viewId;
    if (view && this.store.snapshot().views[view]) await this.store.update(next => { next.views[view!]!.expiresAt = Date.now() + 30 * 60_000; });
    else view = await this.store.view({ kind: 'status', user: admin, guild: channel.guildId, channel: monitor.channelId, sessionId: monitor.sessionId });
    const payload = panel(title, safeText(description, [this.config.token]), [buttons(view, [['refresh', 'Refresh'], ['taskplan', 'View Plan'], ['logs', 'View Logs'], ['workers', 'Workers'], ['stop', 'Stop', ButtonStyle.Danger]])]);
    payload.embeds[0]!.setFooter({ text: marker });
    await this.store.update(next => {
      if (!owns(next.monitors[key]) || (!next.settings.progress && !next.settings.finalResults) || next.settings.notificationChannel !== monitor.channelId)
        throw new Error('Monitor or notification settings changed before publication');
      next.monitors[key]!.pendingSignature = signature; next.monitors[key]!.viewId = view;
    });
    if (messageId) await channel.edit(messageId, payload);
    else messageId = (await channel.send({ ...payload, nonce: key.replaceAll('-', '').slice(0, 25), enforceNonce: true })).id;
    await this.store.update(next => {
      const row = next.monitors[key]; if (!row) return;
      // Message identity can settle after a new input took over this session/channel panel.
      // Its old cursor/turn/completion may never overwrite that new monitored input.
      row.messageId ??= messageId;
      if (!owns(row)) return;
      row.signature = signature; delete row.pendingSignature;
      row.from = page.nextFrom; row.activeTurnId = turn; row.lastUpdate = Date.now();
      row.questionSeq = questionSeq; row.deliveryConfirmed = deliveryConfirmed; row.final = candidate; row.completedTurnId = completedTurnId; row.tools = summaries;
      if (completion) row.notifiedFinal = finalKey;
    });
  }
}
