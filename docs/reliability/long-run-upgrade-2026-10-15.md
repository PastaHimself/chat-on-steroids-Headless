# Headless long-run reliability upgrade — 2026-10-15

Development targets `PastaHimself/chat-on-steroids-Headless:main`. Upstream was read only.
Production investigation used read-only SSH diagnostics. No deployment, service restart,
configuration change, session repair, queue rewrite or provider prompt was performed on the VPS.

## Evidence and implemented fixes

| Boundary | Confirmed failure | Change and regression evidence |
| --- | --- | --- |
| Plugin request → client lifetime | A real SDK timeout/abort returned `RequestTimeout` and marked the whole plugin unavailable despite a concurrent successful call. | Keep the healthy connection ready; return `PLUGIN_CALL_TIMEOUT`, preserve uncertainty, never replay. Real stdio subprocess tests check cancellation notification, one dispatch, successful sibling/next call, and fatal handling of actual disconnects. |
| Shared Git admin directory | Six worker allocations/removals ran Git worktree mutations concurrently in the same common directory. Git can observe another allocation before its `commondir` exists. | Serialize changes by canonical common Git directory; failed operations do not poison the queue. Recheck managed ancestors after waiting and perform removal ownership/content checks inside the repository fence. Real Git regression observed peak overlap 6 before, 1 after. |
| Provider restriction → backend restart | A process reset lost the newest history Retry-After; duplicate notices coalesced, so recorded cards could not restore it. | One versioned `provider-history-backoff` ledger owns exact per-chat deadlines. Persist before HTTP acknowledgment, retain the restrictive memory fence on disk failure, replay persistence, restore before bridge traffic, and fail closed on corrupt/unsupported state. No timer or automatic resend is added. |
| Inserted handoff request → local generation | A fast reply to a Markdown-escaped handoff marker/code request produced no local `turn_start` when the request was compared as ordinary human typing. | Preserve the witnessed app-insertion receipt and use the existing bootstrap comparison: exact source first, then one Markdown unescape. Native message/document/baseline ownership remains mandatory. The regression fails with zero starts on base and passes with exactly one. Recorder/background version 25 ensures existing documents can receive the corrected implementation. |
| Discord status → execution truth | A persisted open turn displayed green Working ahead of provider restrictions and compaction attention. | Prioritize limits and recovery blockers; show an unresolved recorded generation as Turn Open. Display existing recovery kinds/deadlines and distinguish a page reload from assistant recovery. Input/queue receipt semantics remain authoritative. |

The identity fix prevents a reproduced future failure path. It does **not** manufacture
generation IDs, retrospectively attribute old unowned finals, or prove that escaping caused
every historical production failure.

## v2.1.38 comparison and attribution

Archive: `upstream/chat-on-steroids-2.1.38.zip`.
ZIP comment/reference: `84ecbd69f36e44b8207ab458d73433d56a74d0ee`.
SHA-256: `fc7654e06f628f52307a7c2057fa32807ffc9684d97ffdfd9d44046e07be6e8a`.
It was extracted outside the development checkout. The loose user-provided ZIP was preserved.
The MIT license and existing notices remain intact; CONTRIBUTORS and commit coauthor trailers
credit adapted code and tests.

