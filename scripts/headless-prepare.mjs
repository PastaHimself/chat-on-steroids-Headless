// Explicit trusted provisioning: npm lifecycle-script policy may intentionally disable postinstall.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeProbe } from './headless-provenance.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('Prepare Headless as an unprivileged Linux login user');
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Headless preparation requires Node.js 24');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'node_modules/electron/package.json')));
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json')));
if (pkg.version !== lock.packages['node_modules/electron'].version) throw new Error('Electron package differs from lockfile');
const env = { ...process.env };
// Only the package's bundled, pinned official checksums are accepted.
for (const key of Object.keys(env)) if (/^(ELECTRON_|electron_|npm_config_(electron|platform|arch))/.test(key)) delete env[key];
execFileSync(process.execPath, [path.join(root, 'node_modules/electron/install.js')], { cwd: root, env, timeout: 300_000, stdio: 'inherit' });
for (const script of ['fetch-ripgrep.mjs', 'fetch-tunnel-client.mjs'])
  execFileSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, env, timeout: 300_000, stdio: 'inherit' });
console.log(JSON.stringify(nativeProbe(root)));
