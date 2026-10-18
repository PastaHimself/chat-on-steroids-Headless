import { createHash } from 'node:crypto';
import path from 'node:path';
import { ReceiptArchive, RECEIPT_AGE_MS } from '../../runtime/receipt-archive.mjs';
import { z } from 'zod';
import { REMOTE_ACTIONS, type RemoteAction, type RemoteOperation, type RemotePlan } from '../shared/remote-control.js';
import { REASONING_EFFORTS } from '../shared/session.js';
import { resolveChatModel } from '../shared/chat-models.js';
import { getConfig, effectiveCapabilities, updateConfig } from './config.js';
import { remotePermission } from './runtime-mode.js';
import { readDurableStrict, writeDurableNow } from './durable.js';
import { projectAgents, projectInput, projectLive, RequestError } from './control-reads.js';
import { redact, logWarn } from './logger.js';
import { redactSecretText } from './redaction.js';
import { sessionControlsFor, setSessionAutomation, setSessionObjective, stopSessionTurn, compactSession } from './bridge.js';
import { getSession, readSessionPlan, conversationWasSuperseded, conversationUnavailableKnown } from './session/store.js';
import { deliveryProof, inputProjectWaits, sessionInputPolicy } from './session/input.js';
import { sendDesktopInput, cancelDesktopInput } from './session/start-input.js';
import { getProject, listProjects, projectWorkspace, assignSessionProject, getSessionProject, retryProjectCreate } from './projects.js';
import { wakeBrowserWork } from './browser-wake.js';
import { listProjectDirectory } from './project-files.js';
import { getChatModels, startChatModelDiscovery } from './chat-models.js';
import { draftTaskPlan } from './goal.js';
import { resourceSnapshot } from './resource-monitor.js';
import { sessionsRoot } from './session/store.js';
import { operationalHealth } from './operational-health.js';
import { recoveryHeld } from './recovery-hold.js';
import { swarmStateForCaller, stageMessages, requestWorkerBootstraps, requestWorkerRevivals,
  persistCriticalSwarmNow, sleepWorker, type Caller } from './agents.js';
import { admitWorkerSpawn, acceptAgentMutation } from './worker-admission.js';

const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const sessionId = z.string().regex(/^[0-9a-z-]{8,64}$/);
const model = z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/).nullable().optional();
const effort = z.enum(REASONING_EFFORTS).nullable().optional();
const base = z.object({ id: uuid });
const sessionBase = base.extend({ sessionId });
const schemas = {
  ask: sessionBase.extend({ text: z.string().trim().min(1).max(64000), interrupt: z.boolean().optional(),
    delivery: z.enum(['auto', 'after-turn', 'finish']).default('after-turn'), automation: z.enum(['goal', 'loop']).optional(), loopAfterTurn: z.boolean().optional(), model, reasoningEffort: effort }).strict(),
  new: base.extend({ prompt: z.string().trim().min(1).max(16000).optional(), projectId: uuid.optional(), model, reasoningEffort: effort }).strict(),
  automation: sessionBase.extend({ automation: z.enum(['off', 'goal', 'loop']), afterTurn: z.boolean().optional() }).strict(),
  objective: sessionBase.extend({ objective: z.string().trim().min(1).max(16000), mode: z.enum(['goal', 'loop']) }).strict(),
  stop: sessionBase.extend({ expectedTurnId: z.string().min(1).max(256) }).strict(),
  compact: sessionBase.extend({ recoverDeletedConversationId: uuid.optional() }).strict(),
  project: sessionBase.extend({ projectId: uuid }).strict(),
  'project-retry': base.extend({ projectId: uuid, expectedState: z.enum(['failed', 'uncertain']),
    expectedUpdatedAt: z.number().finite().nonnegative(), allowDuplicate: z.literal(true).optional() }).strict(),
  plan: sessionBase.extend({ prompt: z.string().trim().min(1).max(16000), backend: z.enum(['chatgpt', 'api']).optional() }).strict(),
  'plan-edit': base.extend({ planId: uuid, revision: z.number().int().nonnegative(), index: z.number().int().min(0).max(11), text: z.string().trim().min(1).max(12000).nullable() }).strict(),
  'plan-approve': base.extend({ planId: uuid, revision: z.number().int().nonnegative() }).strict(),
  'plan-cancel': base.extend({ planId: uuid, revision: z.number().int().nonnegative() }).strict(),
  'plan-regenerate': base.extend({ planId: uuid, revision: z.number().int().nonnegative() }).strict(),
  delegate: sessionBase.extend({ task: z.string().trim().min(1).max(4000), label: z.string().trim().min(1).max(80).optional(), runId: z.string().min(1).max(128).optional() }).strict(),
  worker: sessionBase.extend({ runId: z.string().min(1).max(128), workerId: z.string().regex(/^worker-\d+$/),
    action: z.enum(['message', 'sleep']), text: z.string().trim().min(1).max(4000).optional(), confirmed: z.boolean().optional() }).strict(),
  settings: base.extend({ maxWorkers: z.number().int().min(1).max(8).optional(), globalMaxWorkers: z.number().int().min(0).max(64).optional(),
    finishTool: z.boolean().optional(), planBackend: z.enum(['chatgpt', 'api']).optional() }).strict()
};
const permissions: Record<RemoteAction, Parameters<typeof remotePermission>[0]> = {
  ask: 'send', new: 'send', automation: 'configure', objective: 'configure', stop: 'send', compact: 'send', project: 'configure',
  'project-retry': 'configure',
  plan: 'plan', 'plan-edit': 'plan', 'plan-approve': 'plan', 'plan-cancel': 'plan', 'plan-regenerate': 'plan', delegate: 'workers', worker: 'workers', settings: 'configure'
};
const planSchema = z.object({ id: uuid, sessionId, conversationId: z.string().min(1).max(256), prompt: z.string().max(16000),
  stages: z.array(z.string().max(12000)).max(12), revision: z.number().int().nonnegative(),
  state: z.enum(['generating', 'approval', 'approved', 'cancelled', 'failed', 'interrupted']), phase: z.string().max(128),
  inputId: uuid.optional(), error: z.string().max(4000).optional(), createdAt: z.number().finite() });
