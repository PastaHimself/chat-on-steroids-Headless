export const RECEIPT_AGE_MS: number;
export const PAYLOAD_AGE_MS: number;
export interface ReplayFence {
  version: number; id: string; fingerprint: string; outcome: 'settled' | 'rejected' | 'done';
  createdAt: number; settledAt?: number; archivedAt: number; action?: string; operationId?: string; sessionId?: string; payloadFile: string;
}
export function writePrivateJson(file: string, value: unknown): Promise<void>;
export class ReceiptArchive {
  constructor(directory: string);
  readonly directory: string;
  file(id: string): string;
  assertSpace(): Promise<void>;
  get(id: string): Promise<ReplayFence | null>;
  put(receipt: Omit<ReplayFence, 'version' | 'archivedAt' | 'payloadFile'>, payload: unknown, now?: number): Promise<ReplayFence>;
  expire(now?: number, budget?: number): Promise<void>;
}
