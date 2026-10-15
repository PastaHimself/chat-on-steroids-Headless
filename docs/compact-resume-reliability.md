# Compact & Resume reliability guarantees

## Verified failure modes

Inspected base `dea3ee1f11e881b2b2c2a7a19a6731a4c891fe4f` in a fresh isolated checkout. The incident report was an investigation baseline. Three source defects were reproduced before their repairs: compaction repair fell through to reload while generation/readiness was uncertain; a completed recorder reply needed another browser checkpoint and was missed after exhausted pickups; settled DOM absence released an uncertain source dispatch for resubmission. The first regression run had six expected failures across these three defects.

Additional failing-before tests caught unknown/malformed/duplicate ledger downgrade, uncertain replacement release, page-summary bypass of recorder refusal, early Fiber truncation, capture becoming stale during handoff preparation, legacy claimed replacement replay authority, late capture bypassing Block and historical DOM-release checkpoints regaining send authority on restart. These defects are independently reproducible application bugs; none proves the exact historical provider failure.

The baseline durable writer already syncs its temporary file and, on Linux, the containing directory. No durable-writer rewrite was needed. Ticket IDs remain opaque random base64url values; a displayed substring is not arithmetic evidence.

## Readiness follow-up on Headless main

The next investigation used Headless `70123a6060bf97424bf8e735b174a718729ebd77`, which already includes the preceding repairs, and compared upstream `d2371d76573ad4a2bda50b2d18e206ec12a96955` and the supplied v2.1.37 source. Headless remains the implementation target. Upstream's v2.1.35–v2.1.37 working-turn, silent-stream and delayed-boundary fixes are useful comparison evidence; they do not establish identical deployed behavior. In particular, upstream's one-pickup transport-loss exception was missing in this fork. Headless already serializes publication of its shared continuation WAL; the upstream lost-update reproduction is not a new defect in this fork.

Five checks failed against this Headless base before implementation:

| Earliest wrong boundary | Repair and evidence |
| --- | --- |
| `bridge.ts` `/compact sourceLost` aborted automatic predispatch intent, even for temporary readiness refusal | The durable automatic flag retains the same token and checkpoints. The legacy route responds `deferred`; manual refusal remains terminal. Tests also refuse the same report after dispatch and after Cancel/Auto Off. |
| `noteRepairHeld` logged readiness/draft protection while `takePendingRepairs` counted unanswered offers | An exact current known hold resets only an unclaimed compaction's unanswered-offer count. Fifteen held polls retain the repair; a hold cannot revoke its eventual action claim. |
| `inspectOwedCompactions` abandoned the automatic ticket after its bounded asking bursts | The existing WAL stores attention on the same ticket. No fourth burst is time-driven. Late `sourcePending`/legacy refusal can reoffer through the existing repair owner without replacing a handed/claimed repair. Exhaustion/restart/readiness tests obtain exactly one dispatch on that same token. |
| `reportContinuationSourceBlockerNow` treated diagnostic repetition as progress | Bounded diagnostics are idempotent and do not change the progress timestamp or send checkpoint. |
| `expediteCompactionPickup` advanced the deadline but a long-thinking lease still vetoed pickup | One exact transport-loss report bypasses that lease for one acted pickup. Running local calls still hold it, and the browser still refuses unsafe navigation. Subsequent fresh work receives its normal lease. |

This does not prove why any particular production response was missing. In `/compact destinationMessageId`, `unknown continuation` means only that `continuationByToken` returned no entry for the reported full token. It cannot distinguish a stale callback, an older lost receipt, or a foreign token. No replacement is inferred from the diagnostic. A substantial handoff fragment likewise cannot establish completed, correctly attributed capture; the existing recorder diagnostics and provenance checks must decide that.

There is no new durable schema, timer, send authority or Goal/worker transfer path. Older snapshots retain their existing defaults and durable pickup counts. Older pages may safely report `sourceLost`; unsupported browser repair capabilities continue to fail closed. The new content accepts both old `aborted` and new `deferred` acknowledgements while preserving an occupied user draft.

Release note: Compact & Resume retains automatic handoff tickets through temporary page readiness failures and exhausted pickups, recovers on later readiness without duplicate dispatch, and promptly checks interrupted long-thinking streams while preserving browser and tool safety guards.

## Changes and invariants

