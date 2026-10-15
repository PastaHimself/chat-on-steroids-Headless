# Headless identity and delivery recovery implementation plan

**Goal:** Preserve exact response evidence across observation interruptions and make Discord opening delivery inspectable without changing send authority.

**Architecture:** Keep continuation custody in the existing WAL, canonical messages in the store, and all Discord delivery in the existing input outbox. Recover a missing handoff final owner only from an independently recorded completed boundary naming that exact native final UUID, within the exact authored handoff interval. Never infer ownership from chronology alone.

**Constraints:** Development checkout only; no production access, deployment, release, merge, force push, ledger edits, tool replay or blind message resend. Existing persisted formats must remain readable. Execute inline under the user's explicit authorization.

## Response evidence

- [x] Add failing shipped-content regressions for ownership loss/conflict and text-final boundary identity.
- [x] Add failing recorder/bridge regressions for exact native-final recovery, restart, late evidence after pickup exhaustion, conflicts, and repeated reconciliation.
- [x] Publish the preserved message owner and the native terminal UUID from the existing completion owner.
- [x] Resolve an unidentified final only when the independently recorded terminal UUID proves exactly one generation. Preserve every existing capture fence and refusal.
- [x] Run content, recorder, chronology, continuation, bridge and Goal/worker continuity suites.

## Discord delivery

- [x] Reproduce `/status` failing on the provider-dependent workers read before initial binding.
- [x] Test queued, claimed/pre-Send, authorized/unconfirmed, bound-awaiting-receipt, confirmed and failed opening status.
- [x] Skip provider-only reads for an unbound local session and project existing input proof into actionable status/history diagnostics.
- [x] Verify admission, binding, late ACK and restart at-most-once behavior with the real outbox suites; investigate any actual dispatch failure before changing retries.

## Validation and review

- [x] Run targeted Vitest tests, `npm run verify`, application and Discord builds, `verify:headless`, and `verify:deployment`.
- [x] Record actual results, unresolved production hypotheses, live authenticated acceptance scenarios, and stopped-stack rollout/rollback guidance in a focused worklog.
- [ ] Review the complete diff against main, commit, push one development branch and open one PR to main.
