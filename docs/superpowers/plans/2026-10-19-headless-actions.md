# Headless GitHub Actions implementation plan

Goal: make Ubuntu 24.04 amd64 and Node 24 the default validation and candidate pipeline for this VPS edition.

Architecture: `ci.yml`, manual `canary.yml` and tagged `publish.yml` call one read-only reusable `release.yml`. It installs both locked dependency trees, provisions the native runtime, runs the complete regression suite, builds with Headless provenance, and exercises deployment and Electron/Xvfb boundaries. Candidates contain committed source, the Chromium extension, build metadata and SHA-256 checksums. They require the documented target-host build before installation. Existing desktop validation/packaging remains manual under `desktop-*` workflow names.

Constraints: write only to PastaHimself/chat-on-steroids-Headless; never publish during this task; preserve native sandboxing, full regression coverage, durable-format checks, and the distinction between isolated runtime evidence and authenticated VPS acceptance. Do not activate inherited community moderation schedules.

- [x] Add failing workflow-contract regressions proving defaults are Linux/Node 24, read-only, and shared across CI/candidates/releases.
- [x] Move desktop workflows to manual entry points and implement the reusable Headless pipeline, pinned workflow linting, cancellation boundaries and failure artifacts.
- [x] Add candidate archive/checksum tests with real temporary Git repositories, including corruption, wrong commit, extra files and malformed manifests; implement the candidate producer/verifier.
- [x] Rewire stable publishing and published-asset checks to the exact Headless artifact set. Require an immutable version tag and reviewed notes; refuse existing releases.
- [x] Update superseded workflow assertions, document artifact/deployment usage, update AGENTS.md and record actual evidence in a focused worklog.
- [ ] Run targeted tests, workflow lint, full verification, both builds and isolated runtime checks where available. Open an unmerged PR on the user's repository and inspect its checks.
