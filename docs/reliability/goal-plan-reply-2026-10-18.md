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

The fixes use the existing Goal reply ledger and durable writer. They do not
add a watchdog, a second state machine, another outbox, or a new retry loop.

## Evidence and limitations

- Both regressions failed before their corresponding fixes and passed after.
- `test/goal-control-race.test.ts`: 40 tests passed, including deterministic
  4-, 8-, 12-, 24-, 48- and 72-hour simulated clock advances. Every step
  accepted one current reply and reconstructed state from the saved snapshot.
- Plan queue regression advanced the same six simulated time horizons, reloaded
  the durable outbox at each one and verified all accepted checkpoint identities,
  ordering and queued states survived without duplicate browser pickup.
- Adjacent suites: Goal 150, input queue/Plan 222, continuation 112,
  Goal resume handoff 7, and finish-input integration 5: all 496 passed.
- Root and Discord TypeScript checks passed after installing independent
  worktree dependencies. A production source build succeeded.
- Deployment verification's 11 local tests passed. It does not exercise a live
  production reboot, privileged VPS restore or real multi-day runtime.
- `verify:headless` cannot run on this development host without the missing
  `Xvfb` executable; its private display wait timed out before application boot.

These tests establish two corrected persistence failure modes, not a full
end-to-end proof against every provider outage, browser reconnect, worker crash,
or multi-day leak. The existing master/config/secret cross-ledger transaction
gap in `AGENTS.md` §21 remains open. Real 24/48/72-hour soak testing and
live signed-in browser recovery were intentionally not run on the shared VPS.
