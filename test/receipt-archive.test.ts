import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReceiptArchive, PAYLOAD_AGE_MS } from '../runtime/receipt-archive.mjs';
import { makeTempDir, removeTempDir } from './helpers.js';
let directory: string, archive: ReceiptArchive;
beforeEach(async () => { directory = await makeTempDir('cos-fences-'); await fs.chmod(directory, 0o700); archive = new ReceiptArchive(directory); });
afterEach(async () => { vi.restoreAllMocks(); await removeTempDir(directory); });
const receipt = () => ({ id: randomUUID(), fingerprint: 'a'.repeat(64), outcome: 'settled' as const, createdAt: 1 });
it('keeps deterministic replay fences after result payload expiry', async () => {
  const row = receipt(), saved = await archive.put(row, { result: 'large output' }, Date.now() - PAYLOAD_AGE_MS - 1);
  await archive.expire(); expect(await archive.get(row.id)).toMatchObject(row);
  await expect(fs.access(path.join(directory, saved.payloadFile))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await fs.stat(archive.file(row.id))).mode & 0o777).toBe(0o600);
});
it('does not publish a fence when payload publication fails', async () => {
  const row = receipt(); vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('interrupted payload publication'));
  await expect(archive.put(row, {})).rejects.toThrow('interrupted'); expect(await archive.get(row.id)).toBeNull();
});
it('does not treat corruption, symlinks or conflicting archived identities as fresh', async () => {
  const row = receipt(); await archive.put(row, {});
  await expect(archive.put({ ...row, fingerprint: 'b'.repeat(64) }, {})).rejects.toThrow('Conflicting');
  await fs.writeFile(archive.file(row.id), '{broken'); await expect(archive.get(row.id)).rejects.toThrow();
  await fs.unlink(archive.file(row.id)); await fs.symlink(path.join(directory, 'missing'), archive.file(row.id));
  await expect(archive.get(row.id)).rejects.toThrow('unsafe');
});
it('refuses archive publication without space for replay protection', async () => {
  vi.spyOn(fs, 'statfs').mockResolvedValue({ bavail: 1, bsize: 4096 } as any);
  await expect(archive.put(receipt(), {})).rejects.toThrow('Insufficient storage');
});
it('expires bulky payloads in bounded batches and never deletes fences', async () => {
  const rows = [receipt(), receipt(), receipt()];
  for (const row of rows) await archive.put(row, {}, Date.now() - PAYLOAD_AGE_MS - 100);
  await archive.expire(Date.now(), 1); await archive.expire(Date.now(), 1); await archive.expire(Date.now(), 1);
  for (const row of rows) expect(await archive.get(row.id)).toMatchObject(row);
});
