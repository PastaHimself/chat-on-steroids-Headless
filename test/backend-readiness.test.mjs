import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { waitForBackend } from '../deploy/wait-backend.mjs';
async function setup(t, healthPid = process.pid) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-readiness-'));
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${'x'.repeat(43)}`) { res.writeHead(401); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify({ ok: true, protocol: 1, pid: healthPid }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const publish = async (pid = process.pid) => {
    await fs.writeFile(path.join(directory, 'token'), 'x'.repeat(43));
    await fs.writeFile(path.join(directory, 'endpoint.json'), JSON.stringify({ protocol: 1, port: server.address().port, pid }));
  };
  return { directory, publish };
}
test('a running PID without initialized API times out', async t => {
  const { directory } = await setup(t);
  await assert.rejects(waitForBackend({ directory, pid: process.pid, timeoutMs: 50, intervalMs: 5 }), /initialization/);
});
test('waits for endpoint publication and authenticates the starting process', async t => {
  const { directory, publish } = await setup(t);
  const timer = setTimeout(() => { void publish(); }, 20);t.after(() => clearTimeout(timer));
  await waitForBackend({ directory, pid: process.pid, timeoutMs: 500, intervalMs: 5 });
});
test('a responsive stale endpoint or a different health PID is never readiness', async t => {
  const { directory, publish } = await setup(t, process.pid + 1);
  await publish(process.pid + 1);
  await assert.rejects(waitForBackend({ directory, pid: process.pid, timeoutMs: 40, intervalMs: 5 }), /initialization/);
  await publish();
  await assert.rejects(waitForBackend({ directory, pid: process.pid, timeoutMs: 40, intervalMs: 5 }), /initialization/);
});
test('permission refusal is actionable and does not masquerade as an absent endpoint', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const { directory, publish } = await setup(t);await publish();
  await fs.chmod(path.join(directory, 'endpoint.json'), 0o000);
  await assert.rejects(waitForBackend({ directory, pid: process.pid, timeoutMs: 500 }), /EACCES/);
});
