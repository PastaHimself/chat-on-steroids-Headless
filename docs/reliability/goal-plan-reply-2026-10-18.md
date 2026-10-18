# Goal and Plan persistence review, 2026-10-18

## Scope and isolation

Reviewed Goal switch/objective/reply ownership in `src/main/goal.ts` and
`src/main/goal-control-journal.ts`, Plan checkpoint ownership in
`src/main/session/input.ts`, and the continuation and browser recovery contracts
in `AGENTS.md`. The generated workflow is delivered with the full original task;
later checkpoints live in the existing durable input outbox. The displayed
`update_plan` state remains presentation only.

Development used only the isolated `fix/goal-plan-long-run-reliability` worktree,
starting from fork `main` at `8f3a649a`. The optimization agent's separate
worktree, test processes, and shared browser were left untouched. The production
Ubuntu VPS was inspected read-only over SSH. No deployment, production restart,
browser-profile mutation, queue edit, or system configuration change was made.
An additional read-only diff comparison against the active optimization branch
`optimize/headless-performance-repair` at `ee9a864e` found no overlapping
implementation files; only `AGENTS.md` overlaps in documentation. Integrators
should reconcile its respective new sections during a future merge. Neither
worktree was rewritten or rebased.
While this branch was under review, the fork's `main` advanced by three commits
through the merged installation/Discord PR #28. Current `main`
(`877e99fb`) was merged **into this isolated reliability branch**; the two
overlapping Discord files auto-merged without conflict and both implementations
remain present. The optimization agent's branch/PR was not merged or modified.

## Reproduced failures and corrections

1. **Older failed reply acceptance erased newer work.** Pause the first Goal
   reply's real durable rename, accept a newer reply for the same conversation,
   then reject the first rename. Previously, the failed write restored an old
   snapshot of *all* replies and erased the newer obligation even after the
   newer write succeeded. `acceptGoalReplyNow` now restores only the row it
   still owns. The failed-first regression checks live state and durable reload.
2. **Failed Stop-claim write exhausted recovery in memory.** Reject the durable
   rename after `claimGoalRecoveryStopNow` reserves its once-only claim.
   Previously, the claim remained set and all subsequent attempts were refused.
   The failure now rolls back the same reply's reservation and leaves the
   original recovery eligible. The failed-first regression then retries the
   claim successfully.
3. **Failed deferral silently extended Goal's listening deadline.** A rejected
   `goal-replies` rename left `listenUntil` changed in memory. The original
   deadline is restored only when that same reply still owns the failed change;
   a newer accepted deadline survives.
4. **Master Goal Off could be undone after restart.** The global config write
   committed Off before the separate per-chat switch cleanup. A crash between
   them restored older enabled overrides. A new random master-Off generation is
   now saved in the same config commit as Off. Switches have an admission
   generation, so stale overrides are ineffective on load; newer explicit
   per-chat On survives late cleanup. Implicit activation from an old saved
   objective remains suspended until a deliberate On or a newly authored goal.
5. **Older queued control requests could reclaim authority.** When an older
   per-chat On, objective save, or combined switch/objective/reply transaction
   waited behind a disk operation, it could execute under the newer master-Off
   state. Admission generations now fence those pending requests and repair
   partially written owners from accepted state.
6. **Interrupted Goal transactions could replay stale intent.** The existing
   cross-ledger journal previously always completed its proposed `after` rows
   during restart recovery. Recovery now compares the journal's admission
   generation with committed master Off; a superseded operation restores only
   its proven prior owner rows and marks the journal superseded. Newer unrelated
   owners remain protected by exact-row identity checks.
7. **Fresh user objectives did not rearm after master Off.** The initial
   generation fence also prevented a person who deliberately typed a new Goal
   into an inherited-Off chat from starting that work. A failed-first real
   bridge-HTTP test showed the objective saved but no Goal could run. The bridge
   now records the new generation on the existing objective row with the
   explicit new instruction; no additional switch authority is created.
   The legacy inherited Off UI stays unchanged. Previously saved objectives stay
   Off without that new user action, and a chat with its own explicit Off remains Off.
8. **Expired Goal replies appeared idle.** The automatic 12-hour pickup safety
   deadline disarmed the owed reply but previously removed its recovery status.
   A failed-first bridge test reproduced the empty status. The existing reply
   ledger now keeps the expiration reason in the handled tombstone. Main
   projects an exact-source manual recovery blocker to the renderer and Discord,
   while preserving Off, newer question and provider restriction fences.
   The restart and explicit reactivation paths are tested, with no new Send.
9. **Pending obligations were silently evicted at ledger capacity.** The 200-row
   history trim previously discarded an accepted pending reply when restoring
   201 outstanding sources. A failed-first test proved the oldest disappeared.
   The bound now prunes handled history first and preserves legacy oversize
   pending custody. New pending admission at 200 live obligations fails with
   `goal_pending_capacity` before a durable acknowledgment; the receipt owner
   can report the blocker without dropping another accepted reply.