const stateSchema = z.object({ version: z.union([z.literal(1), z.literal(2)]), operations: z.array(z.object({ id: uuid, fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  action: z.string().max(40), state: z.enum(['started', 'settled', 'rejected']), createdAt: z.number().finite(), settledAt: z.number().finite().optional(), result: z.unknown().optional(),
  sessionId: sessionId.optional(), error: z.object({ status: z.number().int().min(400).max(599), code: z.string().max(80) }).optional() })
    .refine(row => row.state !== 'rejected' || Boolean(row.error), 'Rejected receipts require owner proof')).max(1000),
  plans: z.array(planSchema).max(50) }).strict();
type State = { version: 2; operations: RemoteOperation[]; plans: RemotePlan[] };
let stateChain: Promise<unknown> = Promise.resolve();
const planners = new Map<string, AbortController>();
const plannerWork = new Map<string, Promise<void>>();
let remoteStopping = false;
let upkeepTimer: ReturnType<typeof setInterval> | null = null;
const archive = () => new ReceiptArchive(path.join(path.dirname(sessionsRoot()), 'receipt-archive'));

export async function initializeRemoteControl(): Promise<void> {
  remoteStopping = false;
  await maintainRemoteReceipts();
  if (!upkeepTimer) {
    upkeepTimer = setInterval(() => { void maintainRemoteReceipts().catch(() => logWarn('Receipt upkeep failed; admission retains its replay fences')); }, RECEIPT_AGE_MS);
    upkeepTimer.unref();
  }
}
export async function maintainRemoteReceipts(now = Date.now()): Promise<void> {
  await transact(async state => { await archiveSettled(state, now); });
  await archive().expire(now);
}
async function archiveSettled(state: State, now: number): Promise<void> {
  const retained = new Set(state.plans.filter(row => row.state === 'generating' || row.state === 'approval').map(row => row.id));
  const eligible = state.operations.filter(row => row.state !== 'started' && (row.settledAt ?? row.createdAt) <= now - RECEIPT_AGE_MS && !retained.has(row.id));
  for (const row of eligible) await archive().put({ id: row.id, fingerprint: row.fingerprint, outcome: row.state as 'settled' | 'rejected',
    action: row.action, createdAt: row.createdAt, settledAt: row.settledAt, sessionId: row.sessionId }, { result: row.result, error: row.error }, now);
  if (eligible.length) {
    const ids = new Set(eligible.map(row => row.id)); state.operations = state.operations.filter(row => !ids.has(row.id));
    await save(state);
  }
}

export async function shutdownRemoteControl(): Promise<void> {
  remoteStopping = true;
  if (upkeepTimer) clearInterval(upkeepTimer);
  upkeepTimer = null;
  for (const controller of planners.values()) controller.abort();
  await Promise.allSettled([...plannerWork.values()]);
}