| Upstream area reviewed | Headless disposition |
| --- | --- |
| [Fresh turns, #1402](https://github.com/totec448-spec/chat-on-steroids/commit/8da4c5f4ea39e4752a5b2cea98bbd08159f7a872), @Maximapple | Adapted with conservative default Off, durable one-row custody, current source/mode checks, tool drain, provider restrictions and lifecycle fencing. |
| [Worktree concurrency](https://github.com/totec448-spec/chat-on-steroids/commit/320fff1818859aaedf05d43880068b2e60a53f9f), @Maximapple | Adapted; cleanup validation also occurs after waiting for repository ownership. |
| [Plugin timeouts](https://github.com/totec448-spec/chat-on-steroids/commit/17579727308e334d9f6469f28584bdea975a99c2), @Akilaydin | Adapted along with real SDK subprocess regressions. Existing two-minute deadline remains; no new timeout configuration surface or automatic retry. |
| Per-plugin longest-call setting/progress reset | Reviewed, not ported. The focused lifetime fix preserves existing settings and timeout behavior. |
| Worker page readiness/re-wakes | Reviewed. Upstream's memory-only transient retry counter/timer was not copied into Headless's durable command/receipt lifecycle. Missing confirmation must not become another wake prompt. Existing exact worker ownership, bounded deadlines and queues remain. |
| Error recognition and transport recovery | Reviewed alongside Headless's existing `stream_gone`, thinking-failed, history restriction, deleted-conversation and bounded pickup paths. No English-text fallback is used to invent generation identity. |
| Firefox, approval answering, desktop updater/sidebar changes | Reviewed release/source scope; omitted from this Brave/Xvfb reliability change. No automatic provider approval is introduced. |

## Optional fresh turns

Set `ui.rotateTurnMinutes` to an integer 1–120 in the existing configuration; 30 matches
upstream's interval. Zero, absent legacy values and malformed values keep Headless **Off**.
The existing settings IPC validates and preserves the field. This PR does not add a new
desktop settings control or Discord configuration command for it.

An attributed tool result may file one automatic browser input for the exact still-running
ordinary non-Pro turn. It uses the existing native steering path in the same provider
conversation. It never presses Stop, changes the objective, creates a provider conversation,
resets local history, or takes worker ownership. Running/settling local calls hold claim/Send.
Unknown selection, Pro, workers/helpers, active broker families, Goal/Loop, compaction,
manual departure, incomplete recording and active provider restrictions veto delivery.

The outbox freezes `purpose: rotation`, `directTurn` and `queuedTurn`. A source ending or
changing cancels an unsubmitted rotation rather than sending it after the turn. A person's
new instruction takes priority before authorization. An uncertain authorized Send retains
its original receipt custody and can accept a late exact receipt. A cancelled/failed row for
that source is not replaced merely because time passed or the backend restarted. Existing
ordinary unfinished-answer recovery remains the fallback, subject to its own proof and bounds.
Old companions without final authorization cannot claim a rotation. A retired bridge lifetime
cannot publish an unaccepted rotation or wake a browser after asynchronous preparation.

Upstream deliberately excludes Pro (long reasoning), Goal/Loop (their own turn-end decisions)
and sub-agents (turn/report lifecycle). Headless also excludes active prime families rather
than asserting unverified concurrent worker compatibility. GPT-6 Thinking can participate as
an ordinary exactly observed non-Pro executor. Live authenticated acceptance is still required
before enabling this setting on the installed VPS.

## Production diagnostic findings

Observations were collected on October 15, 2026; counts describe the retained log/state
snapshots, not a complete incident history. Private identifiers and task text are omitted.

- Installed application and companion reported 2.1.34. The deployment checkout was at the
  fork's pre-ZIP-import main code. All backend/browser/Discord/display/session services were
  active, with zero `NRestarts` in their current service incarnations.
- The umbrella target was inactive while its services ran. A maintenance stop must name the
  individual services as well; target status alone is not a health or shutdown certificate.
- Approximately 7.8 GiB RAM, 8 GiB swap; about 3.8 GiB RAM available, 619 MiB swap used and
  24% root-disk utilization at the first snapshot. Load averages were below 1.0.
- Backend cgroup memory was about 329 MiB with a 3.4 GiB peak; Brave about 3.4 GiB with a
  6.5 GiB peak. Kernel history contained **two Brave OOM kills** in the prior three days.
  These peaks do not establish a leak or prove simultaneous consumption. No hard resource
  cap, worker-limit change or process termination was applied.
- Retained app logs contained 52 assistant-transport-failure notices and over 500 repeated
  exact-generation capture refusals for one retained transaction. Counts grew between reads.
- Continuation WAL: eight records, four committed, one aborted and three awaiting summary.
  The three pending transactions had exhausted writing pickups at the observed snapshot.
  Browser `resumed` action receipts occurred without a captured brief or committed successor.
- One pending source had an exact saved user anchor and a 57,111-character canonical final
  with a provider UUID, but no recorded generation start/end after that anchor. Its capture
  refusal is correct under the identity contract. The saved data cannot establish why those
  boundaries were missed. Two other pending sources remained `dispatched-unresolved` with
  no exact source message receipt; they were neither reset nor resent.
- Outbox snapshot: 55 rows (38 sent, 10 failed, three cancelled, four queued). Those state
  counts are not whole-task completion claims. No outstanding browser commands or active
  broker runs were in the sampled ledgers; dormant history and user progress were preserved.

The historical identity gap and uncertain source dispatches require manual reconciliation.
Open the exact source and inspect its marked question, final and native state; allow exact
observations/late receipts to settle existing custody. Never fabricate a generation or clear a
dispatch checkpoint to try again. If the provider cannot supply proof, retain the failed
transaction and obtain an explicit user decision about a manually reviewed continuation.
Do not treat a reload, an unowned final or absence of a receipt as permission to resubmit.

## Validation

Fail-first reproductions were run against the unchanged implementation before each fix:
real plugin timeout/abort, overlapping Git mutations, lost Retry-After after process reset,
missing handoff generation after escaping, and incorrect Discord restricted status.

Automated evidence includes real local SDK subprocesses and Git repositories; bridge HTTP,
durable ledgers and fault injection; shipped extension scripts against DOM fixtures; renderer
checks in Electron; and a disposable Electron/Xvfb/Brave profile. Provider behavior in bridge
and DOM tests is simulated. No signed-in ChatGPT browser or live Discord delivery was used.

Two short soaks exercise actual local persistence and control code:

- 400 concurrent deadline writes across 16 synthetic chats and 25 cold memory restores:
  all newest deadlines retained. A sampled run took 1.86 s wall/1.05 s CPU, with heap delta
  −0.24 MiB and RSS delta +8.2 MiB.
- 48 source/claim/authorization/receipt cycles representing 24.8 hours: one prompt per
  source, one stable local session, 48 verified fixture receipts, no duplicate claims.
  A sampled run took 5.86 s wall/4.18 s CPU, with heap delta −4.4 MiB and RSS delta +52.6 MiB.

These process-local measurements include caching/GC and concurrent test-host load. They are
not multi-day memory-leak proof, provider latency measurements, or authenticated soak results.

The first UI sweep passed 48/50. The native shell check needed `COS_CHROME` set to Brave;
the desktop pet capture passed when rerun on a private Xvfb display. Both targeted reruns
exited zero without changing pet code. A complete private-display rerun is recorded in the PR.

Final command results are recorded in the PR after verification completes. Required live gates
remain 4/8/12/24-hour authenticated workload runs, an exact handoff/replacement receipt under
the actual account, independent worker families, and an installed-stack rollback drill.

## Deployment, preservation and rollback

No production deployment is part of this PR. Follow
[the reviewed maintenance sequence](../headless-long-run-rollout.md) only after explicit approval
of the disruptive maintenance window and a verified backup. It includes pinned source/build
checks, individual-service shutdown, encrypted snapshot verification, exact code replacement,
session/receipt preservation, post-install acceptance and held rollback.

New optional state: `state/provider-history-backoff.json`; new outbox purpose: `rotation`.
Existing history, sessions, projects, profile, configuration and receipt identities stay in
place. `runtime/durable-formats.json` adds `providerHistoryBackoff:1` and `freshTurns:1` so old
code cannot silently ignore restrictions or misparse these rows. Code-only downgrade below
the published floor is refused; use a matching backup and reconcile effects since that backup.
