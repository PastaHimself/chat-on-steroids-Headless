# Headless and Discord validation report

Validated locally on 2026-10-12. This is an implemented server edition with automated and
isolated runtime checks. It has **not** been certified by a live JCloud VPS reboot or an
authenticated Discord → ChatGPT → MCP task.

## Environment and scope

- Linux Mint 22.3, based on Ubuntu 24.04, x86_64; unprivileged local account.
- Node.js 24.19.0, Electron 44.3.0, TypeScript 7.0.2, Vitest 5.0.2.
- Brave 154.1.96.61; an extracted official Ubuntu 24.04 Xvfb package on a private temporary display.
- Separate Discord dependency lockfile, discord.js 14.27.0; mocked Discord transport in tests.
- No live account credentials, provider sessions, bot registration or privileged system changes were used.

Architecture inspection covered the named startup, browser, bridge, Goal, worker, Control API,
session, MCP, plugin, renderer/preload and extension owners and their relevant tests. The shared
owner map and additive endpoint surface are in [architecture](headless-architecture.md).
The existing desktop remains the default; server mode retains Electron and a graphical browser
on Xvfb. This is not a claim of display-independent or native Chromium headless operation.

## Results

| Check | Result |
| --- | --- |
| `COS_TEST_WORKERS=2 COS_TEST_RETRY=1 GITHUB_ACTIONS=true npm run verify:ci` | Exit 0: 8,386 passed, 162 skipped across 334 test files; no flaky-retry warning in this final run |
| Root and standalone Discord type checks | Passed as part of `verify:ci` |
| Existing public-history privacy check | Passed; repeated after the implementation commits |
| Root/native and Discord third-party notices | Passed; Discord notices cover 26 production packages |
| `npm run build` | Passed; existing Vite mixed-import/chunk notices remain |
| `npm run discord:build` | Passed |
| `node scripts/generate-discord-reference.mjs --check` | Passed: all 32 actual registered command definitions match the reference |
| `npm run verify:deployment` | Passed: shell syntax, non-root refusal for privileged installers, unit syntax and read-only existing swap inspection |
| `npm run verify:headless` with real Xvfb and Brave | Passed: authenticated loopback listener, zero BrowserWindows, dedicated profile, clean SIGTERM drain and endpoint removal |
| Optional Brave portion of the smoke | Passed: live graphical process, persistent profile, same-profile handoff, owned process-group stop and restart |

The main test phase had 318 passed/14 skipped files and 8,380 passed/140 skipped tests.
The existing serialized computer/shutdown phase had one passed/one skipped file and
six passed/22 skipped tests. Platform and live-plugin suites were skipped according to their
existing guards. Windows/macOS native behavior and live external plugins were not verified here.

Unit/integration coverage includes actual durable outbox admission, real reserved session
opening, Goal/Loop controls and objective persistence, strict UUID replay fencing, corrupt-state
refusal, composer approval/checkpoints separated from `update_plan`, and raw-stage preservation.
Existing worker broker/worktree tests exercise the extracted shared admission owner. The added
Discord suites exercise all command registration, owner-bound confirmation, permission revocation,
help discovery, interrupted/stale setup, two-administrator conflicts, failed writes, local session
identity through compaction, requested versus observed models, token rotation, redaction and
notification completion/reconnect evidence. A real API listener test checks shared credential
file permissions under service `UMask=0077` and refuses an unsafe shared directory.

## Reproduce locally

Install both lockfiles, then use Node.js 24 as a normal user:

```sh
npm ci
npm run discord:install
COS_TEST_WORKERS=2 COS_TEST_RETRY=1 GITHUB_ACTIONS=true npm run verify:ci
npm run build
npm run discord:build
node scripts/generate-discord-reference.mjs --check
npm run verify:deployment
COS_SMOKE_BROWSER=/usr/bin/brave-browser npm run verify:headless
```

The last two checks require Linux, systemd tooling, Xvfb, xauth and xdpyinfo. Optional
`COS_XVFB_EXECUTABLE` selects an absolute extracted Xvfb executable; `COS_SMOKE_ELECTRON`
selects a verified installed Electron executable when the checkout's sandbox helper is not
provisioned. The [deployment guide](headless-vps.md) orders installation before these runtime
checks. Neither smoke installs units, activates swap nor contacts an account.

## Verification history

The initial baseline run overlapped early startup edits, so it is not a frozen clean-tree
baseline. It recorded 8,343 passed, 140 skipped and one failed test: the startup VM fixture
needed the new `headless=false` default. The fixture was updated.

An intermediate complete run exposed an old exact health-route-array assertion after additive
routes were introduced; that assertion now checks the existing routes without forbidding
new ones. A subsequent full run encountered an unchanged renderer timing assertion
(`retains a visible collapsed group beyond the normal resident target and still admits newer data`),
which expected 400 DOM rows and observed 390 within its two-second wait. The whole renderer
timeline suite then passed separately. The final full run used the repository's existing
one-retry/report policy and passed without any reported retries. Renderer logic and timing
assertions were not relaxed.

## Remaining live acceptance checks

These require a disposable Ubuntu 24.04 VPS and the operator's own authorized accounts:

1. Run the privileged installer; verify separate service accounts, permissions, sandboxing and actual units.
2. Provision/unlock the encrypted keyring, pair the existing extension, sign in interactively,
   approve workspaces/tools and connect the normal MCP tunnel.
3. Register commands in the intended Discord guild. Exercise `/help`, every `/setup` section,
   explicit user/channel grants and unauthorized-user/component rejection on Android.
4. Run supervised `/new` and `/ask` tasks, observed model/reasoning selection, Goal and Loop,
   composer review/edit/approval, executor `update_plan`, checkpoints and worker operations.
5. Verify queue cancellation, native Stop confirmation, pause/resume and Compact & Resume's
   unchanged local identity. Confirm actual delivery receipts and final notification evidence.
6. Interrupt/restart backend, browser and bot; disconnect/reconnect MCP and Discord; verify
   pending and uncertain inputs are not duplicated. Expire the login and verify human intervention.
7. Reboot with no SSH session. Verify target dependency recovery, persistent browser/profile,
   secret storage, bot connection, workers, compaction recovery and notification checkpoints.
8. Measure memory, CPU/load, swapping and latency under two workers before increasing limits.
9. On a disposable snapshot only, activate optional ZRAM/disk swap, rerun idempotently,
   reboot, verify priority/compression and perform the guarded rollback.

Systemd syntax validation maps not-yet-installed executable paths to local verified paths;
it is not evidence that the installed services ran. Swap verification only inspected the
host's existing swap. Privileged installation, service/keyring boot behavior, swap activation
and rollback were intentionally not performed on this computer.

## Operational limitations

Authentication and account eligibility remain provider-controlled. Pairing/MCP readiness does
not establish ChatGPT sign-in. Browser last-session restoration can require manual intervention
after a crash; background flags do not establish tab-discard immunity. An acknowledged final
turn is reported as a recorded completion, not independent proof of whole-task correctness.

Receipts, plans, panels, notifications and bot state have explicit caps. A busy service needs
the manual settled-receipt maintenance described in [operations](headless-vps.md#6-operations-monitoring-and-recovery).
Uncertain effects fail closed and require owner-state inspection; they are never blindly replayed.
Known credential shapes and local tokens are redacted, but arbitrary unlabeled secrets in
conversation prose cannot be reliably detected. Use explicitly authorized private channels.