- `extension/background.js`, `extension/content.js`, `src/main/bridge.ts`: compaction repair capability negotiation applies to every claim. Writing pickups only refresh/report the current document; missing replies preserve it. Predispatch reload fallback requires exact current document/route plus explicit hydrated, idle, empty-composer readiness. Older backgrounds/content fail closed instead of inheriting reload authority.
- `bridge.ts`: `/events` and the existing compaction sweep reconcile exact completed recorder evidence before pickup/exhaustion gates. Background capture uses ordinary resume delivery and never sets a page-specific placement collector. Block/Stop/provider-unavailable/current ownership and automatic model policy are rechecked at publication.
- `session/store.ts`, `session/continuation.ts`: carry the recorder revision through asynchronous reads and handoff preparation. Publish capture under the existing session mutation fence, acquired inside the continuation checkpoint lock. Emit the handoff timeline event after releasing that fence. A Retry arriving during preparation invalidates capture rather than selecting one branch.
- Source `sourceUndelivered` remains a compatibility endpoint that refuses release. Replacement `destinationLost` releases only predispatch custody. Content never requests its release after beginning dispatch authorization. Missing DOM/composer evidence cannot authorize either resend.
- A send checkpoint survives waiting deadlines, terminal errors and restart. Deadlines become attention diagnostics after dispatch; predispatch intent can still expire. Terminal receipt retention is independent of the original bounded superseded-source close grace. This increases retained WAL history intentionally; age cannot erase submission evidence.
- Startup uses the strict durable reader. Unsupported versions, malformed identity/checkpoints, duplicate tokens and competing active session obligations fail closed before map replacement. Restoration loads every retained ticket rather than silently slicing to 32. Legacy `armed` source records remain uncertain; legacy claimed/committing destinations without checkpoint fields migrate to uncertain dispatch. A positive `askedAt` while awaiting the summary preserves source uncertainty over missing/predispatch checkpoints before retention, including the old DOM-based release output. Other phases can stamp `askedAt` without submitting, so do not acquire this inference.
- `shared/session.ts`, Fiber/content/bridge/recorder/store: propagate `textIncomplete` for bytes lost before storage. Storage overflow remains separately recoverable. Unknown old MAIN completeness stays unknown; sparse old observations cannot clear known loss. A complete later revision can recover the same ticket once. Capture diagnostics distinguish missing anchor/final, nonterminal/failed generation, identity ambiguity, bounded/changing history, truncated text, unavailable overflow and short brief. Diagnostics do not renew progress or replace terminal cancellation outcomes.
- Existing session rebind, Goal transfer, worker reconciliation, Project/workspace and input ownership remain in their existing owners. No new timer, ticket registry or observer daemon was introduced.

## Regression and integration coverage

| Scenario | Evidence/assertion |
| --- | --- |
| Normal compaction/remounted assistant IDs | Recorder bridge tests capture one exact completed interval and one handoff. |
| Delayed or missed response | New `/events` and sweep tests advance without a second `/compact` checkpoint. |
| Exhausted three pickups then late final | Same sent anchor captures, no fourth repair remains, exactly one resume command. |
| Disconnected/unready/generating page | Shipped background VM tests preserve the tab; no reload/create. Older claim negotiation is refused. |
| Slow readiness before send | Existing content native receipt/hydration guards and new explicit reload-readiness cases remain covered. |
| Exhausted unsent budget then readiness/restart | Same automatic token and durable exhausted budget survive; no timed fourth burst, one repair claim and one source dispatch. Cancel/Auto Off and postdispatch reports cannot revive or reset it. |
| Responsive held document | More than ten protected draft/readiness polls retain the exact unclaimed repair; reports cannot revoke a claimed repair. |
| Restart/expiry of uncertain source or destination | Checkpoint remains identical, no new send grant; legacy claimed records remain fenced. |
| Acknowledged source with absent final | Pending reason identifies missing/nonterminal evidence; no replacement. |
| Ambiguous attribution/generation | Existing exact ownership suites and new summary-bypass tests refuse selection/resubmission. |
| Malformed/short/truncated replies | Exact diagnostics, no handoff/queue; later complete revision recovers once. |
| Duplicate submissions/evidence replay | Both uncertain source/replacement release refusals plus repeated final observation retain one handoff/command. |
| Crash during replacement creation/commit | Existing continuation crash, WAL failure, rebind and durable provenance tests retain A or reconcile the already-committed B. |
| Goal/worker/session ownership | Existing repeated overnight resume and parked/terminal worker-history tests preserve the same family, Goal and session. |
| Auth/error/policy changes | Unauthenticated `/events` is rejected without losing custody; failed response is diagnosed; Block holds late capture and release recovers the same ticket. |
| Repeated compactions | Existing full worker/Goal repeated-resume and repeated durable receipt tests exercise the unchanged transfer owners. |

Bridge/store/continuation tests use real temporary files and loopback HTTP. Extension tests execute shipped JavaScript in isolated Chrome API VM and JSDOM/page-model harnesses. Provider output, Chrome APIs and Electron opening are simulated; these assertions prove application state transitions, custody and side-effect counts, not real ChatGPT persistence.

## Verification boundary

Run `npm run verify` for the full suite, including main/Discord TypeScript, privacy and notice checks; build with `npm run build` and `npm run discord:build`. PR CI also exercises the supported OS matrix and the fail-first comparison against base code. Exact execution results belong in the PR. In containers that cannot apply archive UID ownership, `TAR_OPTIONS=--no-same-owner` allows the existing ripgrep extraction prerequisite without changing source code.

A signed-in Brave/provider acceptance test was not performed. No production connector, profile, credentials, session ledger, development repository, service restart, ticket recovery, deployment or merge was used. The separate [read-only recovery procedure](compact-resume-recovery.md) requires exact evidence and a separately authorized operational decision before any live change.
