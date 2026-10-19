import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';

const script = fileURLToPath(new URL('../scripts/headless-candidate.mjs', import.meta.url));
const roots: string[] = [];
const source = 'Chat-On-Steroids-Headless-Source.tar.gz';
const extension = 'Chat-On-Steroids-Headless-Extension.zip';
const metadata = 'HEADLESS-BUILD.json';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cos-candidate-')); roots.push(root);
  mkdirSync(path.join(root, 'extension'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.1.34' }));
  writeFileSync(path.join(root, 'extension/manifest.json'), JSON.stringify({ version: '2.1.34', manifest_version: 3 }));
  writeFileSync(path.join(root, 'extension/background.js'), 'console.log("fixture");\n');
  writeFileSync(path.join(root, 'LICENSE'), 'Test fixture license\n');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']]) {
    execFileSync('git', args, { cwd: root });
  }
  const dir = path.join(root, 'candidate');
  const run = (mode: string, commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), tag = 'v2.1.34') =>
    spawnSync(process.execPath, [script, mode, dir, commit, tag], { cwd: root, encoding: 'utf8' });
  return { root, dir, run };
}
function checksums(dir: string) {
  writeFileSync(path.join(dir, 'SHA256SUMS.txt'), [source, extension, metadata].map(name => `${hash(readFileSync(path.join(dir, name)))}  ${name}\n`).join(''));
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Headless candidate artifacts', () => {
  it('packages only committed source, a matching stamped extension and explicit source metadata', () => {
    const { root, dir, run } = fixture();
    writeFileSync(path.join(root, 'private.env'), 'not included\n');
    const result = run('create');
    expect(result.status, result.stderr).toBe(0);
    expect(run('verify').status).toBe(0);
    const entries = unzipSync(readFileSync(path.join(dir, extension)));
    expect(Object.keys(entries).sort()).toEqual(['LICENSE', 'background.js', 'build-stamp.txt', 'manifest.json']);
    expect(Buffer.from(entries['build-stamp.txt']!).toString()).toMatch(/^[a-f0-9]{12}\n$/);
    const listing = execFileSync('tar', ['-tzf', path.join(dir, source)], { encoding: 'utf8' });
    expect(listing).toContain('chat-on-steroids-headless/package.json');
    expect(listing).not.toContain('private.env');
    expect(JSON.parse(readFileSync(path.join(dir, metadata), 'utf8'))).toMatchObject({ version: 1, artifactKind: 'source', target: 'linux-x64', nodeMajor: 24, appVersion: '2.1.34' });
  });

  it('rejects an artifact from another commit or version', () => {
    const { run } = fixture(); expect(run('create').status).toBe(0);
    expect(run('verify', 'a'.repeat(40)).status).not.toBe(0);
    expect(run('verify', undefined, 'v9.9.9').status).not.toBe(0);
  });

  it('rejects corrupted source and source substitution even with rewritten checksums', () => {
    const { dir, run } = fixture(); expect(run('create').status).toBe(0);
    writeFileSync(path.join(dir, source), 'substituted archive');
    expect(run('verify').status).not.toBe(0);
    checksums(dir);
    const result = run('verify');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('committed source');
  });

  it('rejects extension substitution even with rewritten checksums', () => {
    const { dir, run } = fixture(); expect(run('create').status).toBe(0);
    writeFileSync(path.join(dir, extension), zipSync({ 'manifest.json': strToU8('{"version":"2.1.34"}') }));
    checksums(dir);
    const result = run('verify'); expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('extension');
  });

  it('rejects duplicate, missing, unsafe and extra checksum entries', () => {
    for (const mode of ['duplicate', 'missing', 'unsafe', 'extra']) {
      const { dir, run } = fixture(); expect(run('create').status).toBe(0);
      const file = path.join(dir, 'SHA256SUMS.txt'); const original = readFileSync(file, 'utf8');
      writeFileSync(file, mode === 'duplicate' ? original + original.split('\n')[0] + '\n' : mode === 'missing' ? original.split('\n').slice(1).join('\n') : original + `${'a'.repeat(64)}  ${mode === 'unsafe' ? '../outside' : 'extra.zip'}\n`);
      expect(run('verify').status, mode).not.toBe(0);
    }
  });

  it('refuses dirty committed inputs and unexpected candidate files', () => {
    const { root, dir, run } = fixture(); expect(run('create').status).toBe(0);
    writeFileSync(path.join(dir, 'extra.exe'), 'desktop installer');
    expect(run('verify').status).not.toBe(0);
    writeFileSync(path.join(root, 'extension/background.js'), 'modified');
    expect(run('create').status).not.toBe(0);
  });
});
