import { z } from 'zod';
import { readDurableStrict, writeDurableNow } from './durable.js';

// One owner for the provider's history restriction, independent of coalesced
// timeline notices, browser lifetime, and repair attempts. No retry timer lives here.
const STATE = 'provider-history-backoff';
const MAX_DELAY_MS = 24 * 60 * 60_000;
const deadlines = new Map<string, number>();
const savedSchema = z.object({ version: z.literal(1), deadlines: z.array(z.tuple([
  z.string().min(1).max(256), z.number().finite().nonnegative()
])) }).strict();

export function providerHistoryRetryAt(conversationId: string, now = Date.now()): number | null {
  const until = deadlines.get(conversationId);
  if (until === undefined) return null;
  if (until <= now) { deadlines.delete(conversationId); return null; }
  return until;
}

export async function restoreProviderHistoryBackoff(): Promise<void> {
  const raw = await readDurableStrict<unknown>(STATE);
  if (raw === null) return;
  const saved = savedSchema.parse(raw), now = Date.now();
  for (const [id, until] of saved.deadlines) if (until > now && until - now <= MAX_DELAY_MS)
    deadlines.set(id, Math.max(deadlines.get(id) ?? 0, until));
}

export async function recordProviderHistoryBackoff(conversationId: string,
  observations: readonly { kind: string; time: number; blocking?: boolean; retryAt?: number }[]
): Promise<number | null> {
  const now = Date.now();
  for (const [id, until] of deadlines) if (until <= now) deadlines.delete(id);
  let until = providerHistoryRetryAt(conversationId, now) ?? 0, observed = false;
  for (const item of observations) {
    if (item.kind !== 'chat_error' || item.blocking !== true || !Number.isFinite(item.retryAt) ||
        item.retryAt! <= now || item.retryAt! - now > MAX_DELAY_MS ||
        !Number.isFinite(item.time) || item.retryAt! - item.time > MAX_DELAY_MS) continue;
    until = Math.max(until, item.retryAt!); observed = true;
  }
  if (!observed) return null;
  deadlines.set(conversationId, until);
  // Retain the restrictive memory fence on disk failure and reject the HTTP
  // receipt. Replayed observations must retry this barrier, even at the same deadline.
  await writeDurableNow(STATE, { version: 1, deadlines: [...deadlines] });
  return providerHistoryRetryAt(conversationId);
}

/** Test seam; never changes the saved provider restriction. */
export function resetProviderHistoryBackoffForTests(): void { deadlines.clear(); }