/** One ledger owner, including async planner publication and approval/cancel races. */
function transact<T>(work: (state: State) => Promise<T>): Promise<T> {
  const run = stateChain.then(async () => {
    const raw = await readDurableStrict('remote-control');
    const parsed = stateSchema.parse(raw ?? { version: 2, operations: [], plans: [] });
    const state: State = { ...parsed, version: 2 };
    if (parsed.version === 1) {
      if (!await readDurableStrict('remote-control-v1-backup')) await writeDurableNow('remote-control-v1-backup', raw);
      await save(state);
    }
    return work(state);
  });
  stateChain = run.catch(() => undefined);
  return run;
}
const save = (state: State) => writeDurableNow('remote-control', state);
const publicText = (value: string) => redactSecretText(redact(value)).slice(0, 4000);
function publicPlan(plan: RemotePlan): RemotePlan {
  return { ...plan, prompt: publicText(plan.prompt), stages: plan.stages.map(publicText), error: plan.error ? publicText(plan.error) : undefined,
    ...(plan.state === 'generating' && !planners.has(plan.id) ? { state: 'interrupted' as const, phase: 'interrupted; regenerate explicitly' } : {}) };
}
function assertPermission(action: RemoteAction): void {
  if (remoteStopping) throw new RequestError(503, 'shutting_down');
  if (recoveryHeld()) throw new RequestError(409, 'restore_held', 'Reconcile restored work locally before releasing delivery');
  const config = getConfig();
  if (!config.controlApi.enabled || !config.controlApi.allowActions) throw new RequestError(403, 'actions_disabled');
  if (!remotePermission(permissions[action])) throw new RequestError(403, 'remote_permission_disabled', `Enable ${permissions[action]} through local bootstrap configuration`);
  if (action === 'plan-approve' && !remotePermission('send')) throw new RequestError(403, 'remote_permission_disabled', 'Plan execution also requires send');
  if (action === 'project-retry' && !remotePermission('send')) throw new RequestError(403, 'remote_permission_disabled', 'Project repair may release accepted inputs and also requires send');
}
async function controllable(id: string) {
  const session = await getSession(id);
  if (!session) throw new RequestError(404, 'session_not_found');
  if (session.origin?.kind === 'worker' || session.origin?.kind === 'helper') throw new RequestError(409, 'session_not_controllable');
  if (session.conversationId && await conversationWasSuperseded(session.conversationId)) throw new RequestError(409, 'conversation_superseded');
  return session;
}
function validateSelection(requested?: string | null, reasoning?: typeof REASONING_EFFORTS[number] | null): void {
  if (!requested && !reasoning) return;
  const catalog = getChatModels();
  if (!requested) throw new RequestError(400, 'model_required', 'Specify an observed model with reasoning');
  const choice = resolveChatModel(catalog.models, requested);
  if (catalog.state !== 'ready' || !choice) throw new RequestError(409, 'model_unavailable', 'Refresh the account-observed model catalog');
  if (reasoning && !choice.efforts.includes(reasoning)) throw new RequestError(400, 'reasoning_unavailable');
}
async function callerFor(id: string, runId?: string): Promise<Caller> {
  const session = await controllable(id);
  if (!session.conversationId) throw new RequestError(409, 'no_chat');
  // A trusted local operator names a session. The broker still verifies exact prime/run ownership.
  return { sessionId: id, conversationId: session.conversationId, ...(runId ? { runId } : {}) };
}
function assertWorkerSource(caller: Caller): void {
  if (caller.conversationId && conversationUnavailableKnown(caller.conversationId, caller.sessionId))
    throw new RequestError(409, 'conversation_deleted', 'Reconcile existing workers before replacing the deleted prime.');
}
async function acceptStaged(staged: { commit(): void | boolean; rollback(): void }, action: RemoteAction, caller: Caller): Promise<void> {
  await acceptAgentMutation(staged, 'Worker mutation is unconfirmed', undefined, {
    validate: async () => { if ((await controllable(caller.sessionId!)).conversationId !== caller.conversationId) throw new RequestError(409, 'conversation_changed'); },
    assertCurrent: () => { assertPermission(action); assertWorkerSource(caller); }
  });
}

