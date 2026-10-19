import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readDurableStrict, writeDurableNow } from './durable.js';
import { getConfig } from './config.js';
import { getSession, findSessionByConversation } from './session/store.js';

const row = z.record(z.string(), z.unknown()).nullable();
const journalSchema = z.object({ version: z.literal(2), state: z.enum(['pending', 'committed', 'superseded']),
  conversationId: z.string().min(1).max(256), sessionId: z.string().min(1).max(64).nullable(),
  masterOffGeneration: z.string().uuid().optional(),
  before: z.array(row).length(3), after: z.array(row).length(3) }).strict();
type Journal = z.infer<typeof journalSchema>;
let admittedJournal: Journal | null = null;
const ledgers = [
  { name: 'goal-switches', field: 'switches' },
  { name: 'goal-objectives', field: 'objectives' },
  { name: 'goal-replies', field: 'replies' }
] as const;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const identity = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export async function stageGoalControlJournal(sessionId: string | null, conversationId: string,
  before: Array<Record<string, unknown> | null>, after: Array<Record<string, unknown> | null>,
  masterOffGeneration: string | undefined): Promise<void> {
  admittedJournal = journalSchema.parse({ version: 2, state: 'pending', sessionId, conversationId,
    masterOffGeneration, before, after });
  await writeDurableNow('goal-control-journal', admittedJournal);
}
export async function settleGoalControlJournal(): Promise<void> {
  const journal = admittedJournal ?? journalSchema.parse(await readDurableStrict('goal-control-journal'));
  const committed = { ...journal, state: 'committed' as const };
  await writeDurableNow('goal-control-journal', committed); admittedJournal = committed;
}

export async function reopenGoalControlJournal(): Promise<void> {
  const raw = admittedJournal ?? await readDurableStrict('goal-control-journal');
  if (raw) {
    const pending = { ...journalSchema.parse(raw), state: 'pending' as const };
    await writeDurableNow('goal-control-journal', pending); admittedJournal = pending;
  }
}
export async function supersedeGoalControlJournal(): Promise<void> {
  const raw = admittedJournal ?? await readDurableStrict('goal-control-journal');
  if (!raw) return;
  const superseded = { ...journalSchema.parse(raw), state: 'superseded' as const };
  await writeDurableNow('goal-control-journal', superseded); admittedJournal = superseded;
}

/** Merge only the interrupted transaction's exact owner. Never restore whole stale ledgers. */
export async function recoverGoalControlJournal(): Promise<void> {
  admittedJournal = null;
  const raw = await readDurableStrict('goal-control-journal');
  if (!raw) return;
  const journal: Journal = journalSchema.parse(raw); admittedJournal = journal;
  if (journal.state !== 'pending') return;
  // An app-wide Stop was durably accepted after this transaction started. Replaying
  // its old On/objective would undo that newer instruction across the three ledgers.
  const revokedByMasterOff = journal.masterOffGeneration !== getConfig().goal.masterOffGeneration;
  const session = journal.sessionId ? await getSession(journal.sessionId) : await findSessionByConversation(journal.conversationId, { requireUnique: true });
  const offOnly = journal.after[0]?.enabled === false && identity(journal.before[1]) === identity(journal.after[1]) &&
    (journal.after[2] === null || journal.after[2]?.state === 'handled') &&
    (journal.before[0]?.role !== 'decision' || identity(journal.before[0]) === identity(journal.after[0])) &&
    (journal.after[0]?.role !== 'decision' || journal.before[0]?.role === 'decision');
  if ((journal.sessionId && !session) || (session && session.conversationId !== journal.conversationId) ||
      (!offOnly && (session?.origin?.kind === 'worker' || session?.origin?.kind === 'helper')))
    throw new Error('Interrupted Goal controls changed session ownership; reconcile before startup');
  const snapshots: Array<Record<string, unknown>> = [];
  for (let index = 0; index < ledgers.length; index++) {
    const ledger = ledgers[index]!;
    const snapshot = await readDurableStrict<Record<string, unknown>>(ledger.name) ?? { version: 1, savedAt: Date.now(), [ledger.field]: [] };
    if (snapshot.version !== 1 || !Array.isArray(snapshot[ledger.field])) throw new Error('Goal control recovery ledger is invalid');
    const values = snapshot[ledger.field] as Array<Record<string, unknown>>;
    const matching = values.filter(value => value?.conversationId === journal.conversationId);
    if (matching.length > 1) throw new Error('Goal control recovery ownership is ambiguous');
    const current = matching[0] ?? null;
    if (![journal.before[index], journal.after[index]].some(value => identity(value) === identity(current)))
      throw new Error('Goal control recovery found a newer change; reconcile before startup');
    snapshots.push({ ...snapshot, savedAt: Date.now(), [ledger.field]: [
      ...values.filter(value => value?.conversationId !== journal.conversationId),
      ...((revokedByMasterOff ? journal.before[index] : journal.after[index])
        ? [revokedByMasterOff ? journal.before[index] : journal.after[index]] : [])
    ] });
  }
  for (let index = 0; index < ledgers.length; index++) await writeDurableNow(ledgers[index]!.name, snapshots[index]);
  if (revokedByMasterOff) await supersedeGoalControlJournal();
  else await settleGoalControlJournal();
}
