# Compact & Resume reliability implementation plan

Base revision: `dea3ee1f11e881b2b2c2a7a19a6731a4c891fe4f`.

## Scope and invariants

Use existing continuation WAL, recorder, maintenance sweep and browser repair claim owners. No new poller or mirrored ticket state. A provider submission with uncertain delivery remains fenced; absence from a page snapshot never permits resending. Capture requires the exact conversation, ticket marker, user anchor, one completed generation and one complete authored final. Replacement keeps the existing session, Goal and worker ownership transfer. Production sessions and browser profiles are outside this implementation workspace.

## Tasks

1. Reproduce the three source defects in `test/bridge.test.ts` and `test/extension.test.ts`: generating/unready compaction reload, recorder-only late capture, and DOM-absence release of uncertain submission. Run each against the baseline and record expected failures.
2. Fence browser recovery in `extension/background.js` and `extension/content.js`. Writing pickups negotiate observation-only claims through `src/main/bridge.ts`; older extensions cannot claim a reload-capable writing repair. Predispatch reloads require exact current route/document and explicit hydrated, idle, empty-composer readiness.
3. Reconcile recorder evidence after `/events` and before existing pickup scheduling, including exhausted tickets. Reuse capture and resume delivery owners; background capture must not borrow a page placement collector. Recheck ownership and tools after asynchronous reads.
4. Remove source DOM-absence release authority. Keep the compatibility endpoint fail-closed. Preserve send checkpoints on deadlines and restart; fail closed on unsupported or invalid checkpoint ledgers.
5. Add durable capture issue diagnostics without renewing progress. Propagate authored-text incompleteness through Fiber, content, bridge and recorder, distinguishing pre-storage loss from recoverable storage overflow. Keep failed or too-short sent replies pending for evidence-based recovery.
6. Extend deterministic coverage for delayed/exhausted capture, incomplete/ambiguous/failed replies, legacy state, extension compatibility, restart, persistence failures and replacement/Goal/worker ownership. Run nearest and adjacent suites, `npm run verify`, builds and isolated integration tests.
7. Review the diff independently, address findings, update operational docs and worklog with actual validation and exclusions, then publish a dedicated branch and ready-for-review PR. No merge, deployment or live-session actions.

## Validation boundary

Tests use temporary session stores, loopback bridge ports and shipped extension code in isolated harnesses. Browser/provider acceptance against a production profile is not authorized. Synthetic evidence verifies the application state machine and at-most-once fences; it cannot prove the historical provider response or production incident cause.
