import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../deploy/healthcheck.mjs', import.meta.url));
let directory: string;
let server: Server;
let health: {
  serviceAvailable: boolean;
  taskReadiness: string;
  components: Array<{ id: string; label: string; state: string; detail: string; action: string; observedAt: number }>;
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'cos-healthcheck-'));
  const component = (id: string, state: string) => ({
    id, label: id, state, detail: id, action: 'Inspect locally', observedAt: Date.now()
  });
  health = {
    serviceAvailable: true,
    taskReadiness: 'unknown',
    components: [component('backend', 'available'), component('bridge', 'available'), component('connection', 'available')]
  };
  server = createServer((request, response) => {
    if (request.url !== '/v1/remote/health' || request.headers.authorization !== 'Bearer test-token') {
      response.writeHead(401); response.end(); return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(health));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  await writeFile(path.join(directory, 'endpoint.json'), JSON.stringify({ port: address.port }));
  await writeFile(path.join(directory, 'token'), 'test-token\n', { mode: 0o600 });
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
});

function check(...modes: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...modes], {
      env: { ...process.env, COS_CONTROL_DIRECTORY: directory }
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('headless healthcheck modes', () => {
  it('passes infrastructure connectivity without claiming provider task readiness', async () => {
    const connected = await check('--connected');
    expect(connected.code).toBe(0);
    expect(connected.stdout).toContain('task delivery remain unverified');
    const ready = await check('--ready');
    expect(ready.code).toBe(2);
    expect(ready.stderr).toContain('Task readiness is not proven');
  });

  it('fails infrastructure connectivity if a bridge or MCP connection is missing', async () => {
    health.components.find((row) => row.id === 'bridge')!.state = 'attention';
    expect((await check('--connected')).code).toBe(2);
    health.components.find((row) => row.id === 'bridge')!.state = 'available';
    health.components.find((row) => row.id === 'connection')!.state = 'unknown';
    expect((await check('--connected')).code).toBe(2);
    expect((await check('--service')).code).toBe(0);
  });

  it('refuses false backend liveness and conflicting check modes', async () => {
    health.serviceAvailable = false;
    expect((await check('--service')).code).toBe(2);
    expect((await check('--connected')).code).toBe(2);
    const conflict = await check('--ready', '--connected');
    expect(conflict.code).toBe(1);
    expect(conflict.stderr).toContain('Choose only one healthcheck mode');
    expect((await check()).code).toBe(0);
  });
});
