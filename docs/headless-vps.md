# Linux VPS and Discord deployment

This deployment targets Ubuntu 24.04 LTS, amd64, Node.js 24, Brave and an unprivileged service account. The backend is the existing Electron main process without workspace windows. Electron and graphical Brave still use an authenticated Xvfb display. Native Chromium headless extension compatibility is **not established**. Your personal computer can be turned off once the VPS is configured.

Read [architecture](headless-architecture.md), [security](../SECURITY.md), [command reference](discord-commands.md) and [validation/limitations](headless-validation.md). Provider eligibility, tool approvals, usage limits and safety decisions remain authoritative. An expired login requires human intervention in the private browser.

## 1. Prepare and build as your SSH login user

Use a normal sudo-capable Ubuntu account. Termius on Android can connect using that account and a locally stored SSH key. Verify the server host fingerprint through the VPS console before accepting it. Never paste SSH private keys, ChatGPT credentials, tunnel tokens or bot tokens into Discord.

Apply Ubuntu updates and install the build tools before compiling native dependencies. Reconnect through Termius after a reboot, if requested by Ubuntu:

```sh
sudo apt-get update
sudo apt-get upgrade
sudo apt-get install -y git build-essential python3 pkg-config curl ca-certificates xz-utils
test ! -f /var/run/reboot-required || cat /var/run/reboot-required
```

If Ubuntu reports that a reboot is required, run `sudo reboot` and reconnect before continuing.