async function execute(action: RemoteAction, raw: unknown, effect: () => void = () => undefined): Promise<unknown> {
  assertPermission(action);
  switch (action) {
    case 'ask': {
      const body = schemas.ask.parse(raw);
      const session = await controllable(body.sessionId);
      if (!session.conversationId) throw new RequestError(409, 'no_chat');
      validateSelection(body.model, body.reasoningEffort);
      if ((body.automation || body.loopAfterTurn !== undefined) && !remotePermission('configure')) throw new RequestError(403, 'remote_permission_disabled', 'Default automation requires configure');
      if (body.delivery === 'auto' && (await sessionInputPolicy(body.sessionId)).directTurn && body.interrupt !== true)
        throw new RequestError(409, 'would_interrupt');
      assertPermission(action);
      effect(); const row = await sendDesktopInput({ id: body.id, sessionId: body.sessionId, text: body.text, mode: body.delivery,
        dueAt: Date.now(), automation: body.automation, loopAfterTurn: body.loopAfterTurn, model: body.model ?? null, reasoningEffort: body.reasoningEffort ?? null, authoredSource: 'text' });
      if (row.directTurn && body.interrupt !== true) { await cancelDesktopInput(row.id); throw new RequestError(409, 'would_interrupt'); }
      return { inputId: row.id, sessionId: row.sessionId, state: row.state, accepted: true, delivery: deliveryProof(row),
        selection: 'requested; verify delivery acknowledgement and observed session model' };
    }
    case 'new': {
      const body = schemas.new.parse(raw);
      validateSelection(body.model, body.reasoningEffort);
      if (body.projectId) await projectWorkspace(body.projectId);
      assertPermission(action);
      effect(); const row = await sendDesktopInput({ id: body.id, sessionId: null, projectId: body.projectId,
        text: body.prompt ?? 'Start a new conversation. Await my next instruction.', authoredSource: 'text',
        mode: 'auto', dueAt: Date.now(), model: body.model ?? null, reasoningEffort: body.reasoningEffort ?? null });
      await transact(async state => { const op = state.operations.find(op => op.id === body.id); if (op) op.sessionId = row.sessionId ?? undefined; await save(state); });
      return { inputId: row.id, sessionId: row.sessionId, accepted: true, state: row.state, delivery: deliveryProof(row),
        projectWait: projectInput(row, (await inputProjectWaits([row])).get(row.id)).projectWait };
    }
    case 'automation': {
      const body = schemas.automation.parse(raw); await controllable(body.sessionId); assertPermission(action);
      effect(); return publicControls(await setSessionAutomation(body.sessionId, body.automation, body.afterTurn));
    }
    case 'objective': {
      const body = schemas.objective.parse(raw); await controllable(body.sessionId); assertPermission(action);
      effect(); return publicControls(await setSessionObjective(body.sessionId, body.objective, body.mode));
    }
    case 'stop': {
      const body = schemas.stop.parse(raw); await controllable(body.sessionId); assertPermission(action);
      effect(); return { ...publicControls(await stopSessionTurn(body.sessionId, body.expectedTurnId)),
        note: 'Native Stop requested for the exact turn; cancellation is unconfirmed. This also disables its automation.' };
    }
    case 'compact': {
      const body = schemas.compact.parse(raw); await controllable(body.sessionId); assertPermission(action);
      effect(); return publicControls(await compactSession(body.sessionId, body.recoverDeletedConversationId));
    }
    case 'project': {
      const body = schemas.project.parse(raw); await controllable(body.sessionId); await projectWorkspace(body.projectId); assertPermission(action);
      effect(); await assignSessionProject(body.sessionId, body.projectId); return { sessionId: body.sessionId, projectId: body.projectId };
    }
    case 'project-retry': {
      const body = schemas['project-retry'].parse(raw);
      await projectWorkspace(body.projectId);
      const project = await getProject(body.projectId), link = project?.chatgpt;
      if (project?.ungrouped || !link || link.state !== body.expectedState || link.updatedAt !== body.expectedUpdatedAt)
        throw new RequestError(409, 'project_changed', 'Inspect the current Project state before requesting repair');
      if (link.state === 'uncertain' && body.allowDuplicate !== true)
        throw new RequestError(409, 'project_retry_confirmation_required', 'An uncertain creation may already exist; explicit duplicate-risk confirmation is required');
      assertPermission(action); effect();
      const retried = await retryProjectCreate(body.projectId, { state: body.expectedState, updatedAt: body.expectedUpdatedAt });
      if (retried) wakeBrowserWork();
      return { projectId: body.projectId, retried: !!retried, state: retried ? 'requested' : 'changed' };
    }
    case 'settings': {
      const body = schemas.settings.parse(raw);
      effect(); await updateConfig(config => {
        assertPermission(action);
        return { ...config, multiAgent: { ...config.multiAgent,
          ...(body.maxWorkers !== undefined ? { maxWorkers: body.maxWorkers } : {}),
          ...(body.globalMaxWorkers !== undefined ? { globalMaxWorkers: body.globalMaxWorkers } : {}) },
          ui: { ...config.ui, ...(body.finishTool !== undefined ? { finishTool: body.finishTool } : {}),
            ...(body.planBackend ? { planBackend: body.planBackend } : {}) } };
      });
      return remoteSettings();
    }
    case 'plan': {
      const body = schemas.plan.parse(raw);
      const session = await controllable(body.sessionId);
      if (!session.conversationId) throw new RequestError(409, 'no_chat');
      const plan: RemotePlan = { id: body.id, sessionId: body.sessionId, conversationId: session.conversationId,
        prompt: body.prompt, stages: [], revision: 0, state: 'generating', phase: 'preparing', createdAt: Date.now() };
      await transact(async state => {
        if (state.plans.filter(row => row.state === 'generating' || row.state === 'approval').length >= 20) throw new RequestError(503, 'plan_capacity');
        if (state.plans.some(row => row.state === 'generating' && row.sessionId === body.sessionId && planners.has(row.id))) throw new RequestError(409, 'planner_busy');
        state.plans = state.plans.filter(row => !['approved', 'failed', 'cancelled', 'interrupted'].includes(row.state)).slice(-49);
        state.plans.push(plan); assertPermission(action); effect(); await save(state);
      });
      const abort = new AbortController(); planners.set(plan.id, abort);
      const work = generatePlan(plan, body.backend ?? getConfig().ui.planBackend ?? 'chatgpt', abort);
      plannerWork.set(plan.id, work);
      void work.finally(() => plannerWork.delete(plan.id)).catch(() => logWarn('remote planner settlement failed'));
      return publicPlan(plan);
    }
    case 'plan-regenerate': {
      const body = schemas['plan-regenerate'].parse(raw);
      const source = await transact(async state => {
        const plan = state.plans.find(row => row.id === body.planId);
        if (!plan || plan.revision !== body.revision) throw new RequestError(409, 'stale_plan');
        if (plan.state === 'approved' || (plan.state === 'generating' && planners.has(plan.id))) throw new RequestError(409, 'plan_not_regeneratable');
        plan.state = 'cancelled'; plan.revision++; effect(); await save(state); return { sessionId: plan.sessionId, prompt: plan.prompt };
      });
      return execute('plan', { id: body.id, ...source }, effect);
    }
    case 'plan-edit': case 'plan-approve': case 'plan-cancel': {
      const body = (action === 'plan-edit' ? schemas['plan-edit'] : schemas['plan-approve']).parse(raw);
      return transact(async state => {
        const plan = state.plans.find(row => row.id === body.planId);
        if (!plan) throw new RequestError(404, 'plan_not_found');
        if (plan.revision !== body.revision) throw new RequestError(409, 'stale_plan');
        if (action === 'plan-cancel' && plan.state !== 'approved') {
          plan.state = 'cancelled'; plan.revision++; assertPermission(action); effect(); await save(state);
          planners.get(plan.id)?.abort(); return publicPlan(plan);
        }
        if (plan.state !== 'approval') throw new RequestError(409, 'plan_not_awaiting_approval');
        const session = await controllable(plan.sessionId);
        if (session.conversationId !== plan.conversationId) throw new RequestError(409, 'plan_conversation_changed', 'Regenerate after compaction');
        assertPermission(action);
        if (action === 'plan-edit') {
          const edit = schemas['plan-edit'].parse(raw);
          if (edit.index >= plan.stages.length) throw new RequestError(409, 'stage_not_found');
          const stages = [...plan.stages];
          if (edit.text === null) stages.splice(edit.index, 1); else stages[edit.index] = edit.text;
          if (!stages.length || JSON.stringify(stages).length > 12000) throw new RequestError(400, 'plan_too_large');
          plan.stages = stages; plan.revision++; effect(); await save(state); return publicPlan(plan);
        }
        // The original objective and ordered checkpoints go through the same composer outbox path.
        effect(); plan.state = 'approved'; plan.inputId = body.id; plan.revision++; await save(state);
        const row = await sendDesktopInput({ id: body.id, sessionId: plan.sessionId, text: plan.stages[0]!, objective: plan.prompt,
          authoredSource: 'objective', stages: plan.stages.slice(1), mode: 'finish', dueAt: Date.now(), model: null, reasoningEffort: null });
        const op = state.operations.find(op => op.id === body.id);
        if (op) op.sessionId = plan.sessionId;
        await save(state);
        return { ...publicPlan(plan), delivery: deliveryProof(row) };
      });
    }
    case 'delegate': {
      const body = schemas.delegate.parse(raw);
      const caller = await callerFor(body.sessionId, body.runId);
      assertWorkerSource(caller);
      if (!getConfig().multiAgent.enabled || getConfig().readOnly) throw new RequestError(403, 'workers_disabled');
      const workspace = await getSessionProject(body.sessionId);
      assertPermission(action);
      effect(); const staged = await admitWorkerSpawn({ caller, workers: [{ task: body.task, label: body.label }],
        context: workspace ? `Approved project workspace: ${workspace.virtual}. Respect its AGENTS.md and existing permissions.` : null }, {
        workspace: () => getSessionProject(body.sessionId),
        canIsolate: () => { const config = getConfig(), caps = effectiveCapabilities(config); return !config.readOnly && caps.command && caps.create && caps.edit; },
        validateOwner: async () => { if ((await controllable(body.sessionId)).conversationId !== caller.conversationId) throw new RequestError(409, 'conversation_changed'); },
        assertCurrent: () => { assertPermission(action); assertWorkerSource(caller); }
      });
      requestWorkerBootstraps(staged.created.map(row => row.id), staged.runId);
      return { runId: staged.runId, created: staged.created.map(row => ({ id: row.id, state: row.state, model: row.model })) };
    }
    case 'worker': {
      const body = schemas.worker.parse(raw);
      const caller = await callerFor(body.sessionId, body.runId);
      const state = swarmStateForCaller(caller);
      const worker = state.agents.find(row => row.id === body.workerId && row.runId === body.runId && row.role === 'worker');
      if (!worker) throw new RequestError(404, 'worker_not_owned');
      assertPermission(action);
      if (body.action === 'sleep') {
        if (!body.confirmed) throw new RequestError(409, 'confirmation_required');
        effect(); const result = sleepWorker(worker.id, 'Paused by authorized remote operator', body.runId);
        if (!await persistCriticalSwarmNow()) throw new Error('Worker pause is unconfirmed');
        return { paused: result !== null, workerId: worker.id, runId: body.runId, note: 'Broker worker sleeping; this does not prove native generation cancellation' };
      }
      if (!body.text) throw new RequestError(400, 'text_required');
      assertWorkerSource(caller);
      effect(); const staged = stageMessages(caller, [{ to: worker.id, text: body.text }]);
      await acceptStaged(staged, action, caller);
      requestWorkerRevivals(staged.waking, staged.runId);
      return { workerId: worker.id, runId: staged.runId, queued: true };
    }
  }
}

