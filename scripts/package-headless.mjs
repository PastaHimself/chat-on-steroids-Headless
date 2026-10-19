// The tar preserves the sealed dependency symlinks/executable bits that artifact ZIPs cannot.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyBuild } from './headless-provenance.mjs';
import { headlessAssets, sha256 } from './verify-headless-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'linux' || process.arch !== 'x64' || process.getuid?.() === 0) throw new Error('Package Headless as an unprivileged Linux x64 user');
const build = await verifyBuild(root);
execFileSync('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: root });
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
// Only committed files and sealed payload roots enter the bundle. Never Git config/history,
// ignored local files, the enclosing release directory or upstream source snapshot ZIPs.
const sealed = build.payloadRoots;
const files = [...tracked.filter(file => !file.startsWith('upstream/') && !sealed.some(base => file === base || file.startsWith(`${base}/`))), ...sealed];
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-headless-package-'));
try {
  await fs.mkdir(path.join(root, 'release'), { recursive: true });
  const list = path.join(temp, 'files');
  await fs.writeFile(list, files.join('\0') + '\0');
  execFileSync('tar', ['-czf', path.join(root, 'release', headlessAssets[0]), '-C', root, '--null', '-T', list], { stdio: 'inherit' });
  await verifyBuild(root);
  const rows = [];
  for (const file of headlessAssets) rows.push(`${await sha256(path.join(root, 'release', file))}  ${file}`);
  await fs.writeFile(path.join(root, 'release/SHA256SUMS.txt'), rows.join('\n') + '\n');
  console.log(`Packaged sealed Headless source and payload: ${build.commit}`);
} finally { await fs.rm(temp, { recursive: true, force: true }); }
