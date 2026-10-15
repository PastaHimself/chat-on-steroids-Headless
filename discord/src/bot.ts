import { createHash, randomUUID } from 'node:crypto';
import { MessageFlags, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  type Interaction, type RepliableInteraction } from 'discord.js';
import { ApiError, ControlClient } from './api.js';
import { authorized, safeText, rememberSecret, type Bootstrap } from './config.js';
import { definitions, helpDescription } from './commands.js';
import { StateStore, snowflake, type Permission, type View } from './state.js';
import { panel, buttons, select, sessionDescription, historyDescription, taskPlanDescription, resourceDescription, sessionStatusIndicator, inputDeliveryDescription, EmbedColor } from './ui.js';

const sessionPath = (id: string) => {
  if (!/^[0-9a-z-]{8,64}$/.test(id)) throw new Error('Invalid local session ID');
  return `/v1/sessions/${id}`;
};
const encode = encodeURIComponent;
export class DiscordController {
  private busy = new Set<string>();
  private setupSaving = false;
  constructor(readonly config: Bootstrap, readonly store: StateStore, readonly api: ControlClient) { rememberSecret(config.token); }
  private allowed(interaction: any, permission: Permission): boolean {
    return authorized(this.config, this.store.snapshot().settings, interaction.user.id, interaction.guildId, interaction.channelId, permission);
  }
  private require(interaction: any, permission: Permission): void {
    if (!this.allowed(interaction, permission)) throw new Error('This user, guild, channel or operation is not authorized by the local bootstrap and saved grants.');
  }
  private async makeView(interaction: any, view: Omit<View, 'user' | 'guild' | 'channel' | 'expiresAt'>): Promise<string> {
    return this.store.view({ ...view, user: interaction.user.id, guild: interaction.guildId, channel: interaction.channelId });
  }
  private session(interaction: any): string {
    const state = this.store.snapshot();
    const id = interaction.options?.getString('session') ?? state.selected[interaction.user.id] ?? state.settings.channelSessions[interaction.channelId] ?? state.settings.defaultSession;
    if (!id) throw new Error('Select a session with /sessions or /select first.');
    sessionPath(id); return id;
  }
  private selection(interaction: any, id: string) {
    const state = this.store.snapshot();
    const selected = state.selection[`${interaction.user.id}:${id}`];
    return { model: selected?.model ?? state.settings.defaultModel, reasoningEffort: selected?.reasoning ?? state.settings.defaultReasoning };
  }
  private async operation(interaction: any, work: (id: string) => Promise<any>, requestIdentity?: unknown): Promise<any> {
    if (await this.store.archive.get(interaction.id)) throw new Error('This archived interaction was already handled and cannot run again.');
    const prior = this.store.snapshot().interactions[interaction.id];
    if (prior) throw new Error(prior.state !== 'started' ? 'This interaction was already handled.' : `This interaction has an uncertain operation ${prior.operationId}. Inspect its state before trying again.`);
    await this.store.archive.assertSpace();
    const id = randomUUID();
    await this.store.update(state => {
      if (state.interactions[interaction.id]) throw new Error('Interaction already claimed');
      if (Object.keys(state.interactions).length >= 2000) throw new Error('Interaction receipt capacity reached; completed receipts archive automatically; inspect unresolved operations locally');
      state.interactions[interaction.id] = { operationId: id, createdAt: Date.now(), state: 'started', fingerprint: createHash('sha256')
        .update(JSON.stringify([interaction.id, interaction.user.id, interaction.guildId, interaction.channelId, interaction.commandName ?? interaction.customId,
          requestIdentity ?? interaction.options?.data ?? interaction.values ?? null])).digest('hex') };
    });
    try {
      const result = await work(id);
      await this.store.update(state => { state.interactions[interaction.id]!.state = 'done'; state.interactions[interaction.id]!.settledAt = Date.now(); });
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.outcome === 'rejected' && error.operationId === id) {
        await this.store.update(state => { state.interactions[interaction.id]!.state = 'rejected'; state.interactions[interaction.id]!.settledAt = Date.now(); });
        throw new Error(`Request rejected before effects: ${error.code}. No instruction was sent.`);
      }
      throw new Error(`${safeText(error instanceof Error ? error.message : 'Operation failed')}\nOperation ${id} has no confirmed bot receipt. Inspect application state before another request.`);
    }
  }
  async handle(interaction: Interaction): Promise<void> {
    if (interaction.isAutocomplete()) { await this.autocomplete(interaction); return; }
    if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
    if (this.busy.has(interaction.id)) return;
    if (this.busy.size >= 16) { await interaction.reply({ content: 'The bot is busy; retry shortly.', flags: MessageFlags.Ephemeral }); return; }
    this.busy.add(interaction.id);
    try {
      if (interaction.isChatInputCommand()) {
        const definition = definitions.find(row => row.name === interaction.commandName);
        if (!definition) throw new Error('Command unavailable');
        this.require(interaction, definition.permission);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply(await this.command(interaction));
      } else {
        const [id, action] = interaction.customId.split(':');
        const view = this.store.getView(id!, interaction.user.id, interaction.guildId!, interaction.channelId!);
        this.require(interaction, view.kind === 'setup' ? 'admin' : view.kind === 'confirm' ? view.action === 'worker' ? 'workers' : 'send'
          : view.kind === 'plan' ? action === 'refresh' && this.allowed(interaction, 'read') ? 'read' : 'plan' : 'read');
        if (interaction.isButton() && ['edit', 'setup-notifications', 'setup-access', 'setup-workers'].includes(action!)) {
          await interaction.showModal(this.modal(id!, action!, view)); return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = interaction.isModalSubmit() ? await this.submitModal(interaction, id!, action!, view)
          : await this.component(interaction, id!, action!, view);
        await interaction.editReply(result);
      }
    } catch (error) {
      const text = safeText(error instanceof Error ? error.message : 'Operation failed', [this.config.token]).slice(0, 1800);
      const target = interaction as RepliableInteraction;
      if (target.deferred || target.replied) await target.editReply({ content: text, embeds: [], components: [], allowedMentions: { parse: [] } }).catch(() => undefined);
      else await target.reply({ content: text, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => undefined);
    } finally { this.busy.delete(interaction.id); }
  }
  async command(interaction: any): Promise<any> {
    const name: string = interaction.commandName;
    const string = (key: string) => interaction.options.getString(key);
    const boolean = (key: string) => interaction.options.getBoolean(key);
    const act = (action: string, args: Record<string, unknown>) => this.operation(interaction, id => this.api.action(action, id, args), [action, args]);
    switch (name) {
      case 'help': return this.helpPanel(interaction, string('command'));
      case 'setup': return this.setupPanel(interaction);
      case 'sessions': return this.sessionsPanel(interaction);
      case 'select': {
        const id = this.session(interaction); const detail = await this.api.request(sessionPath(id));
        if (['worker', 'helper'].includes(detail.session.origin?.kind)) throw new Error('Select an ordinary or owning prime session.');
        await this.store.update(state => { state.selected[interaction.user.id] = id; });
        return panel('Session selected', sessionDescription(detail), [], [], { color: EmbedColor.Success });
      }
      case 'new': {
        const startedAt = Date.now();
        const state = this.store.snapshot();
        const args: Record<string, unknown> = { prompt: string('prompt') ?? undefined, projectId: string('project') ?? state.settings.defaultProject ?? undefined,
          model: string('model') ?? state.settings.defaultModel, reasoningEffort: string('reasoning') ?? state.settings.defaultReasoning };
        const result = await act('new', args);
        if (result.sessionId) {
          await this.store.update(next => { next.selected[interaction.user.id] = result.sessionId; });
          await this.monitor(interaction, result.sessionId, result.inputId, 0, startedAt).catch(() => undefined);
        }
        return panel('Conversation admitted', `Local session: ${result.sessionId}\n${inputDeliveryDescription({ ...result, id: result.inputId, state: result.state ?? 'queued' })}\n${args.prompt ? '' : 'Opening message: Start a new conversation. Await my next instruction.'}\nProvider opening and model selection require delivery acknowledgement.`, [], [], { color: result.projectWait ? EmbedColor.Warning : EmbedColor.Success });
      }
      case 'ask': {
        const startedAt = Date.now();
        const id = this.session(interaction); const detail = await this.api.request(`${sessionPath(id)}?live=1`);
        const requested = string('delivery') ?? (detail.live?.activeTurnId ? 'after-turn' : 'auto');
        const defaults = this.store.snapshot().settings.defaultAutomation;
        const cursor = (await this.api.request(`${sessionPath(id)}/events?limit=1`)).nextFrom;
        const result = await act('ask', { sessionId: id, text: string('prompt'), delivery: requested,
          ...(defaults === 'off' ? {} : { automation: defaults }), ...(defaults === 'loop' ? { loopAfterTurn: this.store.snapshot().settings.defaultLoopAfterTurn } : {}), ...this.selection(interaction, id) });
        let monitorNote = '';
        await this.monitor(interaction, id, result.inputId, cursor, startedAt).catch(() => { monitorNote = '\nProgress monitoring could not be attached. The admitted input remains valid; inspect /status and /queue.'; });
        return panel('Input admitted', `Input: ${result.inputId}\nSession: ${id}\nState: ${result.state}\nDelivery proof: ${result.delivery}\nRequested model: ${this.selection(interaction, id).model ?? 'current provider selection'}\nUse /queue and /status to verify delivery and the observed model.${monitorNote}`, [], [], { color: EmbedColor.Success });
      }
      case 'chat': case 'history': return this.historyPanel(interaction, this.session(interaction), undefined, name === 'chat');
      case 'status': return this.statusPanel(interaction, this.session(interaction));
      case 'stop': {
        const id = this.session(interaction), detail = await this.api.request(`${sessionPath(id)}?live=1`);
        if (!detail.live?.activeTurnId) throw new Error('There is no proven active turn to stop. Use /pause to disable automation.');
        return this.confirmPanel(interaction, 'stop', { sessionId: id, expectedTurnId: detail.live.activeTurnId },
          'Request native Stop for this exact turn and disable its automation. The provider may still be running until it acknowledges cancellation.');
      }
      case 'goal': case 'loop': {
        const id = this.session(interaction), action = string('action');
        if (action === 'status') return panel(`${name} state`, await this.api.request(`${sessionPath(id)}/controls`), [], [], { color: EmbedColor.Info });
        if (name === 'goal' && string('objective')) {
          if (action !== 'on') throw new Error('Use action:on with an objective, or leave objective empty to switch modes without changing it.');
          return panel('Goal objective saved', await act('objective', { sessionId: id, objective: string('objective'), mode: 'goal' }), [], [], { color: EmbedColor.Success });
        }
        const afterTurn = name === 'loop' && string('delivery') ? string('delivery') === 'after-turn' : undefined;
        return panel(`${name} configuration`, await act('automation', { sessionId: id, automation: action === 'on' ? name : 'off', afterTurn }), [], [], { color: EmbedColor.Success });
      }
      case 'plan': {
        const id = this.session(interaction); const plan = await act('plan', { sessionId: id, prompt: string('prompt') });
        return this.planPanel(interaction, plan);
      }
      case 'taskplan': return panel('Executor task plan', taskPlanDescription((await this.api.request(`${sessionPath(this.session(interaction))}/taskplan`)).plan), [], [], { color: EmbedColor.Info });
      case 'planstatus': {
        const id = this.session(interaction);
        const result = await this.api.request('/v1/remote/plans');
        const plan = result.plans.filter((row: any) => row.sessionId === id).at(-1);
        if (plan) return this.planPanel(interaction, plan);
        const queue = await this.api.request('/v1/inputs?limit=100');
        return panel('Workflow state', `No remote composer draft.\n${queue.inputs.filter((row: any) => row.sessionId === id && row.mode === 'finish').length} checkpoint inputs recorded.\nUse /taskplan for executor progress.`, [], [], { color: EmbedColor.Info });
      }
      case 'models': {
        const catalog = await this.api.request(`/v1/remote/models${boolean('refresh') ? '?refresh=1' : ''}`);
        const page = await this.makeView(interaction, { kind: 'help', command: 'models', page: 0 });
        return this.modelPanel(catalog, page, 0);
      }
      case 'model': case 'reasoning': {
        const id = this.session(interaction), detail = await this.api.request(sessionPath(id));
        const requested = string(name === 'model' ? 'model' : 'effort');
        if (!requested) return panel('Model selection', `Observed: ${detail.session.model ?? 'unknown'}\nRequested for next prompt: ${safeText(this.selection(interaction, id))}\nRequests are acknowledged by the application on delivery.`, [], [], { color: EmbedColor.Info });
        const catalog = await this.api.request('/v1/remote/models');
        const current = this.selection(interaction, id);
        const picked = catalog.models.find((row: any) => row.id === (name === 'model' ? requested : current.model));
        if (catalog.state !== 'ready' || !picked) throw new Error('Choose an account-observed model with /models first.');
        const reasoning = name === 'reasoning' ? requested : null;
        if (reasoning && !picked.efforts.includes(reasoning)) throw new Error('That reasoning effort is unavailable for the selected model.');
        await this.store.update(state => { state.selection[`${interaction.user.id}:${id}`] = { model: picked.id, reasoning }; });
        return panel('Next-prompt preference saved', `Requested model: ${picked.label}\nReasoning: ${reasoning ?? 'provider default'}\nThis takes effect through /ask. No model switch has been acknowledged yet.`, [], [], { color: EmbedColor.Success });
      }
      case 'workers': {
        const id = this.session(interaction), workers = await this.api.request(`${sessionPath(id)}/workers`);
        return panel('Owned workers', workers.agents.map((row: any) => `${row.runId} · ${row.id} · ${row.state}\n${row.task.text}`).join('\n\n'), [], [], { color: EmbedColor.Info });
      }
      case 'delegate': return panel('Worker admission', await act('delegate', { sessionId: this.session(interaction), task: string('task'), runId: string('run') ?? undefined }), [], [], { color: EmbedColor.Success });
      case 'worker': {
        const args = { sessionId: this.session(interaction), runId: string('run'), workerId: string('worker'), action: string('action'), text: string('text') ?? undefined };
        if (args.action === 'sleep') return this.confirmPanel(interaction, 'worker', { ...args, confirmed: true }, 'Pause this exact owned worker through the broker. Native generation cancellation is unconfirmed.');
        return panel('Worker message', await act('worker', args), [], [], { color: EmbedColor.Success });
      }
      case 'workerlogs': {
        const id = this.session(interaction), workers = await this.api.request(`${sessionPath(id)}/workers?run=${encode(string('run'))}`);
        const worker = workers.agents.find((row: any) => row.id === string('worker') && row.runId === string('run'));
        if (!worker?.conversationId) throw new Error('This worker is not owned by the selected prime, or has no recorded conversation.');
        // Discover its local session through bounded session pages; never use conversation ID as session ID.
        let cursor: string | null = null; let target: any;
        for (let page = 0; page < 5 && !target; page++) {
          const rows: any = await this.api.request(`/v1/sessions?limit=200${cursor ? `&cursor=${encode(cursor)}` : ''}`);
          target = rows.sessions.find((row: any) => row.conversationId === worker.conversationId && row.origin?.kind === 'worker');
          cursor = rows.nextCursor; if (!cursor) break;
        }
        if (!target) throw new Error('No worker recording was found within the bounded search.');
        const rows = await this.api.request(`${sessionPath(target.id)}/events?limit=10`);
        return panel('Worker activity', historyDescription(rows.events), [], [], { color: EmbedColor.Info });
      }
      case 'compact': {
        const id = this.session(interaction), detail = await this.api.request(`${sessionPath(id)}?live=1`);
        const deleted = detail.live?.providerUnavailable?.reason === 'conversation_deleted';
        return this.confirmPanel(interaction, 'compact', { sessionId: id,
          ...(deleted ? { recoverDeletedConversationId: detail.session.conversationId } : {}) }, deleted
          ? 'Confirm only after you have reconciled the old tools, workers, project and /queue receipts. Use the latest saved summary to replace the deleted ChatGPT conversation in this same local session. Unconfirmed Sends and running effects remain blocked; a missing summary requires local recovery.'
          : 'Start Compact & Resume. The provider conversation will change while this local session and Discord mapping remain the same.');
      }
      case 'queue': {
        const id = this.session(interaction), queue = await this.api.request('/v1/inputs?limit=100');
        return panel('Input delivery records', queue.inputs.filter((row: any) => row.sessionId === id || row.deliveredSessionId === id)
          .slice(-20).map((row: any) => `${row.id}\n${row.state} · proof: ${row.delivery} · ${row.mode}\nDue: ${new Date(row.dueAt).toISOString()}\n${row.error ?? ''}`).join('\n\n'), [], [], { color: EmbedColor.Info });
      }
      case 'cancel': {
        const id = this.session(interaction), input = string('input');
        if (!/^[0-9a-f-]{36}$/.test(input ?? '')) throw new Error('Invalid outbox UUID');
        const queue = await this.api.request('/v1/inputs?limit=500');
        const row = queue.inputs.find((item: any) => item.id === input && item.sessionId === id);
        if (!row) throw new Error('This input does not belong to the selected session.');
        return this.confirmPanel(interaction, 'cancel', { sessionId: id, inputId: input }, 'Withdraw this exact input only if the outbox can still prove it was not sent.');
      }
      case 'pause': {
        const id = this.session(interaction), controls = await this.api.request(`${sessionPath(id)}/controls`);
        if (controls.automation === 'off') return panel('Automation already off', 'No Goal or Loop automation is active. Generation and queued inputs have separate controls.', [], [], { color: EmbedColor.Info });
        await this.store.update(state => { state.paused[id] = { mode: controls.automation, afterTurn: controls.loopAfterTurn }; });
        return panel('Automation paused', await act('automation', { sessionId: id, automation: 'off' }), [], [], { color: EmbedColor.Warning });
      }
      case 'resume': {
        const id = this.session(interaction), saved = this.store.snapshot().paused[id];
        if (!saved) throw new Error('No automation pause is saved for this session. Use /goal or /loop to select a mode.');
        const result = await act('automation', { sessionId: id, automation: saved.mode, afterTurn: saved.afterTurn });
        await this.store.update(state => { delete state.paused[id]; }); return panel('Automation resumed', result, [], [], { color: EmbedColor.Success });
      }
      case 'projects': return panel('Approved projects', (await this.api.request('/v1/remote/projects')).projects.map((row: any) => `${row.name}\n${row.id}`).join('\n\n'), [], [], { color: EmbedColor.Info });
      case 'project': return panel('Project associated', await act('project', { sessionId: this.session(interaction), projectId: string('project') }), [], [], { color: EmbedColor.Success });
      case 'files': {
        const result = await this.api.request(`/v1/remote/files?project=${encode(string('project'))}&directory=${encode(string('directory') ?? '')}`);
        const page = interaction.options.getInteger('page') ?? 1;
        return panel(`Files · ${result.projectName} · page ${page}`, result.entries.slice((page - 1) * 20, page * 20)
          .map((row: any) => `${row.kind === 'directory' ? '📁' : '📄'} ${row.path}`).join('\n') + (result.truncated ? '\nDirectory results were bounded.' : ''), [], [], { color: EmbedColor.Info });
      }
      case 'logs': {
        const result = await this.api.request('/v1/log?limit=20');
        return panel('Redacted application activity', result.entries.map((row: any) => `${new Date(row.time).toISOString()} · ${row.level}\n${row.message}`).join('\n\n'), [], [this.config.token], { color: EmbedColor.Info });
      }
      case 'monitor': {
        const health = await this.api.request('/v1/remote/health');
        const resource = await this.api.request('/v1/remote/resources');
        const healthy = health.serviceAvailable && health.components.every((c: any) => c.state === 'available');
        return panel('VPS and service health', `${health.components.map((row: any) => `${row.label}: ${row.state}\n${row.detail}${row.state === 'available' ? '' : `\n${row.action}`}`).join('\n\n')}\n\n${resourceDescription(resource)}`, [], [], { color: healthy ? EmbedColor.Success : EmbedColor.Warning });
      }
      case 'operations': return this.operationListPanel(interaction, this.session(interaction));
      case 'operation': return this.operationPanel(interaction, string('id'));
      default: throw new Error('Command unavailable');
    }
  }
  private async monitor(interaction: any, sessionId: string, inputId: string, from = 0, createdAt = Date.now()): Promise<void> {
    const settings = this.store.snapshot().settings;
    if ((!settings.progress && !settings.finalResults) || !settings.notificationChannel) return;
    if (!authorized(this.config, settings, interaction.user.id, interaction.guildId, settings.notificationChannel, 'read'))
      throw new Error('The notification channel is outside the allowed channel scope.');
    await this.store.update(state => {
      this.store.pruneMonitors(state, Date.now(), true);
      const existing = Object.values(state.monitors).find(row => row.sessionId === sessionId && row.channelId === settings.notificationChannel);
      if (existing) { existing.inputId = inputId; existing.createdAt = createdAt; existing.notifiedFinal = null; existing.from = from; existing.lastUpdate = 0;
        existing.activeTurnId = null; delete existing.final; delete existing.completedTurnId; delete existing.questionSeq; delete existing.deliveryConfirmed; delete existing.tools; return; }
      if (Object.keys(state.monitors).length >= 20) throw new Error('Notification monitor limit reached');
      state.monitors[randomUUID()] = { sessionId, channelId: settings.notificationChannel!, messageId: null, from,
        lastUpdate: 0, signature: '', activeTurnId: null, inputId, createdAt, notifiedFinal: null };
    });
  }
  private async statusPanel(interaction: any, id: string) {
    const detail = await this.api.request(`${sessionPath(id)}?live=1`);
    const view = await this.makeView(interaction, { kind: 'status', sessionId: id });
    const requested = this.selection(interaction, id);
    // An admitted opening already has a local session, but caller-scoped worker
    // state requires a concrete provider conversation. Do not hide its outbox
    // behind the legitimate no_chat refusal at that separate boundary.
    const workers = detail.session.conversationId ? await this.api.request(`${sessionPath(id)}/workers`) : { agents: [] };
    const workerSummary = Object.entries((workers.agents ?? []).reduce((counts: Record<string, number>, row: any) => { counts[row.state] = (counts[row.state] ?? 0) + 1; return counts; }, {})).map(([state, count]) => `${count} ${state}`).join(', ') || 'None';
    const queue = await this.api.request('/v1/inputs?limit=100');
    const input = queue.inputs.filter((row: any) => row.sessionId === id || row.deliveredSessionId === id).at(-1);
    const projects = await this.api.request('/v1/remote/projects');
    const project = projects.projects.find((row: any) => row.id === detail.session.projectId);
    const status = sessionStatusIndicator(detail);
    const delivery = `${input?.delivery ?? 'No recent input proof'}\n${inputDeliveryDescription(input)}\nProvider binding: ${detail.session.conversationId ? 'attributed' : 'not yet attributed'}`;

    return panel('Session status', `${sessionDescription(detail)}\nProject: ${project?.name ?? 'Unfiled or unavailable'}\nNext prompt model: ${requested.model ?? 'Current provider selection'}\nDelivery: ${delivery}\nWorkers: ${workerSummary}\nRecovery: ${detail.live?.providerUnavailable?.reason === 'conversation_deleted' ? 'ChatGPT confirmed deletion. Local work and objective are retained. Review /queue, /operations, /history and workers; after reconciliation, /compact can recover from a saved summary. A stream resume 404 alone does not prove deletion.' : detail.live?.recordingIncompleteAt !== undefined ? 'Recording history is incomplete. Inspect and reconcile it locally before requesting automatic continuation.' : detail.live?.blocked ? 'Review the session block in Details.' : detail.live?.job?.needsAttention ? 'Compact & Resume needs attention; inspect the source and replacement Send checkpoints above. Never manually resend an unconfirmed handoff.' : detail.live?.recovery?.length ? 'The backend is recovering this session. Review Details and inspect its receipt before requesting more work.' : input?.delivery === 'unconfirmed' ? 'Inspect queue and history before submitting another request.' : 'No current recovery action reported.'}`,
      [buttons(view, [['refresh', 'Refresh', ButtonStyle.Primary], ['taskplan', 'View Plan', ButtonStyle.Secondary], ['queue', 'View queue', ButtonStyle.Secondary], ['history', 'View history', ButtonStyle.Secondary], ['details', 'Details', ButtonStyle.Secondary]])],
      [],
      {
        color: status.color,
        fields: [
          { name: 'State', value: `${status.emoji} ${status.text}`, inline: true },
          { name: 'Project', value: project?.name ?? 'Unfiled', inline: true },
          { name: 'Workers', value: workerSummary, inline: true },
        ]
      });
  }
  private async operationListPanel(interaction: any, sessionId: string, cursor?: string) {
    const receipts = await this.api.request(`/v1/remote/operations?session=${encode(sessionId)}&limit=10${cursor ? `&cursor=${encode(cursor)}` : ''}`);
    const view = await this.makeView(interaction, { kind: 'operation', sessionId, cursor: receipts.nextCursor });
    const components: any[] = [];
    if (receipts.operations.length) components.push(select(view, 'choose', 'Inspect a receipt', receipts.operations.map((row: any) => ({
      label: `${row.action} · ${row.state}`, value: row.id, description: new Date(row.createdAt).toISOString()
    }))));
    const navButtons: Array<[string, string, ButtonStyle?]> = receipts.nextCursor
      ? [['next', 'Next page', ButtonStyle.Secondary], ['first', 'First page', ButtonStyle.Secondary]]
      : [['first', 'First page', ButtonStyle.Secondary]];
    components.push(buttons(view, navButtons));
    return panel('Operation receipts', receipts.operations.length ? 'Choose an operation to inspect its outcome. Checking a receipt never sends an instruction.' : 'No hot receipts for this session. An archived operation remains inspectable by its exact ID.', components, [], { color: EmbedColor.Info });
  }
  private async operationPanel(interaction: any, operationId: string) {
    if (!/^[0-9a-f-]{36}$/.test(operationId ?? '')) throw new Error('Use the exact operation ID shown with the request.');
    const receipt = await this.api.request(`/v1/remote/operations/${operationId}`);
    const view = await this.makeView(interaction, { kind: 'operation', action: operationId, sessionId: receipt.sessionId });
    const actions: Array<[string, string, ButtonStyle?]> = [['receipt', 'Check receipt', ButtonStyle.Primary]];
    if (receipt.sessionId) actions.push(['queue', 'View queue', ButtonStyle.Secondary], ['history', 'View history', ButtonStyle.Secondary]);
    const color = receipt.state === 'done' ? EmbedColor.Success : receipt.state === 'unconfirmed' ? EmbedColor.Warning : receipt.state === 'rejected' ? EmbedColor.Danger : EmbedColor.Info;
    return panel('Operation receipt', `Operation: ${receipt.action}\nOutcome: ${receipt.state}${receipt.outcome ? ` (${receipt.outcome})` : ''}\n${receipt.state === 'unconfirmed' ? 'Inspect queue and history before composing another request.' : 'Checking this receipt never sends an instruction.'}\n${receipt.error?.code ?? ''}`, [buttons(view, actions)], [], { color });
  }
  private async historyPanel(interaction: any, id: string, before?: number, recent = false) {
    const result = await this.api.request(`${sessionPath(id)}/events?limit=6${before !== undefined ? `&before=${before}` : ''}${recent ? '&kinds=user_message,assistant_message' : ''}`);
    const view = await this.makeView(interaction, { kind: 'history', sessionId: id, before: result.events[0]?.position });
    const queue = !result.events.length ? await this.api.request('/v1/inputs?limit=100') : null;
    const input = queue?.inputs.filter((row: any) => row.sessionId === id || row.deliveredSessionId === id).at(-1);
    const description = historyDescription(result.events) + (!result.events.length ? `\n${inputDeliveryDescription(input)}\nUse /status to inspect provider binding; empty history alone proves no delivery outcome.` : '');
    return panel('Recorded history', description, [buttons(view, [['older', 'Older', ButtonStyle.Secondary], ['latest', 'Latest', ButtonStyle.Secondary]])], [], { color: EmbedColor.Info });
  }
  private async sessionsPanel(interaction: any, cursor?: string | null) {
    const result = await this.api.request(`/v1/sessions?limit=10${cursor ? `&cursor=${encode(cursor)}` : ''}`);
    const view = await this.makeView(interaction, { kind: 'sessions', cursor: result.nextCursor });
    const rows = result.sessions;
    const descriptions: string[] = [];
    for (const row of rows) {
      let live: any;
      try { live = (await this.api.request(`${sessionPath(row.id)}?live=1`)).live; } catch { /* Saved metadata remains readable if a live probe fails. */ }
      descriptions.push(`${row.title || row.id}\n${row.id} · project ${row.projectId ?? 'unfiled'} · ${row.model ?? 'unknown model'}\n${live ? live.activeTurnId ? 'working' : live.stopPending ? 'stop requested' : 'no proven active turn' : 'live state unavailable'} · automation ${live?.automation ?? 'unavailable'}\n${new Date(row.updatedAt).toISOString()}`);
    }
    const components: any[] = [];
    const selectable = rows.filter((row: any) => !['worker', 'helper'].includes(row.origin?.kind));
    if (selectable.length) components.push(select(view, 'select', 'Select a session', selectable.map((row: any) =>
      ({ label: row.title || row.id, value: row.id, description: `${row.model ?? 'unknown model'} · ${row.projectId ?? 'unfiled'}` }))));
    const navButtons: Array<[string, string, ButtonStyle?]> = result.nextCursor
      ? [['next', 'Next', ButtonStyle.Secondary], ['first', 'First page', ButtonStyle.Secondary]]
      : [['first', 'First page', ButtonStyle.Secondary]];
    components.push(buttons(view, navButtons));
    return panel(`Sessions · ${result.total} saved`, descriptions.join('\n\n'), components, [], { color: EmbedColor.Info });
  }
  private async helpPanel(interaction: any, command?: string | null, category?: string) {
    const visible = definitions.filter(row => this.allowed(interaction, row.permission));
    if (command && !visible.some(row => row.name === command)) throw new Error('That command is unavailable to you.');
    let availability = 'Backend availability could not be verified.';
    try { const settings = await this.api.request('/v1/remote/settings'); availability = `Backend connected. Actions ${settings.actionsAllowed ? 'enabled' : 'disabled'}; local grants: ${Object.entries(settings.permissions).filter(([, value]) => value).map(([key]) => key).join(', ') || 'none'}.`; }
    catch { /* Help stays usable while the backend is offline. */ }
    const view = await this.makeView(interaction, { kind: 'help', command: command ?? undefined });
    const categories = [...new Set(visible.map(row => row.category))];
    const shown = category ? visible.filter(row => row.category === category) : visible.slice(0, 10);
    return panel(command ? `Help · /${command}` : 'Chat On Steroids help', `${command ? helpDescription(command) : shown.map(row => `/${row.name} — ${row.description}`).join('\n')}\n\n${availability}\n\nGoal may decide no continuation is needed. Loop continues within the saved brief. Composer Plan generates reviewable checkpoints. update_plan records the executor’s progress.`,
      [select(view, 'category', 'Browse a category', categories.map(value => ({ label: value, value }))),
        select(view, 'help-command', 'Inspect command options', (category ? shown : visible).slice(0, 25).map(row => ({ label: `/${row.name}`, value: row.name }))) ],
      [],
      { color: EmbedColor.Info });
  }
  private modelPanel(catalog: any, view: string, page: number) {
    const rows = catalog.models.slice(page * 10, (page + 1) * 10);
    return panel(`Account models · ${catalog.state} · page ${page + 1}`, `${catalog.error ?? catalog.waiting ?? ''}\n${rows.map((row: any) => `${row.label} · ${row.id}\nEfforts: ${row.efforts.join(', ') || 'provider default'}`).join('\n\n')}`,
      [buttons(view, [['models-prev', 'Previous', ButtonStyle.Secondary], ['models-next', 'Next', ButtonStyle.Secondary]])], [], { color: EmbedColor.Info });
  }
  private async planPanel(interaction: any, plan: any) {
    const view = await this.makeView(interaction, { kind: 'plan', sessionId: plan.sessionId, planId: plan.id, revision: plan.revision });
    const controls: Array<[string, string, ButtonStyle?]> = [['refresh', 'Refresh', ButtonStyle.Primary]];
    const canPlan = this.allowed(interaction, 'plan');
    if (plan.state === 'approval' && canPlan) {
      if (this.allowed(interaction, 'send')) controls.push(['approve', 'Approve', ButtonStyle.Success]);
      controls.push(['edit', 'Edit stage', ButtonStyle.Secondary], ['delete', 'Delete stage', ButtonStyle.Danger]);
    }
    if (['failed', 'interrupted', 'approval'].includes(plan.state) && canPlan) controls.push(['regenerate', 'Regenerate', ButtonStyle.Secondary]);
    if (['generating', 'approval'].includes(plan.state) && canPlan) controls.push(['cancel', 'Cancel', ButtonStyle.Danger]);
    const components: any[] = [buttons(view, controls.slice(0, 5))];
    if (controls.length > 5) components.push(buttons(view, controls.slice(5)));
    if (plan.state === 'approval' && canPlan) components.push(select(view, 'stage', 'Select a stage to edit or delete', plan.stages.map((stage: string, index: number) =>
      ({ label: `${index + 1}. ${stage.slice(0, 80)}`, value: String(index) }))));
    const inputs = await this.api.request('/v1/inputs?limit=100');
    const owned = inputs.inputs.filter((row: any) => row.sessionId === plan.sessionId && row.mode === 'finish');
    const color = plan.state === 'approval' ? EmbedColor.Warning : plan.state === 'completed' ? EmbedColor.Success : ['failed', 'interrupted'].includes(plan.state) ? EmbedColor.Danger : EmbedColor.Info;
    return panel('Composer workflow', [`State: ${plan.state} · revision ${plan.revision}`, `Original objective: ${plan.prompt}`, plan.error ?? '',
      ...plan.stages.map((stage: string, index: number) => `${index + 1}. ${stage}`), `Checkpoint queue: ${owned.filter((row: any) => ['queued', 'browser'].includes(row.state)).length} pending; ${owned.filter((row: any) => row.delivery === 'unconfirmed').length} unconfirmed.`,
      plan.inputId ? `Approval input: ${plan.inputId}. Inspect /queue for delivery; approval alone is not execution or verified completion.` : 'No stages execute before approval.'].join('\n\n'), components, [], { color });
  }
  private async confirmPanel(interaction: any, action: string, args: Record<string, unknown>, description: string) {
    const view = await this.makeView(interaction, { kind: 'confirm', action, args, sessionId: args.sessionId as string });
    return panel('Confirm operation', description, [buttons(view, [['confirm', 'Confirm', ButtonStyle.Danger], ['dismiss', 'Cancel', ButtonStyle.Secondary]])], [], { color: EmbedColor.Danger });
  }

  private async component(interaction: any, id: string, action: string, view: View): Promise<any> {
    if (view.kind === 'operation') {
      if (action === 'choose') return this.operationPanel(interaction, interaction.values?.[0]);
      if (view.sessionId && ['next', 'first'].includes(action)) return this.operationListPanel(interaction, view.sessionId, action === 'next' ? view.cursor ?? undefined : undefined);
      this.require(interaction, 'read');
      if (action === 'receipt') return this.operationPanel(interaction, view.action!);
      if (action === 'history' && view.sessionId) return this.historyPanel(interaction, view.sessionId);
      if (action === 'queue' && view.sessionId) return panel('Input delivery', (await this.api.request('/v1/inputs?limit=100')).inputs.filter((row: any) => row.sessionId === view.sessionId), [], [], { color: EmbedColor.Info });
      throw new Error('Receipt action unavailable');
    }
    const value = interaction.values?.[0];
    if (view.kind === 'sessions') {
      if (action === 'select') {
        const detail = await this.api.request(sessionPath(value));
        if (['worker', 'helper'].includes(detail.session.origin?.kind)) throw new Error('Select an ordinary session.');
        await this.store.update(state => { state.selected[interaction.user.id] = value; });
        return this.statusPanel(interaction, value);
      }
      return this.sessionsPanel(interaction, action === 'next' ? view.cursor : null);
    }
    if (view.kind === 'history') return this.historyPanel(interaction, view.sessionId!, action === 'older' ? view.before : undefined);
    if (view.kind === 'help') {
      if (action === 'category') return this.helpPanel(interaction, null, value);
      if (action === 'help-command') return this.helpPanel(interaction, value);
      if (action.startsWith('models-')) {
        const catalog = await this.api.request('/v1/remote/models');
        const page = Math.max(0, Math.min(Math.ceil(catalog.models.length / 10) - 1, (view.page ?? 0) + (action === 'models-next' ? 1 : -1)));
        const next = await this.makeView(interaction, { kind: 'help', command: 'models', page }); return this.modelPanel(catalog, next, page);
      }
    }
    if (view.kind === 'status') {
      if (action === 'history') return this.historyPanel(interaction, view.sessionId!);
      if (action === 'queue') return panel('Input delivery', (await this.api.request('/v1/inputs?limit=100')).inputs.filter((row: any) => row.sessionId === view.sessionId), [], [], { color: EmbedColor.Info });
      if (action === 'details') return panel('Session details', await this.api.request(`${sessionPath(view.sessionId!)}?live=1`),
        [buttons(id, [['refresh', 'Refresh', ButtonStyle.Primary], ['workers', 'Workers', ButtonStyle.Secondary], ['logs', 'View Logs', ButtonStyle.Secondary], ['stop', 'Stop', ButtonStyle.Danger]])], [], { color: EmbedColor.Info });
      if (action === 'refresh') return this.statusPanel(interaction, view.sessionId!);
      if (action === 'taskplan') return panel('Executor task plan', taskPlanDescription((await this.api.request(`${sessionPath(view.sessionId!)}/taskplan`)).plan), [], [], { color: EmbedColor.Info });
      if (action === 'workers') return panel('Owned workers', await this.api.request(`${sessionPath(view.sessionId!)}/workers`), [], [], { color: EmbedColor.Info });
      if (action === 'logs') return panel('Application activity', await this.api.request('/v1/log?limit=10'), [], [this.config.token], { color: EmbedColor.Info });
      if (action === 'stop') {
        this.require(interaction, 'send'); const detail = await this.api.request(`${sessionPath(view.sessionId!)}?live=1`);
        if (!detail.live?.activeTurnId) throw new Error('No proven active turn.');
        return this.confirmPanel(interaction, 'stop', { sessionId: view.sessionId, expectedTurnId: detail.live.activeTurnId }, 'Request native Stop for the current exact turn. Automation will also be disabled.');
      }
    }
    if (view.kind === 'confirm') {
      if (action === 'dismiss') { await this.store.update(state => { delete state.views[id]; }); return panel('Cancelled', 'No operation was requested.', [], [], { color: EmbedColor.Info }); }
      this.require(interaction, view.action === 'worker' ? 'workers' : 'send');
      const result = await this.operation(interaction, async operationId => {
        // Consume the confirmation before any side effect. An old button cannot repeat it.
        await this.store.update(state => { if (!state.views[id]) throw new Error('Confirmation already used'); delete state.views[id]; });
        if (view.action === 'cancel') return this.api.request(`/v1/inputs/${view.args!.inputId}/cancel`, {});
        return this.api.action(view.action!, operationId, view.args!);
      });
      return panel('Operation requested', result, [], [], { color: EmbedColor.Success });
    }
    if (view.kind === 'plan') {
      const plan = await this.api.request(`/v1/remote/plans/${view.planId}`);
      if (action === 'refresh') return this.planPanel(interaction, plan);
      this.require(interaction, 'plan');
      if (plan.revision !== view.revision) throw new Error('The plan changed. Refresh before editing or approving.');
      if (action === 'stage') {
        await this.store.update(state => { state.views[id]!.page = Number(value); });
        return panel('Stage selected', `Stage ${Number(value) + 1}\n${plan.stages[Number(value)]}`, [buttons(id, [['edit', 'Edit stage', ButtonStyle.Secondary], ['delete', 'Delete stage', ButtonStyle.Danger]])], [], { color: EmbedColor.Info });
      }
      if (action === 'approve') this.require(interaction, 'send');
      const result = await this.operation(interaction, async operationId => {
        if (action === 'regenerate') {
          return this.api.action('plan-regenerate', operationId, { planId: plan.id, revision: plan.revision });
        }
        if (action === 'delete') {
          if (plan.stages.length === 1) return this.api.action('plan-cancel', operationId, { planId: plan.id, revision: plan.revision });
          return this.api.action('plan-edit', operationId, { planId: plan.id, revision: plan.revision, index: view.page ?? 0, text: null });
        }
        if (!['approve', 'cancel'].includes(action)) throw new Error('Invalid plan action');
        return this.api.action(`plan-${action}`, operationId, { planId: plan.id, revision: plan.revision });
      });
      return this.planPanel(interaction, result);
    }
    if (view.kind === 'setup') return this.setupComponent(interaction, id, action, view, value);
    throw new Error('Panel action unavailable');
  }

  private async autocomplete(interaction: any): Promise<void> {
    if (!this.allowed(interaction, 'read')) { await interaction.respond([]); return; }
    const focus = interaction.options.getFocused(true); const query = String(focus.value).toLowerCase();
    let rows: Array<{ name: string; value: string }> = [];
    try {
      const read = async () => {
        if (focus.name === 'command') return definitions.filter(row => this.allowed(interaction, row.permission)).map(row => ({ name: row.name, value: row.name }));
        if (focus.name === 'session') return (await this.api.request('/v1/sessions?limit=50')).sessions.filter((row: any) => !['worker', 'helper'].includes(row.origin?.kind)).map((row: any) => ({ name: row.title || row.id, value: row.id }));
        if (focus.name === 'project') return (await this.api.request('/v1/remote/projects')).projects.map((row: any) => ({ name: row.name, value: row.id }));
        if (focus.name === 'model') return (await this.api.request('/v1/remote/models')).models.map((row: any) => ({ name: row.label, value: row.id }));
        if (focus.name === 'effort' || focus.name === 'reasoning') {
          const catalog = await this.api.request('/v1/remote/models');
          const picked = interaction.options.getString('model') ?? this.selection(interaction, this.session(interaction)).model;
          return (catalog.models.find((row: any) => row.id === picked)?.efforts ?? []).map((value: string) => ({ name: value, value }));
        }
        return [];
      };
      let timer: ReturnType<typeof setTimeout>;
      try { rows = await Promise.race([read(), new Promise<[]>((resolve) => { timer = setTimeout(() => resolve([]), 1800); })]); }
      finally { clearTimeout(timer!); }
    } catch { /* An offline backend is an empty suggestion list, never guessed availability. */ }
    await interaction.respond(rows.filter(row => row.name.toLowerCase().includes(query) || row.value.includes(query)).slice(0, 25).map(row => ({ name: safeText(row.name, [this.config.token]).slice(0, 100), value: row.value }))).catch(() => undefined);
  }

  private async setupPanel(interaction: any, section = 'overview', cursor?: string | null, page = 0): Promise<any> {
    this.require(interaction, 'admin');
    let draft = this.store.snapshot().setup[interaction.user.id];
    if (!draft) {
      await this.store.update(state => { state.setup[interaction.user.id] = { id: randomUUID(), revision: 0, baseRevision: state.settingsRevision, settings: structuredClone(state.settings), backend: {} }; });
      draft = this.store.snapshot().setup[interaction.user.id]!;
    }
    const view = await this.makeView(interaction, { kind: 'setup', revision: draft.revision, command: section, page });
    const components: any[] = [select(view, 'setup-section', 'Setup sections', ['overview', 'connection', 'sessions', 'ai', 'discord', 'automation', 'vps', 'finish'].map(value => ({ label: value, value })))];
    let text: unknown = 'Private administrator setup. Changes are staged and survive interruptions. Use Finish → Confirm Save to publish. Administrators are established locally. Never enter credentials in Discord.';
    if (section === 'connection') {
      try {
        const health = await this.api.request('/v1/health'), status = await this.api.request('/v1/status');
        text = `Local API: reachable · actions ${health.actions.enabled ? 'enabled' : 'disabled'}\nBrowser bridge: ${status.bridge.running ? 'running' : 'stopped'} · ${status.bridge.paired ? 'paired' : 'not paired'} · ${status.bridge.present ? 'extension connected' : 'extension absent'}\nMCP: ${status.connection.state}\n${status.connection.detail}\nAuthentication: not proven by pairing. If ChatGPT requests sign-in, use the private VPS browser.\nManual steps: approve folders, unlock the service keyring, configure the MCP tunnel, load/pair the companion and sign in interactively. See docs/headless-vps.md.`;
      } catch { text = 'Backend unavailable. Start the application service and enable its loopback control API locally. Check health before finishing.'; }
    }
    if (section === 'sessions') {
      const sessions = await this.api.request(`/v1/sessions?limit=25${cursor ? `&cursor=${encode(cursor)}` : ''}`), projects = await this.api.request('/v1/remote/projects');
      await this.store.update(state => { state.views[view]!.cursor = sessions.nextCursor; });
      text = `Default session: ${draft.settings.defaultSession ?? 'none'}\nDefault project: ${draft.settings.defaultProject ?? 'none'}\nSelect a default session, or map it to this authorized channel.`;
      const rows = sessions.sessions.filter((row: any) => !['worker', 'helper'].includes(row.origin?.kind));
      if (rows.length) {
        components.push(select(view, 'setup-session', 'Default session', rows.map((row: any) => ({ label: row.title || row.id, value: row.id }))));
        components.push(select(view, 'setup-map', 'Map this channel to a session', rows.map((row: any) => ({ label: row.title || row.id, value: row.id }))));
      }
      if (projects.projects.length) components.push(select(view, 'setup-project', 'Default approved project', projects.projects.map((row: any) => ({ label: row.name, value: row.id }))));
      const navButtons: Array<[string, string, ButtonStyle?]> = sessions.nextCursor
        ? [['setup-next', 'More sessions', ButtonStyle.Secondary], ['setup-first', 'First page', ButtonStyle.Secondary]]
        : [['setup-first', 'First page', ButtonStyle.Secondary]];
      components.push(buttons(view, navButtons));
    }
    if (section === 'ai') {
      const catalog = await this.api.request('/v1/remote/models');
      text = `Observed catalog: ${catalog.state}\nDefault model: ${draft.settings.defaultModel ?? 'current provider choice'}\nDefault effort: ${draft.settings.defaultReasoning ?? 'provider choice'}\nSelection is confirmed on prompt delivery. Worker capacity is configurable; lowering it does not terminate active work.`;
      if (catalog.models.length) components.push(select(view, 'setup-model', 'Default observed model', catalog.models.slice(page * 25, (page + 1) * 25).map((row: any) => ({ label: row.label, value: row.id }))));
      const efforts = catalog.models.find((row: any) => row.id === draft.settings.defaultModel)?.efforts ?? [];
      if (efforts.length) components.push(select(view, 'setup-reasoning', 'Supported effort', efforts.map((value: string) => ({ label: value, value }))));
      const aiButtons: Array<[string, string, ButtonStyle?]> = [['setup-workers', 'Worker limits', ButtonStyle.Secondary]];
      if (catalog.models.length > (page + 1) * 25) aiButtons.push(['setup-next', 'More models', ButtonStyle.Secondary]);
      aiButtons.push(['setup-first', 'First page', ButtonStyle.Secondary]);
      components.push(buttons(view, aiButtons));
    }
    if (section === 'discord') {
      text = { authorizedUsers: Object.keys(draft.settings.users), allowedChannels: draft.settings.channels,
        notificationChannel: draft.settings.notificationChannel, progress: draft.settings.progress, finalResults: draft.settings.finalResults, operationalAlerts: draft.settings.operationalAlerts,
        frequencySeconds: draft.settings.frequencySeconds, note: 'Bootstrap guild/channel restrictions remain authoritative. Discord administrator roles confer no access.' };
      components.push(buttons(view, [['setup-access', 'User and channel grants', ButtonStyle.Secondary], ['setup-notifications', 'Notifications', ButtonStyle.Secondary]]));
    }
    if (section === 'automation') {
      text = { draftDefaultAutomation: draft.settings.defaultAutomation, backend: await this.api.request('/v1/remote/settings'),
        note: 'Goal can decide no continuation is needed. Loop remains distinct. Composer plans require approval. Compact & Resume retains local identity. Recovery never replays uncertain sends.' };
      components.push(select(view, 'setup-automation', 'Default automation for /ask', ['off', 'goal', 'loop'].map(value => ({ label: value, value }))));
      components.push(select(view, 'setup-delivery', 'Loop continuation timing', ['session-finish', 'after-turn'].map(value => ({ label: value, value }))));
      components.push(select(view, 'setup-plan-backend', 'Existing planner backend', ['chatgpt', 'api'].map(value => ({ label: value, value }))));
      components.push(select(view, 'setup-finish', 'Session Finish tool', ['on', 'off'].map(value => ({ label: value, value }))));
    }
    if (section === 'vps') {
      text = resourceDescription(await this.api.request('/v1/remote/resources'));
      try { text += `\nOwned workers: ${(await this.api.request(`${sessionPath(this.session(interaction))}/workers`)).agents.filter((row: any) => row.role === 'worker').length}`; }
      catch { text += '\nWorker count unavailable; select an owning session with /sessions.'; }
    }
    if (section === 'finish') {
      const missing = await this.validateSetup(draft);
      text = { missing, summary: { ...draft.settings, users: Object.fromEntries(Object.entries(draft.settings.users).map(([user, grants]) => [user, grants])) }, backendChanges: draft.backend,
        note: missing.length ? 'Resolve missing requirements before saving.' : 'Validation passed. Confirm Save commits supported settings. Browser authentication must still be verified manually.' };
      components.push(buttons(view, [['setup-save', 'Confirm Save', ButtonStyle.Success], ['setup-discard', 'Discard Draft', ButtonStyle.Danger]]));
      return panel(`Setup · ${section}`, text, components, [this.config.token], { color: missing.length ? EmbedColor.Warning : EmbedColor.Success });
    }
    return panel(`Setup · ${section}`, text, components, [this.config.token], { color: EmbedColor.Info });
  }
  private async validateSetup(draft: NonNullable<ReturnType<StateStore['snapshot']>['setup'][string]>): Promise<string[]> {
    const missing: string[] = [];
    const health = await this.api.request('/v1/health');
    const status = await this.api.request('/v1/status');
    if (!health.actions.enabled) missing.push('Enable controlApi.allowActions locally for mutations.');
    if (!status.bridge.present || !status.bridge.paired) missing.push('Load and pair the companion extension in the private VPS browser.');
    if (status.connection.state !== 'connected') missing.push('Connect and verify the supported MCP tunnel locally.');
    if (draft.settings.defaultSession) {
      const detail = await this.api.request(sessionPath(draft.settings.defaultSession));
      if (['worker', 'helper'].includes(detail.session.origin?.kind)) missing.push('Select an ordinary default session.');
    }
    for (const id of Object.values(draft.settings.channelSessions)) {
      const detail = await this.api.request(sessionPath(id));
      if (['worker', 'helper'].includes(detail.session.origin?.kind)) missing.push('Channel mappings must select ordinary owning sessions.');
    }
    if (draft.settings.defaultProject && !(await this.api.request('/v1/remote/projects')).projects.some((row: any) => row.id === draft.settings.defaultProject)) missing.push('Choose an available approved project.');
    if (draft.settings.defaultModel) {
      const catalog = await this.api.request('/v1/remote/models');
      const model = catalog.models.find((row: any) => row.id === draft.settings.defaultModel);
      if (!model || catalog.state !== 'ready') missing.push('Refresh and choose an available model.');
      if (draft.settings.defaultReasoning && !model?.efforts.includes(draft.settings.defaultReasoning)) missing.push('Choose a reasoning effort supported by that model.');
    }
    if (draft.settings.notificationChannel && this.config.channels.length && !this.config.channels.includes(draft.settings.notificationChannel)) missing.push('Notification channel must be permitted by local bootstrap.');
    if (draft.settings.notificationChannel && draft.settings.channels.length && !draft.settings.channels.includes(draft.settings.notificationChannel)) missing.push('Notification channel must be permitted by the staged channel list.');
    const settings = await this.api.request('/v1/remote/settings');
    if (Object.keys(draft.backend).length && !settings.permissions.configure) missing.push('Enable the local configure grant before saving backend settings.');
    if (draft.settings.defaultAutomation !== 'off' && !settings.permissions.configure) missing.push('Default automation needs the local configure grant.');
    return missing;
  }
  private async setupComponent(interaction: any, id: string, action: string, view: View, value?: string) {
    const draft = this.store.snapshot().setup[interaction.user.id];
    if (!draft || draft.revision !== view.revision) throw new Error('Setup changed. Run /setup to resume the current draft.');
    if (action === 'setup-section') return this.setupPanel(interaction, value);
    if (action === 'setup-next') return this.setupPanel(interaction, view.command, view.cursor, (view.page ?? 0) + 1);
    if (action === 'setup-first') return this.setupPanel(interaction, view.command);
    if (action === 'setup-save') {
      if (this.setupSaving) throw new Error('Another setup save is in progress; refresh shortly.');
      this.setupSaving = true;
      try {
        const assertCurrent = () => {
          const current = this.store.snapshot();
          if (current.settingsRevision !== draft.baseRevision) throw new Error('Published settings changed since this draft began. Discard the draft and reopen /setup.');
          if (current.setup[interaction.user.id]?.id !== draft.id || current.setup[interaction.user.id]?.revision !== draft.revision)
            throw new Error('Setup changed during validation; refresh the summary.');
        };
        assertCurrent();
        const missing = await this.validateSetup(draft); if (missing.length) return panel('Setup incomplete', missing.join('\n'), [], [], { color: EmbedColor.Danger });
        assertCurrent();
        await this.operation(interaction, async operationId => {
          if (Object.keys(draft.backend).length) await this.api.action('settings', operationId, draft.backend);
          await this.store.update(state => {
            assertCurrent(); state.settings = draft.settings; state.settingsRevision++;
            delete state.setup[interaction.user.id]; delete state.views[id];
          });
        });
      } finally { this.setupSaving = false; }
      return panel('Setup saved', 'Supported settings were committed and confirmed. Use /help and /status. Account authentication and provider approvals still require the private browser when requested.', [], [], { color: EmbedColor.Success });
    }
    if (action === 'setup-discard') {
      if (this.setupSaving) throw new Error('A setup save is in progress; wait for its result.');
      await this.store.update(state => { delete state.setup[interaction.user.id]; delete state.views[id]; });
      return panel('Setup draft discarded', 'Published settings are unchanged.', [], [], { color: EmbedColor.Info });
    }
    await this.store.update(state => {
      if (this.setupSaving) throw new Error('A setup save is in progress; wait for its result.');
      const current = state.setup[interaction.user.id]!;
      if (current.revision !== view.revision) throw new Error('Stale setup panel');
      if (action === 'setup-session') current.settings.defaultSession = value!;
      else if (action === 'setup-map') current.settings.channelSessions[interaction.channelId] = value!;
      else if (action === 'setup-project') current.settings.defaultProject = value!;
      else if (action === 'setup-model') { current.settings.defaultModel = value!; current.settings.defaultReasoning = null; }
      else if (action === 'setup-reasoning') current.settings.defaultReasoning = value!;
      else if (action === 'setup-automation') current.settings.defaultAutomation = value as 'off' | 'goal' | 'loop';
      else if (action === 'setup-delivery') current.settings.defaultLoopAfterTurn = value === 'after-turn';
      else if (action === 'setup-plan-backend') current.backend.planBackend = value as 'chatgpt' | 'api';
      else if (action === 'setup-finish') current.backend.finishTool = value === 'on';
      else throw new Error('Setup action unavailable');
      current.revision++;
    });
    return this.setupPanel(interaction, action.includes('model') || action.includes('reasoning') ? 'ai' : action.includes('automation') || action.includes('finish') || action.includes('backend') || action.includes('delivery') ? 'automation' : 'sessions');
  }

  private modal(id: string, action: string, view: View): ModalBuilder {
    const modal = new ModalBuilder().setCustomId(`${id}:${action}`).setTitle(action === 'edit' ? 'Edit selected workflow stage' : 'Private setup settings');
    const field = (key: string, label: string, value = '', paragraph = false) => new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(false).setMaxLength(4000).setValue(value.slice(0, 4000)));
    if (action === 'edit') modal.addComponents(field('text', `Stage ${(view.page ?? 0) + 1} replacement`, '', true));
    else {
      const draft = this.store.snapshot().setup[view.user];
      if (!draft || draft.revision !== view.revision) throw new Error('Stale setup panel');
      if (action === 'setup-notifications') modal.addComponents(field('channel', 'Notification channel ID (blank disables)', draft.settings.notificationChannel ?? ''),
        field('frequency', 'Frequency in seconds (15–3600)', String(draft.settings.frequencySeconds)), field('progress', 'Progress updates: on / off', draft.settings.progress ? 'on' : 'off'),
        field('final', 'Final recorded response notifications: on / off', draft.settings.finalResults ? 'on' : 'off'),
        field('health', 'Failure and recovery alerts: on / off', draft.settings.operationalAlerts ? 'on' : 'off'));
      else if (action === 'setup-access') modal.addComponents(field('users', 'User IDs: read / send / configure / plan / workers',
        Object.entries(draft.settings.users).map(([user, grants]) => `${user}:${grants.join(',')}`).join('\n'), true), field('channels', 'Allowed channel IDs, comma-separated', draft.settings.channels.join(',')));
      else if (action === 'setup-workers') modal.addComponents(field('family', 'Workers per family (1–8; initial default 2)', String(draft.backend.maxWorkers ?? 2)),
        field('global', 'Global cap (0–64; 0 disables the cap)', String(draft.backend.globalMaxWorkers ?? 2)));
    }
    return modal;
  }
  private async submitModal(interaction: any, _id: string, action: string, view: View) {
    const text = (key: string) => interaction.fields.getTextInputValue(key).trim();
    if (action === 'edit') {
      this.require(interaction, 'plan');
      const plan = await this.api.request(`/v1/remote/plans/${view.planId}`);
      if (plan.revision !== view.revision || plan.state !== 'approval') throw new Error('Plan changed; refresh it.');
      const result = await this.operation(interaction, id => this.api.action('plan-edit', id, { planId: plan.id, revision: plan.revision, index: view.page ?? 0, text: text('text') }));
      return this.planPanel(interaction, result);
    }
    this.require(interaction, 'admin');
    await this.store.update(state => {
      if (this.setupSaving) throw new Error('A setup save is in progress; wait for its result.');
      const draft = state.setup[interaction.user.id];
      if (!draft || draft.revision !== view.revision) throw new Error('Setup changed; reopen /setup.');
      if (action === 'setup-notifications') {
        draft.settings.notificationChannel = text('channel') ? snowflake.parse(text('channel')) : null;
        const frequency = Number(text('frequency')); if (!Number.isInteger(frequency) || frequency < 15 || frequency > 3600) throw new Error('Frequency must be 15–3600 seconds');
        if (![text('progress'), text('final'), text('health')].every(value => value === 'on' || value === 'off')) throw new Error('Use on or off for notification switches');
        draft.settings.frequencySeconds = frequency; draft.settings.progress = text('progress') === 'on'; draft.settings.finalResults = text('final') === 'on';
        draft.settings.operationalAlerts = text('health') === 'on';
      } else if (action === 'setup-access') {
        const users: Record<string, Permission[]> = {};
        for (const row of text('users').split('\n').filter(Boolean)) {
          const [user, grants] = row.split(':'); snowflake.parse(user);
          const list = (grants ?? '').split(',').map((value: string) => value.trim());
          if (!list.length || !list.every((value: string) => ['read', 'send', 'configure', 'plan', 'workers'].includes(value))) throw new Error('Use explicit read, send, configure, plan or workers grants. Administrators are bootstrapped locally.');
          users[user!] = list as Permission[];
        }
        if (Object.keys(users).length > 100) throw new Error('At most 100 authorized users');
        draft.settings.users = users;
        draft.settings.channels = text('channels').split(',').map((row: string) => row.trim()).filter(Boolean).map((row: string) => snowflake.parse(row));
      } else if (action === 'setup-workers') {
        const family = Number(text('family')), global = Number(text('global'));
        if (!Number.isInteger(family) || family < 1 || family > 8 || !Number.isInteger(global) || global < 0 || global > 64) throw new Error('Worker limits outside the supported range');
        draft.backend = { ...draft.backend, maxWorkers: family, globalMaxWorkers: global };
      } else throw new Error('Modal unavailable');
      draft.revision++;
    });
    return this.setupPanel(interaction, action === 'setup-workers' ? 'ai' : 'discord');
  }
}
