#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const directory = process.env.COS_CONTROL_DIRECTORY;
if (!directory || !path.isAbsolute(directory)) throw new Error('COS_CONTROL_DIRECTORY must be absolute');

try {
  const modes = ['--service', '--connected', '--ready'].filter((flag) => process.argv.includes(flag));
  if (modes.length > 1) throw new Error('Choose only one healthcheck mode: --service, --connected or --ready.');
  const mode = modes[0] ?? '--report';
  const endpoint = JSON.parse(await fs.readFile(path.join(directory, 'endpoint.json'), 'utf8'));
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) throw new Error('Invalid endpoint');
  const token = (await fs.readFile(path.join(directory, 'token'), 'utf8')).trim();
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/remote/health`, {
    redirect: 'error',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Backend health request refused');
  const health = await response.json();
  console.log(`Service: ${health.serviceAvailable ? 'available' : 'unavailable'}; task readiness: ${health.taskReadiness}.`);
  for (const component of health.components) {
    console.log(`${component.label}: ${component.state}. ${component.detail}${component.state !== 'available' ? ` ${component.action}` : ''} Observed ${new Date(component.observedAt).toISOString()}.`);
  }

  if (mode === '--service' && health.serviceAvailable !== true) {
    console.error('Backend API did not report service availability.');
    process.exitCode = 2;
  }
  if (mode === '--connected') {
    const state = (id) => health.components.find((component) => component.id === id)?.state;
    if (health.serviceAvailable !== true || state('bridge') !== 'available' || state('connection') !== 'available') {
      console.error('Infrastructure is not connected: check the backend, browser companion pairing and MCP connection.');
      process.exitCode = 2;
    } else {
      console.log('Infrastructure connected; ChatGPT login, account eligibility and task delivery remain unverified.');
    }
  }
  if (mode === '--ready' && health.taskReadiness !== 'ready') {
    console.error('Task readiness is not proven; inspect the provider login and a real task receipt locally.');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
