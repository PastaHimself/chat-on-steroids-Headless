# Chat On Steroids Headless

**The VPS edition of Chat On Steroids — run on your Ubuntu server and control your work from Discord.**

This repository is built for a private, self-hosted VPS installation. The managed backend runs without desktop workspace windows, while a dedicated Brave browser runs on a virtual display. Tasks, project files, worker state and conversation history live on the server. Your personal computer does not host the backend.

Browser sign-in, keyring provisioning and provider approvals require an interactive bootstrap through a private connection. After setup, Discord provides the everyday controls.

[Install on a VPS](docs/headless-vps.md) · [Discord commands](docs/discord-commands.md) · [Recovery guide](docs/reliability-rollout.md) · [Validation status](docs/headless-validation.md)

## What this edition provides

- **Discord control:** start conversations, send tasks, select projects and observed models, inspect results, manage workers and control Goal/Loop.
- **Persistent server sessions:** retain local session identity, history and worker context through Compact & Resume.
- **Clear health and delivery status:** distinguish an available service from an authenticated provider or a delivered task. Opt-in alerts report failures and recovery in your configured private channel.
- **Durable request tracking:** inspect uncertain operations without resending them. Settled receipts archive automatically; permanent replay protection keeps handled identities blocked.
- **Recoverable maintenance:** verify updates before replacing installed code, preserve previous code and managed units, and recover interrupted replacement.
- **Encrypted local backups:** preserve matching code, backend data, browser profile, keyring, bot state, configuration, workspaces and ownership. Restored work remains held until local reconciliation.
- **Resource monitoring:** inspect memory, CPU, swap and storage, and record workload measurements without automatically killing work or changing worker limits.

## Server requirements

The managed installer targets **Ubuntu 24.04 LTS, x64/amd64**.

| Requirement | Purpose |
| --- | --- |
| A private VPS and a sudo-capable SSH account | Build, install and administer the services |
| Node.js 24, available at `/usr/local/bin/node` | Build the project and run the Discord bot |
| Linux build tools | Compile the native dependencies on the target platform |
| A ChatGPT account/workspace with the required MCP access | Complete browser sign-in and provider/tool approvals |
| Your own Discord application and bot | Register commands in an explicitly authorized guild |
| Private access to the virtual display during bootstrap | Provision the browser profile, extension and secure keyring |

The installer supplies the managed Xvfb, Brave and Secret Service dependencies. Electron and graphical Brave use Xvfb; this deployment does not use Chromium's native headless mode.

