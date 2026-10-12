import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
  frequencySeconds: z.number().int().min(15).max(3600).default(30),
  defaultModel: z.string().max(80).nullable().default(null),
  defaultReasoning: z.string().max(20).nullable().default(null),
  defaultAutomation: z.enum(['off', 'goal', 'loop']).default('off'), defaultLoopAfterTurn: z.boolean().default(false)
}).strict();
export type BotSettings = z.infer<typeof settingsSchema>;
const viewSchema = z.object({ user: snowflake, guild: snowflake, channel: snowflake, expiresAt: z.number(),
  kind: z.enum(['sessions', 'history', 'help', 'setup', 'plan', 'confirm', 'status']),
  sessionId: z.string().optional(), cursor: z.string().nullable().optional(), before: z.number().optional(),
  planId: z.string().optional(), revision: z.number().optional(), command: z.string().optional(),
  action: z.string().optional(), args: z.record(z.string(), z.unknown()).optional(), page: z.number().optional()
}).strict();
export type View = z.infer<typeof viewSchema>;
const stateSchema = z.object({
  version: z.literal(1), settings: settingsSchema, settingsRevision: z.number().int().nonnegative().default(0),
  selected: z.record(snowflake, z.string().max(64)),
  selection: z.record(z.string(), z.object({ model: z.string().max(80), reasoning: z.string().max(20).nullable() })),
  paused: z.record(z.string(), z.object({ mode: z.enum(['goal', 'loop']), afterTurn: z.boolean() })),
  views: z.record(z.string(), viewSchema),
  setup: z.record(snowflake, z.object({ id: z.string().uuid(), revision: z.number(), baseRevision: z.number().int().nonnegative().default(0), settings: settingsSchema,
    backend: z.object({ maxWorkers: z.number().int().min(1).max(8).optional(), globalMaxWorkers: z.number().int().min(0).max(64).optional(),
      finishTool: z.boolean().optional(), planBackend: z.enum(['chatgpt', 'api']).optional() }).default({}) })),
  interactions: z.record(snowflake, z.object({ operationId: z.string().uuid(), createdAt: z.number(), state: z.enum(['started', 'done']), summary: z.string().max(1800).optional() })),
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
  private state: BotState = stateSchema.parse({ version: 1, settings: {}, selected: {}, selection: {}, paused: {}, views: {}, setup: {}, interactions: {}, monitors: {} });
  constructor(readonly directory: string) {}
  async load(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const handle = await fs.open(path.join(this.directory, 'state.json'), 'r');
      try {
        if ((await handle.stat()).size > 4 * 1024 * 1024) throw new Error('Bot state exceeds its bounded envelope');
        this.state = stateSchema.parse(JSON.parse(await handle.readFile('utf8')));
      } finally { await handle.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Bot state is invalid; restore its backup before starting'); }
  }
  snapshot(): BotState { return structuredClone(this.state); }
  update<T>(work: (state: BotState) => T | Promise<T>): Promise<T> {
    const operation = this.chain.then(async () => {
      const next = structuredClone(this.state);
      const result = await work(next);
      stateSchema.parse(next);
      const bytes = JSON.stringify(next);
      if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) throw new Error('Bot state capacity reached');
      const file = path.join(this.directory, 'state.json');
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temp, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temp, file);
        this.state = next;
      } finally { await fs.rm(temp, { force: true }); }
      return result;
    });
    this.chain = operation.catch(() => undefined);
    return operation;
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
