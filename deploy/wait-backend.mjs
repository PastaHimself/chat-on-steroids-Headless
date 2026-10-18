// systemd ExecStartPost: initialization, an authenticated response and the exact main PID.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export async function waitForBackend({ directory, pid, timeoutMs = 90_000, intervalMs = 250 }) {
  if (!directory || !path.isAbsolute(directory) || !Number.isSafeInteger(pid) || pid < 1 || timeoutMs < 1 || timeoutMs > 120_000)
    throw new Error('An absolute control directory, main PID and bounded deadline are required');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      const endpoint = JSON.parse(await fs.readFile(path.join(directory, 'endpoint.json'), 'utf8'));
      if (endpoint.pid !== pid || endpoint.protocol !== 1 || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535)
        throw new Error('Backend endpoint does not belong to the starting process');
      const token = (await fs.readFile(path.join(directory, 'token'), 'utf8')).trim();
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid control credential format');
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/health`, { redirect: 'error', headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(Math.min(2000, Math.max(1, deadline - Date.now()))) });
      if (!response.ok) throw new Error('Authenticated initialization probe refused');
      const health = await response.json();
      if (health.ok === true && health.pid === pid && health.protocol === 1) return;
    } catch (error) {
      if (['EACCES', 'EPERM', 'ESRCH'].includes(error.code)) throw new Error(`Backend readiness failed (${error.code}); inspect service ownership and startup journal`);
      // A previous endpoint may remain during restart; never accept its live process as ours.
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(1, deadline - Date.now()))));
  }
  throw new Error('Backend initialization did not become ready before the startup deadline');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pid = Number(process.argv[2]);
  waitForBackend({ directory: process.env.COS_CONTROL_DIRECTORY, pid }).then(() => console.log('Backend initialized; authenticated Control API matches service PID.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
