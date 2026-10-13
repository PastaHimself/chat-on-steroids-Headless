# Plan + Goal stall recovery

Investigated 2026-10-13 against default-branch commit
`2ebdf90b85a648085f5e5d5de26b9a226fc04b0c`, including the October 13 recovery fixes.
Only an isolated checkout and temporary test data were used. No live VPS, account,
production session, queue, keyring, permissions or service was accessed or modified.

## Root cause

The reported symptoms are reproduced by cooperating owners that each correctly refused
an unsafe independent action, but never transferred the next step to an eligible owner.
The approximately 200-call count is workload context, not a hard tool-call limit.

| Boundary | Defect and consequence |
| --- | --- |
| Plan scheduling → input outbox | `materializeStages` creates durable `finish` checkpoints. Their presence makes `inputBeforeGoal` suppress a separate Goal continuation, including when the queue head cannot deliver. |
| Silence repair → queued checkpoint | `fileSilenceInput` gave eligible queue heads a silence boundary but no recovery Stop custody. `deferSilenceInput` renewed ordinary checkpoint deadlines on every native-busy rejection. A stale native Stop therefore bought another minute indefinitely. |
| Astra finish policy → Continue | Finish-only Astra checkpoints were excluded from browser delivery. The separate `fileRecoveryInput` path refused any outstanding input. A failed turn could neither reach `session_finish` nor earn a safe continuation through its queue. |
| Native reasoning → bridge/content watchdogs | Exact unfinished native reasoning was accepted for Pro and Extra High/Max/Ultra, but GPT-6 Thinking at High still hit the generic ten-minute stall and the bridge's shorter silence window. |
| Persisted turn boundary → startup | Startup reconstructed watches only when `activeTurnId` existed. A recorded `stalled` or `interrupted` end cleared that projection even though the requested work and Goal remained unfinished. |
| Restored outbox → initial silence watch | Restoring a new initial watch for a source already owned by a recovery row could issue an extra reload outside its persisted pickup budget. The outbox must retain that source's custody. |
| Proven pre-Send pickup failure → retry | The same-row retry rejected every other pending input, including older, never-offered finish checkpoints. A safely retryable user message was stranded behind Plan work that did not own a delivery claim. |

A native Send receipt proves that ChatGPT accepted a particular user message. It does not
prove that the model started, finished, or acknowledged its work. A lost receipt remains
ambiguous. Neither the enabled Goal nor a queued checkpoint authorizes replaying it.

## Changes

- The first eligible, never-offered finish checkpoint can acquire the existing outbox
  recovery custody after a confirmed silence repair and independent Continue/Goal/Loop
  authorization. Its UUID, authored text, order, mode, remaining stages and session stay intact.
  No parallel controller, generated task queue or recovery timer was added.
- The optional `recovery.queuedInput` discriminator distinguishes this retained checkpoint
  from synthetic Continue. Revoking recovery returns the checkpoint to its original queue;
  it does not cancel the user's pending work. Existing rows remain readable without migration.
- The same established native recovery flow owns one conditional busy wait, one durable
  Stop claim, and one Send authorization. The prepared recovery message asks the executor
  to inspect existing results and preserve already completed work before repeating actions.
  No message is force-sent into a busy, blocked, changed, drafted or tool-active page.
- Native-busy rejection can no longer renew a checkpoint's deadline. The shared 2/5/10-minute
  pickup schedule and three-reload limit remain durable. A restart cannot earn another initial
  reload for an outbox-owned or exhausted source.
- A native final found before it reaches the recorder keeps the checkpoint queued with an
  explicit recording blocker. Its page-final veto remains until canonical final evidence or
  genuinely new work resolves it; a reload cannot turn it back into Stop authority.
- GPT-6 Thinking, including the family's Low/Medium/High thinking selection, shares the
  existing exact reasoning observation. Document, conversation, generation, native Stop,
  unfinished Fiber identity and lack of transport error remain required. The bridge lease
  still expires after 90 seconds. Ordinary silence windows and the ten-minute fallback are
  unchanged when this proof is absent. Returning exact reasoning also holds pending recovery.
- Startup can rebuild a recent unfinished stalled/interrupted/failed/unknown Goal source
  from its current durable boundary and attributed MCP work. Stop, final, new question,
  dismissal, old history and moved conversation remain vetoes. An existing outbox source
  takes priority over watch reconstruction.
- A proven never-picked-up user message can retry once on the same row when only older,
  never-offered finish checkpoints coexist. Any claimed, authorized, offered or newer input
  still vetoes that retry. No uncertain input is replayed.
- The queue keeps a recovering checkpoint's authored task label and removal action. Its
  recording blocker is visible and translated in every existing locale. Uncertain checkpoint
  deliveries remain visible as delivery notices instead of hidden retired Continue drafts.

`goal.ts`'s objective/switch/reply ledgers and `inputBeforeGoal` priority remain the owners
of automation policy. The fix repairs the missing queue recovery handoff instead of letting
Goal bypass it. The background extension's existing durable input ACK journal already retries
only the captured receipt after navigation, MV3 suspension and backend restart. It does not
re-read a tab or replay Send. Tool request attribution, execution and continuation WAL remain
unchanged; recovery does not re-execute recorded tool actions or replay a handoff bootstrap.

## Deterministic evidence

Regressions were run against the missing behavior before each corresponding production fix:

- Four initial failures: Plan + Goal after 200 attributed calls with GPT-6 Thinking and Pro,
  GPT-6 Thinking High at ten minutes, and the bridge's High-effort reasoning lease.
