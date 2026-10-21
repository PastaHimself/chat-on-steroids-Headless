import type { SurfaceId } from '../shared/types.js';

const LEGACY_KEY = 'cos.plugins.refreshReminder.acknowledgedSchemas';
const DIGESTS_KEY = 'cos.plugins.refreshReminder.acknowledgedSchemaDigests';
const SURFACES: readonly SurfaceId[] = ['core', 'desktop', 'plugins'];
type ConnectorSchemas = Partial<Record<SurfaceId, string>>;
let acknowledgedDigests: ConnectorSchemas = {};
let paintGeneration = 0;

/** Persist only one-way declaration digests, even if a malformed settings reply carries other text. */
async function digest(value: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function persistAcknowledgement(): boolean {
  try { window.localStorage.setItem(DIGESTS_KEY, JSON.stringify(acknowledgedDigests)); return true; }
  catch { return false; }
}
const loaded = (async () => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DIGESTS_KEY) ?? '{}') as unknown;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const surface of SURFACES) {
        const value = (saved as Record<string, unknown>)[surface];
        if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) acknowledgedDigests[surface] = value;
      }
    }
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? '{}') as unknown;
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      for (const surface of SURFACES) {
        const value = (legacy as Record<string, unknown>)[surface];
        if (!acknowledgedDigests[surface] && typeof value === 'string' && value)
          acknowledgedDigests[surface] = await digest(value);
      }
      if (persistAcknowledgement()) window.localStorage.removeItem(LEGACY_KEY);
    }
  } catch { /* Acknowledgement still works for this window when storage is unavailable. */ }
})();

/** UI acknowledgement of a declaration, never proof that ChatGPT refreshed its tools. */
export async function paintPluginRefreshReminder(currentSchemas: ConnectorSchemas, confirmedSchemas: ConnectorSchemas = {}): Promise<void> {
  const generation = ++paintGeneration;
  await loaded;
  const observed: ConnectorSchemas = {};
  try {
    await Promise.all(SURFACES.map(async surface => {
      const value = currentSchemas[surface];
      if (value) observed[surface] = await digest(value);
    }));
  } catch { return; }
  // Settings may have changed while Web Crypto worked. An older paint owns no current UI.
  if (generation !== paintGeneration) return;
  const notice = document.getElementById('pluginRefreshReminder')!;
  let changed = false, learned = false;
  for (const surface of SURFACES) {
    const current = observed[surface];
    if (!current) continue;
    const acknowledged = acknowledgedDigests[surface];
    if (confirmedSchemas[surface] === currentSchemas[surface] || !acknowledged) {
      if (acknowledged !== current) { acknowledgedDigests[surface] = current; learned = true; }
    } else if (acknowledged !== current) changed = true;
  }
  if (learned) persistAcknowledgement();
  notice.hidden = !changed;
  document.getElementById('dismissPluginRefreshReminder')!.onclick = () => {
    if (generation !== paintGeneration) return;
    for (const surface of SURFACES) if (observed[surface]) acknowledgedDigests[surface] = observed[surface];
    persistAcknowledgement();
    notice.hidden = true;
  };
}
