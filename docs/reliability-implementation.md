# Reliability roadmap implementation — 2026-10-12

Implemented the reliability roadmap against the existing headless backend, session, Goal,
worker, Control API, bot and deployment owners. No service was installed or enabled on the
development host, and no authenticated provider task or Discord message was sent.

## Changes

- Added a shared authenticated health projection, plain explanations and recovery actions
  to Discord monitoring, local health checks and desktop Activity/Diagnostics. Provider
  authentication and task delivery remain unknown when no exact receipt proves them.
  Opt-in operational alerts retain episode and publication identity across restarts.
- Added a serialized journal for combined Goal objective, mode and reply changes. Startup
  recovers exact owner rows before browser traffic. Stale changes repair from accepted
  state; failed repairs hold further Goal execution and saves. Worker Stop remains available,
  and helper identity remains fenced when disabling controls.
- Migrated backend and bot receipt storage with retained original records. Settled receipts
  archive hourly and at 80% hot capacity, after one hour. Private permanent replay fences
  precede hot removal; bulky payloads expire after 30 days. Confirmed pre-effect rejection
  is distinct from uncertain execution. Read-only receipt listing/inspection never resends.
- Added staged, verified VPS updates and durable directory/unit replacement recovery.
  Interrupted boot rollback retains a local review requirement across subsequent reboots.
  Local encrypted backups cover matching code, data, browser profile, keyring, bot state,
  configuration, projects, managed units and ownership. Verified restores create a hold
  on delivery, model tools, automation, notifications and worker revival until local
  reconciliation. Format floors refuse incompatible code-only rollback.
- Improved Discord status/details and receipt actions, retained staged setup and per-click
  permission checks, and added the opt-in alert setting. Generated command help has 34
  definitions. Initial worker trial settings are confirmed explicitly; existing limits stay.
- Added five-second shared resource observations, two concurrent read-only notification
  monitors, bounded event-page draining and outage backoff. A private read-only sampler
  records idle/task/soak measurements without creating work or changing worker limits.

## Checks and corrections

Failure tests exercise real durable rename boundaries, archive/fence publication failure,
matching/conflicting archived identities, concurrent upkeep, exhausted storage, Goal and
compaction races, stale asynchronous results, alert deduplication, uncertain Discord creation,
permission revocation, credential rotation and exact completion evidence across pages.
Backend and bot fixtures process 1,200 and 2,200 receipts respectively through archive cycles,
retaining unresolved work and refusing replay.

Full regression runs exposed pre-recording Goal saves, inherited switch semantics, silence
pickup policy and exact worker Stop regressions introduced during implementation. Those
were corrected in the existing owners; timing assertions were preserved. Bulk archive-cycle
tests have a 120-second allowance for thousands of real private fsync writes. A failed first
journal write is superseded durably so background retry cannot resurrect rejected intent.
The final focused Goal/recovery checks pass 41 tests; exact Stop checks pass seven tests.

Final full verification, both builds, UI checks, deployment drills and real isolated
Electron/Xvfb/Brave smoke results are recorded in [validation](headless-validation.md).
Deployment fault drills use temporary paths and mocked systemd operations; encryption and
decryption use real GPG. They do not establish privileged installed-service behavior.

## Remaining acceptance

The [rollout worksheet](reliability-rollout.md#acceptance-worksheet) records every live gate
as pending where installed-stack evidence is unavailable. Real authenticated task delivery,
zero/one/two worker workloads, provider-login expiry, component restarts, compaction,
unattended reboot/keyring recovery, privileged update/restore drills, phone walkthrough,
24-hour delivery acceptance and a seven-day resource/notification soak remain required.
This implementation is reviewable in a draft PR; it is not production acceptance evidence.

## README follow-up

Rewrote the README as the VPS edition's entry point: server requirements, build/install,
private bootstrap, Discord controls, operations, recovery and pending live acceptance gates.
Removed desktop download buttons, screenshots, demo and desktop setup promotion while
retaining upstream credit. Validated all 19 local links/heading targets, the 25 listed Discord
commands, syntax of four shell examples and the whitespace check. This follow-up changes
documentation only; the runtime verification results above still apply.
