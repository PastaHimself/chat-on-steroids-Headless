# Reliability rollout and live acceptance

This change implements local recovery and observability mechanisms. A passing automated
suite does not certify an authenticated VPS or unattended task delivery. Do not install this
branch for daily unattended work until the corresponding live gate below is recorded.
The target remains Ubuntu 24.04 amd64 with Electron, Xvfb and the dedicated graphical Brave
profile. Browser login, keyring unlock and provider approvals remain interactive.

The [long-session implementation and soak procedure](long-session-reliability.md) records the
2026-10-13 recovery fixes, nine upstream comparisons, deterministic multi-hour cases and the
decision to keep timed rotation disabled. Recording quota pressure and incomplete history now
appear in health; an incomplete history blocks automated decisions without discarding intent.
Authenticated 4/8/12/24-hour acceptance and server-side cancellation proof remain pending.

The [October 15 follow-up](reliability/long-run-upgrade-2026-10-15.md) adds durable provider
deadlines, handoff send-receipt repair, plugin/worktree fixes and optional ordinary fresh turns
(still Off by default). Its [reviewed rollout](headless-long-run-rollout.md) retains the same
backup and reconciliation requirements; no production deployment was performed.

## Health and operator controls

`GET /v1/remote/health` is authenticated and read only. Every component includes a state,
observation time, explanation and suggested local action. Backend availability is distinct
from task readiness. Account eligibility and provider delivery remain **unknown** unless
an exact operation/input/session receipt proves the specific action. A healthy process,
paired extension or connected tunnel cannot prove sign-in.

Discord `/monitor` and the local `deploy/healthcheck.mjs` use this projection. `--ready`
exits 2 while task readiness remains unproved; an unreachable service exits 1. Desktop
Workspace → Health → Run checks shows the component observations, also recorded in Activity
and its Diagnostics report.
Resource snapshots are shared for five seconds and carry their observation timestamp.
Pressure alerts recommend investigation; they never terminate tasks or resize worker limits.

In private administrator `/setup`, Notifications has an **on/off** field for operational
alerts. Confirm Save publishes the choice. Alerts are off by default. Enabled alerts poll
every 30 seconds, report after two failures, and update the same message after two successful
checks. Episodes, message identity and uncertain publication intent survive restart. A lost
message-create response is reconciled from its exact marker; absence of proof never causes
another creation. Observation gaps are reported after reconnect. Unknown account state is
shown by health but does not generate a fabricated sign-in failure alert.

`/status` shows the project, requested next model, observed model, automation, delivery
proof and recovery state. Details contains technical identities. `/operations` lists hot
receipts for the selected session; `/operation id:<UUID>` can inspect a retained or archived
identity. **Check receipt**, **View queue**, and **View history** only read evidence. Checking
an uncertain receipt never resends a request. All actions retain per-click permission and
panel-owner checks; setup retains stale-draft refusal and explicit partial-save explanations.

## Durable controls and receipt upkeep

Combined Goal saves record a version 2 journal for objective, switch and reply-obligation
rows. The existing Goal serialization queue commits all three owner ledgers before publishing
memory. Concurrent replies cause rebasing; superseded session ownership rejects the save and
repairs from accepted owners. Startup resolves incomplete transactions before browser traffic.
Conflicting recovery state refuses startup for local reconciliation. Failed repairs hold Goal
execution and further control saves. Individual Goal saves retain their existing commit barrier.
A paired conversation can save controls before its local recording session is created; this
provisional intent cannot create a worker/helper execution authority.

Backend and bot receipt stores migrate to version 2 with an original version 1 backup before
publishing the migration. A backend rejection is settled only when the adapter proves it failed
before an owning mutation began. A timeout, transport failure or failure after that boundary
stays uncertain. Admission and subsequent inspection preserve the original operation identity.