async function generatePlan(plan: RemotePlan, backend: 'chatgpt' | 'api', abort: AbortController): Promise<void> {
  try {
    const stages = await draftTaskPlan(plan.prompt, backend, undefined, abort.signal);
    await transact(async state => {
      const row = state.plans.find(row => row.id === plan.id);
      if (!row || row.state !== 'generating' || abort.signal.aborted) return;
      row.stages = stages; row.state = 'approval'; row.phase = 'approval required'; row.revision++; await save(state);
    });
  } catch (error) {
    await transact(async state => {
      const row = state.plans.find(row => row.id === plan.id);
      if (!row || row.state !== 'generating') return;
      row.state = abort.signal.aborted ? 'cancelled' : 'failed'; row.error = publicText(error instanceof Error ? error.message : 'Plan generation failed');
      row.revision++; await save(state);
    }).catch(() => logWarn('remote plan failure could not be persisted'));
  } finally { planners.delete(plan.id); }
}
function publicControls(controls: Awaited<ReturnType<typeof sessionControlsFor>>) {
  return { sessionId: controls.sessionId, conversationId: controls.conversationId, ...projectLive(controls),
    objective: publicText(controls.objective), loopAfterTurn: controls.loopAfterTurn, proLoopDelivery: controls.proLoopDelivery,
    goalDraft: controls.goalDraft ? { stage: controls.goalDraft.stage, error: controls.goalDraft.error ? publicText(controls.goalDraft.error) : null } : null };
}
function remoteSettings() {
  const config = getConfig();
  return { actionsAllowed: config.controlApi.enabled && config.controlApi.allowActions,
    permissions: Object.fromEntries(['send', 'configure', 'plan', 'workers'].map(key => [key, remotePermission(key as Parameters<typeof remotePermission>[0])])),
    workers: { enabled: config.multiAgent.enabled, maxWorkers: config.multiAgent.maxWorkers, globalMaxWorkers: config.multiAgent.globalMaxWorkers,
      autoWorktrees: config.multiAgent.autoWorktrees },
    automation: { backend: config.goal.backend, mode: config.goal.mode, enabled: config.goal.enabled },
    planBackend: config.ui.planBackend, finishTool: config.ui.finishTool,
    compaction: { auto: config.compaction.auto, autoTokens: config.compaction.autoTokens, handoffLength: config.compaction.handoffLength }, readOnly: config.readOnly };
}

