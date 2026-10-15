# Headless response identity and Discord opening diagnostics

## Scope and evidence

Inspected current Headless main `6c90894388c68ffcb7e3602ad7ce7cc9a97bab5a` in a new development checkout. Read `AGENTS.md` and the recent observation-custody/readiness fixes, including `58f3a9e8`, `d8b8fe26`, and `79099493`. No VPS, production service/profile/keyring, live ticket/outbox, project working tree, Goal or worker state was accessed. The supplied health/log excerpts are incident evidence, not proof that these source defects caused every reported occurrence.

Infrastructure availability, ChatGPT sign-in/model eligibility, browser command custody, provider conversation attribution, and message receipt remain separate facts. An empty recent log window cannot resolve an earlier incident. No live authenticated provider or Discord operation was performed.

## Confirmed defects and repairs

| Boundary | Deterministic defect | Repair |
| --- | --- | --- |
| Content message publication | `refreshFiber` computed a retained exact message `owner`, including sticky conflict handling, but emitted the transient `localOwner`. A later scan could lose the verified owner or publish a contradictory new claim. | Publish the computed owner. Content, activity, deduplication and Goal authority otherwise keep their existing rules. |
| Native completion checkpoint | `finishGeneration` retained the native terminal UUID only for an image terminal. Text completion discarded the independently observed identity that could connect a later ownerless final. | Retain the same native terminal UUID for text and image completions. Bridge parsing already validates this optional UUID and recorder/storage already support it. |
| Recorder duplicate end | The known-end replay guard discarded a later exact UUID enrichment of the same completed boundary. | Persist that enrichment once, preserving its original time/detail. A newer question/reopen, noncompleted end or conflicting existing UUID refuses enrichment. It emits no new activity verdict and duplicate proof adds nothing. |
| Handoff evidence reader | `readHandoffResponse` refused a missing final `turnId` even when the completed boundary independently identified that exact native final UUID. | Resolve capture-only identity from the current completed boundary's matching UUID. No historical event is reassigned and no live generation is invented. |
| Handoff lifecycle ordering | Presentation chronology can put a same-id app reopen ahead of an earlier end. Choosing the last presented boundary could treat the reopened response as completed. | Determine lifecycle by raw publication `seq`. Only its current completed segment can supply terminal proof. A pre-reopen final content revision cannot complete a reopened response. |
| Conflicting native final | A named final UUID could disagree with the completed boundary's terminal UUID and still pass. | Refuse contradictory positive UUIDs as conflicting finals. Legacy exact-turn capture without native UUIDs remains supported. |
| Discord read dependency | `/status` always requested `/workers`. The backend correctly rejects that provider-scoped read with `409 no_chat` for an admitted, unbound local session, preventing the remaining status from rendering. | Skip only that provider-dependent lookup before binding. Read and display the existing outbox state, proof, diagnostic and attribution. Empty `/chat`/history also explains the outbox evidence. |

The new failing-before tests were run before their corresponding repairs. Independent read-only review reproduced the stale/reopened final cases; their regressions failed before the lifecycle refinement and passed afterward. Negative tests cover positive owner conflicts rather than treating a missing owner as equivalent to a contradictory one.

## Exact identity and state-machine invariants

- Capture still requires the exact authored handoff token/message anchor, a bounded interval, exactly one response generation, a current completed lifecycle boundary, exactly one nonempty final, complete readable text and the existing minimum brief validation.
- A missing final owner can be resolved only by equality with the **current completed boundary's exact native final UUID**. Proximity, timestamps, one convenient active turn, the latest visible answer, page titles and trace presentation supply no identity.
- Lifecycle replay uses publication sequence. Earlier completed proof is retired by a same-id reopen, even if the reopen carries an older timestamp. Changed HTML or identity alone cannot refresh `finalContentSeq`.
- Multiple generations, conflicting finals, missing identity or terminal evidence remain unresolved under the existing bounded diagnostic codes. No validation, source-send checkpoint or pickup budget was disabled.
- `/events` and `inspectOwedCompactions` retain the existing late collection path after exhaustion/restart. Reconciliation stores one handoff and queues one replacement. The source remains current until the ordinary durable rebind commits.
- Proven unsent, dispatched/uncertain, sent and replacement-delivered states keep their existing distinct WAL rules. Missing ACKs grant neither a second Send nor manual commitment. No continuation, Goal, worker, tool execution or outbox authority was added.
- The recorder's reconciliation version is 23; background maintenance can replace a healthy older recorder using its existing reinjection owner. MAIN/Fiber remains version 22; bridge protocol and application/extension release versions are unchanged.

## Discord lifecycle and remaining uncertainty

