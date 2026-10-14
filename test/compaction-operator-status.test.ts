import { describe, expect, it } from 'vitest';
import { projectLive } from '../src/main/control-reads.js';
import { sessionDescription } from '../discord/src/ui.js';

type Controls = Parameters<typeof projectLive>[0];

function liveJob(options: { source?: string; destination?: string; attention?: boolean; error?: string | null } = {}) {
  const source = options.source ?? 'not-attempted';
  return projectLive({
    activeTurnId: null,
    stopPending: false,
    automation: 'goal',
    blocked: '',
    canSendDirectly: false,
    canInject: false,
    queueAtFinish: false,
    finishHeld: false,
    finishWaiting: false,
    goalWait: null,
    recovery: [],
    job: {
      token: 'do-not-publish-this-handoff-token',
      sessionId: 'do-not-publish-this-session-id',
      handoffId: 'do-not-publish-this-handoff-id',
      stage: 'handoff-pending',
      startedAt: 1,
      automatic: true,
      busy: true,
      sourceSend: { state: source, messageId: 'do-not-publish-this-source-message' },
      destinationSend: { state: options.destination ?? 'not-attempted', messageId: 'do-not-publish-this-destination-message' },
      ...(options.attention ? { needsAttention: true } : {}),
      error: options.error ?? null
    }
  } as unknown as Controls);
}

function shown(live: ReturnType<typeof liveJob>) {
  return sessionDescription({ session: {
    title: 'Local session', model: null, lastTurnOutcome: 'error', updatedAt: 1
  }, live });
}

describe('compaction operator status remains safe and informative', () => {
  it('projects a durable pre-Send blocker and exposes its source checkpoint in Discord', () => {
    const live = liveJob({ attention: true, error: 'composer_missing' });
    expect(live.job).toMatchObject({
      stage: 'handoff-pending', needsAttention: true,
      sourceSend: 'not-attempted', destinationSend: 'not-attempted', error: 'composer_missing'
    });
    const message = shown(live);
    expect(message).toContain('Handoff Send: not-attempted');
    expect(message).toContain('Replacement Send: not-attempted');
    expect(message).toContain('Compaction needs attention: composer_missing');
    expect(JSON.stringify(live)).not.toContain('do-not-publish-this-');
    expect(message).not.toContain('do-not-publish-this-');
  });

  it('distinguishes ambiguous dispatch from a definitely unsent handoff', () => {
    const message = shown(liveJob({
      source: 'dispatched-unresolved', attention: true,
      error: 'The send result is uncertain. Do not resend it.'
    }));
    expect(message).toContain('Handoff Send: dispatched-unresolved');
    expect(message).toContain('Do not resend it.');
    expect(message).not.toContain('Handoff Send: not-attempted');
  });

  it('does not invent an attention alert for a healthy in-progress compaction', () => {
    const live = liveJob({ source: 'sent' });
    expect(live.job).not.toHaveProperty('needsAttention');
    const message = shown(live);
    expect(message).toContain('Handoff Send: sent');
    expect(message).not.toContain('Compaction needs attention:');
  });
});
