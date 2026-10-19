# Headless Actions rework

The requested rework makes the documented Ubuntu 24.04 amd64 / Node 24 deployment
the Actions target. Desktop packaging commands remain available locally; Actions
builds and tests the windowless backend, companion extension and Discord package.

The selected approach replaces the upstream OS matrix. Keeping that matrix as the
primary gate would retain unnecessary GUI checks; adding another headless-only
workflow would leave the desktop release and canary paths active.

- [ ] Add workflow regressions for Linux/Node 24, both lockfiles, required Brave
  smoke, sealed builds, immutable candidate identity and headless-only assets.
- [ ] Share CI provisioning through a local composite action. Run the complete
  Linux suite, isolated native tests, deployment checks and the real Xvfb/Brave
  smoke. Keep live plugin checks separate and preserve CodeQL.
- [ ] Build a tar bundle containing committed source and the sealed payload,
  excluding Git metadata and the upstream snapshot archives. Publish matching
  native sources and checksums. Re-extract and verify source/payload inventories,
  compiled formats, native runtime, commit and version before upload/publication.
- [ ] Update candidate, canary, stable publication and published-file audits to
  consume the same exact headless asset set. Preserve tag/version/notes/privacy
  checks, existing-release refusal and the staged canary replacement safeguards.
- [ ] Replace obsolete desktop workflow assertions with headless assertions;
  retain tests for desktop packaging scripts that are still usable locally.
- [ ] Document download/install provenance and actual checks, update AGENTS.md,
  run targeted and full checks, commit and open an unmerged PR in this fork.

The archive excludes `.git`; an operator overlays it on a fresh checkout of its
recorded commit before using the existing source-verifying installer. It contains
no credentials and never starts or updates services automatically. Builds run as
an ordinary user; only CI OS provisioning and sandbox-helper setup use sudo.

Validation uses YAML contract tests, archive corruption/identity tests, actionlint,
the full Linux verifier, a committed sealed build and real windowless smoke when
the execution host supports it. Hosted Actions evidence is recorded separately.
