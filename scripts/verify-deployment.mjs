// Non-privileged deployment checks. Never installs services or changes swap.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('Run deployment checks unprivileged on Linux.');
for (const name of await fs.readdir(path.join(root, 'deploy'))) if (name.endsWith('.sh')) execFileSync('bash', ['-n', path.join(root, 'deploy', name)], { stdio: 'inherit' });
for (const name of ['install-ubuntu.sh', 'swap-zram.sh', 'swap-disk.sh']) {
  try { execFileSync('bash', [path.join(root, 'deploy', name)], { stdio: 'pipe' }); throw new Error(`${name} did not enforce its privileged installer boundary`); }
  catch (error) { if (error.status !== 1 || !String(error.stderr).includes('sudo')) throw error; }
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-unit-check-'));
try {
  const units = [];
  for (const name of await fs.readdir(path.join(root, 'deploy/systemd'))) {
    const content = (await fs.readFile(path.join(root, 'deploy/systemd', name), 'utf8'))
      .replaceAll('/opt/chat-on-steroids/current', root.replaceAll(' ', '\\x20')).replaceAll('/usr/local/bin/node', process.execPath.replaceAll(' ', '\\x20'));
    const target = path.join(directory, name); await fs.writeFile(target, content); units.push(target);
  }
  execFileSync('systemd-analyze', ['verify', ...units], { stdio: 'inherit' });
} finally { await fs.rm(directory, { recursive: true, force: true }); }
for (const name of ['swap-zram.sh', 'swap-disk.sh']) execFileSync('bash', [path.join(root, 'deploy', name), '--check'], { stdio: 'inherit' });
console.log('PASS: shell syntax, privilege refusal, unit syntax with local executable paths, read-only existing swap checks.');
console.log('Privileged installation, reboot, swap activation and rollback still need a disposable Ubuntu 24.04 VPS.');
