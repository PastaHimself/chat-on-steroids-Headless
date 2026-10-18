// Read-only installed-stack sampling. Run each label after deliberately setting up that workload.
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const args = Object.fromEntries(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=')]; }));
if (!['idle', 'task-0', 'task-1', 'task-2', 'soak', 'single', 'long-session', 'multi-worker', 'browser-heavy', 'mcp-heavy', 'compact-resume', 'mixed-java', 'recovery'].includes(args.label) || !args.output || !path.isAbsolute(args.output))
  throw new Error('Use --label=idle|single|long-session|multi-worker|browser-heavy|mcp-heavy|compact-resume|mixed-java|recovery|soak (legacy task-0/1/2 accepted) --output=/private/report.jsonl [--seconds=600] [--interval=30]');
const directory = process.env.COS_CONTROL_DIRECTORY;
if (!directory || !path.isAbsolute(directory)) throw new Error('COS_CONTROL_DIRECTORY must be absolute');
const seconds = Number(args.seconds ?? 600), interval = Number(args.interval ?? 30);
if (!Number.isInteger(seconds) || seconds < 30 || seconds > 7 * 86400 || !Number.isInteger(interval) || interval < 15 || interval > 3600) throw new Error('Invalid bounded sampling duration or interval');
const output = await fs.open(args.output, 'wx', 0o600);
const startedAt = Date.now(); let previous = null, failures = 0;
const request = async route => {
  // Restart and credential rotation are part of the experiment; never cache credentials.
  const endpoint = JSON.parse(await fs.readFile(path.join(directory, 'endpoint.json'), 'utf8'));
  const token = (await fs.readFile(path.join(directory, 'token'), 'utf8')).trim();
  if (endpoint.protocol !== 1 || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid local API endpoint');
  const response = await fetch(`http://127.0.0.1:${endpoint.port}${route}`, { redirect: 'error', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Read refused (${response.status})`);
  return response.json();
};
const cpu = async () => {
  const row = /^cpu\s+(.+)$/m.exec(await fs.readFile('/proc/stat', 'utf8'));
  const ticks = row?.[1].trim().split(/\s+/).map(Number);
  return ticks ? { total: ticks.slice(0, 8).reduce((sum, tick) => sum + tick, 0), idle: ticks[3] + ticks[4] } : null;
};
try {
  do {
    const sampleStart = Date.now(); let sample;
    try {
      const clock = performance.now();
      const [health, resources, operations, workers] = await Promise.all([
        request('/v1/remote/health'), request('/v1/remote/resources'), request('/v1/remote/operations?limit=100'), request('/v1/agents')
      ]);
      const commandLatencyMs = Math.round(performance.now() - clock);
      const counters = await cpu().catch(() => null);
      const browserMemory = await Promise.all(resources.processes.filter(row => row.kind === 'browser').map(async row => {
        try {
          const [smaps, cmdline] = await Promise.all([fs.readFile(`/proc/${row.pid}/smaps_rollup`, 'utf8'), fs.readFile(`/proc/${row.pid}/cmdline`, 'utf8')]);
          return { bytes: Number(/^Pss:\s+(\d+)/m.exec(smaps)?.[1] ?? 0) * 1024, renderer: cmdline.includes('--type=renderer') };
        } catch { return null; }
      }));
      const pssComplete = browserMemory.every(row => row !== null);

      sample = { version: 1, label: args.label, observedAt: sampleStart, resourceObservedAt: resources.observedAt,
        commandLatencyMs, health: { serviceAvailable: health.serviceAvailable, taskReadiness: health.taskReadiness,
          states: health.components.map(row => ({ id: row.id, state: row.state })) },
        memory: resources.memory, browserRssBytes: resources.processes.filter(row => row.kind === 'browser').reduce((sum, row) => sum + row.rssBytes, 0),
        browserPssBytes: pssComplete ? browserMemory.reduce((sum, row) => sum + row.bytes, 0) : null,
        browserRendererPssBytes: pssComplete ? browserMemory.filter(row => row.renderer).reduce((sum, row) => sum + row.bytes, 0) : null,
        browserProcessCount: browserMemory.length, eventLoop: resources.eventLoop ?? null, pressureStall: resources.pressureStall ?? null,
        backendCpu: resources.cpuUsage, cpuBusyFraction: previous?.cpu && counters && counters.total > previous.cpu.total
          ? 1 - (counters.idle - previous.cpu.idle) / (counters.total - previous.cpu.total) : null,
        swapActivity: resources.swapActivity, swapDeltaPages: previous?.swap && resources.swapActivity
          ? { in: resources.swapActivity.inPages - previous.swap.inPages, out: resources.swapActivity.outPages - previous.swap.outPages } : null,
        diskAvailableBytes: resources.disk.availableBytes, diskGrowthBytes: previous ? previous.disk - resources.disk.availableBytes : null,
        hotReceipts: operations.capacity, workerCount: workers.agents?.filter(row => !['sleeping', 'finished'].includes(row.state)).length ?? null,
        notificationLatency: 'Record Discord observation times in the acceptance worksheet; HTTP timing does not prove message delivery.' };
      previous = { cpu: counters, swap: resources.swapActivity, disk: resources.disk.availableBytes };
    } catch { failures++; sample = { version: 1, label: args.label, observedAt: sampleStart, state: 'unavailable', action: 'Inspect health and service journals locally.' }; }
    await output.writeFile(`${JSON.stringify(sample)}\n`); await output.sync();
    if (Date.now() - startedAt >= seconds * 1000) break;
    await new Promise(resolve => setTimeout(resolve, Math.max(1, interval * 1000 - (Date.now() - sampleStart))));
  } while (true);
} finally { await output.close(); }
console.log(`Private benchmark saved: ${args.output}. ${failures} unavailable samples. Workload labels require operator confirmation; no work or worker limit was changed.`);
