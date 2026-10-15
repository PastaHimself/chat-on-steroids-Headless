# Reviewed Headless long-run rollout

This is an operator procedure, not evidence of a completed deployment. No command below was
run against production during development. Disruptive steps require explicit authorization.
The existing [maintenance and restore contract](reliability-rollout.md#local-update-backup-and-restore)
still applies. Rehearse the sequence on a disposable Ubuntu 24.04 host first.

## Stage and check without touching production state

Use a separate unprivileged development checkout. Set the full reviewed PR commit, then pin it:

```bash
set -euo pipefail
read -r -p 'Approved full PR commit: ' cos_reviewed_commit
[[ "$cos_reviewed_commit" =~ ^[0-9a-f]{40}$ ]]
cos_stage_dir="$(mktemp -d /tmp/cos-reviewed-upgrade.XXXXXX)"
git clone --single-branch --branch fix/headless-long-run-recovery \
  https://github.com/PastaHimself/chat-on-steroids-Headless.git "$cos_stage_dir/repo"
cd "$cos_stage_dir/repo"
git fetch origin "$cos_reviewed_commit"
git switch --detach "$cos_reviewed_commit"
test "$(git rev-parse HEAD)" = "$cos_reviewed_commit"
node --version
npm ci
npm ci --prefix discord --ignore-scripts
COS_TEST_WORKERS=2 npm run verify
npm run build
npm run discord:build
npm run verify:deployment
COS_SMOKE_BROWSER=/usr/bin/brave-browser npm run verify:headless
```

Use Node 24 and the existing sandboxed Electron/Brave/Xvfb stack. Do not point a staging
backend at `/var/lib/cos-backend`, the production profile, keyring or control directory.
Inspect the PR's test limitations before approval. Preserve any explicit saved permissions,
Goal/Loop switches, approved roots and dedicated profile. Timed fresh turns stay Off initially.

## Approved maintenance and verified backup

First inspect `/status`, `/queue`, `/operations`, `/history` and worker status. Wait for actual
task/worker completion or agree on a private reconciliation plan for every outstanding effect.
An open turn, missing receipt or browser reload cannot prove that work stopped. Do not stop
services while user work still depends on them. Record the source/replacement Send states,
pending input UUIDs and service state privately; never publish that inventory.

The encrypted backup helper requires a stopped, flushed stack. If the backup must precede
even the service stop, obtain and restore-verify a host/volume snapshot before the maintenance
window. Do not describe a live file copy as a consistent backup.

After explicit approval, stop each runtime unit (the production target was observed inactive
despite active children), then take and verify the encrypted backup before replacing code:

```bash
sudo systemctl stop cos-headless.target cos-discord.service cos-backend.service \
  cos-browser.service cos-display.service cos-session.service
sudo python3 /opt/chat-on-steroids/maintenance.py recover
cos_backup="/var/backups/chat-on-steroids/pre-long-run-$(date -u +%Y%m%dT%H%M%SZ).gpg"
sudo python3 /opt/chat-on-steroids/maintenance.py backup --output "$cos_backup"
sudo test -s "$cos_backup"
sudo sha256sum "$cos_backup"
sudo gpg --decrypt "$cos_backup" | tar --list > /dev/null
```

GPG prompts locally for the passphrase; do not put it in arguments, environment files or chat.
The helper inventories/checksums code, sessions, queues, browser profile, keyring, Discord state,
configuration, projects, units and ownership. Decryption/listing checks encrypted archive
readability; a successful restore on an isolated host is the stronger backup gate. Preserve
both evidence and passphrase separately. The stack remains stopped after backup.

## Install only the verified staged tree

```bash
sudo python3 /opt/chat-on-steroids/maintenance.py install --source "$cos_stage_dir/repo"
sudo systemctl daemon-reload
sudo systemctl start cos-headless.target
systemctl is-active cos-headless.target cos-display.service cos-session.service \
  cos-browser.service cos-backend.service cos-discord.service
sudo -u cos-discord env COS_CONTROL_DIRECTORY=/run/cos-control \
  /usr/local/bin/node /opt/chat-on-steroids/current/deploy/healthcheck.mjs --service
```

The maintenance helper verifies staging and retains previous code/units. It does not start
services itself. Installation does not replace production data or reset delivery checkpoints.
The new format floor prevents an unsafe older binary reading fresh-turn rows or ignoring
persisted provider restrictions. Keep a matching pre-upgrade snapshot available.

Confirm installed source hashes for changed extension files as well as the app bundle; the
unchanged 2.1.34 package label alone cannot identify this PR. Confirm recorder version 25 on
freshly loaded disposable pages. Never reload a real working chat merely to test installation.

## Post-install acceptance

Check `/monitor`, `/status`, `/queue` and `/operations` against the private pre-change inventory.
Confirm the same local sessions/projects, pending UUIDs, ambiguous receipts and worker history.
Check production logs for startup/restore errors and kernel OOM reports. Infrastructure health
does not prove sign-in, account eligibility, assistant recovery or task completion.

Use disposable tasks and exact provider receipts to test ordinary GPT-6 Thinking, two
independent sessions, worker start/sleep/wake, native tool completion, a handoff and its
successor. Do not intentionally induce real provider restrictions or bypass approval cards.
Test crash/restriction injection in staging. Leave fresh turns disabled until its native
transition has been observed, then enable `ui.rotateTurnMinutes: 30` in the existing config
only during an approved stopped-stack configuration change. Validate 4/8/12/24-hour workloads.
Unknown/late receipts must reconcile their original UUIDs without duplicate prompts.

## Rollback with progress preserved

Stop the runtime units only in an approved window after reconciling ongoing effects. Take
another verified encrypted backup of the post-upgrade state before restore; this preserves
new progress for investigation/reconciliation. Do not delete new ledgers, copy old code over
new state, or bypass the format floor.

```bash
sudo python3 /opt/chat-on-steroids/maintenance.py recover
sudo python3 /opt/chat-on-steroids/maintenance.py restore --input "$cos_backup"
```

Restore retains previous contents and starts with the reconciliation hold set. Privately
compare provider sends, local file/process effects, Discord notifications and task progress
since the backup. An earlier snapshot cannot undo external effects, so do not blindly replay
its queue. Record the reconciliation in a private absolute-path file, then explicitly release
the hold and start the stack:

```bash
sudo python3 /opt/chat-on-steroids/maintenance.py release-hold \
  --reconciliation /var/backups/chat-on-steroids/reconciliation.txt
sudo systemctl daemon-reload
sudo systemctl start cos-headless.target
```

Only release after the actual review; the example file is not created automatically. Verify
the restored code/profile/session ownership and exact pending receipts again. No automatic
deployment, merge, code-only downgrade, forced push or production restart is authorized here.
