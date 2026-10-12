import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { rememberSecret } from './config.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly operationId?: string) { super(`Backend ${status}: ${code}${operationId ? ` (operation ${operationId}; inspect before retrying)` : ''}`); }
}
export class ControlClient {
  constructor(readonly directory: string, private readonly transport: typeof fetch = fetch) {}
  async request<T = any>(route: string, body?: unknown): Promise<T> {
    if (!/^\/v1\/[a-zA-Z0-9/?=&%_.,-]+$/.test(route) || route.includes('//')) throw new Error('Invalid control route');
    // Re-read per request: the backend rotates credentials/port after each restart.
    const endpoint = z.object({ protocol: z.literal(1), port: z.number().int().min(1).max(65535) }).passthrough()
      .parse(JSON.parse(await fs.readFile(path.join(this.directory, 'endpoint.json'), 'utf8')));
    const token = (await fs.readFile(path.join(this.directory, 'token'), 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid control credential');
    rememberSecret(token);
    const response = await this.transport(`http://127.0.0.1:${endpoint.port}${route}`, { method: body === undefined ? 'GET' : 'POST',
      redirect: 'error', signal: AbortSignal.timeout(25_000), headers: { authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty backend response');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new Error('Backend response too large'); chunks.push(next.value); }
    } finally { await reader.cancel().catch(() => undefined); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok) throw new ApiError(response.status, typeof result.error === 'string' ? result.error : 'request_failed', result.operationId);
    return result as T;
  }
  async action<T = any>(action: string, id: string, args: Record<string, unknown> = {}): Promise<T> {
    // Never retry a mutation automatically; its UUID and the backend owner determine uncertainty.
    const reply = await this.request<{ result: T }>(`/v1/remote/${action}`, { ...args, id });
    return reply.result;
  }
}