Hourly upkeep archives settled receipts older than one hour, also running before admission
at 80% of the 1,000-backend/2,000-bot hot limits. Unresolved receipts, active plans and
notification checkpoints stay hot. Each archive writes the bulky payload and then a private,
permanent replay fence before deleting the hot row. Deterministic SHA-256 fan-out paths keep
identity, fingerprint and outcome. Restart after fence publication safely repeats cleanup,
never execution. Payloads expire after 30 days in bounded passes; fences do not expire.
Archived IDs are permanently denied execution, including conflicting fingerprints. Failed
writes, damaged identity records or insufficient working space refuse unsafe admission.
Permanent fence count grows with distinct accepted identities; measure bytes and inodes in
addition to bounded hot state and the 30-day payload window. Never remove fences to free space.

## Local update, backup and restore

Build both packages and pass their automated checks before installation. The Ubuntu installer
uses `deploy/maintenance.py`, which stages the full code tree and managed units, records a
checksum/ownership inventory, flushes it and verifies it before stopping services. A durable
replacement journal records preparation, stopping, replacement and commit. Previous code and
units remain in `/opt/chat-on-steroids/previous-<UUID>` with paths mapped by `installation.json`.
An interrupted replacement rolls back while services are stopped. Recovery code lives outside
`current/`, so it still exists if that directory replacement was interrupted. The systemd
recovery unit runs before every runtime unit; interrupted boot recovery fails the gate after
rollback and durably requires explicit local review, `maintenance.py recover`, reset and start.
Another reboot cannot bypass that review requirement. Maintenance never starts services.

For the first upgrade from the original headless checkout, run the new helper from the
verified checkout: `sudo python3 deploy/maintenance.py bootstrap --source "$PWD"`, then back
up with that helper before installing. Bootstrap installs the independent recovery guard;
it does not replace the application. Legacy snapshots without format manifests are supported.
Restored legacy code is held at the systemd guard until local reconciliation, because it cannot
honor an application-level hold. Keep the guard and managed drop-ins through that recovery.

Run maintenance locally with sudo; runtime services remain under their existing service users:

```sh
sudo python3 /opt/chat-on-steroids/maintenance.py recover
sudo python3 /opt/chat-on-steroids/maintenance.py backup --output /private/cos-snapshot.gpg
sudo python3 /opt/chat-on-steroids/maintenance.py restore --input /private/cos-snapshot.gpg
sudo python3 /opt/chat-on-steroids/maintenance.py release-hold --reconciliation /private/reconciliation.txt
```

Backups are local AES-256-encrypted GPG archives with interactive passphrase entry. Passphrases
never appear in arguments, configuration or Discord. The snapshot includes matching installed
code, backend data, dedicated browser profile, keyring, bot state, configuration, projects,
managed units/drop-ins and service account ownership. Services stop before capture and remain
stopped afterward. Transient browser lock files are excluded. External links, special files,
invalid archive paths and writes through links are refused. Keep the backup destination outside
those source directories. Private staging contains plaintext only for the workflow and is
removed on normal completion; protect free space and reconcile interrupted staging locally.

Restoration stops the stack and verifies every checksum, file mode and owner before replacing destinations,
and checks the service account IDs. It restores matching code with data. A durable hold blocks
new delivery, model tools, automation, notification publication and worker revival. Local
read-only health/history/receipt inspection remains available. Compare restored operations
with what actually ran since backup, including Discord notifications, running provider turns
and external command effects. Record decisions in a private reconciliation file. Release uses
that file while the stack is stopped and requires an explicit subsequent local start.

`runtime/durable-formats.json` records supported formats; each data owner records its format
floor. Installers refuse a code-only rollback below a data floor. Do not bypass that check or
copy old code over current state. Restore the code's matching encrypted backup and reconcile
potentially repeated work instead. A backup is sensitive even when encrypted: retain its
passphrase separately and periodically verify restoration on a disposable host.

## Acceptance worksheet

