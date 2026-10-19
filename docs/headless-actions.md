# Headless Actions and release bundles

Actions targets the managed deployment: **Ubuntu 24.04 amd64 and Node 24**.
The backend remains Electron without workspace windows; Brave uses a private Xvfb
display. The standalone Discord package uses its own lockfile and Node 24.

## Checks and delivery

| Workflow | Behavior |
| --- | --- |
| Headless CI | Pushes to main, PRs and manual runs: privacy/notices, both typechecks, Node regressions and the complete Linux Vitest suite, with native computer/shutdown tests serialized. Builds both packages with provenance and runs deployment drills plus real Electron/Xvfb/Brave startup, profile reuse, restart and shutdown checks. |
| Published plugin checks | Separate Linux CI job runs the existing real npm/Python plugin suites with one worker. |
| Headless release candidate | Manual or reusable build: the same verification, sealed build and smoke, followed by a Headless bundle, corresponding native sources and checksums. Re-extracts and verifies the candidate before uploading it. |
| Headless canary | Main only, after app-relevant changes: builds the same candidate, verifies its exact commit and stages/digest-checks a replacement before updating the rolling canary prerelease. |
| Publish Headless release | Manual dispatch at a reviewed `vX.Y.Z` tag: checks version metadata, release notes, privacy and existing-release absence; builds its own candidate and re-verifies the extracted payload before publishing. |
| Verify published Headless release | Downloads published assets and checks both hashes, tag/version, the expected commit, source/payload inventories, compiled durable formats and native runtime. Called directly after stable publication because token-created releases do not start another workflow. |
| CodeQL / PR checklist | Code scanning and the existing PR/fail-first checks remain. Fail-first runs with Node 24, including when a changed native test selects Windows. |

All build/check jobs have read-only repository permissions. Publication alone gets
`contents: write`; failed-release audits get issue creation. Setup installs OS
libraries and Brave and provisions Electron's root-owned sandbox helper through
sudo. Dependencies, builds and smoke tests run as the ordinary hosted-runner user.
Brave smoke is required through `COS_SMOKE_BROWSER=/usr/bin/brave-browser`.

The artifacts are:

- `Chat-On-Steroids-Headless-Linux-x64.tar.gz`: committed source plus sealed backend,
  Discord output, dependencies, companion extension, deployment helpers and
  `runtime/headless-build.json`. It preserves executable bits and internal links.
- `Chat-On-Steroids-Native-Sources.tar.gz`: corresponding reviewed native sources.
- `SHA256SUMS.txt`: exactly those two archives.

Git metadata, local ignored files and upstream snapshot ZIPs are excluded. Nothing
contains the operator's credentials, browser profile or application state. The
tar format preserves metadata which a direct artifact ZIP upload of `node_modules`
would lose. Candidate artifacts are scoped to the current workflow run.

## Inspect or install a bundle

Download all three files from the same release/candidate. On the supported host,
as your normal login user, verify them before extraction:

```sh
sha256sum --check SHA256SUMS.txt
mkdir candidate
tar --extract --gzip --file Chat-On-Steroids-Headless-Linux-x64.tar.gz --directory candidate --no-same-owner
node candidate/scripts/verify-headless-build.mjs --root "$PWD/candidate" --payload
```

The managed installer also verifies committed source. The archive deliberately
omits `.git`, so overlay it on a fresh checkout of its recorded commit:

```sh
cos_release_commit=$(node -p 'require("./candidate/runtime/headless-build.json").commit')
git clone https://github.com/PastaHimself/chat-on-steroids-Headless.git headless-release
git -C headless-release checkout --detach "$cos_release_commit"
tar --extract --gzip --file Chat-On-Steroids-Headless-Linux-x64.tar.gz --directory headless-release --no-same-owner
cd headless-release
npm run verify:headless-build
```

Continue with [the deployment guide](headless-vps.md). The bundle does not install
Node or Brave, provision secrets, start services or update an existing VPS.
Existing installations follow the documented backup/update procedure.

Stable tags must include the Headless workflow rework and matching version/notes
updates. Historical desktop tags still contain their original workflows. Local
desktop packaging commands remain for development, while Headless Actions no
longer builds desktop installers or runs the Windows/macOS GUI matrix.

Account-free CI establishes startup, build and local lifecycle behavior. Provider
authentication, actual Discord delivery, installed systemd boot behavior and long
running account-backed tasks remain the live gates in [the rollout guide](headless-long-run-rollout.md).
