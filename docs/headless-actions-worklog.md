# Headless Actions rework — 2026-10-19

The inherited default CI started three desktop OS jobs and two desktop UI jobs; its automatic canary built Windows/macOS/Linux installers. The fork's supported managed deployment is Ubuntu 24.04 amd64, Node 24, windowless Electron and a separate Discord adapter.

Implemented one read-only reusable Headless verification/build for PRs, main pushes, manual candidates and tagged source releases. It retains full ordinary regressions, published-plugin integration probes, both application builds with provenance, deployment fault drills and isolated Electron/Xvfb/browser lifecycle checks. Existing desktop workflows are manual, normal PR tooling uses Node 24, and inherited community moderation remains inactive. No VPS services, provider/Discord credentials or public releases were changed by this task.

Candidates contain exact committed source, the matching stamped Chromium extension, source metadata and an exact checksum inventory. The checker compares archives to their commit and rejects source/extension substitutions even with rewritten hashes. Full-repository validation exposed a 128 MiB stdout-buffer limit because this tree includes a large upstream ZIP and historical assets; archive generation now writes to disk and hashing streams files. Stable publication checks the remote resolved tag commit in preflight and immediately before creating the release, refuses existing releases, and audits downloads. These checks do not make a version tag immutable against an administrator concurrently force-moving it.

Evidence recorded before the final hosted run:

- Four new workflow regressions failed against the original default workflows. The candidate tests failed before their producer existed.
- Initial focused workflow/candidate/desktop compatibility checks: 46/46 passed. After the streaming change, the ten Headless workflow/candidate checks passed again.
- All workflows pass actionlint 1.7.12, fetched with its verified SHA-256; `git diff --check` passes.
- A real 136 MiB source candidate was created and independently re-verified from the committed tree after the buffer repair.
- Public-history and notice checks pass; root and Discord type checks passed within `verify:ci` before its regression phase.
- An independent read-only review identified lost live-plugin coverage and a tag-retargeting gap; both were fixed. Its minor incomplete-release audit concern was also addressed.
- Full local regression execution and hosted Ubuntu checks were running when this record was written. The PR validation section records their final outcome.

The local container maps only UID 0 and cannot switch to an unprivileged login. Its tar extraction also needs `TAR_OPTIONS=--no-same-owner` because archived foreign ownership cannot be mapped. This local environment adjustment was not added to the product scripts. Unprivileged preparation, sealed Headless builds, deployment checks and native lifecycle smoke must be proven on the hosted Ubuntu runner. Source artifacts require a fresh build of the exact commit on the VPS; they are not prebuilt installers. Authenticated provider/Discord operation, privileged installation and multi-day VPS acceptance remain separate gates.

The first complete hosted regression phase passed 8,805 Vitest tests (162 expected platform/opt-in skips) and eight Node tests (one root-only skip). The next command exposed an ordering defect: `generate-discord-reference.mjs` imports `discord/dist/commands.js`, which a clean runner has only after building Discord. The reference check was moved after the provenance build; a new workflow-order assertion failed before that repair. Earlier local reference validation had compiled output available, so it did not establish clean-runner ordering. The PR records the subsequent hosted result.
