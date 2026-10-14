# Long-running logical session reliability

Implementation review: 2026-10-13. Target: one saved task across many provider turns,
reconnections, backend restarts and Compact & Resume transactions. Simulated elapsed time
is explicitly separate from wall-clock authenticated provider acceptance. No production
account, installed service, secret or external deployment was changed.

The October 14 follow-up preserves these improvements and adds durable confirmed-deletion
handling and asynchronous publication fences. Its separate evidence, verification results,
limitations and staged VPS procedure are in [the recovery follow-up](long-session-recovery-2026-10-14.md).
The October 13 validation results below describe that earlier environment and revision.

## Research and root causes

All nine primary upstream reports were reviewed against this fork's implementation and tests.
Issue state is the state observed during this review, not a claim about future upstream changes.

| Primary source | Finding in this checkout |
| --- | --- |
| [#1402: 24-hour experiment](https://github.com/totec448-spec/chat-on-steroids/issues/1402) | Lost browser streams may coexist with server-side tool work. The proposed 30-minute rotation is a small-sample experiment, not a published provider limit. Rotation Stop can collide with compaction. No timed rotation is enabled. |
| [#1405: delivery timeout](https://github.com/totec448-spec/chat-on-steroids/issues/1405) | Recovery must preserve the saved task and independently check Goal/Loop or automatic Continue authority. A delivery timeout is not an accepted Send receipt. Existing durable outbox ambiguity fences remain authoritative. |
| [#746: durable continuation ownership](https://github.com/totec448-spec/chat-on-steroids/issues/746) | Existing Goal reply obligations, input receipts, request-to-turn identity and continuation WAL already separate the owners. No new controller/store was added. A missing in-memory silence watch after restart was still reproducible and fixed. |
| [#1399: Stop + Continue](https://github.com/totec448-spec/chat-on-steroids/pull/1399) | This is a reviewed upstream PR, not a merged fix copied into this branch. A reload can remint a generation for the same question; bridge/input recovery was incorrectly requiring MCP proof only on that new generation. The fork already had a question-level proof helper but most gates did not use it. Preserving an error page must still reload when Continue is Off, as the upstream review points out. |
| [#336: stuck recovery](https://github.com/totec448-spec/chat-on-steroids/issues/336) | Closed upstream via #389. This fork already has durable queued/Goal pickup budgets: three retries after 2/5/10-minute waits, then a visible actionable stop. Existing bounds were retained and exercised. |
| [#786: extended reasoning](https://github.com/totec448-spec/chat-on-steroids/issues/786) | Closed upstream via #793. Content already deferred the ten-minute stall for exact non-Pro deliberate reasoning, but the bridge still expired its independent generic silence watch. Exact fresh evidence now reaches that owner; pending page tools also veto the generic content stall. |
| [#207: sessions across conversations](https://github.com/totec448-spec/chat-on-steroids/issues/207) | Closed upstream as not planned, but this fork already implements same-session A-to-B continuation. Existing lineage, worker/objective migration, WAL recovery and superseded-conversation fences were retained. |
| [#1128: delayed compaction ownership](https://github.com/totec448-spec/chat-on-steroids/issues/1128) | Closed upstream via #1132. The current continuation owner already persists a dispatched resume gate. Expiration cannot reopen a possibly sent task. Existing deterministic coverage was retained. |
| [#1406: recording capacity](https://github.com/totec448-spec/chat-on-steroids/issues/1406) | The shared 2 GiB asset quota can reject overflow text as well as images. Successful tool work must stay successful, but local history can become incomplete. The earlier behavior emitted repeated warnings and did not expose a durable blocker. |

The concrete wrong boundaries were:

1. `bridge.ts::silenceSourceCurrent`, `silenceContinuationAllowed`, `inspectSilentChats`
   and `input.ts` recovery gates discarded same-question execution proof after a remint.
   `store.ts::questionHasMcpCall` now performs one bounded-buffer reverse scan, restricted
   to the current conversation and this or earlier anchored generations. This is execution
   evidence, never proof of final response identity or provider cancellation.
2. `/activity` restored the recorder after restart but only restored recovery debt after
   explicit page dismissal. `startBridgeOnce` and `restoreReturnedPageActivity` now rebuild
   watches from saved unfinished work. Repeated ordinary polling cannot resurrect an expired
   watch; explicit Stop, block, departure and verified final remain vetoes.
3. `content.js::deliberateTurnLive` had native evidence that never reached the bridge.
   `reasoningTurnLive`, background `activity`, bridge `/activity` and the existing
   sweep now share fresh exact evidence. The 90-second expiry is evidence freshness, not a
   longer task timeout. Losing it cannot generate `turn_end` or authorize a Send.
4. `background.js::performBrowserRepairs` always reloaded silence repairs, even when a
   preserved transport-error page could feed the existing Stop + Continue path. The exact
   repair claim now carries its Continue-policy verdict. Preservation spends no new Send
   authority; a fresh repair acknowledgment time supplies the existing listening window.
5. `store.ts::applyToSummary` previously lacked a persisted history-loss fact.
   `recordingIncompleteAt` records committed missing text/preview, survives reconstruction
   and restart, and reaches backend health and Discord status. Goal/Loop drafting, finish
   followups and synthetic Continue refuse to reason from that missing record.

## Ownership and evidence boundaries

| Fact | Authoritative owner | Recovery consequence |
| --- | --- | --- |
| Saved objective, mode and owed reply | `goal.ts` durable ledgers and control journal | Failures preserve intent; a failed decision is not task completion. |
| Browser Send claim, authorization and exact receipt | `session/input.ts` durable outbox | A never-dispatched claim can transfer. A spent Send authorization cannot be repeated after restart or a missing acknowledgment. |
| Exact request, executed tool and response generation | correlation, recorder, store and running-call owner | Continued exact MCP work overrides a false early end. A lost result never grants tool replay. |
| Current document and native unfinished reasoning | content/Fiber → background → bridge activity grant | Fresh exact evidence defers one existing sweep. A connected browser or native Stop alone is insufficient. |
| Browser repair action | bridge repair claim and exact document checks | Reload/preservation proves only the action, not recovered provider execution. |
| Same-session conversation transition | `session/continuation.ts` WAL and resume gate | Old conversation authority retires only at the durable commit; ambiguous resume Send remains spent. |
| Worker family and outstanding assignment | agents/broker ownership | Recovery and compaction retain identity; the timer cannot create a second assignment. |
| Incomplete recording | existing session summary derived from committed rows | Missing history remains incomplete after freeing space. No automatic deletion or quota increase. |

Transport loss, delivery rejection, provider history backoff, rate limits, expired login,
page departure, verified final and uncertainty retain their existing distinct classifications.
Continue/Goal pickup and helper retry budgets remain bounded. Retry-After and existing cooldowns
remain in force. No silence timer is evidence that the provider ended a request.

The optional summary/status field is backward compatible: old metadata and older extensions
remain readable. Its absence in legacy metadata does not certify complete history; this change
does not scan and retroactively certify every old recording. The marker has no automatic clear
operation. Locally reconcile the exact missing checkpoint, then begin a new task with complete
history. Keep the old record and uncertain receipts for audit.

## Rotation decision

Rotation is disabled; no new setting or competing continuation path is exposed. Before an
opt-in 25–30-minute experiment can be implemented safely, live evidence must establish all of:

- Stop ends the exact previous provider execution, including late server-side MCP admissions.
- No active tool or worker side effect can overlap the new provider request.
- A native final or cancellation observation survives lost streams and delayed documents.
- The existing outbox issues one continuation with an exact native receipt.
- A pending Compact & Resume transaction retains priority and its dispatched gate.
- Deliberate reasoning and Pro retain their model-specific evidence policy.

The present page and tool evidence cannot prove the first two conditions for a disconnected
provider. A timestamp, vanished Stop button or idle composer would be unsafe substitutes.
Existing worker/compaction collision tests cover current authorities; they are not rotation
tests and do not demonstrate safe rotation.

## Deterministic verification

The added bridge regressions reproduced four failures before production fixes: normal restart
recovery for Goal and Loop, same-question remint, and uninterrupted exact native reasoning over
24 simulated hours. They pass after the changes. Negative cases exclude a new question and
retain existing expired-watch/Stop behavior. Startup recovery also passes before any page poll.

The repeatable combined test runs 4, 8, 12 and 24 simulated hours with a fake Date clock and
real temporary store/outbox/recorder/bridge/continuation owners. It covers 96 receipt-confirmed
continuations, 24 running-state resets and 12 compactions. It injects stream loss while exact
MCP work continues, observes delayed canonical finals, restores queued and claimed inputs,
fences the old claimant, restores dispatched authorization without another Send, joins the
native user echo to one input-history row, and checks the same local session/objective after
each transition. This is event-order simulation, not real server-side execution or a 24-hour
wall-clock test. Its 30-minute synthetic turn length is test cadence, not a rotation policy.

```sh
COS_TEST_WORKERS=2 npm test -- --run test/bridge.test.ts \
  -t 'simulated hours of receipts|native long reasoning|at service startup before'
COS_TEST_WORKERS=2 npm run verify
npm run build
npm run discord:build
npm run verify:deployment
COS_SMOKE_BROWSER=/usr/bin/brave-browser npm run verify:headless
```

Adjacent coverage is retained in `session-input*`, `input-delivery-integration`, `goal`,
`session-response-identity`, `session`, `mcp-inflight`, `continuation`, `resume`, `extension`,
`content-script`, `conversation-load-failure` and the Discord/control API suites. These cover
delivery failures, false early ends, running calls, authorization loss, late exact finals,
rate limits/Retry-After, missing login, history-loading limits, compaction/worker collisions,
uncertain receipts and pickup exhaustion. New extension tests distinguish preserved error
pages from Recovery Off reloads. A sparse-file quota test reaches the actual global capacity,
keeps the recorded successful tool outcome and one event, checks warning deduplication and
restores the durable marker. Goal and Loop both reject missing-history decisions before
calling a provider while retaining their objective and enabled mode.
Additional race tests discover missing history after Continue was queued or claimed and
after a Goal/Loop decision was requested. Final authorization and decision publication
refuse that new evidence; even a late provider "stop" cannot falsely complete the task.

Final `COS_TEST_WORKERS=2 GITHUB_ACTIONS=true npm run verify` exited 0: 8,436 tests passed,
162 skipped by platform/live guards, with no test retries enabled. Root/Discord type checks,
privacy and notice checks passed within that command. Root/Discord production builds, the
34-command Discord reference check, all 11 deployment drills and isolated Electron/Xvfb/Brave
smoke also passed. Full command outcomes and intermediate failures are recorded in
[headless-validation](headless-validation.md).

## Recommended headless setup

Use the existing Ubuntu 24.04 amd64 deployment, unprivileged service users, private graphical
Brave profile on Xvfb and authenticated loopback control API. Preserve approved folders and
Discord per-user/session grants. Sign-in, keyring unlock and provider approvals stay interactive.
Use a saved per-chat objective and explicit Goal or Loop mode. Keep automatic Continue on for
authorized unattended transport recovery; explicit Off remains Off. Pro/Astra defaults to
finish-based continuation; choose after-turn behavior deliberately for the task.

Keep recording on and automatic compaction at the existing 400,000 estimated-token advisory
threshold initially; this estimate is not the provider's context limit. Adjust from measured
account/model evidence, not the 30-minute anecdote. For the initial soak, set both
`multiAgent.maxWorkers` and `multiAgent.globalMaxWorkers` to 2; the existing global default of
0 preserves uncapped cross-family admission. Raise only after observing memory, account limits and tool
contention. Check recording quota, filesystem bytes/inodes and health before starting. Back up
before image cleanup or explicitly deleting reviewed inactive recordings. Never remove replay
fences or uncertain history to create space. A service health check cannot certify task delivery.

## Real VPS soak and acceptance gates

All live gates below remain pending. Run on a disposable VPS and the operator's authorized
account before daily unattended use. Keep private receipt/history artifacts locally; publish
only redacted summaries.

1. Install the reviewed build through the existing maintenance procedure. Pass root/Discord
   builds, deployment drills and isolated Electron/Xvfb/Brave smoke. Verify authentication,
   action grants, profile ownership and interactive provider login. Do not reuse production
   tasks for fault injection.
2. Save one bounded objective with observable checkpoints and an isolated approved workspace.
   Use harmless, uniquely labeled test writes; count their execution separately from provider
   Send receipts. Record local session, current conversation/generation, pending input ID,
   exact MCP request IDs, worker assignments and compaction ticket through existing status,
   history and operation views. Do not add synthetic completion evidence.
3. Run staged 4-, 8-, 12- and 24-hour wall-clock Goal and Loop trials across ordinary and
   deliberate/Pro modes, with zero and two workers. Record meaningful-work time, completed
   checkpoints, Send receipts, compaction count, quota bytes/inodes and attention episodes at
   each checkpoint. Confirm new native `reasoningTurn` evidence on the real signed-in page.
4. Between safe checkpoints restart the backend and bot separately, restart the dedicated
   browser, and reconnect a worker. Interrupt only the isolated browser stream while keeping
   the backend available, then inspect exact MCP work. Do not replay operations or assume Stop
   cancelled a provider request. Compare current source ownership before and after each fault.
5. Trigger Compact & Resume through its existing owner. Delay its browser pickup, restart
   during the queued and dispatched phases, and confirm one committed successor with the same
   session, objective, project and worker family. The old page must not admit new conflicting
   work. Observe delayed finals and provider receipts before judging completion.
6. Exercise Recovery Off and Stop vetoes. Inspect a naturally occurring rate limit/history
   restriction or expired login without provoking or bypassing provider limits. For storage,
   use a separate isolated data directory; confirm health/status and `recording_incomplete`
   instead of saturating the production volume. Persistent faults must show a reason and
   converge to bounded retry exhaustion or user action with saved intent intact.
7. Accept each duration only when every authorized instruction has one receipt/history owner,
   no test side effect occurred twice, no pending continuation vanished, no timer invented
   completion, workers retained assignments, and every unresolved episode has a specific
   actionable blocker. Inspect provider-side work after stream loss; an unavailable receipt
   leaves that trial unresolved. Reboot/systemd lifecycle and a seven-day soak remain separate
   rollout gates in [reliability-rollout](reliability-rollout.md).