10. **Combined journal could inherit a newer master-Off generation.** After
    a combined Goal control was admitted, an awaited event read permitted
    master Off to commit. The journal then captured the new generation and
    falsely labeled old intent as current. A deterministic gate reproduced this
    persisted wrong-generation row. The journal now receives the generation
    captured at admission; restart can supersede that exact stale transaction.

The fixes use the existing Goal reply ledger, durable input outbox, transaction
journal and status projection. They do not add a watchdog, another state machine,
an additional receipt ledger or an automatic retry loop.

## Evidence and limitations

- Both initial regressions and additional confirmed failures were reproduced
  before correction and passed afterward.
- `test/goal-control-race.test.ts`: 50 tests passed, including deterministic
  4-, 8-, 12-, 24-, 48- and 72-hour simulated clock advances. Every step
  accepted one current reply and reconstructed state from the saved snapshot.
- Plan queue regression advanced the same six simulated time horizons, reloaded
  the durable outbox at each one and verified all accepted checkpoint identities,
  ordering and queued states survived without duplicate browser pickup.
- An earlier isolated Goal/Plan/continuation/Discord regression group passed
  **547/547** tests (Goal-control 47 at that revision, Goal 150, input/Plan 223,
  continuation 112, Goal handoff 7, finish-input 5, Discord reliability 3).
  The three later Goal-control cases also passed on the final revision, and
  the full main Vitest suite covered all 50 Goal-control cases plus the
  bridge/manual-recovery, Discord and renderer translations.
- An HTTP bridge regression verifies that old objectives remain disarmed after
  a committed master Off, that a new explicit goal becomes armed across a
  durable objective-ledger reload, and that a later per-chat Off still wins.
- Root and Discord TypeScript checks passed after installing independent
  worktree dependencies. A production source build succeeded.
- Deployment verification's 11 local tests passed. It does not exercise a live
  production reboot, privileged VPS restore or real multi-day runtime.
  The same 11 tests passed again after integrating the newer fork `main`,
  including its installation and Discord changes.
- An initial `verify:headless` attempt was blocked by the host's missing Xvfb.
  Xvfb was subsequently obtained and extracted **without installing
  a system package** into a separate folder. The rebuilt Electron headless
  smoke passed under private Xvfb, checking authenticated loopback API, zero
  BrowserWindows, isolated profile, graceful SIGTERM, and credential cleanup.
  The optional private Brave-profile smoke also passed: profile persistence,
  same-profile handoff, owned process-group stop, and restart. Neither connected
  to a ChatGPT account, the shared browser, or production services.
  After the final Goal/status changes, `npm run build` and
  `verify:headless` were run again and both passed with private Xvfb and
  private Brave on the final source revision.
- **Final `npm run verify:ci` passed**: 8,766 tests passed, 140 skipped,
  zero failures across 347 test files (333 passed files, 14 skipped files).
  The follow-on `test/mcp-shutdown.test.ts` passed 6/6 and platform-specific
  `test/computer.test.ts` skipped 22/22 on this Linux host. Root/Discord
  TypeScript, privacy and third-party notices also passed. A prior full run
  had one `renderer-state.test.ts` settings-save timing failure (8,751 pass),
  which passed alone; the complete suite subsequently passed on the recovered
  implementation and again on the final source revision.
- **Post-main merge verification also passed** on the integrated branch at
  `3ec497d5`: `npm run verify:ci` finished with 333 passed files,
  14 skipped files, 8,766 passed tests and 140 skipped tests; the chained
  shutdown suite passed 6/6 with 22 host-dependent computer tests skipped.
  `npm run build` exited zero, followed by `verify:headless` with private
  Xvfb and Brave, which exited zero and independently passed backend shutdown,
  browser-profile handoff and restart. These were isolated tests, not
  live-provider or production-environment validation.

These tests establish specific corrected persistence and admission failures,
not a full end-to-end proof against every provider outage, browser reconnect,
worker crash, or multi-day leak. Master Off is fenced across the ledgers;
other app-wide configuration and provider-secret cross-ledger transitions remain
unverified as noted in `AGENTS.md` §21. Real 24/48/72-hour soak testing and
live signed-in browser recovery were intentionally not run on the shared VPS.
The existing Goal reply ledger also has an intentional 12-hour automatic
pickup safety deadline and a 200-pending-obligation admission cap. A pending reply that expires
cannot be silently auto-sent a day later; a deliberate user activation is
required to rearm a retained exact reply. This deadline means an unattended
task disconnected continuously for more than 12 hours is **not** guaranteed to
resume automatically. The revised status projection now explicitly reports
that blocker and the requirement to resume manually. Live signed-in browser
recovery and simultaneous provider-secret rotation with an in-flight Send
remain unverified.
