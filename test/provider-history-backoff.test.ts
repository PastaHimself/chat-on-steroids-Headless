import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as durable from '../src/main/durable.js';
import { providerHistoryRetryAt, recordProviderHistoryBackoff, resetProviderHistoryBackoffForTests,
  restoreProviderHistoryBackoff } from '../src/main/provider-history-backoff.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let directory: string;
let now: number;
beforeEach(async () => {
  directory = await makeTempDir('cos-provider-backoff-'); durable.initDurableStore(directory);
  resetProviderHistoryBackoffForTests(); now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(async () => {
  vi.restoreAllMocks(); await durable.flushDurable(); resetProviderHistoryBackoffForTests();
  durable.resetDurableForTests(); await removeTempDir(directory);
});
const limit = (retryAt: number) => [{ kind: 'chat_error', blocking: true, time: now, retryAt }];

it('retains the restrictive fence on disk failure and persists the identical replay before receipt', async () => {
  vi.spyOn(durable, 'writeDurableNow').mockRejectedValueOnce(new Error('injected disk failure'));
  await expect(recordProviderHistoryBackoff('chat-a', limit(now + 60_000))).rejects.toThrow('disk failure');
  expect(providerHistoryRetryAt('chat-a')).toBe(now + 60_000);
  await recordProviderHistoryBackoff('chat-a', limit(now + 60_000));
  resetProviderHistoryBackoffForTests(); await restoreProviderHistoryBackoff();
  expect(providerHistoryRetryAt('chat-a')).toBe(now + 60_000);
});

it('never shortens a provider deadline, borrows another chat, or restores an expired limit', async () => {
  await recordProviderHistoryBackoff('chat-a', limit(now + 120_000));
  await recordProviderHistoryBackoff('chat-a', limit(now + 60_000));
  await recordProviderHistoryBackoff('chat-b', limit(now + 30_000));
  expect(providerHistoryRetryAt('chat-a')).toBe(now + 120_000);
  expect(providerHistoryRetryAt('unrestricted')).toBeNull();
  now += 30_001; resetProviderHistoryBackoffForTests(); await restoreProviderHistoryBackoff();
  expect(providerHistoryRetryAt('chat-b')).toBeNull();
  expect(providerHistoryRetryAt('chat-a')).toBe(now - 30_001 + 120_000);
});

it('rejects an unsupported durable format instead of starting without its restrictions', async () => {
  await durable.writeDurableNow('provider-history-backoff', { version: 99, deadlines: [] });
  await expect(restoreProviderHistoryBackoff()).rejects.toThrow();
});

it('fails closed on a corrupt restriction file', async () => {
  await fs.mkdir(path.join(directory, 'state'), { recursive: true });
  await fs.writeFile(path.join(directory, 'state/provider-history-backoff.json'), '{torn');
  await expect(restoreProviderHistoryBackoff()).rejects.toThrow('Cannot read durable');
});

it('soaks concurrent deadline updates and cold restores without losing the newest restriction', async () => {
  const expected = new Map<string, number>();
  const memory = process.memoryUsage(), cpu = process.cpuUsage(), started = performance.now();
  for (let cycle = 0; cycle < 25; cycle++) {
    await Promise.all(Array.from({ length: 16 }, async (_, index) => {
      const chat = `synthetic-chat-${index}`, until = now + 60_000 + cycle * 1000;
      expected.set(chat, until);
      await recordProviderHistoryBackoff(chat, limit(until));
    }));
    resetProviderHistoryBackoffForTests(); await restoreProviderHistoryBackoff();
    for (const [chat, until] of expected) expect(providerHistoryRetryAt(chat)).toBe(until);
  }
  const elapsedCpu = process.cpuUsage(cpu), after = process.memoryUsage();
  console.info('Simulated provider-backoff soak', { writes: 400, coldRestores: 25, chats: 16,
    elapsedMs: Math.round(performance.now() - started), cpuMs: Math.round((elapsedCpu.user + elapsedCpu.system) / 1000),
    heapDeltaBytes: after.heapUsed - memory.heapUsed, rssDeltaBytes: after.rss - memory.rss });
});
