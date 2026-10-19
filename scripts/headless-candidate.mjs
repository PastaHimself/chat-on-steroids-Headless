// Source-distribution artifacts. This is not a portable native payload or a deployment attestation.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync, unzipSync } from 'fflate';
import { assertCommittedSource } from './headless-provenance.mjs';
import { extensionStamp } from './write-extension-stamp.mjs';

export const CANDIDATE_FILES = ['Chat-On-Steroids-Headless-Source.tar.gz', 'Chat-On-Steroids-Headless-Extension.zip', 'HEADLESS-BUILD.json'];
const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function archive(root, commit, file) {
  // This repository includes large historical assets. Write directly to disk rather
  // than collecting the entire compressed source in an execFileSync stdout buffer.
  git(root, ['archive', '--format=tar.gz', '--prefix=chat-on-steroids-headless/', `--output=${file}`, commit]);
}

function identity(root, commit, tag) {
  const head = git(root, ['rev-parse', 'HEAD']).toString().trim();
  if (!/^[a-f0-9]{40}$/.test(commit) || commit !== head) throw new Error('Candidate commit differs from checkout');
  const pkg = JSON.parse(git(root, ['show', `${commit}:package.json`]));
  if (tag && tag !== `v${pkg.version}`) throw new Error('Tag does not match the candidate version');
  const manifest = JSON.parse(git(root, ['show', `${commit}:extension/manifest.json`]));
  if (manifest.version !== pkg.version) throw new Error('App and extension versions differ');
  return { version: 1, artifactKind: 'source', commit, appVersion: pkg.version, target: 'linux-x64', nodeMajor: 24 };
}

function extensionEntries(root, commit) {
  const entries = {};
  const files = git(root, ['ls-tree', '-r', '--name-only', '-z', commit, '--', 'extension']).toString().split('\0').filter(Boolean);
  for (const name of files) entries[name.slice('extension/'.length)] = git(root, ['show', `${commit}:${name}`]);
  // Use the app's canonical stamp algorithm. Build output never changes committed extension bytes.
  entries['build-stamp.txt'] = Buffer.from(`${extensionStamp(path.join(root, 'extension'))}\n`);
  entries.LICENSE = git(root, ['show', `${commit}:LICENSE`]);
  return entries;
}

export async function createCandidate({ root, dir, commit, tag }) {
  assertCommittedSource(root);
  const info = identity(root, commit, tag);
  // Never overwrite a previous run's candidate or mix it with other artifacts.
  await fs.mkdir(dir);
  archive(root, commit, path.join(dir, CANDIDATE_FILES[0]));
  const extension = zipSync(extensionEntries(root, commit), { level: 9, mtime: new Date('1980-01-01T00:00:00Z') });
  await fs.writeFile(path.join(dir, CANDIDATE_FILES[1]), extension);
  await fs.writeFile(path.join(dir, CANDIDATE_FILES[2]), JSON.stringify(info, null, 2) + '\n');
  const checksums = await Promise.all(CANDIDATE_FILES.map(async name => `${await hashFile(path.join(dir, name))}  ${name}\n`));
  await fs.writeFile(path.join(dir, 'SHA256SUMS.txt'), checksums.join(''));
  await verifyCandidate({ root, dir, commit, tag });
}

export async function verifyCandidate({ root, dir, commit, tag }) {
  assertCommittedSource(root);
  const expectedInfo = identity(root, commit, tag);
  const files = [...CANDIDATE_FILES, 'SHA256SUMS.txt'].sort();
  if (JSON.stringify((await fs.readdir(dir)).sort()) !== JSON.stringify(files)) throw new Error('Unexpected or missing candidate files');
  for (const name of files) if (!(await fs.lstat(path.join(dir, name))).isFile()) throw new Error(`Candidate is not a regular file: ${name}`);
  const lines = (await fs.readFile(path.join(dir, 'SHA256SUMS.txt'), 'utf8')).trimEnd().split('\n');
  const hashes = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9.-]+)$/.exec(line);
    if (!match || !CANDIDATE_FILES.includes(match[2]) || hashes.has(match[2])) throw new Error('Malformed or duplicate candidate checksum');
    hashes.set(match[2], match[1]);
  }
  if (hashes.size !== CANDIDATE_FILES.length) throw new Error('Candidate checksum missing');
  for (const name of CANDIDATE_FILES) if (await hashFile(path.join(dir, name)) !== hashes.get(name)) throw new Error(`Candidate checksum differs: ${name}`);
  const info = JSON.parse(await fs.readFile(path.join(dir, CANDIDATE_FILES[2]), 'utf8'));
  if (JSON.stringify(info) !== JSON.stringify(expectedInfo)) throw new Error('Candidate metadata differs from checkout');
  // Do not extract an untrusted archive. Recreate its exact bytes from the reviewed commit.
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-source-check-'));
  try {
    const source = path.join(temporary, 'source.tar.gz');
    archive(root, commit, source);
    if (await hashFile(source) !== hashes.get(CANDIDATE_FILES[0])) throw new Error('Candidate archive differs from committed source');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  const actual = unzipSync(await fs.readFile(path.join(dir, CANDIDATE_FILES[1])));
  const expected = extensionEntries(root, commit);
  if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort()) ||
      Object.keys(expected).some(name => !Buffer.from(actual[name]).equals(expected[name]))) throw new Error('Candidate extension differs from committed source');
  console.log(`Verified Headless source candidate ${commit}; build on Ubuntu 24.04 amd64 before installation.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [mode, dir, commit, tag] = process.argv.slice(2);
  if (!['create', 'verify'].includes(mode) || !dir || !commit) throw new Error('Usage: headless-candidate.mjs create|verify <directory> <commit> [version-tag]');
  await (mode === 'create' ? createCandidate : verifyCandidate)({ root: process.cwd(), dir: path.resolve(dir), commit, tag });
}
