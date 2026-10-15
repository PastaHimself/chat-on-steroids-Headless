/** Remote adapters project existing owners; requested settings are never observations. */
export const REMOTE_READ_ROUTES = ['/v1/remote/settings', '/v1/remote/resources', '/v1/remote/models',
  '/v1/remote/projects', '/v1/remote/files', '/v1/remote/plans', '/v1/remote/plans/{id}',
  '/v1/remote/operations', '/v1/remote/health', '/v1/remote/operations/{id}', '/v1/sessions/{id}/taskplan', '/v1/sessions/{id}/controls',
  '/v1/sessions/{id}/workers'] as const;
export const REMOTE_ACTIONS = ['ask', 'new', 'automation', 'objective', 'stop', 'compact', 'project', 'project-retry',
  'plan', 'plan-edit', 'plan-approve', 'plan-cancel', 'plan-regenerate', 'delegate', 'worker', 'settings'] as const;
export const REMOTE_ACTION_ROUTES = REMOTE_ACTIONS.map(action => `POST /v1/remote/${action}`);
export type RemoteAction = typeof REMOTE_ACTIONS[number];
export interface RemotePlan {
  id: string;
  sessionId: string;
  conversationId: string;
  prompt: string;
  stages: string[];
  revision: number;
  state: 'generating' | 'approval' | 'approved' | 'cancelled' | 'failed' | 'interrupted';
  phase: string;
  inputId?: string;
  error?: string;
  createdAt: number;
}
export interface RemoteOperation {
  id: string;
  fingerprint: string;
  action: string;
  state: 'started' | 'settled' | 'rejected';
  createdAt: number;
  settledAt?: number;
  result?: unknown;
  sessionId?: string;
  error?: { status: number; code: string };
}

/** Read-only receipt projection. Archived outcomes never grant execution authority. */
export interface RemoteOperationView extends Omit<RemoteOperation, 'fingerprint' | 'state'> {
  state: 'unconfirmed' | 'settled' | 'rejected' | 'archived';
  outcome?: 'settled' | 'rejected';
  archivedAt?: number;
}