The traced path is Discord authorization and durable interaction UUID → remote operation fence → `sendDesktopInput`/durable input admission → reserved local session → asynchronous connector/browser startup → `/status` input offer → exact browser/document claim → durable Send authorization → native provider conversation/message receipt → exact opening bind → receipt/history publication. `/new` correctly returns admission before the provider conversation exists.

Status now distinguishes queued/no browser claim, browser claimed before authorization, tool-recipient or after-turn/finish waiting, potentially delivered/unconfirmed Send, confirmed receipt, terminal non-delivery, retained startup error and provider attribution. Checking status/history never mutates or retries delivery. A late receipt can still settle the original UUID through the existing outbox; an uncertain request is never reissued by these changes. Provider-bound worker lookup resumes once the local session has a conversation id.

No independent source reproduction proved that the incident's opening stalled in dispatch, lost its browser claim, failed sign-in/model selection, or lost a provider receipt. Its `pending` admission followed by `no_chat` is compatible with an opening still awaiting provider creation. The source-confirmed defect was that status hid the distinction. The exact production phase remains unknown without private read-only outbox/operation and paired-browser evidence. No existing request was retried to investigate it.

There remain deliberate fail-closed limits: a legacy ownerless final without an independently recorded current native-terminal UUID cannot be reconstructed; a prior interrupted/stalled/unknown lifecycle end is not upgraded merely because prose looks complete. The existing exact Thinking-failed recovery rule is unchanged. This repair handles a completed generation interrupted in observation/transport, not every possible uncertain provider verdict. Such cases retain their diagnostic and custody rather than acquiring Send or generation authority.

## Files and functions

- `extension/content.js`: `refreshFiber`, `finishGeneration`, `RECORDER_VERSION`.
- `extension/background.js`: `PAGE_RECORDER_VERSION` for existing recorder restoration.
- `src/main/session/recorder.ts`: `recordChatObservationsNow`, completed-boundary UUID enrichment.
- `src/main/session/store.ts`: `readHandoffResponse`, publication-order terminal validation and exact UUID recovery.
- `discord/src/bot.ts`: `DiscordController.statusPanel`, `historyPanel`.
- `discord/src/ui.ts`: read-only `inputDeliveryDescription`.
- `test/handoff-generation-identity.test.ts`, `test/content-script.test.ts`, `test/bridge.test.ts`, `test/discord.test.ts`, `test/extension.test.ts`: new regressions and recorder-version fixture alignment.
- `AGENTS.md`, this engineering report and the focused implementation plan: contracts, evidence and acceptance limits.

## Regression coverage

| Required scenario | Automated evidence |
| --- | --- |
| Normal Compact & Resume and valid generation | Existing bridge capture/continuation suites; new legacy exact-turn capture case. |
| Required `turnId` missing | New absent/mismatched/unnamed-boundary refusal cases; exact-current-UUID positive cases. |
| Active browser reload | Existing content recorded-turn/question adoption and recorder canonical-final recovery fixtures. |
| Extension reload during recording | Existing orphan retirement/reinjection fixtures; new v22 replacement and ownership-loss/conflict cases. |
| Backend restart between source Send and capture | Extended real bridge test restores sent continuation WAL/session/recorder before exhausting pickups and receiving the final. |
| Independently verified durable reconstruction | New matching-terminal UUID cases, including cold restart and late exact enrichment. |
| Genuine ambiguity | Missing proof, conflicting UUID, two generations and newer-question negative cases. |
| Multiple generations for one prompt | Existing bridge Retry/regenerate refusal plus new conflicting-generation test. |
| Stale assistant final | New named/ownerless terminal mismatch, still-open reopen, older timestamps and pre-reopen content cases. |
| Final after pickup exhaustion | Both ordinary exact-turn and restarted native-UUID recovery collect after 3/3 without another reload. |
| Repeated reconciliation | Same handoff id/one resume command, and duplicate enrichment writes nothing. |
| Discord admitted/not dispatched | Controller queued status cases plus existing real reserved-session/outbox admission tests. |
| Browser claim delayed/unavailable | Existing desktop-input maintenance election/readiness fixtures; claimed-before-authorization diagnostic. |
| Provider creation ACK delayed/lost | Existing content exact opening receipt/bind and opening-input uncertain/late receipt tests. |
| Temporary `no_chat` | New unbound status cases reject the provider-only mock read and verify it is never requested. |
| Eventually attributed/committed | Existing opening-input exact owner/binding/ACK/history and Discord durable session mapping tests. |
| Crash/uncertainty at-most-once | Existing opening-input, remote-operation and extension command/journal custody tests; status/history assert no action call. |
| Goal and worker continuity | Existing continuation, Goal-resume, project-successor, swarm and simulated 8/12/24-hour bridge cases. Transfer code is unchanged. |

## Validation

Final validation completed successfully on the development Linux container:

