import fs from 'node:fs/promises';
import path from 'node:path';
import { writePrivateJson } from './receipt-archive.mjs';
import formats from './durable-formats.json' with { type: 'json' };
export const durableFormats = Object.freeze(formats);
export async function verifyDurableFormats(directory, publish = true) {
  let stored;
  try { stored = JSON.parse(await fs.readFile(path.join(directory, 'durable-formats.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Durable format metadata is corrupt'); }
  if (stored && (stored.version !== 1 || Object.entries(stored).some(([key, value]) => !Number.isInteger(value) || value < 1 || value > (durableFormats[key] ?? 0))))
    throw new Error('This code cannot read the durable formats. Restore its matching encrypted backup.');
  if (publish) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.uid !== process.getuid())) throw new Error('Durable format directory has invalid ownership');
    if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
    await writePrivateJson(path.join(directory, 'durable-formats.json'), durableFormats);
  }
}
