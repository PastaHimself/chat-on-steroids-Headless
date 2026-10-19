import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { verifyBuild, verifyInventory, sourceRoots } from './headless-provenance.mjs';

export const headlessAssets = ['Chat-On-Steroids-Headless-Linux-x64.tar.gz', 'Chat-On-Steroids-Native-Sources.tar.gz'];
export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function verifyChecksums(directory) {
  const rows = (await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n');
  const expected = new Map();
  for (const row of rows) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(row);
    if (!match || expected.has(match[2])) throw new Error('Invalid checksum asset set');
    expected.set(match[2], match[1]);
  }
  if (expected.size !== headlessAssets.length || headlessAssets.some(file => !expected.has(file))) throw new Error('Unexpected checksum asset set');
  for (const file of headlessAssets) if (await sha256(path.join(directory, file)) !== expected.get(file)) throw new Error(`Checksum mismatch: ${file}`);
}
export async function verifyRelease(directory, commit, tag, probe = true) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Require Linux x64 and the expected full commit SHA');
  await verifyChecksums(directory);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-headless-release-'));
  try {
    // Python 3.12's data filter refuses absolute/traversing paths and escaping links
    // before extraction while preserving ordinary file executable bits.
    execFileSync('python3', ['-c', 'import sys, tarfile; tarfile.open(sys.argv[1], "r:gz").extractall(sys.argv[2], filter="data")', path.resolve(directory, headlessAssets[0]), staging], { stdio: 'pipe' });
    const manifest = await verifyBuild(staging, true, probe);
    if (manifest.commit !== commit) throw new Error('Headless candidate commit differs from requested ref');
    await verifyInventory(staging, sourceRoots, manifest.source);
    const pkg = JSON.parse(await fs.readFile(path.join(staging, 'package.json'), 'utf8'));
    if (tag && tag !== `v${pkg.version}`) throw new Error('Release tag differs from bundled version');
    return manifest;
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [, , directory, commit, tag] = process.argv;
  if (!directory) throw new Error('Usage: verify-headless-release.mjs DIRECTORY COMMIT [TAG]');
  await verifyRelease(directory, commit, tag);
  console.log(`Verified Headless release bundle and native sources: ${commit}`);
}
