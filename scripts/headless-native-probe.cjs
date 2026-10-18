// Executed with the exact Electron binary in Node mode, before touching application state.
(async () => {
  const fs = require('node:fs'), path = require('node:path');
  const root = path.resolve(__dirname, '..');
  for (const file of ['resources/rg/rg', 'resources/tunnel/tunnel-client', 'resources/tunnel/cloudflared'])
    fs.accessSync(path.join(root, file), fs.constants.R_OK | fs.constants.X_OK);
  const expected = require(path.join(root, 'node_modules/electron/package.json')).version;
  if (process.versions.electron !== expected) throw new Error('Electron executable/package version mismatch');
  const Parser = require('tree-sitter'), Bash = require('tree-sitter-bash');
  const parser = new Parser(); parser.setLanguage(Bash);
  if (parser.parse('echo verified').rootNode.hasError) throw new Error('Shell parser failed');
  const sharp = require('sharp');
  await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
  const koffi = require('koffi');
  if (koffi.load('libc.so.6').func('int getpid()')() !== process.pid) throw new Error('Native FFI failed');
  const pty = require('node-pty');
  await new Promise((resolve, reject) => {
    const child = pty.spawn('/bin/sh', ['-c', 'printf cos-native-probe'], { cols: 80, rows: 24 });
    let result = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('PTY probe timed out')); }, 5000);
    child.onData(data => { result += data; });
    child.onExit(({ exitCode }) => { clearTimeout(timer); exitCode === 0 && result.includes('cos-native-probe') ? resolve() : reject(new Error('PTY probe failed')); });
  });
  const version = fs.readFileSync(path.join(root, 'node_modules/electron/dist/version'), 'utf8').trim().replace(/^v/, '');
  if (version !== expected) throw new Error('Electron distribution version mismatch');
  console.log(JSON.stringify({ ok: true, electron: expected, node: process.versions.node, modules: ['tree-sitter-bash', 'sharp', 'koffi', 'node-pty'] }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
