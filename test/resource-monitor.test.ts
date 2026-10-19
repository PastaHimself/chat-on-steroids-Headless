import { describe, expect, it, vi } from 'vitest';
import { parseMeminfo, parsePressure, serviceSnapshot } from '../src/main/resource-monitor.js';

const crlfOutput = [
  'Id=cos-display.service\r',
  'LoadState=loaded\r',
  'ActiveState=active\r',
  'SubState=running\r',
  '\r',
  'Id=cos-backend.service\r',
  'LoadState=not-found\r',
  'ActiveState=inactive\r',
  'SubState=dead\r'
].join('\n');

vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
    callback(null, { stdout: crlfOutput, stderr: '' });
  }
}));

describe('Resource Monitor Systemd Service Parsing', () => {
  it('correctly parses /proc/meminfo formatted lines', () => {
    const sample = [
      'MemTotal:       16328400 kB',
      'MemFree:         2405100 kB',
      'MemAvailable:    8542100 kB',
      'SwapTotal:       4194300 kB',
      'SwapFree:        4194300 kB'
    ].join('\n');

    const result = parseMeminfo(sample);
    expect(result.MemTotal).toBe(16328400 * 1024);
    expect(result.MemAvailable).toBe(8542100 * 1024);
    expect(result.SwapTotal).toBe(4194300 * 1024);
  });

  it('parses kernel pressure without confusing cumulative microseconds and percentages', () => {
    expect(parsePressure('some avg10=58.25 avg60=30.00 avg300=4.20 total=123456\nfull avg10=27.00 avg60=2.00 avg300=0.00 total=6789\n')).toEqual({
      some: { avg10: 58.25, avg60: 30, avg300: 4.2, total: 123456 }, full: { avg10: 27, avg60: 2, avg300: 0, total: 6789 }
    });
  });

  it('handles systemctl show CRLF output without corrupting property values', async () => {
    // Stub platform to 'linux' so serviceSnapshot runs regardless of host runner platform
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    try {
      const snapshot = await serviceSnapshot();
      expect(snapshot.available).toBe(true);
      expect(snapshot.services).toHaveLength(2);
      expect(snapshot.services[0]).toEqual({
        name: 'cos-display.service',
        active: 'active',
        state: 'running'
      });
      expect(snapshot.services[1]).toEqual({
        name: 'cos-backend.service',
        active: 'not installed', // LoadState === 'not-found' maps to 'not installed'
        state: 'dead'
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
