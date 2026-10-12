# Discord command reference

Generated from the implemented registration definitions. Rebuild the bot, then run `node scripts/generate-discord-reference.mjs` after changing commands.

Commands reply privately. Authorization combines locally bootstrapped users/guilds/channels, saved user grants and the backend’s local permission switches. No Discord role grants administrator access. `session` means the durable local session ID; omitting it uses your selection, the channel mapping, then the default.

Read commands inspect recorded/live evidence. Mutation acknowledgement is admission, not proof of provider delivery or task completion. String prompts/tasks/objectives are limited to 4,000 characters by Discord. Use buttons and dropdowns for mobile navigation; expired panels require reopening the command.

## Conversations

### /ask

Send or queue a prompt through the durable outbox

Permission: **send**. Example: `/ask prompt:Run the tests`.

- `prompt` (required): Your task or question.
- `session` (optional): Local session; defaults to your selected session.
- `delivery` (optional): Auto refuses an unapproved interruption. Choices: `auto`, `after-turn`, `finish`.

### /new

Open a conversation using the existing input lifecycle

Permission: **send**. Example: `/new prompt:Inspect the project`.

- `prompt` (optional): Your task or question.
- `project` (optional): Approved project.
- `model` (optional): Account-observed model; confirmed on delivery.
- `reasoning` (optional): Supported effort.

### /sessions

Browse saved sessions and select one

Permission: **read**. Example: `/sessions`.

### /select

Select your local session

Permission: **read**. Example: `/select session:…`.

- `session` (required): Local session; defaults to your selected session.

### /chat

Read recent recorded conversation messages

Permission: **read**. Example: `/chat`.

- `session` (optional): Local session; defaults to your selected session.

### /history

Browse recorded conversation history

Permission: **read**. Example: `/history`.

- `session` (optional): Local session; defaults to your selected session.

### /status

Inspect live session state and delivery

Permission: **read**. Example: `/status`.

- `session` (optional): Local session; defaults to your selected session.

### /stop

Request native Stop for the exact live turn

Permission: **send**. Example: `/stop`.

- `session` (optional): Local session; defaults to your selected session.

## Goal and Loop

### /goal

Control the existing Goal engine and saved objective

Permission: **configure**. Example: `/goal action:on objective:Fix bugs and verify`.

- `action` (required): Operation. Choices: `on`, `off`, `status`.
- `objective` (optional): Save the requested finish line.
- `session` (optional): Local session; defaults to your selected session.

### /loop

Control existing Loop continuation within the saved brief

Permission: **configure**. Example: `/loop action:on`.

- `action` (required): Operation. Choices: `on`, `off`, `status`.
- `delivery` (optional): Existing continuation boundary. Choices: `session-finish`, `after-turn`.
- `session` (optional): Local session; defaults to your selected session.

## Plans and tasks

### /plan

Generate a composer workflow for explicit review and approval

Permission: **plan**. Example: `/plan prompt:Refactor and verify`.

- `prompt` (required): Your task or question.
- `session` (optional): Local session; defaults to your selected session.

### /taskplan

Read the executor’s durable update_plan progress

Permission: **read**. Example: `/taskplan`.

- `session` (optional): Local session; defaults to your selected session.

### /planstatus

Inspect generated workflow review and checkpoint state

Permission: **read**. Example: `/planstatus`.

- `session` (optional): Local session; defaults to your selected session.

## Models

### /model

Inspect or request the model for your next prompt

Permission: **configure**. Example: `/model model:…`.

- `model` (optional): Account-observed model; confirmed on delivery.
- `session` (optional): Local session; defaults to your selected session.

### /models

Browse actual account-observed models

Permission: **read**. Example: `/models`.

- `refresh` (optional): Observe an existing ChatGPT page.

### /reasoning

Inspect or request a supported next-prompt effort

Permission: **configure**. Example: `/reasoning effort:high`.

- `effort` (optional): Supported reasoning effort.
- `session` (optional): Local session; defaults to your selected session.

## Workers

### /workers

Read workers owned by the selected prime session

Permission: **read**. Example: `/workers`.

- `session` (optional): Local session; defaults to your selected session.

### /worker

Message or pause an owned broker worker

Permission: **workers**. Example: `/worker action:message run:… worker:worker-1 text:Review tests`.

- `action` (required): Broker operation. Choices: `message`, `sleep`.
- `run` (required): Exact run incarnation.
- `worker` (required): Worker ID within that run.
- `text` (optional): Follow-up assignment (required for message).
- `session` (optional): Local session; defaults to your selected session.