export function isRemoteActionPath(route: string): boolean {
  return /^\/v1\/remote\/[^/]+$/.test(route) && REMOTE_ACTIONS.includes(route.slice('/v1/remote/'.length) as RemoteAction);
}

/** Fence accepted UUIDs before any side effect; interrupted mutations are not replayed. */
export async function serveRemoteAction(route: string, raw: unknown) {
  const action = route.slice('/v1/remote/'.length) as RemoteAction;
  if (!REMOTE_ACTIONS.includes(action)) return undefined;
  assertPermission(action);
  const parsed = schemas[action].safeParse(raw);
  if (!parsed.success) throw new RequestError(400, 'invalid_body');
  const body = parsed.data;
  const fingerprint = createHash('sha256').update(JSON.stringify([action, body])).digest('hex');
  const existing = await transact(async state => {
    const archived = await archive().get(body.id);
    if (archived) {
      if (archived.fingerprint !== fingerprint) throw new RequestError(409, 'id_conflict');
      throw new RequestError(409, 'operation_archived', 'This operation was already handled and will never execute again');
    }
    const prior = state.operations.find(row => row.id === body.id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new RequestError(409, 'id_conflict');
      return prior;
    }
    await archive().assertSpace();
    if (state.operations.length >= 800) await archiveSettled(state, Date.now());
    if (state.operations.length >= 1000) throw new RequestError(503, 'operation_capacity', 'Inspect uncertain operations; completed receipts are archived automatically');
    state.operations.push({ id: body.id, fingerprint, action, state: 'started', createdAt: Date.now(),
      sessionId: 'sessionId' in body ? body.sessionId : undefined });
    assertPermission(action); await save(state); return null;
  });
  if (existing) {
    if (existing.state === 'rejected') throw new RequestError(existing.error!.status, existing.error!.code, 'This request was rejected before effects', 'rejected', body.id);
    if (existing.state === 'started') return { status: 409, body: { error: 'operation_unconfirmed', operationId: body.id,
      detail: 'The operation may have completed. Inspect its owner state; it will not be replayed.' } };
    return { status: 200, body: { result: existing.result, replayed: true, operationId: body.id } };
  }
  let result: unknown;
  let affected = false;
  try { result = await execute(action, body, () => { affected = true; }); }
  catch (error) {
    // Preserve the fence: some owners can have committed before throwing or losing a write.
    if (error instanceof RequestError && !affected) {
      await transact(async state => {
        const row = state.operations.find(row => row.id === body.id)!;
        row.state = 'rejected'; row.settledAt = Date.now(); row.error = { status: error.status, code: error.code }; await save(state);
      });
      throw new RequestError(error.status, error.code, error.detail, 'rejected', body.id);
    }
    if (error instanceof RequestError) throw new RequestError(error.status, error.code, error.detail, 'unconfirmed', body.id);
    logWarn(`remote ${action} failed: ${publicText(error instanceof Error ? error.message : 'unknown')}`);
    throw new RequestError(409, 'operation_unconfirmed', 'Inspect application state before another operation', 'unconfirmed', body.id);
  }
  await transact(async state => {
    const row = state.operations.find(row => row.id === body.id)!;
    row.state = 'settled'; row.settledAt = Date.now(); row.result = result; await save(state);
  });
  return { status: 202, body: { operationId: body.id, result, replayed: false } };
}

