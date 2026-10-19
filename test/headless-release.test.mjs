import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { headlessAssets, verifyChecksums, verifyRelease } from '../scripts/verify-headless-release.mjs';
import { inventory, sourceRoots, deployedRoots, manifestPath } from '../scripts/headless-provenance.mjs';

const commit = 'a'.repeat(40);
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-headless-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function checksums(root) {
  const rows = [];
  for (const file of headlessAssets) rows.push(`${createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')}  ${file}`);
  await fs.writeFile(path.join(root, 'SHA256SUMS.txt'), rows.join('\n') + '\n');
}
test('release requires exactly both headless assets and rejects corruption, omissions and extra checksums', async t => {
  const root = await directory(t);
  for (const name of headlessAssets) await fs.writeFile(path.join(root, name), name);
  await checksums(root);
  await verifyChecksums(root);
  await fs.appendFile(path.join(root, headlessAssets[0]), 'corrupt');
  await assert.rejects(verifyChecksums(root), /checksum/i);
  await checksums(root);
  await fs.appendFile(path.join(root, 'SHA256SUMS.txt'), `${'0'.repeat(64)}  unexpected.tar.gz\n`);
  await assert.rejects(verifyChecksums(root), /asset set/i);
  await checksums(root);
  const rows = await fs.readFile(path.join(root, 'SHA256SUMS.txt'), 'utf8');
  await fs.appendFile(path.join(root, 'SHA256SUMS.txt'), rows.split('\n')[0] + '\n');
  await assert.rejects(verifyChecksums(root), /asset set/i);
  await checksums(root);
  await fs.rm(path.join(root, headlessAssets[1]));
  await assert.rejects(verifyChecksums(root), /ENOENT/);
});
test('extracted bundle preserves source, symlinks and executable intent and rejects wrong commit, version or bytes', async t => {
  const root = await directory(t), payload = await directory(t);
  const files = new Set([...sourceRoots, ...await deployedRootsForFixture()]);
  const directories = new Set(['src', 'extension', 'runtime', 'deploy', 'scripts', 'discord/src', 'resources', 'out', 'node_modules', 'discord/dist', 'discord/node_modules', 'discord/licenses']);
  for (const name of files) {
    if (directories.has(name)) await fs.mkdir(path.join(payload, name), { recursive: true });
    else { await fs.mkdir(path.dirname(path.join(payload, name)), { recursive: true }); await fs.writeFile(path.join(payload, name), 'fixture'); }
  }
  await fs.writeFile(path.join(payload, 'package.json'), '{"version":"2.1.34"}');
  await fs.writeFile(path.join(payload, 'runtime/durable-formats.json'), '{"version":1}');
  await fs.mkdir(path.join(payload, 'out/main'), { recursive: true });
  await fs.writeFile(path.join(payload, 'out/main/index.js'), 'const formats = { version: 1 };');
  await fs.writeFile(path.join(payload, 'discord/dist/index.js'), "import '../../runtime/durable-formats.mjs';");
  await fs.writeFile(path.join(payload, 'node_modules/tool'), 'fixture', { mode: 0o755 });
  await fs.symlink('tool', path.join(payload, 'node_modules/tool-link'));
  const roots = await deployedRoots(payload);
  await fs.writeFile(path.join(payload, manifestPath), JSON.stringify({ version: 1, commit, platform: 'linux', arch: 'x64', formats: { version: 1 }, source: await inventory(payload, sourceRoots), payloadRoots: roots, payload: await inventory(payload, roots) }));
  const archive = path.join(root, headlessAssets[0]);
  const seal = async () => { execFileSync('tar', ['-czf', archive, '-C', payload, '.']); await checksums(root); };
  await fs.writeFile(path.join(root, headlessAssets[1]), 'native source archive fixture');
  await seal();
  await verifyRelease(root, commit, 'v2.1.34', false);
  await assert.rejects(verifyRelease(root, 'b'.repeat(40), 'v2.1.34', false), /commit/i);
  await assert.rejects(verifyRelease(root, commit, 'v9.0.0', false), /version/i);
  await fs.writeFile(path.join(payload, 'src/injected.ts'), 'unsealed source');
  await seal();
  await assert.rejects(verifyRelease(root, commit, undefined, false), /src\/injected/);
  await fs.rm(path.join(payload, 'src/injected.ts'));
  await fs.chmod(path.join(payload, 'node_modules/tool'), 0o644);
  await seal();
  await assert.rejects(verifyRelease(root, commit, undefined, false), /node_modules\/tool/);
  await fs.chmod(path.join(payload, 'node_modules/tool'), 0o755);
  await fs.symlink('/tmp/forbidden-release-target', path.join(payload, 'escape'));
  await seal();
  await assert.rejects(verifyRelease(root, commit, undefined, false), /AbsoluteLinkError|outside/i);
});
async function deployedRootsForFixture() {
  // Reuse the production inventory vocabulary without a fake native runtime probe.
  const { payloadRoots } = await import('../scripts/headless-provenance.mjs');
  return payloadRoots;
}
