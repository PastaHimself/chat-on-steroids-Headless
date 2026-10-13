import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ReceiptArchive, RECEIPT_AGE_MS, writePrivateJson } from '../../runtime/receipt-archive.mjs';
import { z } from 'zod';

export const snowflake = z.string().regex(/^\d{17,20}$/);
export const permissions = ['read', 'send', 'configure', 'plan', 'workers', 'admin'] as const;
export type Permission = typeof permissions[number];
const settingsSchema = z.object({
  users: z.record(snowflake, z.array(z.enum(permissions)).max(6)).default({}),
  channels: z.array(snowflake).max(100).default([]),
  defaultSession: z.string().max(64).nullable().default(null),
  defaultProject: z.string().uuid().nullable().default(null),
  channelSessions: z.record(snowflake, z.string().max(64)).default({}),
  notificationChannel: snowflake.nullable().default(null),
  progress: z.boolean().default(false), finalResults: z.boolean().default(false),
  operationalAlerts: z.boolean().default(false),
  frequencySeconds: z.number().int().min(15).max(3600).default(30),
  defaultModel: z.string().max(80).nullable().default(null),
  defaultReasoning: z.string().max(20).nullable().default(null),
  defaultAutomation: z.enum(['off', 'goal', 'loop']).default('off'), defaultLoopAfterTurn: z.boolean().default(false)
}).strict();
export type BotSettings = z.infer<typeof settingsSchema>;
const viewSchema = z.object({ user: snowflake, guild: snowflake, channel: snowflake, expiresAt: z.number(),
  kind: z.enum(['sessions', 'history', 'help', 'setup', 'plan', 'confirm', 'status', 'operation']),
  sessionId: z.string().optional(), cursor: z.string().nullable().optional(), before: z.number().optional(),
  planId: z.string().optional(), revision: z.number().optional(), command: z.string().optional(),
  action: z.string().optional(), args: z.record(z.string(), z.unknown()).optional(), page: z.number().optional()
}).strict();
export type View = z.infer<typeof viewSchema>;
const stateSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), settings: settingsSchema, settingsRevision: z.number().int().nonnegative().default(0),
  selected: z.record(snowflake, z.string().max(64)),
  selection: z.record(z.string(), z.object({ model: z.string().max(80), reasoning: z.string().max(20).nullable() })),
  paused: z.record(z.string(), z.object({ mode: z.enum(['goal', 'loop']), afterTurn: z.boolean() })),
  views: z.record(z.string(), viewSchema),
  setup: z.record(snowflake, z.object({ id: z.string().uuid(), revision: z.number(), baseRevision: z.number().int().nonnegative().default(0), settings: settingsSchema,
    backend: z.object({ maxWorkers: z.number().int().min(1).max(8).optional(), globalMaxWorkers: z.number().int().min(0).max(64).optional(),
      finishTool: z.boolean().optional(), planBackend: z.enum(['chatgpt', 'api']).optional() }).default({}) })),
  interactions: z.record(snowflake, z.object({ operationId: z.string().uuid(), createdAt: z.number(), state: z.enum(['started', 'done', 'rejected']), settledAt: z.number().finite().optional(),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(), summary: z.string().max(1800).optional() })),
  health: z.object({ lastSeen: z.number().default(0), episodes: z.record(z.string(), z.object({
    id: z.string().uuid(), channelId: snowflake, failures: z.number().int().nonnegative(), successes: z.number().int().nonnegative(),
    reported: z.boolean(), recovered: z.boolean(), messageId: snowflake.nullable(), pending: z.boolean(), detail: z.string().max(1000)
  })) }).default({ lastSeen: 0, episodes: {} }),
  monitors: z.record(z.string(), z.object({ sessionId: z.string(), channelId: snowflake, messageId: snowflake.nullable(),
    from: z.number().int().nonnegative(), lastUpdate: z.number(), signature: z.string(), pendingSignature: z.string().optional(),
    activeTurnId: z.string().nullable(), inputId: z.string().nullable(), createdAt: z.number(), notifiedFinal: z.string().nullable(),
    questionSeq: z.number().optional(), deliveryConfirmed: z.boolean().optional(), completedTurnId: z.string().optional(), viewId: z.string().uuid().optional(), tools: z.array(z.string().max(500)).max(4).optional(),
    final: z.object({ seq: z.number(), time: z.number(), turnId: z.string(), text: z.string().max(4000) }).optional() }))
}).strict();
export type BotState = z.infer<typeof stateSchema>;

