# Long-session recovery follow-up — October 14, 2026

Reviewed against Headless `main` at `0d06040f` and read-only upstream `main` at `98b07e94`.
The target is reliable 8–24-hour autonomous operation. Accelerated tests establish local
invariants, not authenticated provider stability. No production profile, credentials,
services, database or active task was used or changed.

## Incident evidence and confirmed defects

The supplied timeline places an ordinary GitHub checks command at 17:55:41 UTC, assistant
transport failure at 17:57:34, recovery reload at 17:57:40, a deleted-chat error at 17:57:48,
and repeated silence recovery through 18:00–18:02. `gh pr checks` exit 8 means pending
checks ([official manual](https://cli.github.com/manual/gh_pr_checks)); it is not evidence
of a browser, MCP or terminal transport failure.

The installed incident revision, raw native HTTP payloads, request IDs and full logs were
not available. Consequently this review cannot establish why the native response was
interrupted, why a reload occurred despite the October 13 preservation logic, or whether
the provider actually deleted the conversation. The reported fixed deletion message is
consistent with this checkout's native deletion path, but does not replace the raw evidence.
No claim is made that a successful local command caused the provider failure.

`extension/usage.js::inspectDeleted` requires HTTP 404 on the native
conversation endpoint, the exact conversation ID and `detail.code === 'conversation_deleted'`.
The separate resume-stream 404 path reports `stream_gone`. These were already distinct;
this patch retains that distinction. DOM prose, silence and a missing stream are not
authoritative deletion or cancellation evidence.

The earliest confirmed local error was after the authoritative deletion notification:
`bridge.ts` previously failed waiting inputs but did not persist provider unavailability or
retire recovery authority. The ordinary failed-turn and page-return paths could then rearm
the deleted source, eventually reaching the existing ten-offer ceiling. Goal intent remained
enabled but the unusable provider binding had no durable, actionable classification.

Fail-first tests also reproduced these independent ownership defects:

- An asynchronous silence sweep retired by conversation ID and removed a newer turn's grant.
- Failing a deleted chat's inputs erased a spent Send's owner, losing late exact ACK custody;
  an unacknowledged MCP instruction also remained eligible for delivery into a successor.
- Deletion during outbox disk writes could still publish Send permission or MCP instructions.
- A provider's late `stop`, final model-preference read or Loop authority read could consume
  reply debt after the source became unavailable.
- A saved summary could be reopened after an aborted destination Send had been dispatched
  without a receipt; invited workers without a conversation were omitted from reconciliation.
- Exact deleted-chat admission needed both the existing late-request evidence grace and a
  final veto after strict Trust reads. Worker revival needed a veto after workspace validation.
- Work accepted while a saved handoff was being read needed rechecking before replacement
  command delivery. New remote wake/delegate requests must also respect the deleted prime.
- A sleeping worker could still own an admitted tool or background process. Broker sleep
  does not prove cancellation; replacement now checks exact worker calls and local session
  process custody independently of broker state.

The production timeline alone cannot prove which of these races occurred in that run, or
whether any tool/Send was ambiguous. The fixes preserve receipts and uncertainty rather
than inferring cancellation or replaying effects.

## Owners and corrected behavior

| Fact | Existing authoritative owner | Correction |
| --- | --- | --- |
| Local session, current frontend, lineage, deletion | Session store metadata and committed recording | Exact keyed deletion facts persist before direct browser ACK and reconstruct from journal-only observations. Multiple unavailable predecessors remain fenced. No automatic clearing. |
| Native transport observations | `usage.js` → content journal/bridge | Structured nonrecoverable `conversation_deleted` is retained; stream resume 404 remains recoverable transport evidence. |
| Repairs and activity grants | Existing bridge recovery episodes | Deletion retires grants, repair tokens and watches; page returns and late tool recording cannot rearm them. Sweeps retire only the grant/repair they inspected. |
| Execution and result | MCP correlation, kernel, running-call/process owners | Refuse new exact unavailable-source effects. Resolve late exact evidence using the existing grace. Retain admitted tool results; withhold new instructions after deletion/handoff. No tool replay or inferred cancellation. |
| Send and input ACK | Existing serialized outbox | Final publication revalidates the source. Preserve legacy and modern ambiguous claim owners and late ACK custody. Never-dispatched inputs fail visibly; authored content remains recorded. |
| Goal/Loop objective and reply obligations | Existing Goal durable ledgers | Deleted-source decisions fail nonretryably with an action, without completing the objective or spending reply debt. Existing mode and full objective survive restart/rebind. |
| Workers | Existing broker and execution owners | Include invited unbound workers by exact prime provenance; block new wake/delegate work for a deleted prime, preserve existing work and allow operator sleep/reconciliation. Do not hand a deleted worker revival or Stop command to a page. |
| A→B handoff | Existing continuation WAL/resume gate | Reuse a saved brief only with positive prior WAL proof of no destination dispatch. Missing/pruned WAL is a blocker. Recheck running effects before publishing the replacement command. |
| Operator status/actions | Existing control API, Discord confirmation and operation receipts | Expose confirmed deletion, retained objective/work, receipt inspection and explicit saved-summary recovery through `/compact`. Same action permissions and session/Discord mapping. |

Discord `/status` reports the blocker and directs the operator to `/queue`, `/operations`,
`/history` and workers. `/compact` freezes the exact deleted source in its existing confirmation.
Confirm only after reconciling provider requests, local effects and delivery receipts. The
backend independently refuses running tools/processes/workers and unconfirmed Sends. It
does not clear uncertainty because a button was pressed. A usable saved summary and its
positive pre-dispatch WAL proof are required; incomplete history remains its own blocker.
Without that proof, inspect/reconcile locally and prepare a fresh explicit task from verified
checkpoints. The old session remains available; there is no automatic reconstruction of
missing work or replay of failed/uncertain queued messages.

Exactly one current provider binding remains in the session store. Replacement commits
through the existing continuation owner, retaining local identity, project and Goal lineage.
Old source deletion cannot poison the successor. Existing workers/checkpoints/history are
retained; this patch does not add a watchdog, retry driver, dependency or second state ledger.
The deletion map is bounded by retained conversation lineage; the transient sweep map lives
for one pass. Unknown-call admission consults the existing catalog, without per-request disk
history scans or an independent unavailable-chat cache.

## Upstream comparison

Actual source/history/tests for v2.1.35, v2.1.36 and relevant newer stable commits were compared.

| Upstream change/reference | Classification and decision |
| --- | --- |
| [PR #1399](https://github.com/totec448-spec/chat-on-steroids/pull/1399), `64cfc9b6`, `d24657b4`, `00bc29e9`, merged `360fcfac` | Already adapted by October 13 Headless: same-question MCP proof, error-page preservation and Continue-policy veto. Retained and tested; no duplicate Stop/Continue controller. |
| Long native reasoning and false stalls | Already implemented by October 13 exact reasoning leases and pending-tool vetoes. Existing 24-hour high/ultra/Pro simulations retained. Freshness expiry never fabricates a final or authorizes Send. |
| `6b939330` / #1360, stale silence-grant retirement | Missing and suitable. Adapted object-identity ownership check with a deterministic concurrent-turn regression and original-author credit. |
| Native conversation deletion / resume HTTP 404 | Present but incomplete in Headless. Native classifiers were correct; durable state retirement and execution/delivery/status fences were missing. Corrected the existing store and consumers. |
| Delivery timeout, rate limits/Retry-After, session restart | Existing outbox receipt custody, provider backoff and restart reconstruction retained. Deletion is now a permanent source blocker rather than another transient retry episode. |
| Compaction silence deadlock (`473a8437`) and later editor/remount fixes | Headless already includes targeted October 13 corrections. Existing WAL/checkpoint, late-final, worker and restart tests retained. Added the missing saved-summary uncertainty gate. |
| Host wake grace (`25557bc5`) | Missing desktop behavior; not adapted without VPS incident evidence. This assignment does not add a broad host-sleep timer. |
| [Issue #1402](https://github.com/totec448-spec/chat-on-steroids/issues/1402), rotation around 25–30 minutes | Experimental, not proven safe. Browser stream loss can coexist with server-side tools; Stop does not prove cancellation. Rotation stays disabled because nonoverlap/cancellation and compaction arbitration are unproven. |
| Newer worker archive/UI/connector features through `98b07e94` | Unrelated or independently scoped. Not blindly ported into the Ubuntu/Discord recovery path. |

## Regression coverage and simulations

New deterministic tests first failed on the original decisions, then passed after correction.
They use synthetic IDs/receipts and isolated temporary storage. Existing suites cover the
working October 13 behavior rather than duplicating it.

| Required scenario | Coverage |
| --- | --- |
| GPT-6 reasoning >60 minutes | Existing bridge 24-hour high/ultra/Pro lease simulations and content reasoning tests. |
| Silent stream with active MCP / browser disconnect with tools | Existing in-flight call, pending-tool, late attribution, browser loss tests; new replacement execution veto. |
| Interrupted response and Stop + Continue | Existing bridge/input/content/extension same-question and preserved-page positive/negative tests. |
| Resume 404 without deletion | Existing usage-observer stream tests; new bridge stream-error→repair→separate deletion sequence. |
| Confirmed deletion | New direct and journal-only durable tests, restart/page-return veto, exact kernel admission and multi-deleted lineage tests. |
| Reload/tab loss/extension suspension | Existing extension/content/bridge maintenance and worker suspension suites; deletion tokens cannot be claimed after retirement. |
| Backend/bridge restart | Existing restored Goal/Loop/silence/WAL tests; new unavailable-source restart matrix. |
| Goal/Loop after recovery | Existing multi-hour mixed-fault tests; new retained objective/mode/debt and late-decision deletion tests. |
| Uncertain Send ACK | New retained ambiguous owner and late exact ACK test plus final authorization/legacy claim disk-write races. |
| Delayed final / retired source | Existing continuation/recorder late-final tests; new final MCP appendix veto after deletion. |
| Worker during prime recovery | Existing worker custody tests; new unbound invited-worker, newly accepted-worker, sleeping-worker tool/process and revived-workspace publication regressions. |
| Compact & Resume pending tools/restarts/ambiguous destination | Existing continuation/resume/input suites; new running-effect and dispatched-without-receipt saved-summary vetoes. |
| Rate limits/Retry-After/auth | Existing Goal/bridge/content/usage tests; no changes to provider limits/backoff. |
| Stop/Pause/Continue Off | Existing veto suites retained; new unavailable-source Stop/revival fences use the same command authority. |
| Exhaustion without lost work | Existing bounded offer/pickup tests; new deletion stops invalid recovery before the ten-offer limit. |
| Incomplete recorded history | Existing durable incomplete-recording and Goal/Loop refusal tests retained. |
| Discord status/actions | New status and exact-source reconciliation confirmation tests; remote delegation refusal and unchanged command reference. |

The existing 4-, 8-, 12- and 24-hour mixed-fault bridge simulations retain one task across
receipts, restarts, transport interruptions and compactions. The new Goal/Loop deletion
matrix advances each duration, restarts store/recorder/bridge, polls the unavailable page,
and verifies preserved identity/objective/history and zero recovery handouts. No real-time
24-hour authenticated provider run was performed.

## Verification

Final verification exited 0: **8,536 tests passed, 159 skipped**, across the main and serial
test runs. No test retries were enabled. Earlier fail-first
and review runs intentionally failed. A first
full run while final review fixes were being applied reported 8,520 passing, 137 skipped
and five failures; affected suites were rerun after correcting the code and fixture isolation.
A second full run reported 8,528 passing and two newly reproduced sleeping-worker effect
failures. Those were corrected and the complete command below passed on the final source.

| Exact command | Result |
| --- | --- |
| `npm ci` and `npm ci --prefix discord --ignore-scripts` | Passed using locked dependencies. |
| `TAR_OPTIONS=--no-same-owner COS_TEST_WORKERS=2 npm run verify` | Exit 0. Privacy, notices, root/Discord types and Electron module load passed; main run: 8,530 passed / 137 skipped / 341 files; serial run: 6 passed / 22 skipped / 2 files. |
| `COS_TEST_WORKERS=2 npm test -- --run test/bridge.test.ts` | Exit 0: all 711 tests passed, including reasoning and 4/8/12/24-hour mixed-fault simulations. |
| `npm run typecheck` | Exit 0 on final source, including new worker-effect fixtures. |
| `npm run build` | Exit 0 on final source. |
| `npm run discord:build` | Exit 0. |
| `node scripts/generate-discord-reference.mjs --check` | Passed: 34 implemented commands. |
| `npm test -- --maxWorkers=1 test/computer.test.ts test/mcp-shutdown.test.ts` | Exit 0: 6 passed, 22 computer tests skipped; subsequently also passed inside final verify. |
| `npm run verify:deployment` | Not verified: exit 1 at the required unprivileged-user guard. |
| `npm run verify:headless` | Not verified: exit 1 at the required unprivileged-user guard. |
| `PYTHONDONTWRITEBYTECODE=1 python3 test/maintenance_drills.py` | 10/11 passed; Unix-socket drill blocked by this runtime's socket permissions. |
| `bash -n` for every `deploy/*.sh` | Passed separately without executing installers or modifying services. |

Representative fail-first invocations included `npm test -- --run
test/kernel-identity-recovery.test.ts test/goal.test.ts -t 'late request evidence|during
delivery|final model-preference'` (three failures), `npm test -- --run test/goal.test.ts -t
'deletion wins during its authority'` (one failure), `npm test -- --run test/bridge.test.ts
test/kernel-identity-recovery.test.ts -t 'redeems a restored broker-owned|final awaited
strict'` (two failures), `npm test -- --run test/bridge.test.ts -t 'workers accepted while'`
(one failure), `npm test -- --run test/input-delivery-integration.test.ts -t 'unacknowledged
MCP input'` (one failure), and `npm test -- --run test/bridge.test.ts -t 'sleeping worker
with an admitted'` (two failures). Each intended failure passed after its corresponding fix,
then passed in the final complete verification. Raw test logs remain local; no native incident
logs were published.

The first `npm run verify` stopped extracting pinned ripgrep because this Work runtime cannot
change archive ownership. `TAR_OPTIONS=--no-same-owner` preserves checksum verification and
extracts into the isolated checkout without requesting archive ownership. The initial broad
test job was rejected by automatic approval review over possible external OpenRouter calls.
`test/network-isolation.ts` now permits ephemeral loopback fetches and rejects unexpected
external fetches. Provider tests use synthetic responses; no live model request is required.

`npm run verify:deployment` and `npm run verify:headless` refuse this root-only runtime as
designed. The unprivileged guard was retained. Direct maintenance drills passed 10 of 11;
the Unix-socket drill is blocked by `PermissionError: Operation not permitted`. Deployment
shell syntax is checked separately. Electron/Xvfb/Brave smoke, keyring/systemd behavior and
live provider acceptance remain unverified here and require an unprivileged Ubuntu host.

## Real VPS soak acceptance

Use a disposable Ubuntu 24.04 VPS, separate profile/data/project directories and the existing
maintenance installation procedure. Use the operator's authorized provider account and
interactive login. Start with at most two workers and harmless uniquely labeled test writes.
Keep receipts/private provider logs locally; publish redacted evidence only. Do not inject
faults into production work or deliberately provoke provider limits/deletion.

| Wall-clock stage | Faults and acceptance gate |
| --- | --- |
| 4 hours | Normal Goal and Loop checkpoints; one controlled browser restart and backend restart at a safe boundary. Same local session/objective/project, one current binding, every instruction accounted for, no duplicate test writes. |
| 8 hours | Add two workers, a supported stream interruption and compaction. Inspect real reasoning/MCP evidence, retained worker obligations and exact Send receipts. Existing Continue/Off/Stop controls must behave truthfully. |
| 12 hours | Restart during queued and dispatched handoff phases; delay receipts/finals. One committed successor, old frontend cannot admit effects, ambiguity is visible and never replayed. |
| 24 hours | Combine prior faults at safe checkpoints, sample resource/quota/inode usage and status hourly. Every pending obligation has an owner or actionable blocker; retries and retained state stay within existing bounds. No fabricated completion or silent inactive enabled Goal. |

Advance only when every prior stage passes. A missing cancellation/delivery receipt leaves
the trial unresolved. Record commit, provider model/effort, meaningful-work time, reasoning
evidence, request and input IDs, compaction count, effect counts, worker assignments and
resource peaks. Confirmed deletion recovery may be exercised only with explicit authoritative
evidence and reconciliation in an isolated task; do not delete an active production chat.
Authenticated long-run behavior and a seven-day soak remain separate acceptance gates.

## Deployment and rollback

This PR does not deploy or merge. Back up the existing user-data/project files and receipts;
stop through the existing maintenance procedure, build both root and Discord artifacts,
stage the matching extension, and run unprivileged deployment/browser smoke before the soak.
The metadata field and journal reason are additive; older recordings/extensions remain readable.

Older binaries do not enforce the new deletion fence. A code-only rollback must therefore
keep services/automation stopped until the operator has reconciled unavailable sources and
uncertain receipts; restore the reviewed build/data pair using the existing rollback process.
Do not erase the deletion fact, WAL or outbox to make a retry possible. Saved-summary recovery
can remain blocked when its prior WAL was pruned or never recorded. That limitation is
intentional: missing custody evidence cannot certify nonexecution.
