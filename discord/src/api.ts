import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { rememberSecret } from './config.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly operationId?: string, readonly outcome?: 'rejected' | 'unconfirmed') { super(`Backend ${status}: ${code}${operationId ? ` (operation ${operationId}; inspect before retrying)` : ''}`); }
}
export class ControlClient {
  constructor(readonly directory: string, private readonly transport: typeof fetch = fetch) {}
  private async readCredentials(retries = 4, delayMs = 400): Promise<{ port: number; token: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const endpointRaw = await fs.readFile(path.join(this.directory, 'endpoint.json'), 'utf8');
        const tokenRaw = await fs.readFile(path.join(this.directory, 'token'), 'utf8');
        const endpoint = z.object({ protocol: z.literal(1), port: z.number().int().min(1).max(65535) }).passthrough()
          .parse(JSON.parse(endpointRaw));
        const token = tokenRaw.trim();
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid control credential format');
        return { port: endpoint.port, token };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EACCES' || code === 'EPERM') throw new Error('Backend control files are not readable; inspect cos-control group ownership.');
        if (code !== 'ENOENT') throw new Error('Backend control endpoint is invalid; inspect backend initialization.');
        lastError = new Error('Backend is not initialized; its control endpoint is unavailable.');
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Failed to read control credentials');
  }

  async request<T = any>(route: string, body?: unknown, timeoutMs = 25_000): Promise<T> {
    if (!/^\/v1\/[a-zA-Z0-9/?=&%_.,-]+$/.test(route) || route.includes('//')) throw new Error('Invalid control route');
    // Re-read per request: the backend rotates credentials/port after each restart.
    let credentials = await this.readCredentials();
    rememberSecret(credentials.token);
    let response: Response;
    try {
      response = await this.transport(`http://127.0.0.1:${credentials.port}${route}`, { method: body === undefined ? 'GET' : 'POST',
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { authorization: `Bearer ${credentials.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (netErr) {
      if (body === undefined) {
        await new Promise(resolve => setTimeout(resolve, 500));
        credentials = await this.readCredentials();
        rememberSecret(credentials.token);
        response = await this.transport(`http://127.0.0.1:${credentials.port}${route}`, { method: 'GET',
          redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { authorization: `Bearer ${credentials.token}` } });
      } else {
        throw netErr;
      }
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty backend response');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new Error('Backend response too large'); chunks.push(next.value); }
    } finally { await reader.cancel().catch(() => undefined); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok) throw new ApiError(response.status, typeof result.error === 'string' ? result.error : 'request_failed', result.operationId,
      ['rejected', 'unconfirmed'].includes(result.outcome) ? result.outcome : undefined);
    return result as T;
  }
  async action<T = any>(action: string, id: string, args: Record<string, unknown> = {}): Promise<T> {
    // Never retry a mutation automatically; its UUID and the backend owner determine uncertainty.
    const reply = await this.request<{ result: T }>(`/v1/remote/${action}`, { ...args, id });
    return reply.result;
  }
}