export async function serveRemoteRead(route: string, query: URLSearchParams): Promise<unknown | undefined> {
  if (!route.startsWith('/v1/remote/') && !/^\/v1\/sessions\/[^/]+\/(taskplan|controls|workers)$/.test(route)) return undefined;
  const allowed = route === '/v1/remote/operations' ? ['state', 'cursor', 'limit', 'session'] : route === '/v1/remote/files' ? ['project', 'directory'] : route === '/v1/remote/models' ? ['refresh'] : route.endsWith('/workers') ? ['run'] : [];
  for (const key of query.keys()) if (!allowed.includes(key) || query.getAll(key).length !== 1) throw new RequestError(400, 'invalid_query');
  if (route === '/v1/remote/settings') return remoteSettings();
  if (route === '/v1/remote/health') return operationalHealth();
  if (route === '/v1/remote/operations') {
    const limit = query.get('limit') ?? '20', cursor = query.get('cursor'), filter = query.get('state'), session = query.get('session');
    if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
        (cursor && !uuid.safeParse(cursor).success) || (session && !sessionId.safeParse(session).success) ||
        (filter && !['unconfirmed', 'settled', 'rejected'].includes(filter))) throw new RequestError(400, 'invalid_query');
    return transact(async state => {
      const rows = state.operations.filter(row => (!filter || (row.state === 'started' ? 'unconfirmed' : row.state) === filter) && (!session || row.sessionId === session))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).filter(row => !cursor || row.id > cursor);
      const page = rows.slice(0, Number(limit));
      return { operations: page.map(row => ({ id: row.id, action: row.action, state: row.state === 'started' ? 'unconfirmed' : row.state,
        sessionId: row.sessionId, createdAt: row.createdAt, error: row.error })),
        nextCursor: rows.length > page.length ? page.at(-1)!.id : null,
        capacity: { used: state.operations.length, limit: 1000, automaticUpkeep: true } };
    });
  }
  if (route === '/v1/remote/resources') return resourceSnapshot(sessionsRoot());
  if (route === '/v1/remote/models') {
    if (query.has('refresh') && !['0', '1'].includes(query.get('refresh')!)) throw new RequestError(400, 'invalid_query');
    // GET never opens a helper/browser. Refresh is passive account observation only.
    if (query.get('refresh') === '1') await startChatModelDiscovery(false);
    const catalog = getChatModels();
    return { ...catalog, error: catalog.error ? publicText(catalog.error) : undefined };
  }
  if (route === '/v1/remote/projects') {
    const projects = await listProjects(); const result = [];
    for (const project of projects) {
      try { if (!project.ungrouped) { await projectWorkspace(project.id); const link = project.chatgpt;
        result.push({ id: project.id, name: publicText(project.name), chatgpt: link ? { state: link.state, updatedAt: link.updatedAt,
          error: 'error' in link ? publicText(link.error) : null } : null }); } }
      catch { /* Unapproved or unavailable folders are not selectable remotely. */ }
    }
    return { projects: result };
  }
  if (route === '/v1/remote/files') {
    if (!effectiveCapabilities(getConfig()).browse) throw new RequestError(403, 'browse_disabled');
    const projectId = uuid.safeParse(query.get('project'));
    if (!projectId.success) throw new RequestError(400, 'invalid_project');
    if ((query.get('directory')?.length ?? 0) > 4096) throw new RequestError(400, 'invalid_query');
    const listing = await listProjectDirectory(projectId.data, query.get('directory') ?? '');
    return { ...listing, projectName: publicText(listing.projectName), entries: listing.entries.map(row => ({ ...row, name: publicText(row.name), path: publicText(row.path) })) };
  }
  if (route === '/v1/remote/plans') return transact(async state => ({ plans: state.plans.map(publicPlan) }));
  const planMatch = /^\/v1\/remote\/plans\/([0-9a-f-]{36})$/.exec(route);
  if (planMatch) return transact(async state => {
    const row = state.plans.find(row => row.id === planMatch[1]);
    if (!row) throw new RequestError(404, 'plan_not_found'); return publicPlan(row);
  });
  const operationMatch = /^\/v1\/remote\/operations\/([0-9a-f-]{36})$/.exec(route);
  if (operationMatch) return transact(async state => {
    const row = state.operations.find(row => row.id === operationMatch[1]);
    if (!row) {
      const archived = await archive().get(operationMatch[1]!);
      if (!archived) throw new RequestError(404, 'operation_not_found');
      return { id: archived.id, action: archived.action, state: 'archived', outcome: archived.outcome, sessionId: archived.sessionId, createdAt: archived.createdAt, settledAt: archived.settledAt, archivedAt: archived.archivedAt };
    }
    return { id: row.id, action: row.action, state: row.state === 'started' ? 'unconfirmed' : row.state, result: row.result, error: row.error, sessionId: row.sessionId, createdAt: row.createdAt, settledAt: row.settledAt };
  });
  const sessionMatch = /^\/v1\/sessions\/([0-9a-z-]{8,64})\/(taskplan|controls|workers)$/.exec(route);
  if (sessionMatch) {
    const id = sessionMatch[1]!;
    if (!await getSession(id)) throw new RequestError(404, 'session_not_found');
    if (sessionMatch[2] === 'controls') return publicControls(await sessionControlsFor(id));
    if (sessionMatch[2] === 'workers') return projectAgents(swarmStateForCaller(await callerFor(id, query.get('run') ?? undefined)));
    const plan = await readSessionPlan(id);
    return { plan: plan ? { ...plan, explanation: plan.explanation ? publicText(plan.explanation) : undefined,
      plan: plan.plan.map(row => ({ ...row, step: publicText(row.step), details: row.details ? publicText(row.details) : undefined })) } : null };
  }
  return undefined;
}
