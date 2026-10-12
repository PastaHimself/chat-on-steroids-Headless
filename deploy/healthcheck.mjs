#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
const directory = process.env.COS_CONTROL_DIRECTORY;
if (!directory || !path.isAbsolute(directory)) throw new Error('COS_CONTROL_DIRECTORY must be absolute');
try {
  const endpoint = JSON.parse(await fs.readFile(path.join(directory, 'endpoint.json'), 'utf8'));
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) throw new Error('Invalid endpoint');
  const token = (await fs.readFile(path.join(directory, 'token'), 'utf8')).trim();
  const request = async route => {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}${route}`, { redirect: 'error', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Backend health request refused'); return response.json();
  };
  const health = await request('/v1/health');
  if (!health.ok) throw new Error('Backend unhealthy');
  if (process.argv.includes('--ready')) {
    const status = await request('/v1/status');
    if (!status.bridge.present || !status.bridge.paired || status.connection.state !== 'connected') throw new Error('Manual browser/extension/tunnel setup or recovery is required');
  }
  console.log('Loopback backend health verified. Account authentication is a separate manual/provider check.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
