import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
import { workerCapacity, resourceWorkerSlots } from '../src/main/resource-admission.js';
const GiB = 1024 ** 3, MiB = 1024 ** 2;
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('Headless worker pressure admission', () => {
  it('retains concurrency with headroom and stops only new admission under pressure', () => {
    expect(workerCapacity({ totalBytes: 8 * GiB, availableBytes: 6 * GiB, memoryFullAvg10: 0 })).toBeGreaterThan(8);
    expect(workerCapacity({ totalBytes: 8 * GiB, availableBytes: 165 * MiB, memoryFullAvg10: 27 })).toBe(0);
    expect(workerCapacity({ totalBytes: 8 * GiB, availableBytes: 1.4 * GiB, memoryFullAvg10: 10 })).toBe(0);
    expect(workerCapacity({ totalBytes: 8 * GiB, availableBytes: 1.4 * GiB, memoryFullAvg10: 0 })).toBe(2);
  });
  it('counts reservations across families inside one sample and regains admission after a spike', () => {
    vi.stubEnv('COS_RUNTIME_MODE', 'headless'); vi.useFakeTimers(); vi.setSystemTime(1000);
    let available = 2 * GiB, pressure = 0;
    vi.mocked(readFileSync).mockImplementation((file: any) => String(file).endsWith('meminfo')
      ? `MemTotal: ${8 * GiB / 1024} kB\nMemAvailable: ${available / 1024} kB\n`
      : `full avg10=${pressure} avg60=0.00 avg300=0.00 total=0\n`);
    expect(resourceWorkerSlots(0)).toBe(4);
    expect(resourceWorkerSlots(2)).toBe(2);
    available = 1400 * MiB; pressure = 27; vi.setSystemTime(2001);
    expect(resourceWorkerSlots(2)).toBe(0);
    available = 6 * GiB; pressure = 0; vi.setSystemTime(3002);
    expect(resourceWorkerSlots(2)).toBeGreaterThan(8);
  });

  it('does not impose a new desktop limit', () => {
    vi.stubEnv('COS_RUNTIME_MODE', 'desktop');
    expect(resourceWorkerSlots(100)).toBe(Infinity);
  });
});
