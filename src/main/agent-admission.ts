import { noteAgentContextTokens, persistCriticalSwarmNow, swarmStateForCaller, type Caller } from './agents.js';
import { findSessionByConversation } from './session/store.js';
import { admitWorkerSpawn } from './worker-admission.js';
import type { SpawnInput } from './agents.js';
export { acceptAgentMutation } from './worker-admission.js';
/**
 * Re-measures how full each sleeping worker's chat is before status or a possible wake.
 *
 * The context ceiling is what makes a stop final, and it is measured from the app's own
 * durable session for that conversation rather than from anything a model reported. The
 * broker keeps the figure in memory and in its snapshot, but a chat that grew while this app
 * was not running, or one whose snapshot predates the measurement entirely, would otherwise
 * be woken into a conversation with no room left in it. Reading it again before a wake makes
 * the ceiling survive a crash rather than a restart quietly handing back a worker the prime
 * was already told was finished.
 */
export async function measureSleepingWorkers(caller: Caller): Promise<void> {
  const state = swarmStateForCaller(caller);
  if (state.agents.length === 0) return;
  for (const info of state.agents) {
    if (info.role !== 'worker' || info.state !== 'sleeping' || !info.conversationId) continue;
    const summary = await findSessionByConversation(info.conversationId, { requireUnique: true }).catch(() => null);
    if (summary) noteAgentContextTokens(info.conversationId, summary.contextTokens);
  }
  // Measurement is usually telemetry, but crossing the worker ceiling revokes durable revival
  // authority and can terminalize a parked worker. `status` also calls this helper, so there is
  // no later message/spawn acceptance barrier we can rely on: make every critical revision seen
  // through the end of measurement durable before publishing the resulting state to the model.
  try {
    if (!(await persistCriticalSwarmNow())) {
      throw new Error('the broker has no immediate durable persistence sink');
    }
  } catch (error) {
    throw new Error(
      `Worker context/revival state could not cross its durable barrier. Retry the agents call. (${error instanceof Error ? error.message : String(error)})`
    );
  }
}


export function spawnAgentWorkers(input: SpawnInput, workspace: () => Promise<{ real: string; virtual: string } | null>, canIsolate: () => boolean, admission?: { validate(): Promise<void>; assertCurrent(): void; workspace?: { real: string; virtual: string } | null }) {
  admission?.assertCurrent();
  return admitWorkerSpawn(input, { workspace, canIsolate, validateOwner: admission?.validate, assertCurrent: admission?.assertCurrent });
}
