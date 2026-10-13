# Compact & Resume source recovery investigation

## Scope and evidence boundary

This change investigates automatic compaction in an isolated checkout based on main
`a0713ea91d4209b95b789cc5985f816536d6a96d`. It does not access or modify the production
VPS, its active conversation, its repository workspace, or its provider account.
All incident reproduction and recovery evidence below is deterministic simulation,
real loopback HTTP, and temporary-file ledger restoration. It is not a verified live recovery.

The initial report described a completed local tool, a delivery timeout, no proven active
turn, and an unsent automatic handoff. Later evidence showed five asking pickups with
browser acknowledgments, followed by compaction-owned silence and an automatic backoff.
Those acknowledgments disprove a claim that the scheduler never ran throughout the incident.
They prove a browser action or accepted page nudge; they do not prove source Send, native
result receipt, summary generation, account authentication, or a replacement conversation.
The exact native preparation failure on the VPS remains unverified.

## Traced ownership and checkpoints

| Boundary | Owner and evidence | Recovery limit |
| --- | --- | --- |
| Threshold admission | bridge `considerAutomaticCompaction`, durable current session, eligible model/role and exact live work | One continuation token for the durable session |
| Source preparation | content `startCompact` / `stopAndSettle`: original question/document, visible editable composer, actual local execution drain and native connector-result receipt | Existing bounded hydration/result/Stop waits; no replay of tools |
| Source Send | continuation `beginContinuationSourceSendNow` then `dispatchContinuationSourceSendNow` | `not-attempted` / `attempted-unresolved` remain pre-dispatch; `dispatched-unresolved` is possibly delivered |
| Acceptance and summary | exact marked source user-message identity; native response or recorder `readHandoffResponse`; bounded `attachSummary` provenance | Missing receipt never authorizes another Send; convenient assistant text cannot substitute |
| Browser pickup | bridge `inspectOwedCompactions`, background exact-document repair claim, content `resumePendingCompactionFromRepair` | Asking: five attempts per burst, two slower extra bursts; writing/opening: three; `resumed` acknowledges a nudge |
| Destination handoff | existing command/document claim and destination Send checkpoints; exact bootstrap marker | An ambiguous destination cannot be retyped or reopened as a fresh send |
| Commitment | continuation WAL intent, durable session metadata A-to-B rebind, existing projection repair | Preserve durable session/history/project/cwd/Goal/workers/receipts; no rollback after rebind |

## Confirmed defects and focused changes

1. **Unresolved turn used as permanent source-work proof.** The asking scheduler used
   `sessionInputActivity().exact`. That input-safety projection includes any recorder live
   `activeTurnId`, even after the meaningful-work lease has expired. Ordinary silence and
   assistant-error recovery yield to the compaction, so a source that never reports its end
   can permanently prevent the compaction owner's own pickup. Reproduction also retains a
   prior `completed` outcome while the current unresolved generation is stale: controls report
   no proven active turn, local calls are drained, and the handoff remains unsent. Pickup now
   defers for the existing bounded work/native-reasoning lease and actual running-call barrier.
   Native Stop/Send receipt and identity checks remain in force independently.

2. **Pickup budget refunded on backend restart.** Counts, slower bursts, deadlines and the
   exhaustion notice lived only in `compactionWatch`. They now belong to the existing
   continuation WAL. The bridge remains a projection; custody is written before browser work
   and rechecked after the write. Schedule changes do not renew the handoff lifetime.

3. **Cross-token eager WAL snapshots could undo send fences.** Per-token checkpoint locks did
   not serialize construction/publication of the shared whole-ledger snapshot. A second token's
   pickup write could restore another token's old pre-dispatch checkpoint on disk. The failing
   disk regression observed `attempted-unresolved` after a successful dispatch. Foreground
   snapshot/write/publication now serialize at the existing continuation owner; background
   snapshots use the existing lazy durable projection API. No outbox or Goal redesign is involved.

4. **Source refusal and exhausted custody lacked persistent actionable status.** Automatic
   hydration or native receipt/Stop refusal previously remained browser-local while the ticket
   survived. The exact pre-Send token can now report that bounded diagnostic into its existing
   error field without aborting, stopping, dispatching, or spending the prompt. A new source-send
   claim clears obsolete refusal. Late reports after dispatch are rejected. Exhausted writing
   and an ambiguous destination without transport show a persistent blocker in status, desktop
   controls, and the companion, with sign-in/source-response inspection guidance. Late exact
   commitment clears the blocker. Existing waiting-for-browser presentation remains intact.

The new production pickup/backoff logs are compatible with preparation refusing to reach Send.
They do not identify which native check failed. The new source diagnostic distinguishes that
case from scheduling starvation on future observations; this PR does not claim it establishes
that an account was signed in or that the live session recovered.

## Regression evidence

Fail-first runs demonstrated:

- No pickup for a completed exact tool followed by a delivery timeout and stale current turn,
  both before and after continuation/session restoration and historical source adoption.
