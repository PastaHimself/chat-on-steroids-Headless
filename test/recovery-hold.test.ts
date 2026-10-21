import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';
import { initRecoveryHold, recoveryHeld, resetRecoveryHoldForTests } from '../src/main/recovery-hold.js';
import { verifyDurableFormats } from '../runtime/durable-formats.mjs';
vi.mock('electron', () => ({ app: { on: vi.fn(), getPath: () => '', getVersion: () => 'test', getAppPath: () => process.cwd(), isPackaged: false },
  safeStorage: { isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptStringAsync: async (value: string) => Buffer.from(value), decryptStringAsync: async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false }) },
  BrowserWindow: class {}, shell: { openExternal: vi.fn(), openPath: vi.fn() }, nativeTheme: {} }));
let directory: string;
beforeEach(async () => { directory = await makeTempDir('cos-restore-'); resetRecoveryHoldForTests(); });
afterEach(async () => { resetRecoveryHoldForTests(); await removeTempDir(directory); });
it('holds corrupt or linked restore latches and releases only an explicit local record after restart', async () => {
  await initRecoveryHold(directory); expect(recoveryHeld()).toBe(false);
  await fs.writeFile(path.join(directory, 'restore-hold.json'), '{broken'); await initRecoveryHold(directory); expect(recoveryHeld()).toBe(true);
  await fs.writeFile(path.join(directory, 'restore-hold.json'), JSON.stringify({ version: 1, held: false })); await initRecoveryHold(directory); expect(recoveryHeld()).toBe(false);
  await fs.unlink(path.join(directory, 'restore-hold.json')); await fs.symlink(path.join(directory, 'missing'), path.join(directory, 'restore-hold.json'));
  await initRecoveryHold(directory); expect(recoveryHeld()).toBe(true);
});
it('blocks instruction admission, browser claims and model tools during reconciliation', async () => {
  await fs.writeFile(path.join(directory, 'restore-hold.json'), JSON.stringify({ version: 1, held: true })); await initRecoveryHold(directory);
  const input = await import('../src/main/session/input.js'), kernel = await import('../src/main/mcp/kernel.js');
  const run = vi.fn();
  expect(await input.sessionInputPolicy('local-session')).toMatchObject({ canInject: false, browserAllowed: false });
  expect(await input.claimBrowserInput('unused', 'owner', 'conversation')).toBeNull();
  await expect(input.enqueueInput({ text: 'uncertain restored task', mode: 'auto' } as any)).rejects.toThrow('restore_held');
  expect(await kernel.dispatch('exec', {}, null, null, 'core', run)).toMatchObject({ isError: true }); expect(run).not.toHaveBeenCalled();
});
it('refuses future durable formats without changing the original metadata', async () => {
  const file = path.join(directory, 'durable-formats.json'); const original = JSON.stringify({ version: 1, backendReceipts: 3 }); await fs.writeFile(file, original);
  await expect(verifyDurableFormats(directory)).rejects.toThrow('cannot read'); expect(await fs.readFile(file, 'utf8')).toBe(original);
});

it('separates service availability from task readiness and preserves per-owner observation times', async () => {
  const { projectOperationalHealth } = await import('../src/main/operational-health.js');
  const healthy = { bridge: { present: true, paired: true }, connection: { state: 'connected' }, storage: true, pressure: false,
    held: false, services: [], managed: false, profile: null, actions: false, now: 200, resourceObservedAt: 100 };
  const health = projectOperationalHealth(healthy);
  expect(health.serviceAvailable).toBe(true); expect(health.taskReadiness).toBe('unknown');
  expect(health.components.find(row => row.id === 'provider')).toMatchObject({ state: 'unknown', observedAt: 200 });
  expect(health.components.find(row => row.id === 'storage')).toMatchObject({ state: 'available', observedAt: 100 });
  const blocked = projectOperationalHealth({ ...healthy, held: true, storage: false });
  expect(blocked.taskReadiness).toBe('blocked');
  expect(blocked.components.find(row => row.id === 'storage')?.action).toContain('preserve uncertain records');
  for (const recording of [null, { usedBytes: 91, limitBytes: 100, incompleteSessions: 0 },
    { usedBytes: 1, limitBytes: 100, incompleteSessions: 1 }]) {
    const health = projectOperationalHealth({ ...healthy, recording });
    expect(health.components.find(row => row.id === 'recording')?.state).toBe(recording ? 'attention' : 'unknown');
  }
});


it('refuses code-only rollback before new native edit or branch inputs can be reinterpreted', async () => {
  const data = path.join(directory, 'data'), legacy = path.join(directory, 'legacy-runtime');
  await fs.mkdir(legacy);
  await verifyDurableFormats(data);
  await fs.mkdir(path.join(data, 'state'));
  const pending = JSON.stringify([
    { id: 'pending-branch', branch: { conversationId: 'source', messageId: 'exact-reply' }, sendAuthorizedAt: 123 },
    { id: 'pending-edit', edit: { messageId: 'original-question' } }
  ]);
  const file = path.join(data, 'state/session-input.json');
  await fs.writeFile(file, pending);
  const formats = JSON.parse(await fs.readFile(new URL('../runtime/durable-formats.json', import.meta.url), 'utf8'));
  delete formats.providerInputActions;
  await fs.writeFile(path.join(legacy, 'durable-formats.json'), JSON.stringify(formats));
  for (const name of ['durable-formats.mjs', 'receipt-archive.mjs'])
    await fs.copyFile(new URL(`../runtime/${name}`, import.meta.url), path.join(legacy, name));
  const module = pathToFileURL(path.join(legacy, 'durable-formats.mjs')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const runtime = await import(${JSON.stringify(module)}); await runtime.verifyDurableFormats(${JSON.stringify(data)}, false); console.log('browser traffic would start');`
  ], { encoding: 'utf8', timeout: 10_000 });
  expect(child.status).not.toBe(0);
  expect(child.stderr).toContain('cannot read the durable formats');
  expect(child.stdout).not.toContain('browser traffic would start');
  expect(await fs.readFile(file, 'utf8')).toBe(pending);
});
