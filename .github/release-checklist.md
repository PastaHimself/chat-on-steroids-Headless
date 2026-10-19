Live checks for **VERSION**, on an isolated Ubuntu 24.04 amd64 VPS with Node 24.
An unchecked item means not tested. Automated checks use fresh profiles and no accounts.

### Before tagging

- [ ] **CI:** Headless CI, Linux live plugin checks and CodeQL pass for the reviewed commit.
- [ ] **Candidate:** the Headless release candidate passes its full suite, deployment drills and real Electron/Xvfb/Brave lifecycle smoke.
- [ ] **Bundle:** source, backend, Discord, dependencies, extension and build manifest survive archive extraction and match the recorded commit; native sources and SHA256SUMS.txt are present.
- [ ] **Installation:** overlay the bundle on a clean checkout of its recorded commit; verify the build, install and verify systemd units using docs/headless-vps.md.
- [ ] **Secrets and login:** protected environment files and the encrypted keyring persist; pair the companion and sign in through the private browser.
- [ ] **Discord:** test unauthorized access, /new, /ask, /goal, /plan, status and final notifications in an explicitly authorized test channel.
- [ ] **Continuation:** verify worker settlement, Compact & Resume and pending Goal/Plan work across controlled backend/browser/bot restarts without duplicate effects.
- [ ] **Maintenance:** encrypted backup/restore, incompatible-format refusal and interrupted-update recovery pass on a disposable installation.
- [ ] **Release notes:** docs/release-notes/VERSION.md describes the Headless changes and actual validation; app/extension/main/lockfile versions agree.

### After publishing

- [ ] **Published files:** Verify published Headless release is green for VERSION and the original publishing commit.
- [ ] **Download:** verify the downloaded bundle and native-source checksums, then repeat installation on a disposable VPS.
- [ ] **Long runs:** record the live acceptance evidence required by docs/headless-long-run-rollout.md; account-free CI smoke does not prove provider authentication or Discord delivery.