Record operator, UTC time, code revision, VPS sizing, observed receipts and outcome for every
row. Use synthetic tasks with unique non-sensitive markers. Keep raw authenticated evidence
private; publish only redacted results. A receipt proves one observed operation, not the entire
request or an account's future eligibility.

| Milestone | Live drill | Required evidence | Current result |
| --- | --- | --- | --- |
| 1 | Real task delivery and zero/one/two workers | One exact admitted input, matching provider question/final/turn end and expected task result for each workload | Pending disposable VPS |
| 1 | Compaction and each component restart | Stable local session, exact continuation/worker receipts, no duplicate work | Pending |
| 1 | Expired login, lost tunnel and bot reconnect | Truthful blocked/unknown health, one alert episode, recovery after two successful observations | Pending |
| 1 | Reboot with no SSH session and 24-hour run | Enabled target revives normally, keyring remains usable, no unexplained lost/duplicated tasks | Pending |
| 2 | Sustained archive cycles beyond both hot limits | Fences survive restart, matching/conflicting IDs cannot execute, unresolved work remains inspectable | Automated fixture cycles passed; installed workload pending |
| 3 | Failed update and interrupted replacement | Previous code/units restored, no provider instruction silently resumes | Automated filesystem drills passed; privileged VPS drill pending |
| 3 | Encrypted backup/restore and incompatible rollback | Verified data/owners, held startup, recorded local reconciliation before release | Automated GPG snapshot, checksum and restore-hold drill passed; installed-stack drill pending |
| 4 | Phone and desktop walkthrough | Operator identifies session/project/model, inspects exact delivery and finds recovery action without raw records | Pending operator walkthrough |
| 5 | Seven-day soak | Hot state and payload growth bounded, permanent fence growth measured, no duplicate delivery or notification starvation | Pending |

For update drills, interrupt immediately before and after each directory move, rerun recovery,
and test reboot while `current/` is absent. Test rejected and uncertain mutations separately.
For restore drills, submit a task after the backup but before restore; verify the old snapshot
cannot silently repeat it. Use a provider account reserved for disposable acceptance work.

## Measurements and soak runs

The read-only sampler writes private JSONL with timestamps, health, available memory, backend
memory/CPU, browser RSS, swap counters/deltas, available disk/growth, hot receipt pressure,
worker count and API read latency. Run as an authorized local account able to read the Control
API credential. It re-reads credentials every request, including after a backend restart.
It does not create tasks or change worker limits. Label each representative task only after
confirming its actual worker count. Set two workers and a global cap of two through confirmed
setup for an initial VPS trial; preserve existing explicitly configured limits.

```sh
COS_CONTROL_DIRECTORY=/run/cos-control node scripts/benchmark-headless.mjs --label=idle --seconds=600 --output=/private/idle.jsonl
COS_CONTROL_DIRECTORY=/run/cos-control node scripts/benchmark-headless.mjs --label=task-0 --seconds=600 --output=/private/task-0.jsonl
COS_CONTROL_DIRECTORY=/run/cos-control node scripts/benchmark-headless.mjs --label=task-1 --seconds=600 --output=/private/task-1.jsonl
COS_CONTROL_DIRECTORY=/run/cos-control node scripts/benchmark-headless.mjs --label=task-2 --seconds=600 --output=/private/task-2.jsonl
COS_CONTROL_DIRECTORY=/run/cos-control node scripts/benchmark-headless.mjs --label=soak --seconds=604800 --output=/private/soak.jsonl
```

Measure Discord notification acknowledgement/visibility times separately against recorded event
timestamps. API latency does not prove Discord delivery. Notification scheduling uses two
concurrent read-only monitors, at most five event pages and a ten-second read budget per update,
exact saved cursors/evidence and outage backoff. Include a busy monitor with more than 100 events,
a slow monitor, a backend outage, credential rotation and channel permission revocation in the
soak. Compare percentile latency, sustained memory, swap activity, per-day disk/inode growth and
missed/duplicate markers before selecting hardware or making further performance changes.
