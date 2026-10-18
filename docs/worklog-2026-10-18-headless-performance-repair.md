# Headless installation, readiness and resource repair — 2026-10-18

## Confirmed faults and changes

The installer ran under umask 077, so requesting mode 0755 on creation still produced an inaccessible 0700 application directory. Code normalization also preserved restrictive copied modes. Code directories and managed unit drop-ins now receive explicit root-owned 0755 permissions, regular code files 0644/0755 according to executable intent, and only Chromium's sandbox retains 4755. Persistent homes, configuration, credentials and project data are excluded from that normalization. A regression stages an actual installation with umask 077 and restrictive source modes.

Production journals confirmed a rejected durable-format bootstrap left Electron running. The asynchronous startup promise had no fatal handler. Startup failures now log, drain through existing shutdown and exit 1. Headless awaits control publication; a systemd startup probe authenticates `/v1/health` and verifies both endpoint and response name the exact main PID. A stale responding endpoint cannot satisfy readiness. Discord retains its existing independent outage reporting/reconnect behavior, while invalid/unreadable endpoint files fail promptly with an actionable diagnostic rather than useless retry delays.

Plain `npm ci` does not prove that Electron's executable or native stack exists, and matching JSON manifests do not prove a bundle was rebuilt. `headless:prepare` explicitly calls Electron's pinned checksum-verified installer and probes parser, image, FFI and PTY functionality with Electron's own Node runtime. `headless:build` requires committed source, clears both application and Discord outputs and prior attestation, builds both packages, verifies source did not change during compilation, checks compiled durable formats, and seals source/payload/dependency hashes. The installer checks the source before mutation and the normalized stage before stopping services. It rechecks durable compatibility after stopping, preventing a running old process from advancing the saved format floor between preflight and replacement. Attestation is integrity evidence for a trusted build, not a signature against someone authorized to rewrite both code and manifest.

The existing broker remains worker ownership/admission authority. A Headless-only guard supplies its new-spawn, sleeping-worker message and queued-revival boundaries with sampled memory headroom. It accounts for concurrent reservations without another scheduler, queue, watchdog or eviction. Active-worker corrections and existing work continue under pressure. It neither changes model/thinking choices nor imposes Java CPU quotas. A conservative per-new-worker renderer allowance is not a guarantee about arbitrary later external command memory.

Diagnostics overlap independent proc reads with a bounded pool of eight instead of serially awaiting every process. The five-second observation cache remains single-flight. Diagnostics now expose kernel CPU/memory/I/O PSI and Headless event-loop utilization/delay. The sampling script adds PSS/renderer PSS, process count and workload labels; unavailable PSS is null, not zero. `pruneManagedTabs()` was reviewed and retained: unresolved send custody, live documents, selected/recent pages, pins and unknown ownership remain protected.

## Validation before deployment

- `npm ci --ignore-scripts`, Discord's separate clean install, and explicit Electron/native provisioning succeeded on Linux amd64.
- `npm run verify:ci`: 8,762 tests passed, 162 platform/opt-in tests skipped. No failed tests were counted as passing.
- `npm run typecheck`, Discord typecheck/build, privacy/notices gates passed.
- `npm run verify:deployment`: 13 Python maintenance drills passed, along with shell privilege/syntax and systemd syntax checks.
- Real Electron/Xvfb smoke passed authenticated API, zero workspace windows, graceful shutdown/credential cleanup, incompatible-format exit 1 with original metadata retained, and failed control-publication exit 1.
- New standalone build/readiness regressions passed. Broker pressure cases failed against the original broker and passed after repair; installer umask and post-stop compatibility cases similarly reproduced before the fix.
- Adjacent broker/Discord/resource/control suites and bootstrap/packaging suites passed after final source edits.

## Measurements and limits

The production host was idle enough to maintain: roughly 5.8 GiB available RAM, seven Brave renderers using about 1.05 GiB PSS, and no swap-in/out during the one-minute baseline. Historical severe pressure was not reproduced. No active Java/Gradle/Minecraft process was present. Existing queued inputs were held by unresolved handoff custody or confirmed provider deletion and were preserved.

On that VPS, 30 cold diagnostic samples measured median **69.85 → 40.22 ms**, p95 **92.09 → 54.41 ms**, and total process CPU **1538.99 → 1177.15 ms**. Process inventories were comparable (179 versus 178). Reproduce with `node scripts/benchmark-resource-monitor.mjs --module=/absolute/original-resource-monitor.ts` and the current module on the same host. This measures monitoring overhead, not AI throughput.

A real pre-deployment task recorded browser acceptance, a successful MCP `exec_command`, final marker and completed turn in **14.407 s**. One earlier sandbox refusal was correctly enforced before the task selected an approved root. This is functional baseline evidence; a single model response does not establish tasks/hour or p95 task latency.

Deployment, encrypted production-backup verification and post-deployment acceptance are separate gates, recorded in the operator's final private deployment report. These source-level results do not claim that those later gates already passed. Multi-hour soak, full real-client Minecraft timing, and representative mixed Java/AI throughput require additional measurements; no results are invented for them. Kernel/swap settings and external project source were retained because current measurements do not justify changing them.
