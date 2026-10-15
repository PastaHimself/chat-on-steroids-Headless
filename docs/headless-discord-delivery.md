# Headless Discord delivery repair — 2026-10-15

This repair starts from `main` at `ecb2ffba3c101c4122f2306f3a761ac0c03fcd24`
(merged PR #20). Development and tests use the local checkout and disposable state.
No production VPS, project worktree, queued production message or existing PR was accessed
or modified. The upstream repository was not a write target.

## Findings and evidence limits

The supplied incident proves durable admission without a browser claim. It does **not**
include the private outbox row, project-link state, actual extension `/status` reply,
opening election, tab inventory or document registrations. Consequently it cannot establish
which guard or election stranded that particular input. This report distinguishes source
defects reproduced in isolation from an unverified diagnosis of that production incident.

Four delivery defects were reproduced:

1. **Desktop browser preference leaked into Headless.** Both built-in-browser startup and
   browser wake/open selection read the saved `ui.chatBrowser`. Temporary desktop bootstrap
   selecting `cos` therefore starts that browser on the next Headless launch. Its companion
   can compete with Brave for first-browser opening custody, or browser wake can route to
   the built-in browser instead of the dedicated external profile. The new runtime selection
   owner resolves Headless to Brave while preserving the saved desktop preference.
2. **Unbounded sign-in scripting blocked input polling.** `maintainOnce` waits for
   `chatGptSignedIn` before `/status`. The four-second timeout was inside the injected page
   function; it could never fire if Chrome did not execute the script. Pairing, recording
   and wake connections can remain active independently of this blocked maintenance flight.
   The existing worker-side `browserReply` bounds that observation at five seconds, returning
   unknown. A late result grants neither login proof for that pass nor another input offer.
3. **Persisted opening election could strand unsent work.** Only `preparing` elections
   could reprepare an idle elected page. A `ready` election with a vanished marker waited
   forever. Persisted tab ids also prevented adoption when browser restart restored the
   exact marked page under a different tab id. Recovery now either adopts one existing
   exact-marked page, or re-prepares the same elected idle document after fresh proof. It
   never treats a missing page or reply as new tab-creation authority. New ready records
   retain document/epoch; replacement documents and extra navigation fail closed.
4. **Background and content disagreed about markers.** The coordinator offered query or
   hash markers, but ordinary fresh-page content accepted only a query marker. A hash-only
   offer could never claim. Both now require one exact owner, accepting query or hash and
   rejecting contradictory markers. Hash-owned pages are also excluded from idle reuse.

The previous Discord diagnostics are retained. The extension additionally reports a bounded
stage/reason observation from its existing election on the next authenticated `/status`.
The input owner durably stores `browserPreparation`, accepting only fixed codes and only
before Send authorization. Control API and Discord project this as the **last observation**,
never a receipt, permission to retry, or evidence of success.

## Desktop versus Headless

The desktop built-in browser runs a different persistent Electron partition, browser host
and extension worker lifecycle. Its success demonstrates a functioning route through that
browser and Core, not Brave delivery or Discord acceptance. Headless had no runtime override
for the persisted desktop choice. Even with Brave correctly selected, the independent
maintenance, election and marker defects above can block its input claim. The production
browser selection and actual blocking stage remain unverified. GPU, mmap, Sharp and network
warnings are not established causes; no sandbox, AppArmor, permissions or service restrictions
were relaxed.

## Pipeline and source owners

Paths below are repository-relative; line references describe the repaired source.

| Stage | Owner and relevant implementation |
| --- | --- |
| Discord authorization and one interaction UUID | `discord/src/bot.ts::DiscordController.operation`, `command` (`new`, `ask`); `discord/src/state.ts` |
| Remote grant, operation fence and admission | `src/main/remote-control.ts::serveRemoteAction`; `src/main/control-api.ts` |
| Durable admission, reservation and async startup | `src/main/session/start-input.ts:76`, `sendDesktopInput`; `src/main/session/input.ts::enqueueInput`, `materializeOpening` |
| Effective runtime browser | `src/main/browser-selection.ts:6`, `selectedChatBrowser`; used by browser, startup, built-in lifecycle/host, bridge, IPC and shell |
| OS wake without a workspace window | `src/main/browser-startup.ts::wakeBrowserUrl`; `src/main/browser.ts::isPreferredBrowserRunning`, `openInPreferredBrowser` |
| Publication | `src/main/session/input.ts::preparable`, `browserInputAllowed`, `pendingBrowserInputs`; `src/main/bridge.ts` `/status`, browser custody filtering |
| Polling and election | `extension/background.js::maintainOnce`, `deliverDesktopInputs`, `inputReuseProbe`, `prepareDesktopInputReceipt` |
| Page preparation and exact claim | `extension/content.js::prepareDesktopInputPage`, `acceptDesktopInput`; `extension/background.js::HANDLERS.desktop_input`; `src/main/bridge.ts` `/input/claim` |
| Final Send fence | `src/main/session/input.ts::authorizeBrowserInput`; content `acceptDesktopInput`; `extension/chatgpt-dom.js` native composer/model/Send operations |
| Receipt, attribution and recording | `ackDesktopInput`, `bindPendingInputProject`; `/input/bind`, `/input/ack`; `input.ts::bindBrowserInputProject`, `acknowledgeBrowserInput`; `session/recorder.ts`, `session/store.ts` |
| Status/history | `src/main/control-reads.ts::projectInput`, session read model; `discord/src/bot.ts::statusPanel`, `historyPanel`; `discord/src/ui.ts::inputDeliveryDescription` |
| Last browser-stage observation | `input.ts::noteInputBrowserPreparation`, optional `browserPreparation`; bridge `/status` `inputPreparation`; coordinator election `waitReason` |

`pendingBrowserInputs` does not equate queued with publishable. It requires a preparable,
due row, correct session/transport and completion boundary, no local setup failure, and a
linked native Project when one is configured. Bridge additionally filters live tool/tunnel
and browser custody. A valid unbound desktop reservation is publishable, as the real-HTTP
integration verifies. The supplied production facts do not prove its native Project was linked
or its other guards passed. Model availability is validated separately by the remote API and
native content preparation. Startup/setup errors, Project state, claimed/model failure and
browser preparation observations must be inspected independently.

`deploy/start-browser.sh`, `start-backend.sh` and both systemd units retain their dedicated
profile, graphical display, unprivileged users, private keyring and sandbox settings.

The hypothesis audit is independent: H1, H3, H4 and H5 have reproducing source tests above;
H9 had missing election-stage projection and now has durable observation tests. H2's publication
guards are exercised without bypassing them; the incident's private project/ledger facts are
insufficient to prove its publication. H6 retains durable admission and the existing async
startup/error, cancellation, wake coalescing and pre-Send recovery rules; the tests did not
establish an additional startup-owner defect. H7's native Project and account model conditions
remain separate guards with existing regression coverage, not established incident causes.
H8 has isolated sandboxed Electron/Brave and deployment evidence, but no production kernel or
service-level reproduction. No warning was promoted to a root-cause claim by itself.

Production file changes (tests and documentation are listed separately):

| File | Changed functions or contract |
| --- | --- |
| `src/main/browser-selection.ts:6` | New `selectedChatBrowser`, runtime-only choice |
| `src/main/browser.ts:52` | `isPreferredBrowserRunning`, `openInPreferredBrowser` at line 255 |
| `src/main/browser-startup.ts:8` | `wakeBrowserUrl` uses the same effective selection through its async probe |
| `src/main/cos-browser/selection.ts:50` | `syncCosBrowser`, opt-in module loading |
| `src/main/cos-browser/index.ts:68` | `syncCosBrowser`, running built-in browser lifecycle |
| `src/main/cos-browser/host.ts:658` | `CosBrowser.googleSignIn`, `launchSignIn` at line 746 |
| `src/main/index.ts:361` | `refreshTray` projects the effective browser |
| `src/main/ipc.ts:1189` | `link:open` and `cosBrowser:show` runtime selection guards |
| `src/main/bridge.ts:2405` | Built-in sign-in route/current-owner guard; `/status` at line 2544 admits bounded preparation observations |
| `src/main/session/input.ts:57` | Optional diagnostic schema; `noteInputBrowserPreparation` at line 1161 commits observations without delivery transitions |
| `src/main/control-reads.ts:399` | `projectInput` projects the optional diagnostic |
| `src/shared/control-api.ts:314` | Additive `ControlApiInput.browserPreparation` wire field |
| `extension/background.js:2202` | `inputIdFromUrl`; `deliverDesktopInputs` at line 2217; `maintainOnce` at line 3191; `HANDLERS.desktop_input` at line 3948; recorder version; `askChatGptSignedIn` at line 5583 |
| `extension/content.js:39` | Recorder 24; `acceptDesktopInput` at line 12810 uses exact query/hash markers; `inputReuseSafe` at line 13430 protects hash-owned openings |
| `discord/src/ui.ts:99` | `inputDeliveryDescription` separates last preparation from receipt evidence |

Tests changed: `content-script`, `control-api-reads`, `cos-browser-opt-in`,
`desktop-input-maintenance`, `discord`, `extension`, `headless`, and
`input-delivery-integration`. `test/fixtures/desktop-input-worker.ts` extracts the existing
coordinator fixture for reuse by the real-HTTP integration. `AGENTS.md` records the runtime,
election and optional diagnostic contracts; this document records evidence and operator steps.

## Safety and compatibility

- The outbox UUID, reserved session, project, frozen text, claim owner, authorization,
  receipts, compaction tickets, Goal and worker ledgers are not cleared or migrated away.
- `pendingBrowserInputs` excludes authorized/uncertain Sends. Recovery consumes the existing
  offer; the serialized backend claim and one-time `sendAuthorizedAt` remain authoritative.
  Pre-authorization custody may transfer, but only its current owner can authorize Send.
- A different tab id is adopted only from an existing exact marker. Two marked windows elect
  one tab. No missing/closed/stale page or absent response authorizes `tabs.create`.
- Same-tab preparation requires current document/epoch, stable URL, no pending navigation,
  an explicit idle proof and a fresh tab read. Drafts, attachments, work, pins, another input
  marker and native Project routing retain their fences. A prior fallback remains spent.
- A failed authorization never submits. Lost Send ACKs remain receipt custody; an exact late
  receipt settles the original UUID. Diagnostic state cannot authorize or replay a tool call.
- Existing election formats and the `desktopInputTabs` migration still load. New diagnostic
  and election metadata are additive and optional. Legacy rows require fresh idle proof;
  rows lacking sufficient live proof remain held rather than guessed at.
- Recorder version advances from 23 to 24 in both participants so ordinary reinjection can
  replace a healthy older content script. App version and bridge protocol remain unchanged.
  An installed extension update may require the operator's normal reload; in-flight work is
  not forcibly reloaded to update it.

## Regression evidence

Fail-first tests run against an isolated copy of merge commit `ecb2ffba`, with current tests
and shared fixture but original production code. They reproduce the saved-browser leak,
unexecuted sign-in script, ready-election marker loss, hash-only claim refusal, conflicting
marker claim, lost-marker Discord integration, and absent durable/browser-stage diagnostics.
Separate pre-fix runs also reproduce changed tab-id adoption failure for query and hash.
The same tests pass after repair. No production data is used in fixtures.

The new lifecycle integration uses the real Discord controller and state store, real
authenticated control/bridge HTTP servers, actual durable outbox/session owners and the shipped
extension coordinator. Scenarios cover no initial tab, safe home reuse and a persisted ready
election after marker loss. Each verifies one admission, an offered input, claim, single Send
authorization, exact synthetic receipt, session attribution, recorded assistant history,
Discord status/chat, and a successfully delivered follow-up `/ask`. Chrome APIs, native page
preparation and provider responses in this integration are simulated. Separate content tests
run shipped content/DOM code in jsdom. Neither establishes authenticated provider acceptance.

| Required regression family | Evidence |
| --- | --- |
| `/new` one durable input; `/status` projection; offered but not claimed | New real-HTTP/coordinator integration; `discord`, `opening-input`, `input-startup` |
| No tab, reusable signed-in-shaped home, unsafe reuse/new tab | `desktop-input-maintenance`; new integration no-tab/home cases |
| Native New Chat URL transition, delayed composer, delayed model surface | `content-script`, `chatgpt-dom-input`, `model-picker-state`, `desktop-input-maintenance` |
| Marker consumed/changed, stale ready election, document/epoch changed, tab disappears | New marker/election cases and neighboring refusal tests; `extension`, `content-script` |
| MV3/browser restart, reconnect/backend restore, older outbox/elections | `desktop-input-maintenance`, `extension`, `bridge`, `opening-input`, `input-startup` |
| Desktop to Headless choice | New `headless`, `cos-browser-opt-in` regressions; `browser-startup`, `browser` |
| Native Project and local project binding | `desktop-input-maintenance`, `content-script`, `projects`, real opening/bridge integration |
| Claim/authorization once, failed authorization, two-window custody | New integration; `session-input`, `bridge`, `extension`, `content-script` |
| Lost ACK, uncertain Send, exact late receipt, duplicate observations | `desktop-input-maintenance`, `opening-input`, `input-delivery-integration`, `session-input` |
| Correct history, assistant response and `/ask` | New Discord-to-recorder integration; `content-script`, `session-input-history` |
| Existing Goal, workers and Compact & Resume | Full verification includes `goal*`, `agents*`, `swarm*`, `continuation`, `resume`, `handoff-generation-identity`, bridge/content integration |

## Operator-only rollout and acceptance

These are instructions, not actions performed by this investigation. Review and merge the PR
deliberately before production deployment. First test the exact revision on a disposable Ubuntu
24.04 VPS with an authenticated dedicated Brave profile and a private test Discord channel.
Do not run coding workers against unfinished production work for acceptance.

1. Build and verify the reviewed checkout as the ordinary operator. Keep the existing encrypted
   backup unchanged; create an additional uniquely named encrypted snapshot using the installed
   maintenance helper. It stops the target and preserves matching code, data, bot state,
   profile, keyring, projects, units and ownership. Retain the keyring and backup passwords.
2. Follow `docs/reliability-rollout.md#local-update-backup-and-restore`. From the verified checkout,
   run the documented `sudo ./deploy/install-ubuntu.sh --update`. It stages/verifies the update
   and leaves services stopped. Keep the independent recovery guard and previous installation.
   Do not substitute a fresh data directory or clear any outbox/election state.
3. After local receipt review and any required hold reconciliation, explicitly start the
   existing target. Use the localhost-only interactive browser procedure to confirm the
   intended dedicated Brave profile is signed in, the new worker is loaded, and the page
   reports recorder 24. Do not reset extension storage or reload a generating page merely
   to test delivery. Headless no longer needs a desktop window or saved browser-setting edit.
4. Read the old input before considering new work. The following operator-only local read
   prints selected ledger facts without its prompt, credentials or conversation contents:

   ```sh
   sudo -u cos-backend env INPUT_TO_INSPECT='REPLACE_WITH_PRIVATE_INPUT_UUID' /usr/local/bin/node --input-type=module <<'NODE'
   import fs from 'node:fs/promises';
   const rows = JSON.parse(await fs.readFile('/var/lib/cos-backend/app/state/session-input.json', 'utf8'));
   const input = rows.find(row => row.id === process.env.INPUT_TO_INSPECT);
   if (!input) throw new Error('Input absent; inspect retained state locally. Absence does not authorize replay.');
   const keys = ['id', 'sessionId', 'conversationId', 'state', 'transportIntent', 'dueAt',
     'offeredAt', 'requiresAuthorization', 'sendAuthorizedAt', 'deliveredAt', 'deliveredSessionId',
     'messageId', 'browserPreparation'];
   console.log(JSON.stringify(Object.fromEntries(keys.map(key => [key, input[key] ?? null])), null, 2));
   NODE
   ```

   Supply `INPUT_TO_INSPECT` explicitly through the operator's environment for the previously
   queued UUID. Do not print or export the whole ledger. Also use authenticated read-only
   `/v1/inputs`, session detail/events and `/operations` locally, plus the paired extension's
   election/tab/document inventory. A bounded API page may omit an older input.

5. Correlate the **same UUID**, reserved local session, selected native Project and exact
   browser document. Look for publication, last preparation stage, browser claim, authorization,
   native conversation/message receipt, matching session binding and recorded answer. An
   authorized/uncertain row must not be resent; only its exact receipt can settle it. A missing
   elected tab remains conservatively held. Never delete the election or create a replacement
   request just because Discord still says queued.
6. Only on the disposable authenticated acceptance environment, exercise a fresh harmless
   `/new prompt:Hello`, verify one native submission and receipt, inspect `/status` and `/chat`,
   then `/ask`. Verify the recorded answer belongs to the same session after backend/worker
   restart. Record actual provider/Discord evidence before declaring live acceptance.

For the incident input, supply the UUID from the private incident report; it was not used as
test data or resent here. For infrastructure
only, run the documented `deploy/healthcheck.mjs --connected`; its healthy result is not delivery
proof. If rollback is needed, retain matching code/data and reconcile provider effects using the
encrypted snapshot and maintenance guard. Do not roll back by deleting ledgers or weakening
sandboxing.

## Validation results

Environment: unprivileged Linux Mint 22.3 (Ubuntu Noble base), Node 24.19.0, npm 11.6.2,
Electron 44.3.0, graphical Brave 154.1.96.61. Node/npm were selected in the development PATH;
dependencies were installed with `npm ci` and `npm ci --prefix discord --ignore-scripts`.
No verification script, sandbox or platform guard was weakened.

| Command | Actual result |
| --- | --- |
| `COS_TEST_WORKERS=4 TAR_OPTIONS=--no-same-owner npm run verify` | Passed. Privacy/notices/native-source metadata, app/Discord type checks and Electron resolution passed. Main Vitest: 330 files passed, 14 skipped; **8,666 passed, 140 skipped**, 0 failures. Serialized native/shutdown stage: 1 file passed, 1 skipped; **6 passed, 22 skipped**, 0 failures. Total **8,672 passed, 162 skipped** across 346 files. |
| `npm exec -- vitest run test/extension.test.ts test/input-delivery-integration.test.ts test/desktop-input-maintenance.test.ts --maxWorkers=2` | **860/860 passed**, including the three new Discord-to-recorder scenarios and final coordinator repairs. |
| `npm exec -- vitest run test/desktop-input-maintenance.test.ts test/discord.test.ts test/headless.test.ts test/cos-browser-opt-in.test.ts test/browser-startup.test.ts test/browser.test.ts --maxWorkers=2` | **281 passed, 1 platform skip**. |
| `npm exec -- vitest run test/control-api-reads.test.ts --maxWorkers=1` | **73/73 passed** on the final explicit diagnostic projection. |
| `npm run typecheck` | Passed independently on final source; Discord types also passed in full verification. |
| `npm run build` and `npm run discord:build` | Both passed. Main application rebuilt after the final read-projection edit. |
| `node --check extension/background.js`, `node --check extension/content.js`, `node --check extension/chatgpt-dom.js` | All passed. |
| `COS_XVFB_EXECUTABLE=/tmp/cos-xvfb/extracted/usr/bin/Xvfb COS_SMOKE_BROWSER=/usr/bin/brave-browser npm run verify:headless` | Passed on real unprivileged Electron/Xvfb and Brave: authenticated disposable API, no workspace BrowserWindows, isolated persistent profile, clean SIGTERM/credential removal, same-profile handoff, process-group stop and browser restart. No account used. |
| `npm run verify:deployment` | Passed all **11** maintenance/encrypted-backup/restore drills, shell/privilege/unit validation and read-only swap checks. No installation, production service action or swap activation. |
| `git diff --check` | Passed. |

Fail-first evidence is intentional failure, not a final red check: the selected isolated-base
run had **9 failures, 4 passes and 1,474 selection skips**. Separate tab-id tests had **2
failures and 190 selection skips** before their repair. Initial focused reproduction had 5
failures and 2 passes. An intermediate full run had 8,662 passes, 140 skips and 2 failures
(the new diagnostic-field allowlist and sign-in stall regression); both were corrected before
the clean final full run above. Earlier fixture mistakes were corrected without changing
production behavior to accommodate them.

The first Headless smoke attempt timed out because Xvfb was absent. The official Ubuntu
Noble Xvfb package was downloaded and extracted only under `/tmp`; the unchanged smoke then
passed twice with its explicit executable override. The temporary runtime was not installed
system-wide. Standard skips cover Windows/macOS native desktop, WSL and opt-in live plugin
probes. jsdom's expected missing canvas implementation warning is not live rendering evidence.

No authenticated ChatGPT/Discord transport, account eligibility, live installed extension,
production UUID, Ubuntu VPS systemd lifecycle, privileged install/reboot, deployment or long
authenticated soak was tested. In particular, passing the graphical browser smoke is distinct
from a live Brave-companion claim and native provider receipt. Those remain operator acceptance
gates on an isolated authenticated environment before production rollout.
