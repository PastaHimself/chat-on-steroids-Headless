# GitHub Actions for the Headless edition

The default pipeline targets **Ubuntu 24.04 amd64 and Node.js 24**, matching the managed VPS installer. Pull requests and pushes to `main` run workflow linting and the shared Headless candidate build. Untrusted pull requests have read-only repository access and receive no service credentials.

The candidate build installs the root and Discord lockfiles with lifecycle scripts disabled, then explicitly provisions the verified Electron/native runtime. It runs the complete regression suite without automatic test retries, checks the generated Discord reference, exercises published npm/Python plugins with Python 3.12 and pinned uv, builds both applications with Headless provenance, verifies deployment boundaries and maintenance fault drills, and exercises windowless Electron on private Xvfb. The isolated browser check uses the runner's graphical Google Chrome and a fresh profile; it does not sign in or contact a user's installed browser. Brave and the installed private keyring/systemd stack still require the documented VPS acceptance checks.

Every successful build uploads `headless-candidate-<run id>-<attempt>` for 14 days. Find it under **Actions → CI → the successful run → Artifacts**. A main push already produces this artifact. To build a different selected ref deliberately, run **Headless test candidate (manual)** (`canary.yml`). It creates an artifact without replacing the historical public `canary` release.

## Candidate contents

| File | Meaning |
| --- | --- |
| `Chat-On-Steroids-Headless-Source.tar.gz` | Exactly the committed repository source, under `chat-on-steroids-headless/`; no `.git`, installed dependencies, build outputs or private runtime data |
| `Chat-On-Steroids-Headless-Extension.zip` | Chromium extension from the same commit, with the canonical build stamp and license |
| `HEADLESS-BUILD.json` | Commit, app version, source-distribution kind and intended Linux/Node target |
| `SHA256SUMS.txt` | Exact checksum manifest for the three files above |

These are **source distributions**, not a prebuilt installation or backup. The native dependency/provenance build is verified in CI, but it must be recreated for the installation on the target VPS. Use `HEADLESS-BUILD.json` to select the exact commit in a Git clone, then follow [headless-vps.md](headless-vps.md). The source archive has no Git history, so it cannot itself satisfy the installer's committed-checkout requirement. Do not pass it directly to the installer or substitute its metadata for `runtime/headless-build.json`.

The candidate checker refuses missing/extra files, malformed or duplicate checksum rows, wrong commits/versions, source substitutions and extension substitutions, even when a substituted file's checksum was rewritten. It compares the source archive directly to `git archive` of the checked-out commit without extracting it.

## Stable source releases

1. Prepare and review a version commit. Align package/main/extension versions, changelog and `docs/release-notes/vX.Y.Z.md`. Describe the Headless source distribution and its target-host build in those notes.
2. Create and push its version tag, such as `v2.1.35`.
3. Dispatch **Publish Headless release** (`publish.yml`) at that tag. A tag push alone does not publish anything.

Preflight rejects branches, version disagreement, stale tunnel pins, missing notes and existing releases before building. The same run builds a new candidate, then the publisher verifies its contents against the checked-out tag. Only the publish job receives `contents: write`, and it is restricted to `PastaHimself/chat-on-steroids-Headless`. The GitHub CLI always receives the current repository explicitly; existing releases are never overwritten. The published-file audit downloads the four attached files and repeats the commit/content checks. It reports a failure as an issue in this repository.

Publication is serialized per tag and is not cancelled midway. CI and manual test-candidate runs cancel superseded work. No workflow installs this build on your VPS, accesses Discord/provider credentials or declares authenticated delivery/long-running acceptance complete.

## Optional desktop compatibility

The inherited Windows/macOS/Linux desktop UI, native packaging and publishing paths remain under `desktop-*.yml`, with manual entry points. They do not run for normal Headless pushes or pull requests. The inherited community moderation schedules keep their original inactive repository guards; this change does not enable automated reminders or closures on this fork. CodeQL continues to analyze the JavaScript/TypeScript sources.
