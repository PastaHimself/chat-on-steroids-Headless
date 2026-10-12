import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const RECEIPT_AGE_MS = 60 * 60_000;
export const PAYLOAD_AGE_MS = 30 * 24 * 60 * 60_000;
const hash = value => createHash('sha256').update(value).digest('hex');

async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' &&
      (stat.uid !== process.getuid() || (stat.mode & 0o077)))) throw new Error('Receipt archive directory is not private');
}

export async function writePrivateJson(file, value) {
  await privateDirectory(path.dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
    if (process.platform === 'linux') {
      const parent = await fs.open(path.dirname(file), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally { await fs.rm(temporary, { force: true }); }
}

async function readJson(file, maximum) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || (process.platform !== 'win32' &&
      (stat.uid !== process.getuid() || (stat.mode & 0o077)))) throw new Error('Receipt archive record is unsafe or oversized');
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error('Receipt archive record changed while opening');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}

/** Storage primitive only. Each adapter retains its own admission and transaction authority. */
export class ReceiptArchive {
  constructor(directory) { this.directory = directory; }
  key(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(id)) throw new Error('Invalid receipt identity');
    return hash(id);
  }
  file(id) { const key = this.key(id); return path.join(this.directory, 'fences', key.slice(0, 2), `${key}.json`); }
  async get(id) {
    await privateDirectory(this.directory);
    await privateDirectory(path.join(this.directory, 'fences'));
    const file = this.file(id);
    await privateDirectory(path.dirname(file));
    let row;
    try { row = await readJson(file, 8192); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (row.version !== 1 || row.id !== id || !/^[0-9a-f]{64}$/.test(row.fingerprint) ||
        !['settled', 'rejected', 'done'].includes(row.outcome) || !Number.isFinite(row.createdAt) ||
        !Number.isFinite(row.archivedAt)) throw new Error('Receipt replay fence is corrupt');
    return row;
  }
  async assertSpace() {
    await privateDirectory(this.directory);
    const disk = await fs.statfs(this.directory);
    if (disk.bavail * disk.bsize < 16 * 1024 * 1024) throw new Error('Insufficient storage for receipt replay protection');
  }
  async put(receipt, payload, now = Date.now()) {
    await this.assertSpace();
    const previous = await this.get(receipt.id);
    if (previous) {
      if (previous.fingerprint !== receipt.fingerprint || previous.outcome !== receipt.outcome)
        throw new Error('Conflicting archived receipt');
      return previous;
    }
    const day = new Date(now).toISOString().slice(0, 10);
    const payloadFile = path.join('payloads', day, `${this.key(receipt.id)}.json`);
    const bytes = JSON.stringify(payload ?? null);
    if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) throw new Error('Archived receipt payload exceeds its envelope');
    await writePrivateJson(path.join(this.directory, payloadFile), { expiresAt: now + PAYLOAD_AGE_MS, value: payload ?? null });
    const row = { ...receipt, version: 1, archivedAt: now, payloadFile };
    await writePrivateJson(this.file(receipt.id), row);
    return row;
  }
  async expire(now = Date.now(), budget = 5000) {
    const directory = path.join(this.directory, 'payloads');
    let days;
    try { days = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await privateDirectory(directory);
    let inspected = 0;
    for (const day of days.sort()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid receipt archive partition');
      if (Date.parse(day) + PAYLOAD_AGE_MS > now) break;
      const folder = path.join(directory, day);
      await privateDirectory(folder);
      const entries = await fs.opendir(folder);
      for await (const entry of entries) {
        if (++inspected > budget) return;
        if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) throw new Error('Invalid archived payload');
        const file = path.join(folder, entry.name);
        const payload = await readJson(file, 3 * 1024 * 1024);
        if (!Number.isFinite(payload.expiresAt)) throw new Error('Invalid archived payload expiry');
        if (payload.expiresAt <= now) await fs.unlink(file);
      }
      await fs.rmdir(folder).catch(error => { if (error.code !== 'ENOTEMPTY') throw error; });
    }
  }
}
