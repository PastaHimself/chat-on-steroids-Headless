// Node 24 strips TypeScript. Compare copies of the original and changed module on the same host.
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const arg = process.argv.find(value => value.startsWith('--module='))?.slice(9);
const modulePath = arg ? path.resolve(arg) : fileURLToPath(new URL('../src/main/resource-monitor.ts', import.meta.url));
const { resourceSnapshot } = await import(pathToFileURL(modulePath).href);
const samples = [], cpuStart = process.cpuUsage();
for (let i = 0; i < 30; i++) {
  const start = performance.now();
  // Distinct equivalent paths deliberately bypass the observation cache.
  await resourceSnapshot(path.resolve(process.cwd()) + '/' + './'.repeat(i + 1));
  samples.push(performance.now() - start);
}
const cpu = process.cpuUsage(cpuStart); samples.sort((a, b) => a - b);
console.log(JSON.stringify({ samples: samples.length, medianMs: samples[14], p95Ms: samples[28], cpuMs: (cpu.user + cpu.system) / 1000,
  processCount: (await fs.readdir('/proc')).filter(name => /^\d+$/.test(name)).length, scope: 'cold diagnostic collection; not model task throughput' }));
