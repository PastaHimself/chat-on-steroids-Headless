import os from 'node:os';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const managedServices = ['cos-display', 'cos-session', 'cos-browser', 'cos-backend', 'cos-discord'];
export async function serviceSnapshot() {
  if (process.platform !== 'linux') return { available: false, services: [] as Array<{ name: string; active: string; state: string }> };
  try {
    const { stdout } = await execute('systemctl', ['show', '--property=Id,LoadState,ActiveState,SubState', ...managedServices.map(name => `${name}.service`)],
      { timeout: 2000, maxBuffer: 16384, encoding: 'utf8' });
    const services = stdout.trim().split(/\n\n/).map(block => {
      const fields = Object.fromEntries(block.split('\n').map(line => line.split('=', 2)));
      return { name: fields.Id ?? 'unknown', active: fields.LoadState === 'not-found' ? 'not installed' : fields.ActiveState ?? 'unknown', state: fields.SubState ?? 'unknown' };
    });
    return { available: true, services };
  } catch { return { available: false, services: [], note: 'Service manager unavailable; check locally with systemctl.' }; }
}
export async function profileSnapshot() {
  const profile = process.env.COS_BROWSER_PROFILE;
  if (!profile) return { configured: false, accessible: false, note: 'Desktop profile is managed by the selected browser.' };
  try {
    const stat = await fs.lstat(profile);
    await fs.access(profile, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    return { configured: true, accessible: stat.isDirectory() && !stat.isSymbolicLink(), ownedByService: stat.uid === process.getuid?.(),
      authentication: 'Not proven by process presence or extension pairing; inspect provider sign-in/error state.' };
  } catch { return { configured: true, accessible: false, note: 'Dedicated profile unavailable; local intervention required.' }; }
}

export function parseMeminfo(text: string): Record<string, number> {
  return Object.fromEntries(text.split('\n').flatMap(line => {
    const match = /^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB$/.exec(line);
    return match ? [[match[1]!, Number(match[2]) * 1024]] : [];
  }));
}

/** Diagnostics only. No threshold here terminates work or changes worker admission. */
export async function resourceSnapshot(directory: string) {
  const mem = process.platform === 'linux' ? parseMeminfo(await fs.readFile('/proc/meminfo', 'utf8')) : {};
  const disk = await fs.statfs(directory);
  const processes: Array<{ pid: number; kind: 'browser' | 'terminal'; rssBytes: number; parent: number }> = [];
  if (process.platform === 'linux') {
    const names = (await fs.readdir('/proc')).filter(name => /^\d+$/.test(name));
    // Sequential bounded reads avoid opening hundreds of descriptors at once.
    for (const name of names) {
      if (processes.length >= 256) break;
      try {
        const status = await fs.readFile(`/proc/${name}/status`, 'utf8');
        if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) !== process.getuid?.()) continue;
        const comm = /^Name:\s+(.*)$/m.exec(status)?.[1] ?? '';
        const kind = /brave|chrome|chromium/.test(comm) ? 'browser' : /^(bash|zsh|sh|fish)$/.test(comm) ? 'terminal' : null;
        if (kind) processes.push({ pid: Number(name), kind, rssBytes: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024,
          parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0) });
      } catch { /* A process may exit between directory and status reads. */ }
    }
  }
  let swaps: Array<{ kind: 'zram' | 'disk'; bytes: number; usedBytes: number; priority: number }> = [];
  if (process.platform === 'linux') {
    const raw = await fs.readFile('/proc/swaps', 'utf8');
    swaps = raw.trim().split('\n').slice(1).map(line => {
      const row = line.trim().split(/\s+/);
      return { kind: row[0]?.startsWith('/dev/zram') ? 'zram' as const : 'disk' as const,
        bytes: Number(row[2]) * 1024, usedBytes: Number(row[3]) * 1024, priority: Number(row[4]) };
    });
  }
  return { platform: process.platform, cpuCount: os.cpus().length, loadAverage: os.loadavg(),
    memory: { totalBytes: mem.MemTotal ?? os.totalmem(), availableBytes: mem.MemAvailable ?? os.freemem(),
      swapTotalBytes: mem.SwapTotal ?? 0, swapFreeBytes: mem.SwapFree ?? 0, app: process.memoryUsage() },
    pressure: (mem.MemAvailable ?? os.freemem()) / (mem.MemTotal ?? os.totalmem()) < 0.1 ? 'high' : 'normal',
    disk: { totalBytes: disk.blocks * disk.bsize, availableBytes: disk.bavail * disk.bsize }, swaps, processes,
    possibleOrphans: processes.filter(row => row.parent === 1).map(row => row.pid),
    browser: await profileSnapshot(), systemd: { managed: Boolean(process.env.INVOCATION_ID), ...await serviceSnapshot() } };
}
