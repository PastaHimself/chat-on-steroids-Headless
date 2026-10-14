import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateStore } from '../discord/src/state.js';

let directory: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function seededStore(count: number) {
  directory = await mkdtemp(path.join(tmpdir(), 'cos-archive-batches-'));
  const store = new StateStore(directory);
  await store.load();
  const first = '666666666666666666';
  const ids = Array.from({ length: count }, (_, index) => String(BigInt(first) + BigInt(index)));
  await store.update(state => {
    for (const id of ids) state.interactions[id] =
      { operationId: randomUUID(), state: 'done', createdAt: 1, fingerprint: 'a'.repeat(64) };
    state.interactions['777777777777777777'] = { operationId: randomUUID(), state: 'started', createdAt: 1 };
  });
  return { store, ids };
}

describe('Discord receipt archive bounded concurrency', () => {
  it('archives independent settled receipts concurrently without losing fences across reload', async () => {
    const { store, ids } = await seededStore(22);
    const original = store.archive.put.bind(store.archive);
    let active = 0;
    let peak = 0;
    const spy = vi.spyOn(store.archive, 'put').mockImplementation(async (...args) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 2));
        return await original(...args);
      } finally { active--; }
    });
    await store.upkeep();
    expect(spy).toHaveBeenCalledTimes(ids.length);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(active).toBe(0);
    expect(Object.keys(store.snapshot().interactions)).toEqual(['777777777777777777']);
    const recovered = new StateStore(store.directory);
    await recovered.load();
    expect(Object.keys(recovered.snapshot().interactions)).toEqual(['777777777777777777']);
    expect(await recovered.archive.get(ids[0]!)).toMatchObject({ outcome: 'done' });
    expect(await recovered.archive.get(ids.at(-1)!)).toMatchObject({ outcome: 'done' });
  });

  it('waits for a failed batch to settle and leaves all receipts recoverable on retry', async () => {
    const { store, ids } = await seededStore(12);
    const original = store.archive.put.bind(store.archive);
    let active = 0;
    const spy = vi.spyOn(store.archive, 'put').mockImplementation(async (...args) => {
      active++;
      try {
        if (args[0].id === ids[3]) throw new Error('synthetic archive disk error');
        return await original(...args);
      } finally { active--; }
    });
    await expect(store.upkeep()).rejects.toThrow('synthetic archive disk error');
    expect(active).toBe(0);
    expect(Object.keys(store.snapshot().interactions)).toHaveLength(ids.length + 1);
    const restarted = new StateStore(store.directory);
    await restarted.load();
    expect(Object.keys(restarted.snapshot().interactions)).toHaveLength(ids.length + 1);
    spy.mockRestore();
    await restarted.upkeep();
    expect(Object.keys(restarted.snapshot().interactions)).toEqual(['777777777777777777']);
    for (const id of ids) expect(await restarted.archive.get(id)).toMatchObject({ outcome: 'done' });
  });
});