/** This bot's state only. It never opens the backend's session/config ledgers. */
export class StateStore {
  private chain: Promise<unknown> = Promise.resolve();
  private state: BotState = stateSchema.parse({ version: 2, settings: {}, selected: {}, selection: {}, paused: {}, views: {}, setup: {}, interactions: {}, monitors: {} });
  readonly archive: ReceiptArchive;
  constructor(readonly directory: string) { this.archive = new ReceiptArchive(path.join(directory, 'receipt-archive')); }
  async load(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const handle = await fs.open(path.join(this.directory, 'state.json'), 'r');
      try {
        if ((await handle.stat()).size > 4 * 1024 * 1024) throw new Error('Bot state exceeds its bounded envelope');
        const raw = JSON.parse(await handle.readFile('utf8'));
        const parsed = stateSchema.parse(raw);
        if (parsed.version === 1) {
          const backup = path.join(this.directory, 'state-v1-backup.json');
          try { await fs.access(backup); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writePrivateJson(backup, raw); }
          parsed.version = 2; await writePrivateJson(path.join(this.directory, 'state.json'), parsed);
        }
        this.state = parsed;
      } finally { await handle.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Bot state is invalid; restore its backup before starting'); }
  }
  snapshot(): BotState { return structuredClone(this.state); }
  update<T>(work: (state: BotState) => T | Promise<T>): Promise<T> {
    const operation = this.chain.then(async () => {
      const next = structuredClone(this.state);
      if (Object.keys(next.interactions).length >= 1600) await this.archiveSettled(next, Date.now());
      const result = await work(next);
      stateSchema.parse(next);
      const bytes = JSON.stringify(next);
      if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) throw new Error('Bot state capacity reached');
      const file = path.join(this.directory, 'state.json');
      await writePrivateJson(file, next);
      this.state = next;
      return result;
    });
    this.chain = operation.catch(() => undefined);
    return operation;
  }
  private async archiveSettled(state: BotState, now: number): Promise<void> {
    const expired = Object.entries(state.interactions).filter(([, row]) =>
      row.state !== 'started' && (row.settledAt ?? row.createdAt) <= now - RECEIPT_AGE_MS);
    // Each archive.put() durably syncs the payload and replay fence. Thousands of serial
    // writes can exceed Discord's maintenance budget on Windows. Archive independent IDs
    // in small batches, but settle every in-flight write before an error can escape: no
    // leftover operation may race the next StateStore update on this serialized owner.
    const BATCH_SIZE = 8;
    for (let start = 0; start < expired.length; start += BATCH_SIZE) {
      const outcomes = await Promise.allSettled(expired.slice(start, start + BATCH_SIZE).map(async ([id, row]) => {
        // Old receipts predate fingerprints. Their immutable interaction/operation pair remains a replay fence.
        await this.archive.put({ id, operationId: row.operationId,
          fingerprint: row.fingerprint ?? createHash('sha256').update(`${id}:${row.operationId}`).digest('hex'),
          outcome: row.state === 'rejected' ? 'rejected' : 'done', createdAt: row.createdAt, settledAt: row.settledAt },
        row.summary ?? null, now);
        return id;
      }));
      const failed = outcomes.find(outcome => outcome.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      // Only the clone is mutated; its enclosing update publishes state after all
      // batches succeed. An interrupted/failed batch leaves the original state intact
      // and previously written immutable fences are idempotently reconciled on retry.
      for (const outcome of outcomes) if (outcome.status === 'fulfilled') delete state.interactions[outcome.value];
    }
  }
  async upkeep(now = Date.now()): Promise<void> {
    await this.update(async state => { await this.archiveSettled(state, now); });
    await this.archive.expire(now);
  }
  async view(view: Omit<View, 'expiresAt'>): Promise<string> {
    return this.update(state => {
      for (const [id, row] of Object.entries(state.views)) if (row.expiresAt < Date.now()) delete state.views[id];
      if (Object.keys(state.views).length >= 200) throw new Error('Too many interactive panels; let older panels expire');
      const id = randomUUID(); state.views[id] = { ...view, expiresAt: Date.now() + 30 * 60_000 }; return id;
    });
  }
  getView(id: string, user: string, guild: string, channel: string): View {
    const view = this.state.views[id];
    if (!view || view.expiresAt < Date.now() || view.user !== user || view.guild !== guild || view.channel !== channel)
      throw new Error('This panel is expired or belongs to another person or channel. Run the command again.');
    return structuredClone(view);
  }
}
