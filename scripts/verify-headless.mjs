// Real Electron/Xvfb lifecycle smoke. Owns only fresh temporary data and its child processes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('Run this smoke on Linux as an unprivileged user.');
const require = createRequire(import.meta.url);
const electron = process.env.COS_SMOKE_ELECTRON ?? require('electron');
if (!path.isAbsolute(electron)) throw new Error('COS_SMOKE_ELECTRON must name an absolute verified Electron executable.');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-headless-smoke-'));
const children = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(200); }
  throw new Error(`${label} timed out; no success inferred.`);
}
function launch(command, args, env = process.env) {
  const child = spawn(command, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data.toString()).slice(-12000); });
  child.on('error', error => { output += error.message; });
  return { child, output: () => output };
}
try {
  await fs.access(path.join(root, 'out/main/index.js'));
  let number;
  for (let candidate = 160; candidate < 250; candidate++) {
    try { await fs.access(`/tmp/.X11-unix/X${candidate}`); }
    catch { try { await fs.access(`/tmp/.X${candidate}-lock`); } catch { number = candidate; break; } }
  }
  if (!number) throw new Error('No unused smoke display found');
  const display = `:${number}`, authority = path.join(directory, 'Xauthority');
  await fs.writeFile(authority, '', { mode: 0o600 });
  execFileSync('xauth', ['-f', authority, 'source', '-'], { input: `add ${display} . ${randomBytes(16).toString('hex')}\n`, stdio: ['pipe', 'ignore', 'pipe'] });
  const xvfb = launch(process.env.COS_XVFB_EXECUTABLE ?? 'Xvfb', [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp', '-auth', authority, '-noreset']);
  const data = path.join(directory, 'data'), profile = path.join(directory, 'profile'), report = path.join(directory, 'windows.json');
  await fs.mkdir(data, { mode: 0o700 }); await fs.mkdir(profile, { mode: 0o700 });
  const env = { ...process.env, DISPLAY: display, XAUTHORITY: authority, COS_RUNTIME_MODE: 'headless', COS_DATA_DIR: data, COS_BROWSER_PROFILE: profile,
    COS_REMOTE_PERMISSIONS: '', CLF_BRIDGE_PORTS: '0' };
  delete env.COS_CONTROL_DIRECTORY; delete env.COS_CONTROL_GID;
  await waitFor(async () => { try { execFileSync('xdpyinfo', [], { env, stdio: 'ignore' }); return true; } catch { return false; } }, 'Private Xvfb display');
  const config = require('./fixtures/app-defaults.cjs').defaultConfig();
  config.controlApi = { enabled: true, allowActions: false }; config.ui.autoConnect = false; config.ui.autoRefreshPlugins = false;
  await fs.writeFile(path.join(data, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'cos-headless-smoke', version: '0.0.0', main: 'bootstrap.cjs' }));
  await fs.writeFile(path.join(directory, 'bootstrap.cjs'), `const {app,BrowserWindow}=require('electron'); const fs=require('node:fs');
    app.whenReady().then(()=>setInterval(()=>fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({windows:BrowserWindow.getAllWindows().length})),250));
    require(${JSON.stringify(path.join(root, 'out/main/index.js'))});`);
  const backend = launch(electron, [directory], env);
  let endpoint, token;
  await waitFor(async () => {
    if (backend.child.exitCode !== null || backend.child.signalCode) throw new Error(`Electron startup failed: ${backend.output()}`);
    try { endpoint = JSON.parse(await fs.readFile(path.join(data, 'control-api/endpoint.json'), 'utf8')); token = (await fs.readFile(path.join(data, 'control-api/token'), 'utf8')).trim(); return true; }
    catch { return false; }
  }, 'Restored backend/control API');
  const request = (route, headers = {}) => fetch(`http://127.0.0.1:${endpoint.port}${route}`, { headers, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if ((await request('/v1/remote/settings')).status !== 401) throw new Error('Remote reads were not authenticated');
  const health = await request('/v1/health', { authorization: `Bearer ${token}` });
  if (!health.ok || !(await health.json()).ok) throw new Error('Health request failed');
  await waitFor(async () => { try { return JSON.parse(await fs.readFile(report, 'utf8')).windows === 0; } catch { return false; } }, 'No renderer windows');
  backend.child.kill('SIGTERM');
  await waitFor(async () => backend.child.exitCode !== null || Boolean(backend.child.signalCode), 'Graceful backend shutdown', 30_000);
  try { await fs.access(path.join(data, 'control-api/endpoint.json')); throw new Error('Endpoint survived shutdown'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (backend.child.signalCode || backend.child.exitCode !== 0) throw new Error(`Backend did not exit cleanly: ${backend.output()}`);
  if (xvfb.child.exitCode !== null) throw new Error('Display exited before backend teardown');
  console.log('PASS: authenticated loopback API, no BrowserWindows, persistent isolated profile, SIGTERM drain and credential-file removal on real Electron/Xvfb.');
  if (process.env.COS_SMOKE_BROWSER) {
    const argumentsForBrowser = [`--user-data-dir=${profile}`, '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--no-first-run', '--restore-last-session', 'about:blank'];
    const browser = launch(process.env.COS_SMOKE_BROWSER, argumentsForBrowser, env);
    await waitFor(async () => {
      if (browser.child.exitCode !== null || browser.child.signalCode) throw new Error(`Browser startup failed: ${browser.output()}`);
      try { await fs.access(path.join(profile, 'Default/Preferences')); return true; } catch { return false; }
    }, 'Graphical browser profile');
    const handoff = launch(process.env.COS_SMOKE_BROWSER, argumentsForBrowser, env);
    await waitFor(async () => handoff.child.exitCode !== null || Boolean(handoff.child.signalCode), 'Same-profile browser handoff');
    if (handoff.child.exitCode !== 0 || browser.child.exitCode !== null) throw new Error('Browser did not reuse its original live profile owner');
    process.kill(-browser.child.pid, 'SIGTERM');
    await waitFor(async () => browser.child.exitCode !== null || Boolean(browser.child.signalCode), 'Owned browser process-group stop');
    const restarted = launch(process.env.COS_SMOKE_BROWSER, argumentsForBrowser.slice(0, -1), env);
    await pause(1000);
    if (restarted.child.exitCode !== null || restarted.child.signalCode) throw new Error(`Browser restart failed: ${restarted.output()}`);
    await fs.access(path.join(profile, 'Default/Preferences'));
    console.log('PASS: graphical browser on private Xvfb, profile persistence, same-profile handoff, process-group stop and restart. No account was used.');
  }
  console.log('No Discord, provider authentication, live tasks or installed systemd lifecycle were tested by this smoke.');
} finally {
  for (const child of children.reverse()) if (child.exitCode === null && !child.signalCode && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  for (const child of children) {
    await waitFor(async () => child.exitCode !== null || Boolean(child.signalCode), 'Child cleanup', 5000).catch(() => child.kill('SIGKILL'));
  }
  await fs.rm(directory, { recursive: true, force: true });
}
