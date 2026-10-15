import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { runtimeMode, remotePermission, validateHeadlessEnvironment } from '../src/main/runtime-mode.js';
import { parseMeminfo, resourceSnapshot } from '../src/main/resource-monitor.js';
import { serverBrowserArgs, openInPreferredBrowser, openBrowserSignIn } from '../src/main/browser.js';

describe('headless runtime boundaries', () => {
  it('keeps desktop as the default and refuses invalid or display-free server claims', () => {
    expect(runtimeMode({})).toBe('desktop');
    expect(() => runtimeMode({ COS_RUNTIME_MODE: 'bogus' })).toThrow();
    expect(() => validateHeadlessEnvironment({ COS_RUNTIME_MODE: 'headless' }, 'linux')).toThrow('virtual display');
    expect(() => validateHeadlessEnvironment({ COS_RUNTIME_MODE: 'headless', DISPLAY: ':99', COS_DATA_DIR: '/data', COS_BROWSER_PROFILE: '/profile' }, 'linux')).not.toThrow();
    expect(() => validateHeadlessEnvironment({ COS_RUNTIME_MODE: 'headless', DISPLAY: ':99', COS_DATA_DIR: 'relative', COS_BROWSER_PROFILE: '/profile' }, 'linux')).toThrow('absolute');
  });
  it('requires explicit local grants; similarly named values do not grant authority', () => {
    expect(remotePermission('send', {})).toBe(false);
    expect(remotePermission('send', { COS_REMOTE_PERMISSIONS: 'send-all' })).toBe(false);
    expect(remotePermission('send', { COS_REMOTE_PERMISSIONS: 'send, plan' })).toBe(true);
    expect(remotePermission('workers', { COS_REMOTE_PERMISSIONS: 'send, plan' })).toBe(false);
  });
  it('uses a dedicated profile and an explicit Brave executable without sandbox-disabling switches', async () => {
    const env = { COS_RUNTIME_MODE: 'headless', COS_BROWSER_PROFILE: '/srv/profile', COS_BROWSER_EXECUTABLE: '/custom/brave' };
    const launch = vi.fn(async () => ({ pid: 123 }));
    await openInPreferredBrowser('https://chatgpt.com/c/example', { env, platform: 'linux', browser: 'brave', usable: () => true, launch });
    expect(launch).toHaveBeenCalledWith('/custom/brave', [...serverBrowserArgs(env), 'https://chatgpt.com/c/example'], '/custom');
    expect(JSON.stringify(launch.mock.calls)).not.toMatch(/no-sandbox|disable-setuid-sandbox|remote-debugging|headless|new-window/);
    expect(serverBrowserArgs({})).toEqual([]);
  });
  it('routes a saved built-in desktop choice to the dedicated Brave in Headless', async () => {
    const env = { COS_RUNTIME_MODE: 'headless', COS_BROWSER_PROFILE: '/srv/profile', COS_BROWSER_EXECUTABLE: '/custom/brave' };
    const launch = vi.fn(async () => ({ pid: 123 }));
    await openInPreferredBrowser('https://chatgpt.com/', { env, platform: 'linux', browser: 'cos', usable: () => true, launch });
    expect(launch).toHaveBeenCalledExactlyOnceWith('/custom/brave', [...serverBrowserArgs(env), 'https://chatgpt.com/'], '/custom');
  });
  it('headless activation never constructs a workspace window', () => {
    const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function createWindow(): void {');
    const prefix = source.slice(start, source.indexOf('  const primaryWorkArea', start)).replace(': void', '');
    const unexpected = vi.fn();
    vm.runInNewContext(prefix + ' unexpected(); } createWindow();', { headless: true, unexpected });
    expect(unexpected).not.toHaveBeenCalled();
    expect(source).toContain('if (!headless) startUpdateChecks();');
    expect(source).toContain("process.on(signal, () => app.quit())");
  });
  it('keeps an explicit interactive sign-in in the same dedicated browser profile', async () => {
    const env = { COS_RUNTIME_MODE: 'headless', COS_BROWSER_PROFILE: '/srv/profile', COS_BROWSER_EXECUTABLE: '/custom/brave' };
    const launch = vi.fn(async () => ({ pid: 123 }));
    await openBrowserSignIn('brave', { env, platform: 'linux', usable: () => true, launch });
    expect(launch).toHaveBeenCalledWith('/custom/brave', [...serverBrowserArgs(env), '--new-window', '--window-size=520,760', 'https://chatgpt.com/auth/login'], '/custom');
  });
  it('reports physical RAM and both swap types without process arguments or intervention', async () => {
    expect(parseMeminfo('MemTotal: 8000 kB\nMemAvailable: 2000 kB\nSwapTotal: 4000 kB\n')).toEqual({ MemTotal: 8192000, MemAvailable: 2048000, SwapTotal: 4096000 });
    const state = await resourceSnapshot(process.cwd());
    expect(state.memory.totalBytes).toBeGreaterThan(0); expect(state.disk.totalBytes).toBeGreaterThan(0);
    expect(state.processes.every(row => !('args' in row))).toBe(true);
  });
});