### /delegate

Delegate an independent task through the existing broker

Permission: **workers**. Example: `/delegate task:Review the tests`.

- `task` (required): Independent task and expected report.
- `run` (optional): Existing owned run incarnation.
- `session` (optional): Local session; defaults to your selected session.

### /workerlogs

Read bounded recorded activity of an owned worker

Permission: **read**. Example: `/workerlogs run:… worker:worker-1`.

- `run` (required): Exact run incarnation.
- `worker` (required): Owned worker ID.
- `session` (optional): Local session; defaults to your selected session.

## Sessions and projects

### /compact

Compact and resume the same durable local session

Permission: **send**. Example: `/compact`.

- `session` (optional): Local session; defaults to your selected session.

### /queue

Inspect pending, scheduled and uncertain inputs

Permission: **read**. Example: `/queue`.

- `session` (optional): Local session; defaults to your selected session.

### /cancel

Withdraw a provably unsent input

Permission: **send**. Example: `/cancel input:…`.

- `input` (required): Exact outbox UUID.
- `session` (optional): Local session; defaults to your selected session.

### /pause

Disable this session’s local Goal or Loop automation

Permission: **configure**. Example: `/pause`.

- `session` (optional): Local session; defaults to your selected session.

### /resume

Restore the automation mode explicitly paused here

Permission: **configure**. Example: `/resume`.

- `session` (optional): Local session; defaults to your selected session.

### /project

Associate this session with an already approved project

Permission: **configure**. Example: `/project project:…`.

- `project` (required): Approved project.
- `session` (optional): Local session; defaults to your selected session.

### /projects

List selectable approved projects

Permission: **read**. Example: `/projects`.

### /files

Browse an approved project directory read-only

Permission: **read**. Example: `/files project:… directory:src`.

- `project` (required): Approved project.
- `directory` (optional): Relative directory; no traversal or symlink escapes.
- `page` (optional): Page number.

## System monitoring

### /logs

Read bounded redacted application diagnostics privately

Permission: **read**. Example: `/logs`.

### /monitor

Inspect VPS resources and backend connection health

Permission: **read**. Example: `/monitor`.

## Configuration

### /setup

Configure and validate the integration in an administrator wizard

Permission: **admin**. Example: `/setup`.

### /help

Browse registered commands, permissions and availability

Permission: **read**. Example: `/help command:plan`.

- `command` (optional): Registered command.

## Behavior and limitations

- Goal uses the existing completion-aware engine and may send no continuation. Loop continues within the saved objective. Switching modes without an objective preserves it.
- Composer Plan generates approval-required workflow stages. Its edit/delete/approve/regenerate/cancel controls validate the draft revision and session conversation. Approval enters the existing checkpoint outbox. `/taskplan` reads the executor’s separate durable `update_plan` document; completed labels are the executor’s report.
- `/model` and `/reasoning` store a requested preference for the next `/ask`. `/status` reports the observed model; delivery acknowledgement is required before claiming a switch. `/models refresh:true` passively observes an existing account page.
- `/new` reserves the existing local session through the outbox. Without a prompt it sends the stated opening instruction: “Start a new conversation. Await my next instruction.”
- `/stop`, `/compact`, `/cancel` and worker sleep require owner-bound confirmation. Stop disables automation and requests the exact generation’s native Stop; cancellation remains unconfirmed until provider evidence. Pause saves and disables local automation; Resume restores only a mode paused through this bot.
- Worker actions are restricted to the selected prime and exact run incarnation. Message delivery and sleep use the broker. `/workerlogs` searches at most 1,000 session summaries and reads at most ten events; it never treats a provider conversation ID as a local session ID.
- Projects must already exist and be approved locally. Files lists directories read-only and preserves root/symlink checks; it does not expose file editing, root approval or arbitrary paths.
- `/setup` requires a locally established administrator. Changes remain in a durable draft until Finish → Confirm Save. Model/default session/channel mapping, worker caps, planner/finish controls, grants, notifications and Loop timing are supported. Secrets, browser authentication, tunnels and folder approval require local bootstrap.
- `/help` reads these same registration definitions and hides commands outside the user’s grants. Backend availability/local grants are shown; an offline backend can still provide help.
- Progress/final notifications are opt-in and edit a persisted message. Exact recorded turn completion is separate from whole-task success. Channels can expose sensitive prose; use private channels and avoid unlabeled secrets.

[Deployment and recovery](headless-vps.md) · [Architecture](headless-architecture.md) · [Validation](headless-validation.md)
