import { readFileSync } from 'node:fs';

export interface AdmissionObservation { availableBytes: number; totalBytes: number; memoryFullAvg10: number; }
const MiB = 1024 * 1024;
/** Reserve room for the foreground backend/browser; a new renderer needs measured working space. */
export function workerCapacity(observation: AdmissionObservation): number {
  const reserve = Math.max(768 * MiB, observation.totalBytes * 0.1);
  if (observation.memoryFullAvg10 >= 5 && observation.availableBytes < observation.totalBytes * 0.2) return 0;
  return Math.max(0, Math.floor((observation.availableBytes - reserve) / (256 * MiB)));
}
let cached: { at: number; occupied: number; capacity: number } | null = null;
/**
 * An admission guard, not another queue or ownership system. The broker supplies its current
 * reservations, so concurrent families share the same sampled headroom. No timer, eviction,
 * model change, CPU quota or process killing. Re-evaluate naturally on the next admission.
 */
export function resourceWorkerSlots(occupied: number): number {
  if (process.platform !== 'linux' || process.env.COS_RUNTIME_MODE !== 'headless') return Infinity;
  const now = Date.now();
  if (!cached || now < cached.at || now - cached.at >= 1000) {
    try {
      // These two tiny proc files are read only on admission, never on a polling loop.
      const mem = readFileSync('/proc/meminfo', 'utf8');
      const availableBytes = Number(/^MemAvailable:\s+(\d+)/m.exec(mem)?.[1]) * 1024;
      const totalBytes = Number(/^MemTotal:\s+(\d+)/m.exec(mem)?.[1]) * 1024;
      if (!Number.isFinite(availableBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) return Infinity;
      let memoryFullAvg10 = 0;
      try { memoryFullAvg10 = Number(/^full avg10=([\d.]+)/m.exec(readFileSync('/proc/pressure/memory', 'utf8'))?.[1] ?? 0); } catch { /* PSI is optional on older kernels. */ }
      cached = { at: now, occupied, capacity: workerCapacity({ availableBytes, totalBytes, memoryFullAvg10 }) };
    } catch { return Infinity; }
  }
  return Math.max(0, cached.capacity - Math.max(0, occupied - cached.occupied));
}
