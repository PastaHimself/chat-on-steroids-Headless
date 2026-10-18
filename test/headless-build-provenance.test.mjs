import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inventory, verifyInventory, cleanBuildOutputs, checkCompiledFormats } from '../scripts/headless-provenance.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-build-provenance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'out/main'), { recursive: true });
  await fs.writeFile(path.join(root, 'out/main/index.js'), 'current');
  return root;
}
test('sealed output rejects a changed stale bundle, missing file and extra mixed-build chunk', async t => {
  const root = await fixture(t), entries = await inventory(root, ['out']);
  await verifyInventory(root, ['out'], entries);
  await fs.writeFile(path.join(root, 'out/main/index.js'), 'stale');
  await assert.rejects(verifyInventory(root, ['out'], entries), /out\/main\/index.js/);
  await fs.writeFile(path.join(root, 'out/main/index.js'), 'current');
  await fs.writeFile(path.join(root, 'out/main/old.js'), 'leftover');
  await assert.rejects(verifyInventory(root, ['out'], entries), /out\/main\/old.js/);
  await fs.rm(path.join(root, 'out/main/old.js'));
  await fs.rm(path.join(root, 'out/main/index.js'));
  await assert.rejects(verifyInventory(root, ['out'], entries), /out\/main\/index.js/);
});
test('source inventory detects additions as well as edits; external linked dependency is refused', async t => {
  const root = await fixture(t), entries = await inventory(root, ['out']);
  await fs.writeFile(path.join(root, 'out/new.js'), 'new source');
  await assert.rejects(verifyInventory(root, ['out'], entries), /out\/new.js/);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-build-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const externalFile = path.join(outside, 'private.txt');await fs.writeFile(externalFile, 'outside fixture');
  await fs.symlink(externalFile, path.join(root, 'out/linked'));
  await assert.rejects(inventory(root, ['out']), /outside/);
});
test('clean build invalidates prior attestation and both output trees before any compiler runs', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'discord/dist'), { recursive: true });
  await fs.mkdir(path.join(root, 'runtime'));
  await fs.writeFile(path.join(root, 'discord/dist/index.js'), 'old bot');
  await fs.writeFile(path.join(root, 'runtime/headless-build.json'), '{}');
  await cleanBuildOutputs(root);
  for (const relative of ['out', 'discord/dist', 'runtime/headless-build.json'])
    await assert.rejects(fs.access(path.join(root, relative)), { code: 'ENOENT' });
});
test('compiled backend durable formats must match manifest despite matching package version', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'runtime'));
  await fs.mkdir(path.join(root, 'discord/dist'), { recursive: true });
  await fs.writeFile(path.join(root, 'runtime/durable-formats.json'), '{"version":1,"backendReceipts":2,"freshTurns":1}');
  await fs.writeFile(path.join(root, 'out/main/index.js'), 'var formats = {version: 1, backendReceipts: 1, freshTurns: 1};');
  await fs.writeFile(path.join(root, 'discord/dist/index.js'), "import { verifyDurableFormats } from '../../runtime/durable-formats.mjs';");
  await assert.rejects(checkCompiledFormats(root), /backendReceipts/);
  await fs.writeFile(path.join(root, 'out/main/index.js'), 'var formats = {version: 1, backendReceipts: 2, freshTurns: 1};');
  await checkCompiledFormats(root);
});
test('deployment provenance refuses edited or untracked source while ignoring generated attestation', async t => {
  const { execFileSync } = await import('node:child_process');
  const { assertCommittedSource } = await import('../scripts/headless-provenance.mjs');
  const root = await fixture(t);await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src/main.ts'), 'original');
  await fs.writeFile(path.join(root, '.gitignore'), 'runtime/headless-build.json\n');
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git(['init']);git(['add', '.']);git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture']);
  assertCommittedSource(root);
  await fs.writeFile(path.join(root, 'src/main.ts'), 'edited');
  assert.throws(() => assertCommittedSource(root), /committed source/);
  await fs.writeFile(path.join(root, 'src/main.ts'), 'original');
  await fs.writeFile(path.join(root, 'src/new.ts'), 'untracked');
  assert.throws(() => assertCommittedSource(root), /committed source/);
  await fs.rm(path.join(root, 'src/new.ts'));await fs.mkdir(path.join(root, 'runtime'));
  await fs.writeFile(path.join(root, 'runtime/headless-build.json'), '{}');assertCommittedSource(root);
});
