import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const manifestPath = 'runtime/headless-build.json';
export const sourceRoots = ['src', 'extension', 'runtime', 'deploy', 'scripts', 'discord/src', 'discord/tsconfig.json', 'electron.vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json', 'discord/package.json', 'discord/package-lock.json'];
export const payloadRoots = ['resources', 'out', 'extension', 'runtime', 'deploy', 'package.json', 'package-lock.json', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'node_modules', 'discord/dist', 'discord/node_modules', 'discord/package.json', 'discord/package-lock.json', 'discord/THIRD-PARTY-NOTICES.txt', 'discord/licenses', 'scripts/headless-provenance.mjs', 'scripts/verify-headless-build.mjs', 'scripts/headless-native-probe.cjs'];
const ignored = name => name === manifestPath || name.split('/').includes('__pycache__');

/** Hash bytes and executable intent; installation deliberately normalizes ownership/read modes. */
export async function deployedRoots(root) {
  const roots = [...payloadRoots];
  for (const name of ['native']) {
    try { await fs.lstat(path.join(root, name)); roots.push(name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return roots;
}

export async function inventory(root, roots) {
  const entries = {};
  async function visit(relative) {
    if (ignored(relative)) return;
    const file = path.join(root, relative), info = await fs.lstat(file);
    if (info.isSymbolicLink()) {
      const target = await fs.readlink(file), real = await fs.realpath(file);
      if (!real.startsWith(path.resolve(root) + path.sep)) throw new Error(`Link outside build: ${relative}`);
      entries[relative] = { link: target };
    } else if (info.isDirectory()) {
      entries[relative] = { directory: true };
      for (const name of (await fs.readdir(file)).sort()) await visit(`${relative}/${name}`);
    } else if (info.isFile()) {
      entries[relative] = { sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex'), executable: Boolean(info.mode & 0o111) };
    } else throw new Error(`Special file in build: ${relative}`);
  }
  for (const relative of roots) await visit(relative);
  return entries;
}
export async function verifyInventory(root, roots, expected) {
  const actual = await inventory(root, roots);
  for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)]))
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) throw new Error(`Build bytes changed or missing: ${key}`);
}
export function assertCommittedSource(root) {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...sourceRoots], { cwd: root, encoding: 'utf8' });
  if (status.trim()) throw new Error('Headless deployment builds require committed source. Commit the reviewed changes, then rebuild.');
  const ignoredFiles = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...sourceRoots], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  if (ignoredFiles.some(file => /(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example') || /\.(?:pem|p12|pfx)$/.test(file)))
    throw new Error('Private credential files must remain outside deployment source roots.');
}
export async function cleanBuildOutputs(root) {
  for (const relative of [manifestPath, 'out', 'discord/dist']) {
    const target = path.join(root, relative);
    try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error(`Linked build output: ${relative}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rm(target, { force: true, recursive: true });
  }
}
export async function checkCompiledFormats(root) {
  const formats = JSON.parse(await fs.readFile(path.join(root, 'runtime/durable-formats.json'), 'utf8'));
  const bundle = await fs.readFile(path.join(root, 'out/main/index.js'), 'utf8');
  // Vite can hoist JSON properties into constants. Resolve numeric literals only; never eval code.
  const object = /(?:const|var|let) formats\s*=\s*\{([^}]+)\}/.exec(bundle)?.[1];
  if (!object) throw new Error('Compiled durable format object missing');
  for (const [key, value] of Object.entries(formats)) {
    const row = new RegExp(`(?:^|,)\\s*["']?${key}["']?\\s*(?::\\s*([0-9]+))?\\s*(?=,|$)`).exec(object.trim());
    const number = row?.[1] ?? (row ? new RegExp(`(?:const|var|let) ${key}\\s*=\\s*([0-9]+)\\s*;`).exec(bundle)?.[1] : undefined);
    if (Number(number) !== value) throw new Error(`Compiled durable format differs: ${key}`);
  }
  const discord = await fs.readFile(path.join(root, 'discord/dist/index.js'), 'utf8');
  if (!discord.includes('../../runtime/durable-formats.mjs')) throw new Error('Discord durable format import missing');
  return formats;
}
export function nativeProbe(root) {
  const electron = path.join(root, 'node_modules/electron/dist/electron');
  const output = execFileSync(electron, [path.join(root, 'scripts/headless-native-probe.cjs')], {
    cwd: root, timeout: 30_000, maxBuffer: 32768, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: path.join(root, 'node_modules') }, encoding: 'utf8'
  });
  const result = JSON.parse(output.trim().split('\n').at(-1));
  if (result.ok !== true) throw new Error('Native dependency verification failed');
  return result;
}
export async function verifyBuild(root, payload = false, probe = true) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, manifestPath), 'utf8'));
  if (manifest.version !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch || !/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error('Incompatible build attestation');
  if (!payload) {
    assertCommittedSource(root);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (commit !== manifest.commit) throw new Error('Build commit differs from checkout');
    await verifyInventory(root, sourceRoots, manifest.source);
  }
  const roots = await deployedRoots(root);
  if (JSON.stringify(roots) !== JSON.stringify(manifest.payloadRoots)) throw new Error('Build resource roots changed');
  await verifyInventory(root, roots, manifest.payload);
  if (JSON.stringify(await checkCompiledFormats(root)) !== JSON.stringify(manifest.formats)) throw new Error('Build durable formats differ');
  if (probe) nativeProbe(root);
  return manifest;
}
