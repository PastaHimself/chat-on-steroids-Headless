# Headless and Discord service boundaries

The server deployment runs the existing Electron main process on Xvfb, with no workspace
window, tray or pet overlay. It is not a display-independent Node replacement. Brave is a
graphical browser on that same virtual display. Native Chromium headless extension support
has not been verified. The desktop default remains the existing application.

| Capability | Existing authority | Remote adapter |
| --- | --- | --- |
| Input, new conversation, checkpoints | `session/input.ts`, `session/start-input.ts` | Authenticated input admission; same reserved session and delivery receipts |
| Goal, Loop, objective | `bridge.ts` session controls → `goal.ts` | Per-session controls, never a Discord continuation scheduler |
| Composer Plan | `goal.ts::draftTaskPlan` | Durable review draft; explicit revision-checked approval into the existing outbox |
| Executor `update_plan` | `session/store.ts::readSessionPlan` | Read-only projection; unrelated to composer approval |
| Stop | `bridge.ts::stopSessionTurn` | Exact active-turn request; provider cancellation remains unconfirmed |
| Compact & Resume | `bridge.ts::compactSession` → continuation WAL | Original local session ID remains the Discord mapping |
| Models | `chat-models.ts`, input model acknowledgement | Account-observed choices; requested next-send selection is separate from observed selection |
| Workers | `agents.ts` staged broker operations | Exact owning prime and run incarnation; no direct worker-chat inputs |
| Projects/files | `projects.ts`, `project-files.ts`, sandbox | Existing approved roots; directory listing only |
| Connection/extension | `connection.ts`, `bridge.ts` | Existing redacted control status; pairing and authentication are separate facts |
| History/progress | Control API event sequence and session read model | Bounded cursor polling; persistent Discord message/checkpoint state |

The loopback Control API retains bearer authentication, Origin rejection, Host validation,
body limits, rate limits, serialized actions and its authoritative `allowActions` switch.
New remote mutation permissions are explicit local bootstrap grants in
`COS_REMOTE_PERMISSIONS` (`send,configure,plan,workers`). They cannot be enabled by Discord.
Remote operation UUIDs are durably fenced before side effects. Interrupted operations are
reported as unconfirmed and never automatically replayed. The outbox remains delivery authority.

The bot owns Discord authorization, setup drafts, user/channel mappings and notification
checkpoints in its separate data directory. It reads only the explicitly shared API credential
directory and uses HTTP for application state. It never opens application session/config files.
The first administrator comes from the local environment file; Discord roles cannot claim it.

The application owns all backend restore/shutdown ordering. Systemd owns Xvfb and Brave
process groups and restart policies. Resource diagnostics report pressure and possible orphan
processes; they do not kill active tasks. Authentication, keyring unlock, extension installation,
provider tool approval, account eligibility and tunnel provisioning still require a person.

## Additive API surface

The route catalog is `src/shared/remote-control.ts`; implementation and strict request schemas
are in `src/main/remote-control.ts`. All routes use the existing authenticated listener.
Grouped suffixes in the table inherit the first route's `/v1/remote` or `/v1/sessions/{id}` prefix.

| Routes | Scope |
| --- | --- |
| `GET /v1/remote/settings`, `/resources`, `/models`, `/projects`, `/files` | Safe settings, resources, observed model catalog and approved directory reads |
| `GET /v1/remote/plans`, `/plans/{id}`, `/operations/{id}` | Review drafts and durable mutation receipts |
| `GET /v1/sessions/{id}/controls`, `/taskplan`, `/workers` | Actual per-session controls, executor plan and owned worker family |
| `POST /v1/remote/ask`, `/new`, `/stop`, `/compact` | Existing input, session opening, native Stop and continuation owners; `send` grant |
| `POST /v1/remote/automation`, `/objective`, `/project`, `/settings` | Narrow existing settings; `configure` grant |
| `POST /v1/remote/plan`, `/plan-edit`, `/plan-cancel`, `/plan-regenerate` | Existing planner plus review drafts; `plan` grant |
| `POST /v1/remote/plan-approve` | Revision-checked approval into the outbox; both `plan` and `send` grants |
| `POST /v1/remote/delegate`, `/worker` | Shared staged worker admission and broker operations; `workers` grant |

Every mutation requires a caller-generated UUID `id`. An exact settled request can return its
stored receipt; a changed payload with the same UUID conflicts; an interrupted admission is
unconfirmed. Reads expose redacted projections, so a stage edit addresses one index rather than
writing a displayed/truncated plan back over the raw stages. Worker operations additionally
require the owning prime session and exact run incarnation. Existing health, status, history,
outbox and cancel routes remain in their original owners.
