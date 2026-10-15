import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateStore } from '../discord/src/state.js';
import { ControlClient } from '../discord/src/api.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await makeTempDir('cos-discord-test-');
});

afterEach(async () => {
  await removeTempDir(tempDir);
});

describe('Discord bot state store & API client reliability', () => {
  it('archives settled interactions under high load even if younger than 1 hour', async () => {
    const store = new StateStore(tempDir);
    await store.load();

    // Populate store with 1050 settled interactions using valid 18-digit snowflake keys.
    // >= 1000 triggers elevated archiving mode without excessive disk sync overhead.
    await store.update(state => {
      const now = Date.now();
      const baseSnowflake = BigInt('100000000000000000');
      for (let i = 0; i < 1050; i++) {
        const id = (baseSnowflake + BigInt(i)).toString();
        state.interactions[id] = {
          operationId: randomUUID(),
          createdAt: now - 1000, // 1 second ago
          settledAt: now - 500,
          state: 'done'
        };
      }
    });

    expect(Object.keys(store.snapshot().interactions).length).toBe(1050);

    // Call upkeep to trigger interaction archiving
    await store.upkeep();

    // Settled interactions should have been archived and cleared from memory
    expect(Object.keys(store.snapshot().interactions).length).toBe(0);
  }, 120_000);

  it('prunes stale and completed notification monitors when capacity is approached', async () => {
    const store = new StateStore(tempDir);
    await store.load();

    const now = Date.now();
    await store.update(state => {
      // Add 20 completed monitors with varying timestamps
      for (let i = 0; i < 20; i++) {
        const id = `monitor-${i}`;
        state.monitors[id] = {
          sessionId: `session-${i}`,
          channelId: '123456789012345678',
          messageId: null,
          from: 0,
          lastUpdate: now - (20 - i) * 60_000,
          signature: 'sig',
          activeTurnId: null,
          inputId: null,
          createdAt: now - (20 - i) * 60_000,
          notifiedFinal: i < 15 ? 'notified' : null,
          ...(i < 15 ? { final: { seq: 1, time: now, turnId: 'turn-1', text: 'done' } } : {})
        };
      }
    });

    // Trigger pruneMonitors via upkeep
    await store.upkeep(now);

    // Completed/stale monitors should be pruned down below capacity (<= 15)
    expect(Object.keys(store.snapshot().monitors).length).toBeLessThanOrEqual(15);
  });

  it('retries reading endpoint and token credentials during backend restart window', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new ControlClient(tempDir, mockFetch as unknown as typeof fetch);

    // Write valid endpoint and token after a 200ms delay to simulate async restart
    setTimeout(async () => {
      await fs.writeFile(
        path.join(tempDir, 'endpoint.json'),
        JSON.stringify({ protocol: 1, port: 18765 }),
        'utf8'
      );
      await fs.writeFile(
        path.join(tempDir, 'token'),
        'A'.repeat(43),
        'utf8'
      );
    }, 200);

    // Request should succeed after brief retry window
    const result = await client.request('/v1/health');
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:18765/v1/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Bearer ${'A'.repeat(43)}`
        })
      })
    );
  });
});
