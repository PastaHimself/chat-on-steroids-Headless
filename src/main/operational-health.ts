import type { OperationalHealth, HealthComponent } from '../shared/operational-health.js';
import { bridgeStatus } from './bridge.js';
import { getStatus } from './connection.js';
import { getConfig } from './config.js';
import { resourceSnapshot } from './resource-monitor.js';
import { getImageStorage, indexedSessions, sessionsRoot } from './session/store.js';
import { runtimeMode } from './runtime-mode.js';
import { goalControlRecoveryNeeded } from './goal.js';
import { recoveryHeld } from './recovery-hold.js';

export function projectOperationalHealth(source: {
  bridge: { present: boolean; paired: boolean }; connection: { state: string };
  storage: boolean | null; pressure: boolean | null; held: boolean; goalHold?: boolean;
  services: Array<{ name: string; active: string; state: string }>; managed: boolean;
  profile: boolean | null; actions: boolean; remoteRequired?: boolean; now: number; resourceObservedAt?: number;
  recording?: { usedBytes: number; limitBytes: number; incompleteSessions: number } | null;
}): OperationalHealth {
  const components: HealthComponent[] = [];
  const add = (id: string, label: string, state: HealthComponent['state'], detail: string, action: string) =>
    components.push({ id, label, state, detail, action, observedAt: ['storage', 'memory', 'profile', 'services'].includes(id) || id.startsWith('service:') ? source.resourceObservedAt ?? source.now : source.now });
  add('backend', 'Backend', 'available', 'The backend answered this authenticated request.', '');
  add('bridge', 'Browser companion', source.bridge.present && source.bridge.paired ? 'available' : 'attention',
    source.bridge.present ? source.bridge.paired ? 'Present and paired.' : 'Present but not paired.' : 'No companion is present.', 'Inspect the dedicated browser and pair its companion locally.');
  add('connection', 'MCP connection', source.connection.state === 'connected' ? 'available' : 'attention',
    source.connection.state === 'connected' ? 'Connected.' : 'The MCP connection is unavailable.', 'Check connection setup and the tunnel locally.');
  add('provider', 'ChatGPT account', 'unknown', 'Sign-in, account eligibility and task delivery are not proved by pairing.', 'Inspect the signed-in browser and the exact task receipt when needed.');
  add('storage', 'Storage', source.storage === null ? 'unknown' : source.storage ? 'available' : 'attention',
    source.storage === null ? 'Storage could not be inspected.' : source.storage ? 'Storage has working space.' : 'Storage is critically low.', 'Free space locally after backing up; preserve uncertain records and replay fences.');
  add('memory', 'Memory', source.pressure === null ? 'unknown' : source.pressure ? 'attention' : 'available',
    source.pressure === null ? 'Memory could not be inspected.' : source.pressure ? 'Available memory is below 10%.' : 'No high memory pressure observed.', 'Inspect resource use before admitting more workers. Active work is never killed by diagnostics.');
  const recording = source.recording;
  if (recording !== undefined) add('recording', 'Recording history', !recording ? 'unknown' :
    recording.incompleteSessions > 0 || recording.usedBytes >= recording.limitBytes * 0.9 ? 'attention' : 'available',
    !recording ? 'Recording capacity could not be inspected.' :
      `${recording.usedBytes} of ${recording.limitBytes} bytes used by images and overflow text; ${recording.incompleteSessions} sessions have incomplete history.`,
    'Back up and inspect affected history locally. Free recorded images or explicitly delete reviewed inactive chats to reclaim overflow text. Missing history remains incomplete; reconcile it before starting a new task.');
  add('recovery', 'Restore recovery', source.held ? 'attention' : 'available', source.held ? 'Restored work is held for local reconciliation.' : 'No restore hold.', 'Reconcile uncertain work locally before releasing the restore hold.');
  add('goal-controls', 'Goal control save', source.goalHold ? 'attention' : 'available',
    source.goalHold ? 'A Goal control save requires recovery before automation can continue.' : 'No unresolved Goal control save.',
    'Recover the local Goal journal before continuing. Conflicting ownership requires local reconciliation.');
  add('permissions', 'Remote actions', source.actions ? 'available' : source.remoteRequired ? 'attention' : 'unknown', source.actions ? 'Local action switch enabled; individual grants still apply.' : 'Local action switch disabled.', 'Enable actions locally only after reviewing remote authority.');
  if (source.profile !== null) add('profile', 'Dedicated browser profile', source.profile ? 'available' : 'attention', source.profile ? 'Profile is accessible.' : 'Profile is unavailable.', 'Inspect profile ownership and the browser service locally.');
  if (source.managed) {
    if (!source.services.length) add('services', 'Managed services', 'unknown', 'Systemd state could not be inspected.', 'Inspect the service journal locally.');
    for (const service of source.services) add(`service:${service.name}`, service.name, service.active === 'active' ? 'available' : 'attention',
      `${service.active} / ${service.state}`, 'Inspect the managed target and service journal locally.');
  }
  return { observedAt: source.now, serviceAvailable: true,
    taskReadiness: components.some(row => row.state === 'attention') ? 'blocked' : 'unknown', components };
}

export async function operationalHealth(): Promise<OperationalHealth> {
  const [resources, recording] = await Promise.all([
    resourceSnapshot(sessionsRoot()).catch(() => null),
    Promise.all([getImageStorage(), indexedSessions()]).then(([usage, sessions]) => ({ ...usage,
      incompleteSessions: sessions.filter(session => session.recordingIncompleteAt !== undefined).length })).catch(() => null)
  ]);
  const config = getConfig();
  return projectOperationalHealth({ bridge: await bridgeStatus(), connection: getStatus(), now: Date.now(), resourceObservedAt: resources?.observedAt,
    storage: resources ? resources.disk.availableBytes >= 16 * 1024 * 1024 : null,
    recording,
    pressure: resources ? resources.pressure === 'high' : null, held: recoveryHeld(), goalHold: goalControlRecoveryNeeded(),
    profile: resources?.browser.configured ? resources.browser.accessible && resources.browser.ownedByService === true : null,
    services: resources?.systemd.services ?? [], managed: Boolean(process.env.INVOCATION_ID), remoteRequired: runtimeMode() === 'headless', actions: config.controlApi.enabled && config.controlApi.allowActions });
}