Install a maintained Node.js 24 Linux x64 distribution from [Node.js downloads](https://nodejs.org/en/download). The systemd bot uses `/usr/local/bin/node`; do not use a login-user-only version manager path in service units. If that path already supplies trusted Node 24, retain it. Otherwise, the following example installs the official archive and checks its published SHA-256 checksum. Review the release version on the official site; local project verification used 24.19.0, while this installation example uses the currently listed 24.21.0. For stronger download verification, follow [Node's signed checksum instructions](https://github.com/nodejs/node#verifying-binaries).

```sh
(
  set -e
  cos_node_version=v24.21.0
  cos_node_archive="node-${cos_node_version}-linux-x64.tar.xz"
  cos_node_stage=$(mktemp -d)
  trap 'rm -rf "$cos_node_stage"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://nodejs.org/dist/${cos_node_version}/SHASUMS256.txt" -o "$cos_node_stage/SHASUMS256.txt"
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://nodejs.org/dist/${cos_node_version}/${cos_node_archive}" -o "$cos_node_stage/$cos_node_archive"
  (cd "$cos_node_stage"; awk -v archive="$cos_node_archive" '$2 == archive' SHASUMS256.txt | sha256sum --check --strict)
  tar -xJf "$cos_node_stage/$cos_node_archive" -C "$cos_node_stage"
  sudo install -d -m 0755 /usr/local/lib/nodejs
  test ! -e "/usr/local/lib/nodejs/${cos_node_archive%.tar.xz}"
  sudo cp -R "$cos_node_stage/${cos_node_archive%.tar.xz}" /usr/local/lib/nodejs/
  sudo chown -R root:root "/usr/local/lib/nodejs/${cos_node_archive%.tar.xz}"
  for cos_node_command in node npm npx; do
    sudo ln -s "/usr/local/lib/nodejs/${cos_node_archive%.tar.xz}/bin/$cos_node_command" "/usr/local/bin/$cos_node_command"
  done
)
```

These links refuse to replace existing executables. If a link exists, inspect the previous installation locally before changing it.

```sh
node --version                    # v24.x
/usr/local/bin/node --version     # v24.x
git clone https://github.com/PastaHimself/chat-on-steroids-Headless.git
cd chat-on-steroids-Headless
npm ci
npm run discord:install
COS_TEST_WORKERS=2 npm run verify
npm run build
npm run discord:build
```

Build on Linux amd64 so native terminal/parser dependencies match the VPS. Do not transfer a Windows/macOS dependency directory. If native installation scripts are blocked by your package manager, approve the repository's reviewed native dependencies and rerun installation; do not ignore a failed native check. Root builds and root application execution are unsupported.

## 2. Install the managed service files

```sh
sudo ./deploy/install-ubuntu.sh
sudo systemd-analyze verify /etc/systemd/system/cos-*.service /etc/systemd/system/cos-headless.target
sudoedit /etc/chat-on-steroids/backend.env
sudoedit /etc/chat-on-steroids/discord.env
```

After the installer supplies Xvfb, Brave and the root-owned Electron sandbox helper, run the checks as the normal SSH login user. The smoke creates a fresh isolated profile and virtual display; it does not use service credentials or contact a provider account:

```sh
npm run verify:deployment
COS_SMOKE_ELECTRON=/opt/chat-on-steroids/current/node_modules/electron/dist/electron \
  COS_SMOKE_BROWSER=/usr/bin/brave-browser npm run verify:headless
```

The installer checks Ubuntu/architecture/build prerequisites, installs Xvfb and Secret Service dependencies, and uses [Brave's official apt repository](https://brave.com/linux/) when Brave is absent. It refuses unfamiliar existing destinations. It creates two system users with no login shell, private homes, a narrow `cos-control` group, root-owned code and root-readable environment files. It preserves existing environment files. It does **not** start the stack before bootstrap.

Installed locations:

| Location | Owner/use |
| --- | --- |
| `/opt/chat-on-steroids/current` | Root-owned, built code and dependencies |
| `/var/lib/cos-backend/app` | Private backend configuration, history, queues and recovery ledgers |
| `/var/lib/cos-backend/brave` | Private persistent Brave profile, extension and login state |
| `/var/lib/cos-backend/.local/share/keyrings` | Backend account's encrypted keyring |
| `/var/lib/cos-discord/state.json` | Private bot grants, selections, setup drafts and notification receipts |
| `/srv/cos-projects` | Backend-owned workspace parent; folders still need local approval |
| `/run/cos-display/Xauthority` | Private Xvfb authentication; display `:99`, no TCP listener |
| `/run/cos-session/bus` | Private D-Bus shared by Brave and Electron |
| `/run/cos-control` | Backend-owned API discovery/token files; bot group can read, cannot write |
| `/etc/chat-on-steroids` | Root-only bootstrap configuration and optional encrypted credential |

The installer configures Electron's verified `chrome-sandbox` helper root-owned mode 4755. Brave retains its package-provided sandbox. Do not add `--no-sandbox` or disable system-wide namespace protections to make an installation start. Diagnose a sandbox failure locally.

In `backend.env`, select the absolute Brave executable/profile/data paths. Set `COS_REMOTE_PERMISSIONS=send,configure,plan,workers` only after reviewing the corresponding powers; leave categories empty/omitted to disable them. `controlApi.allowActions` remains a separate, initially disabled switch in the application. Discord cannot enable either local bootstrap authority.

In `discord.env`, enter the bot token, application ID, first administrator user IDs and authorized guild IDs. IDs are comma-separated Discord snowflakes. `DISCORD_CHANNEL_IDS` optionally narrows channels locally; `/setup` cannot widen that list. Enable Developer Mode in Discord to copy IDs. Administrators are bootstrapped here; there is no ownership-claim command and Discord roles grant no authority.

Create a Discord application/bot in the [Developer Portal](https://discord.com/developers/applications). Invite it with `bot` and `applications.commands` scopes into the configured guild. Grant View Channels, Send Messages, Embed Links, Read Message History and permission to use application commands in intended channels. No Administrator, member or message-content intent is needed. Keep the token in the root-owned environment file, never in a command argument or repository.

## 3. Provision the private keyring locally

The `cos-session` service supplies a shared private D-Bus/Secret Service to both applications. Electron's existing insecure `basic_text` fallback remains refused. For unattended boots, provision a strong keyring password using terminal input and systemd's encrypted credentials:

```sh
sudo -v
read -r -s -p 'New service keyring password: ' cos_keyring_password
printf '\n'
printf '%s' "$cos_keyring_password" | sudo systemd-creds encrypt --name=keyring-password - /etc/chat-on-steroids/keyring-password.cred
unset cos_keyring_password
sudo chmod 0600 /etc/chat-on-steroids/keyring-password.cred
sudo systemctl edit cos-session.service
```

Add this local drop-in, then reload:

```ini
[Service]
LoadCredentialEncrypted=keyring-password:/etc/chat-on-steroids/keyring-password.cred
```

```sh
sudo systemctl daemon-reload
sudo systemctl start cos-display.service cos-session.service cos-browser.service
```

Use the existing password when unlocking an already provisioned service keyring. Replacing it with a different password does not migrate encrypted state. Keep a secure backup of the password and keyring; a credential encrypted for this host is not a portable backup. Without unattended unlock, secure storage can block until a person unlocks it. Never silently fall back to plaintext credentials. See the [GNOME daemon manual](https://manpages.ubuntu.com/manpages/noble/man1/gnome-keyring-daemon.1.html).

## 4. Bootstrap through a private interactive display

Install an optional local VNC viewer/server route. For example, `sudo apt-get install x11vnc` on the VPS, then run an SSH-scoped localhost-only server:

```sh
sudo -u cos-backend x11vnc -display :99 -auth /run/cos-display/Xauthority -localhost -rfbport 5900 -nopw -once
```

Forward local port 5900 to VPS `127.0.0.1:5900` through SSH. Termius port forwarding can provide this tunnel on Android; connect a VNC viewer to the forwarded localhost port. No VNC/API/display port should be opened in the public firewall. `-nopw` above relies on localhost plus the authenticated SSH tunnel; on a shared multi-user host add VNC authentication too. Close the VNC process/tunnel after setup.

Start a temporary desktop bootstrap using the **same** service data/profile and private bus:

```sh
sudo systemd-run --unit=cos-bootstrap --collect \
  --property=User=cos-backend --property=Group=cos-backend \
  --property=SupplementaryGroups=cos-control \
  --property=EnvironmentFile=/etc/chat-on-steroids/backend.env \
  --setenv=DISPLAY=:99 \
  --setenv=XAUTHORITY=/run/cos-display/Xauthority \
  --setenv=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/cos-session/bus \
  /usr/bin/env COS_RUNTIME_MODE=desktop /opt/chat-on-steroids/current/deploy/start-backend.sh
```

Only one backend may own that data directory. Keep `cos-headless.target` and `cos-backend.service` stopped during bootstrap. In the desktop app:

1. Open `https://chatgpt.com/` manually in Brave and choose Brave as the app's ChatGPT browser. Load the existing unpacked companion from `/opt/chat-on-steroids/current/extension` in this dedicated profile using Brave's extension developer mode, and pair it through the normal pairing flow. Service startup requests ordinary last-session restoration without adding an extra ChatGPT URL tab. Crash recovery can still require interactive restoration.
2. Sign in to ChatGPT interactively. Do not export cookies or transplant another profile. Disable Brave Memory Saver for `chatgpt.com`; service launch flags disable background renderer/timer throttling, but do not prove tab-discard immunity.
3. Approve intended `/srv/cos-projects/...` folders and create the project's normal local association. Review Core capabilities, command policy, read-only mode and external plugin permissions. Headless mode reuses these exact owners.
4. Configure the supported MCP tunnel using [existing setup instructions](setup.md). Enable auto-connect, verify the connection in ChatGPT, and complete account/workspace/tool approvals there. Local API credentials and MCP tunnel credentials are different.
5. Enable Local Control API and, after reviewing remote authority, Allow actions. Retain two initial workers; use `/setup` later to adjust capacity. An optional global cap of 2 constrains multiple prime families; 0 disables that extra global cap.
6. Send a small supervised prompt and verify a recorded response/tool call. Select an observed model so the account catalog is populated. Confirm credential persistence by restarting the bootstrap and checking saved configuration/profile state.

Stop bootstrap before starting the windowless backend:

```sh
sudo systemctl stop cos-bootstrap.service
sudo systemctl start cos-backend.service
sudo -u cos-backend env COS_CONTROL_DIRECTORY=/run/cos-control /usr/local/bin/node /opt/chat-on-steroids/current/deploy/healthcheck.mjs --ready
```

`--ready` checks authenticated API, extension pairing/presence and MCP connection. It does not prove ChatGPT authentication or account eligibility. A login error, absent extension or unavailable catalog is a reason to reopen the private browser and inspect the actual provider state.

## 5. Register commands and enable the stack

Register once per changed command schema, through a transient service that reads the protected environment:

```sh
sudo systemd-run --unit=cos-register --wait --collect \
  --property=User=cos-discord --property=Group=cos-discord \
  --property=SupplementaryGroups=cos-control \
  --property=EnvironmentFile=/etc/chat-on-steroids/discord.env \
  /usr/local/bin/node /opt/chat-on-steroids/current/discord/dist/index.js --register
sudo systemctl enable --now cos-headless.target
```

`cos-headless.target` holds display, private session, Brave, backend and bot services up. Ordering starts display/keyring before Brave, and Brave before the backend. Service process groups are cleaned up during stops. The backend drains existing state on SIGTERM; its stop timeout is 95 seconds. The bot reconnects transport and rereads rotated backend token/port files for every request. Dependency crashes can stop dependent services; the active target restarts them. Stop the target for maintenance so it does not restart a deliberately stopped component.

On Android run `/help`, `/setup`, then select a session/project and observed model. Setup sections cover connection, default session/channel mapping, model/reasoning, worker capacity, user/channel grants, opt-in notifications, Goal/Loop timing, planner/finish settings and resources. Edits are private staged drafts. Finish validates readiness and requires Confirm Save. Interrupted drafts survive; stale drafts cannot overwrite a newer administrator's settings. Browser credentials, roots, plugin secrets and tunnel provisioning remain local operations.

## 6. Operations, monitoring and recovery

```sh
sudo systemctl status cos-headless.target cos-display cos-session cos-browser cos-backend cos-discord
sudo journalctl -u cos-backend -u cos-browser -u cos-discord --since '20 minutes ago'
sudo systemctl restart cos-browser.service       # controlled browser restart; work may need receipt recovery
sudo systemctl restart cos-discord.service       # keeps mappings/checkpoints
sudo systemctl stop cos-headless.target          # planned maintenance
sudo systemctl start cos-headless.target
```

`/monitor` and Setup → VPS show CPU core/load information, physical RAM, backend RSS, swap kinds/priorities, disk, same-account browser/shell processes, possible orphan PIDs and systemd states. Load is not CPU utilization percentage; summed RSS can count shared pages twice. Parent PID 1 is a diagnostic hint, not proof of an orphan. No pressure threshold kills active work.

Start with two workers. Watch available RAM and swap activity before increasing family/global caps; reducing a cap prevents new admissions and does not terminate current workers. The app keeps existing resource cleanup and bounded queues. Do not run a second Brave process manager on this profile or concurrently run bootstrap and backend.

Delivery is `pending`, `sent`, `not_sent` or `unconfirmed`. Admission is not delivery. A disconnected browser can leave a queued or uncertain input; inspect `/queue`, `/status` and history before composing another request. Never resend an uncertain input to “fix” a timeout. Compact & Resume changes the provider conversation while preserving the local session ID used by Discord. `/pause` disables automation; `/stop` requests native cancellation of the exact active generation; `/cancel` withdraws only safely unsent queued input.

Progress notifications are disabled initially. Enable them only in an explicitly authorized private channel. They edit one persisted message per monitored session/channel, follow bounded event cursors and throttle updates. Completion requires the monitored input's recorded user message, confirmed delivery, exact turn final response and completed turn record with no active turn/compaction. “Recorded turn completed” does not establish whole-task success. A crashed Discord message creation is reconciled through bounded recent bot messages; if reconciliation cannot prove its message ID, notification creation remains uncertain and is not repeated.

Hot remote mutation receipts are capped at 1,000 and bot interaction receipts at 2,000. Settled receipts older than one hour archive automatically every hour and before admission at 80% capacity. Private permanent identity/fingerprint/outcome fences commit before hot removal and continue to deny replay; bulky result payloads expire after 30 days. Uncertain receipts and active plans remain hot. Review plans are capped at 50, with at most 20 pending; notifications at 20 session/channel monitors; interactive panels at 200 with 30-minute expiry; bot state at 4 MiB. Capacity, corruption and failed writes refuse unsafe admission. Inspect unresolved receipts through `/operation` and their owning queue/history; never remove fences, delete uncertain receipts or reset live ledgers to free capacity.

Known credential shapes and bootstrap tokens are redacted, responses are capped and mentions are disabled. Arbitrary unlabeled secrets in user prose cannot reliably be identified; keep sensitive conversation content out of notification channels. The API token grants access to recorded history. Commands run with the backend account's ordinary privileges; approved roots constrain file tools, not all shell effects.

## 7. Optional swap

Inspect existing configuration first; these helpers are independent of the application:

```sh
./deploy/swap-zram.sh --check
./deploy/swap-disk.sh --check
sudo ./deploy/swap-zram.sh        # 4 GiB LZ4 zram, priority 100
sudo ./deploy/swap-disk.sh        # 4 GiB ext4 swapfile, priority 10
swapon --show --bytes
zramctl
```

The zram helper refuses configured devices, conflicting generator configuration or changed managed units. Disk swap requires ext4, at least 5 GiB free space, a private root-owned managed directory/file and an exact owned fstab row. Btrfs/XFS need their own validated procedures. Existing unrelated swap is preserved. ZRAM's 4 GiB is compressed virtual capacity, not extra physical RAM.

```sh
sudo ./deploy/swap-zram.sh --rollback
sudo ./deploy/swap-disk.sh --rollback
```

Rollback verifies ownership and enough free RAM before swapoff. If activation partially fails, inspect the retained device/file/unit locally; do not reset a device with unconfirmed ownership. No helper changes swappiness or unrelated tuning. Actual privileged activation/reboot/rollback must be tested on a disposable VPS before production use.

## 8. Backups and updates

Use the root-only local maintenance helper described in [reliability rollout](reliability-rollout.md#local-update-backup-and-restore). It stops the stack and creates an encrypted GPG snapshot of matching code, both service homes, browser profile/keyring, configuration, managed units/drop-ins, workspaces and ownership. Keep backup and keyring passwords separately in a secure manager. Do not publish a backup or its logs. Restore verifies checksums and ownership before replacement and places delivery, automation and worker revival on hold. Review potentially repeated work locally and record reconciliation before releasing that hold; services remain stopped until an explicit local start.

Build and verify an update as the SSH login user, back up, then run `sudo ./deploy/install-ubuntu.sh --update`. The installer stages and verifies complete contents before stopping the stack, journals replacement and retains previous code and managed units under a UUID directory. Its independent recovery guard rolls back interrupted replacement and retains a local review requirement across reboots. Existing environment files/data are preserved. Check local unit syntax, re-register changed commands locally, then explicitly start `cos-headless.target` and run health/readiness checks. Headless mode disables the desktop auto-updater because installed code is root-owned. Durable format floors refuse incompatible code-only rollback; restore matching encrypted code/data and reconcile provider-side effects instead.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Backend fails before API appears | Inspect service journal, DISPLAY/Xauthority, secret-service readiness, absolute paths, sandbox helper and data ownership |
| Brave exits immediately or profile locked | Ensure one owner/profile; stop the target and inspect its process group before removing any stale lock |
| API healthy, bridge absent | Open private VNC, verify unpacked companion, Brave profile and pairing; do not expose bridge/API ports |
| Bridge paired but tasks fail | Pairing is not account authentication; inspect ChatGPT sign-in, model catalog, tool approval, quota/safety errors and MCP connection |
| Discord denies setup | Check exact locally bootstrapped user/guild/channel IDs; a Discord Administrator role does not grant access |
| API 403 | Enable API/Allow actions locally and the required local remote grant; `/setup` cannot bypass them |
| Model unavailable | `/models refresh:true` observes an existing page; open ChatGPT manually if the catalog is absent; no invented choices |
| Stop requested but generation continues | Stop is unconfirmed until provider evidence; automation is disabled; inspect the exact live turn |
| No final notification | Check channel permissions, opt-in settings, completion evidence and retained outbox row; uncertainty is not success |
| Setup saved backend changes but local write failed | Treat the operation as uncertain; inspect backend settings and published bot state before another confirmation |
| Capacity reached | Inspect unresolved receipts and storage/upkeep failures locally; preserve uncertain records and permanent replay fences |

Do not share raw journals or state files without reviewing/redacting them. Automated verification and its live-runtime exclusions are recorded in [the validation report](headless-validation.md).

## Reliability updates and recovery

Read [Reliability rollout and live acceptance](reliability-rollout.md) before installing updates.
It describes encrypted local backup/restore, interrupted-install recovery, the restored-work hold,
permanent receipt replay fences, opt-in operational alerts and required VPS/soak evidence.
The maintenance recovery unit and managed drop-ins must be retained with the runtime units.
