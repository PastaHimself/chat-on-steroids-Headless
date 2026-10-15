# Discord native Project delivery hold

## Confirmed cause

This follow-up starts at `main` merge `49f35af4` (PR #21). After the operator explicitly authorized
VPS access, read-only inspection established that the installed main bundle, Discord entry and
extension background file matched the locally verified PR #21 build byte for byte.

The failing greetings were present in `state/session-input.json`, associated with one local
project. That project's native ChatGPT link was `failed`, with the existing owner error
"ChatGPT no longer opens this Project". Eleven queued rows had no offer, Send authorization or
delivery timestamp. `pendingBrowserInputs` intentionally withholds their openings until that
Project is linked. There was no Discord-to-backend admission failure for these rows.

Discord discarded this app-side gate: it displayed "waiting for browser claim" even though the
input had not been published. PR #21 fixed different browser-selection/election failures and
did not repair this existing native Project link. Neither the stored failure nor browser history
alone proves whether the original native Project was deleted or why its page redirected.

A temporary `cos-bootstrap.service` was running the desktop backend while the managed Headless
backend was stopped. Starting the managed backend alongside it lost the single-instance race;
systemd then removed its runtime discovery directory. The temporary bootstrap was stopped
gracefully and the existing managed backend started successfully. The bot was then reconnected.
The earlier GPU fatal messages occurred during stop sequences and were not established as the
Project delivery cause.

## Repair and safety

The input owner now projects the native Project wait using the same opening predicate as
publication and the actual current target. It reads the project catalog once per bounded input
page. Terminal, already handed-out, tool-routed and bound-conversation work receives no Project
wait. API projection names only state/error, redacts credentials and caps the error at 300
characters. No new durable input fields, retry counters, timers or delivery authority exist.

Discord admission, status and empty history now distinguish Project creation from a failed or
uncertain link. Provider receipt and Send uncertainty retain precedence. Old API replies lacking
the optional field remain readable. Stored outbox/session/compaction/election formats are unchanged.

The explicit Headless `project-retry` action routes to `retryProjectCreate`, the same catalog owner
used by desktop IPC. It requires local configure **and** send grants, approved project workspace,
the observed failed/uncertain state and timestamp, and a stable operation UUID. An uncertain
creation additionally requires `allowDuplicate: true`; no GET or status display creates a Project.
The owner rechecks state/timestamp inside its serialized write. Duplicate operation UUIDs return
the original result; stale observations fail before effects. A concurrent change at the owner
returns `retried: false`. The existing companion creates the replacement through native UI and
only a verified native Project id releases queued openings. No opening falls back to the root.

For operator use, first read the authenticated `/v1/remote/projects` response. After reviewing
the affected queued inputs and any duplicate-Project risk, POST the following through the same
local authenticated control API, substituting the inspected values:

```json
{
  "id": "NEW_OPERATION_UUID",
  "projectId": "APPROVED_LOCAL_PROJECT_UUID",
  "expectedState": "failed",
  "expectedUpdatedAt": 0
}
```

The route is `/v1/remote/project-retry`. For an inspected `uncertain` link, use that state and
include `allowDuplicate: true` only after explicitly accepting that risk. Creating a replacement
may release previously accepted openings; inspect them before this action. Never edit ledgers or
mark messages delivered manually.

## Validation record

Five integration regressions failed before the diagnostic change because the real authenticated
API omitted `projectWait`. They pass afterward for requested, claimed, creating, failed and
uncertain links. Each follows real Discord controller admission, the real outbox and API, proves
the input is withheld from companion status, checks admission/status/empty history, then verifies
a linked Project clears the diagnostic and publishes the exact original input. Reads leave the
row unchanged. Three new repair-action regressions also failed before the action existed.

Additional coverage checks conditional concurrent retries, stale observation rejection, duplicate
operation replay, configure/send grants, explicit uncertain-creation confirmation, bounded private
error projection, and precedence of actual delivery receipts. Before the repair action was added,
the five focused suites passed 476 tests; the final action/owner run passed 32 tests.

Final commands used Node 24.19.0 and npm 11.6.2 on the local unprivileged Linux checkout:

| Check | Result |
| --- | --- |
| `COS_TEST_WORKERS=4 TAR_OPTIONS=--no-same-owner npm run verify` | **8,685 passed, 162 skipped, zero failures** across 346 files: main 8,679 passed/140 skipped in 458.44 s; serial native/shutdown 6 passed/22 skipped in 3.16 s. Includes privacy/notices checks and both TypeScript checks. |
| `npm run build` and `npm run discord:build` | Both passed on final production source. |
| `npm run verify:deployment` | All 11 maintenance/backup drills and shell, unit and read-only swap checks passed. |
| `COS_XVFB_EXECUTABLE=/tmp/cos-xvfb/extracted/usr/bin/Xvfb COS_SMOKE_BROWSER=/usr/bin/brave-browser npm run verify:headless` | Passed again on the final bundle: real unprivileged Electron/Xvfb and Brave, no workspace windows, persistent isolated profile, stop/restart and credential cleanup. This smoke uses no provider account. |
| `git diff --check` | Passed. |

Standard skips remain platform-native and opt-in live probes; they were not counted as passes.
An earlier full run was cancelled when the operator authorized Project repair and the action
was added; the final complete run above covers the final action and diagnostic source together.

## Live acceptance scope

Private root-only snapshots of existing app state, sessions, bot state/config and installed code
were saved before changes; the pre-existing encrypted backups were retained. No credential,
private prompt, project path, provider id or production input UUID is included in this report.

On the managed Headless backend and dedicated Brave profile, the shipped Discord controller was
invoked with isolated synthetic interactions and its real authenticated local API. One fresh,
unfiled greeting received a real provider Send receipt, exact conversation binding, recorded
`DELIVERY_OK` assistant reply and completed turn. A real follow-up through `/ask` received its
own receipt and recorded `FOLLOWUP_OK` reply in that same local session. The eleven previously
queued rows were compared against the private snapshot and were unchanged at that point.
The real Discord gateway connection was confirmed independently in the bot service journal.

The operator subsequently explicitly authorized repairing the failed Project and allowing its
queued requests to proceed. The final main bundle and two changed Discord runtime files were
installed with the bot/backend briefly stopped; Brave and its profile were retained. Installed
SHA-256 values matched the tested artifacts. The new explicit repair action created one native
Project through the existing companion owner and verified it as linked.

Five original inputs then acquired real Send receipts. Six ended before Send authorization with
the existing "Requested model or reasoning could not be confirmed" error. A fresh isolated test
with the same requested model/effort succeeded. These facts establish a burst-time preparation
failure, not its internal cause; no speculative selector, timeout or account fallback was added.

After inspecting all six original failure rows (no authorization, delivery or message id, exact
pre-Send model error), the operator-authorized work was completed with six sequential explicit
replacement attempts through normal remote `new` admission. Original text, project and requested
model/effort were retained. Each attempt's new UUID was saved before POST in a private durable
mapping; the script stopped on any failure or uncertainty and never repeated confirmed Sends.
All six replacements received real provider receipts, exact local conversation bindings, a
recorded assistant response and a completed turn. They performed no local tool calls. Original
failed rows and local sessions remain intact; they were not manually relabeled as delivered.
Together with the five original successful attempts, all eleven messages were delivered.

While acceptance was running, the live bot also recorded a new real Discord interaction as
`done`. Its operation UUID matched a settled backend `new`, a confirmed provider Send receipt
inside the repaired Project, an attributed local conversation, recorded assistant messages and
a completed turn. This observation verifies the actual gateway-to-provider path independently
of the synthetic interactions. No Discord-client command was impersonated by the agent, and
the user's live selected session was retained.

Backend, Brave and Discord services were confirmed active after the repair. The existing
compaction state, encrypted backups and durable histories were preserved. Native Project
creation remains an explicit provider action; unknown Send outcomes are never safe retry proof.