| Check | Actual result |
| --- | --- |
| `TAR_OPTIONS=--no-same-owner COS_TEST_WORKERS=4 npm run verify` | Passed: 8,652 tests; 159 platform/opt-in skips. The main stage passed 8,646 and the serialized shutdown stage passed 6. Privacy, dependency notices/native-source inventory, app/Discord types and Electron resolution passed in the same pipeline. |
| Latest `handoff-generation-identity.test.ts` | 23/23 passed, including the final positive fresh-content-after-reopen/restart case added after full-suite collection. |
| Real bridge restart/exhaustion recheck | Both ordinary and native-UUID modes passed; one source checkpoint, one captured handoff, one replacement command. |
| `npm run typecheck` | Passed independently on final production code. |
| `npm run build` and `npm run discord:build` | Both passed on final production code. |
| `node --check` on changed extension scripts; `git diff --check` | Passed. |
| Independent code review | No remaining merge-blocking finding; reviewer independently ran 22/22 identity tests before the last positive case. |

Earlier checkpoints included 460/460 targeted tests and a full run of 8,642 passing tests before final review regressions. Fail-first runs observed ownership, native terminal identity, exact recovery/enrichment, stale/reopened proof and Discord status/queue diagnostics fail before their corresponding repairs.

Environment-specific results remain distinct from test success:

- Default `npm run verify` stopped in ripgrep extraction because this container cannot apply the archive's UID/GID. `TAR_OPTIONS=--no-same-owner COS_TEST_WORKERS=4 npm run verify` runs the unchanged verification pipeline with safe local extraction and bounded workers.
- `verify:headless` and `verify:deployment` were invoked and refused root execution as designed. This container cannot switch groups to an unprivileged account and has neither Xvfb nor Brave. No guard was bypassed.
- Deployment shell syntax passed for all eight scripts; both changed extension scripts pass `node --check`.
- The maintenance fault drills ran: 10 passed; the encrypted-backup drill errored because this environment denies creation of its temporary Unix socket (`EPERM`). The production backup mechanism was not exercised or modified.
- Standard suite skips include Windows/native desktop, WSL, macOS and opt-in live plugin probes. No authenticated ChatGPT, real Discord transport, installed systemd lifecycle, packaging/release, reboot or long authenticated soak is implied.

## Backward compatibility

No new durable file, required field, format version or ledger migration is introduced. `providerMessageId` was already optional on assistant and completed-turn events and validated on both bridge ingress paths. Old exact-turn records continue to capture; old records with insufficient evidence remain unresolved. Raw history, local session id, project ownership, accepted queue entries, Goal intent, worker families and terminal custody are preserved. New UUID-enriched boundaries remain ordinary legacy-readable `turn_end` events. The recorder-version bump coordinates reinjection only and grants no browser action.

## Live acceptance, rollout and rollback

Before production adoption, use a separate disposable Ubuntu 24.04 installation, dedicated Brave profile and authenticated test account. Record code/extension revision, time and exact private receipt identities for each drill:

1. Complete a synthetic Compact & Resume normally; verify one source Send, one captured brief and one replacement Send/rebind with the same local session/project/Goal/worker family.
2. Repeat with a browser reload, extension reload, and backend restart independently during handoff writing. Verify generation identity/terminal UUID survives or remains safely diagnosed; no second source Send occurs.
3. Deliver complete evidence after writing pickups exhaust; verify one capture/command. Inject a different generation/UUID, same-id reopen and stale final; verify safe refusal.
4. Run Discord `/new`, inspect status before claim/binding, delay browser readiness/model selection, then inspect the exact native receipt and local recorded history. Suppress/delay receipt transport and restart the backend/bot: no duplicate Send may occur, and a late exact receipt must settle the original operation.
5. Verify Goal and worker work is retained through replacement, at-most-once local tool execution, and the existing authenticated 4/8/12/24-hour soak. Successful service health alone does not pass these gates.

Rollout is operator-only after review and acceptance: build/verify as the ordinary SSH user; use the documented stopped-stack encrypted matching code/data/profile/keyring/bot/project backup; install via `deploy/install-ubuntu.sh --update`; explicitly start `cos-headless.target`; verify extension bytes/reinjection and the exact test operation receipts. Inspect existing unresolved tickets read-only first. Do not resend them, clear ledgers or manually commit a continuation. See [reliability rollout](reliability-rollout.md#local-update-backup-and-restore) and [Headless updates](headless-vps.md#8-backups-and-updates).

Rollback also follows the maintenance helper and format-floor checks, with services stopped. Retain the current evidence and prior verified code/units. Prefer compatible code rollback preserving current ledgers; if matching encrypted code/data restoration is required, retain the recovery hold and reconcile all potentially executed work since the snapshot before an explicit release/start. Never replay the restored pending outbox or remove receipt fences to make it appear healthy. This branch performs no rollout or rollback.