- A fourth writing pickup after restart despite the three-attempt limit.
- Browser work newly admitted while its durable pickup reservation was suspended.
- Another token's pickup snapshot rolling a dispatched source back on disk.
- No actionable status for an unresolved destination receipt.
- Missing source preparation diagnostic at both the page and backend boundary.
- Missing forwarding of the new diagnostic checkpoint by the background worker.

Positive and neighboring tests cover fresh ongoing progress, running-call custody, exact native
result receipt, duplicate/foreign/missing receipts, no source/destination resend after ambiguous
dispatch, no extra destination before capture, pickup CAS/disk failure, unchanged manual TTL,
late commitment, persistent Goal objective/mode, durable current session identity, and existing
4/8/12/24-hour continuity simulations with worker/workspace/input receipt preservation.

## Validation

| Check | Final local result |
| --- | --- |
| Complete `npm run verify` | Exit 0: 8,475 passed, 159 platform/opt-in skips across both configured passes; no retries enabled |
| Privacy / notices / native sources | Passed: 162 production packages, 7 catalog entries, 730 pinned native source archives/patches, 26 Discord packages |
| Main and Discord type checks | Passed |
| Application and Discord builds | Passed |
| Discord command reference | Passed |
| Continuation suite | All 93 passed; commit-race fixture now awaits the actual held rebind boundary instead of assuming one microtask |
| Deployment shell syntax | Passed |
| Maintenance drills | 10 passed; 1 blocked by AF_UNIX socket denial |
| Official deployment / headless scripts | Blocked: unprivileged switch unavailable; Xvfb/xauth absent |
| `npm run verify:ui` | Attempted all 50; blocked by root Electron sandbox refusal / absent Chromium display prerequisites |
| Diff validation and independent code review | Passed; no remaining material defect found |

Native UI/headless checks and provider behavior are not inferred from passing unit tests or builds.

Local constraints: the runner is Ubuntu 24.04 / Node 24 in a managed root container. Official
unprivileged deployment/headless checks cannot complete here: `runuser` cannot set groups,
Xvfb/xauth are absent, and the encrypted backup drill's real AF_UNIX socket is denied by the
sandbox. Deployment shell syntax passes; 10 of 11 maintenance drills pass and the socket drill
is environment-blocked. These constraints are not treated as passing live deployment evidence.
The repository's Ubuntu CI headless job is the appropriate isolated platform check.

Verification runs use a temporary network-denial preload allowing only local endpoints.
Provider backends use synthetic test keys and fetch stubs. No provider/account action is
part of this verification. The local ripgrep fetch step uses its cached pinned archive with
`TAR_OPTIONS=--no-same-owner` because this root namespace cannot map the archive's upstream UID.


## 2026-10-13 follow-up: acknowledged pickups with no source Send

**Production report (not reproduced against the provider):** the existing Goal
session remained `handoff-pending` / `not_sent` after PR #5. The previous ticket was durably abandoned before Send when the
composer changed; its draft was preserved. The replacement ticket opened at 14:16:29 UTC with 415,811 context
tokens; pickups at 14:18:47 and 14:28:18 UTC were acknowledged, with an
assistant transport failure at 14:26:10 UTC. There was no proved source
dispatch, marked message, brief, or committed destination. ChatGPT also
reported temporary restrictions on conversation-history access.

**Verified source-code gap:** PR #5 persisted automatic preparation refusal
during hydration and `stopAndSettle`, but the following native
`runNativeCompaction.abandonBeforeSend` path still returned after errors
without forwarding the refusal: no handoff prompt, missing/remounted composer,
native editor insertion refusal, Send button not ready, or a native pre-Send
exception. The background worker had already recorded `resumed` as a successful
browser nudge, while the app's durable ticket had no source Send and no
diagnostic to distinguish a provider/editor refusal from a healthy recovery.
Repeated pickup ACKs were not a delivery receipt.

**Fix:** recoverable *automatic* refusals in that native pre-Send path now call
the existing bounded `sourcePending` checkpoint, retaining the original token
and recoverable custody. A conflicting user draft still retires only the
provably unsent ticket and preserves the human draft. Manual refusals retain
their existing immediate-abort behavior. Any step that crossed the exclusive
`sourceDispatch` boundary remains ambiguous and **never** reports itself
retryable; source identity, Stop, local-call drain, result receipt and
no-duplicate protections are unchanged. New page-level regression tests
exercise the shipped native function for missing prompt, composer unavailable,
insertion failure, disabled Send, draft ownership, manual refusal, and
post-dispatch ambiguity.

**Not verified:** the report does not establish which ChatGPT-native check
blocked the replacement ticket. If history restriction withholds the original
question, a writable composer, a native result, or the Send control, the app
must continue to refuse unsafe source Send. This patch improves durable
diagnosis and recovery of transient pre-Send refusal; it does **not** override
provider restrictions, confirm live Send/resume, or modify the VPS. A source
`sourcePending` error (or its absence) must be read with the exact durable
`sourceSend` state before any further conclusion. Source delivery and later
receipt remain separate facts.