Choose VPS memory and CPU capacity from measured workloads. Start a new trial with two workers and a global cap of two through confirmed setup; preserve existing explicit settings. See the [measurement procedure](docs/reliability-rollout.md#measurements-and-soak-runs).

## Install and configure

Follow the [complete deployment guide](docs/headless-vps.md) in order. It covers Node installation, service ownership, protected configuration, keyring unlock, private browser access and Discord registration.

### 1. Build as your normal SSH login user

After preparing Ubuntu, build tools and Node.js 24:

```sh
git clone https://github.com/PastaHimself/chat-on-steroids-Headless.git
cd chat-on-steroids-Headless
npm ci
npm run discord:install
COS_TEST_WORKERS=2 npm run verify
npm run build
npm run discord:build
```

Build on Linux amd64 so native dependencies match the VPS. Run the build and runtime as unprivileged users.

### 2. Install the managed services

```sh
sudo ./deploy/install-ubuntu.sh
sudoedit /etc/chat-on-steroids/backend.env
sudoedit /etc/chat-on-steroids/discord.env
```

The installer creates separate backend and bot accounts, private data directories and root-owned code. It preserves existing protected configuration and leaves the stack stopped for bootstrap.

Configure the bot token, application ID, authorized administrator/guild IDs and optional channel restriction locally. Remote action grants and the application's Allow actions switch are separate local controls; Discord setup cannot bypass them.

### 3. Complete the private bootstrap

Use the deployment guide to provision the keyring and connect to the virtual display through an SSH tunnel. In the dedicated Brave profile:

1. Load and pair the companion extension, then sign in to ChatGPT interactively.
2. Approve the intended server project folders and tool capabilities.
3. Configure the MCP connection and complete provider approvals.
4. Review the Local Control API and remote action permissions.
5. Run a supervised task and inspect its exact delivery and recorded result.

The temporary bootstrap interface and managed backend must not run against the same data directory at the same time. Close bootstrap before starting the backend.

### 4. Register Discord commands and start the stack

Register commands using the protected service environment as described in the deployment guide. After bootstrap and registration:

```sh
sudo systemctl enable --now cos-headless.target
```

In your authorized private Discord channel, open `/help` and `/setup`. Review the staged settings, permissions, worker limits and notification choices before confirming Save. Notifications and operational alerts are opt-in.

## Everyday Discord controls

| Commands | Use |
| --- | --- |
| `/new`, `/ask` | Start a conversation or send/queue a task |
| `/sessions`, `/select` | Find and select a saved local session |
| `/status`, `/monitor` | Inspect the active session, delivery evidence and service health |
| `/models`, `/model`, `/reasoning` | Inspect observed model availability and request the next prompt's settings |
| `/goal`, `/loop` | Control automation within your saved objective or brief |
| `/plan`, `/taskplan` | Review a proposed workflow or inspect recorded task progress |
| `/workers`, `/delegate` | Inspect workers or delegate an independent task |
| `/compact` | Compact and resume while retaining the local session identity |
| `/queue`, `/history`, `/chat` | Inspect queued inputs and recorded conversation evidence |
| `/operations`, `/operation` | Inspect request receipts, including an archived identity by its exact ID |
| `/stop`, `/cancel` | Request Stop for the exact live turn or withdraw a provably unsent input |
| `/setup`, `/help` | Configure authorized controls and discover available commands |

Buttons and dropdowns support phone use. Every command and component action retains permission checks. The [full command reference](docs/discord-commands.md) explains arguments and required grants.

Admission is not proof of delivery or task completion. If a request is uncertain, inspect its receipt, queue and history before composing another request. Checking a receipt never resends it.

## Operations, updates and backups

Check or stop the managed stack locally:

```sh
sudo systemctl status cos-headless.target cos-backend.service cos-browser.service cos-discord.service
sudo journalctl -u cos-backend -u cos-browser -u cos-discord --since '20 minutes ago'
sudo systemctl stop cos-headless.target
```

Use the [local maintenance workflow](docs/reliability-rollout.md#local-update-backup-and-restore) for encrypted backups, verified updates, interrupted-install recovery and restoration. The independent maintenance guard runs before runtime services and retains a local review requirement after an interrupted boot rollback.

Restoration verifies checksums and ownership, restores matching code/data, and holds delivery, automation, model tools, notifications and worker revival. Review potentially repeated work locally, retain a reconciliation record, then release the hold while the stack is stopped. Starting services remains an explicit local step.

Settled receipts older than one hour archive hourly and before admission at 80% hot capacity. Bulky archived results expire after 30 days; permanent replay fences and unresolved receipts remain protected. Do not remove replay protection to free capacity. Incompatible code-only rollbacks are refused; use the matching encrypted backup and recovery procedure.

## Validation and readiness

Automated regression checks, both builds, deployment fault drills and isolated Electron/Xvfb/Brave checks have passed locally. Detailed results, skipped checks and observed native UI flakiness are recorded in the [validation report](docs/headless-validation.md).

The following live gates are still **pending**:

- Authenticated task delivery, zero/one/two-worker workloads, compaction and component restarts on a disposable VPS.
- Expired-login handling, privileged update/restore drills and unattended reboot/keyring recovery.
- A phone walkthrough and 24 hours without unexplained lost or duplicated work.
- A seven-day resource and notification soak.

Complete the [acceptance worksheet](docs/reliability-rollout.md#acceptance-worksheet) before treating an installation as ready for unattended daily use. A paired extension or healthy service cannot establish provider sign-in or whole-task correctness.

## Security and responsible use

Keep the display, browser bootstrap and Control API private; use authenticated SSH access and explicitly authorized Discord channels. Store credentials in the protected local configuration, never in Discord, source control or command arguments. Approved folders constrain file tools; shell commands still run with the backend account's normal privileges.

Use only authorized accounts and workspaces, respect provider rules, usage limits and safety decisions, and review automated actions and results. This independent project does not grant extra quota or model access and is not affiliated with or endorsed by OpenAI.

## Documentation and credits

- [VPS deployment and troubleshooting](docs/headless-vps.md)
- [Discord command reference](docs/discord-commands.md)
- [Reliability, recovery and acceptance](docs/reliability-rollout.md)
- [Headless architecture](docs/headless-architecture.md)
- [Validation results](docs/headless-validation.md)
- [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)

Based on [Chat On Steroids](https://github.com/totec448-spec/chat-on-steroids), with credit to its [contributors](CONTRIBUTORS.md).