- Two restart failures: stalled/interrupted Goal work vanished at startup; explicit Stop
  was the negative case and already passed.
- Two outbox-owned restart failures: an extra initial reload bypassed durable pickup custody.
- One safely retryable pickup failed in the presence of older Plan checkpoints.
- One page-final case lost its retained veto before authoritative recording arrived.

The final focused fence run covers both models, three finish checkpoints, backend restart,
outbox reload, immutable text/identity/order, one checkpoint per source, one Stop and Send,
late/lost acknowledgment, stale-document fencing, pre-Send browser preparation timeout,
canonical/page finals, new tool work, Stop, Goal Off, Block, new question, conversation rebind,
45 simulated minutes of exact tool execution, returning/expiring native reasoning, pickup
exhaustion and one safe retry. The 200 executed tool records remain exactly 200 after recovery.
Existing extension/content tests additionally exercise native receipt custody, extension reloads,
MV3 journal restoration, busy-page fencing and late final vetoes. Existing continuation and
request attribution suites check handoff and tool ownership. Simulated elapsed time is not a
wall-clock authenticated provider soak.

Independent review found two additional recovery boundaries: restored Pro `thinking_failed`
must retain its shorter retry window, and a returning exact reasoning observation must hold
an existing recovery ticket without earning another initial reload when its lease expires.
Both were reproduced before correction and rechecked independently. The final review found
no remaining critical or important issue. Renderer regressions also verify checkpoint labels,
visible blockers, removal semantics and uncertain-delivery notices.

## Validation

Environment: isolated Ubuntu 24.04.3 x86_64 executor, Node.js 24.19.0,
Electron 44.3.0, TypeScript 7.0.2 and Vitest 5.0.2. Focused runs use two workers;
the final full suite uses four and its computer/shutdown phase uses one. No retries.
A temporary Node preloader blocks outbound provider traffic during validation while allowing
loopback fixtures. API decision tests use synthetic credentials and mocked responses.
The first broad run was stopped by automatic approval review over potential provider egress;
the guarded run prevents that egress rather than granting provider access.

| Check | Result |
| --- | --- |
| `npm run verify` | Exit 0. Main phase: 321 files passed, 14 skipped; 8,456 tests passed, 137 skipped. Serial phase: one file passed, one skipped; six shutdown tests passed, 22 computer tests skipped. Total: 8,462 passed, 159 skipped, zero failed. |
| Root and Discord type checks | Passed inside `verify`. |
| `npm run build` and `npm run discord:build` | Passed. |
| Public-history privacy | Passed: 1,981 commits and one tag. |
| Notices/native-source validation | Passed: 162 production packages, seven catalog entries, 730 pinned native source archives/patches and 26 Discord packages. |
| Focused recovery/review regressions | 19 passed, plus seven presentation/cross-boundary checks; their relevant files also passed in the full run. Independent review's two boundary checks passed after correction. |
| `git diff --check` | Passed. |
| Deployment shell syntax, rendered systemd unit verification, both swap scripts' read-only `--check` | Passed. No services or swap settings changed. |
| `npm run verify:deployment`, `npm run verify:headless` | Attempted; refused the root-only executor. Unprivileged smoke remains pending. |
| `PYTHONDONTWRITEBYTECODE=1 python3 test/maintenance_drills.py` | Ten passed; the encrypted backup drill was blocked by `PermissionError` creating an AF_UNIX socket. |
| `npm run verify:ui` | Attempted; 0/50 because of the root sandbox/missing Chromium environment described below. Real UI acceptance remains pending. |

The first full pass exposed a missing translation for the new recording blocker. All twelve
existing non-English locales were updated and the final complete pass above includes the
renderer source/translation gate and both new checkpoint presentation regressions. Platform,
native computer and opt-in live-provider skips follow the existing suite's conditions.

## Limits

- A provider-native Stop and idle page do not prove server-side cancellation of a disconnected
  request. Exact active/settling tools and fresh native reasoning still hold recovery. Recovery
  performs no tool-action replay, but cannot certify a provider's independent execution after
  a lost stream. Missing or uncertain Send remains blocked awaiting an exact receipt/operator
  reconciliation, with original work retained.
- A source without exact recorded MCP proof cannot earn automatic silence intervention.
  Missing history, expired login, provider limits, drafts, explicit Stop/Off/Block, compaction
  and user dismissal retain their existing safety blockers. Fixing a queue deadlock does not
  remove those permissions or make missing evidence positive proof.
- The root-only managed executor cannot switch to an unprivileged UID or create Unix sockets.
  The checked deployment/headless wrappers refuse root; their privilege checks were preserved.
  Shell/unit/read-only checks can run separately. An encrypted backup drill requires a Unix
  socket and is blocked by the executor. No installer, swap activation or service changes were
  attempted to overcome those constraints.
- The real-Electron UI wrapper was attempted without weakening Chromium's sandbox. It reports
  0/50 checks: 49 attempts stop at the root sandbox boundary (including the Electron child
  of the performance check), and the shell-runtime attempt reports no Chromium executable.
  These are environment blockers, not successful UI acceptance results.
- A real signed-in ChatGPT/extension flow, unprivileged Electron/Xvfb/browser smoke,
  VPS reboot/systemd lifecycle and authenticated long-running task remain external acceptance
  gates. They require a disposable authorized environment; this change never modifies the
  operator's live VPS or session data.
