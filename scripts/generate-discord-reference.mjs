import fs from 'node:fs/promises';
import { definitions, commands } from '../discord/dist/commands.js';
const lines = ['# Discord command reference', '', 'Generated from the implemented registration definitions. Rebuild the bot, then run `node scripts/generate-discord-reference.mjs` after changing commands.', '',
  'Commands reply privately. Authorization combines locally bootstrapped users/guilds/channels, saved user grants and the backend’s local permission switches. No Discord role grants administrator access. `session` means the durable local session ID; omitting it uses your selection, the channel mapping, then the default.', '',
  'Read commands inspect recorded/live evidence. Mutation acknowledgement is admission, not proof of provider delivery or task completion. String prompts/tasks/objectives are limited to 4,000 characters by Discord. Use buttons and dropdowns for mobile navigation; expired panels require reopening the command.', ''];
for (const category of [...new Set(definitions.map(row => row.category))]) {
  lines.push(`## ${category}`, '');
  for (const definition of definitions.filter(row => row.category === category)) {
    const command = commands.find(row => row.name === definition.name);
    lines.push(`### /${command.name}`, '', command.description, '', `Permission: **${definition.permission}**. Example: \`${definition.example}\`.`, '');
    for (const option of command.options ?? []) lines.push(`- \`${option.name}\` (${'required' in option && option.required ? 'required' : 'optional'}): ${option.description}${'choices' in option && option.choices ? `. Choices: ${option.choices.map(row => `\`${row.value}\``).join(', ')}` : ''}.`);
    if (command.options?.length) lines.push('');
  }
}
lines.push('## Behavior and limitations', '',
  '- Goal uses the existing completion-aware engine and may send no continuation. Loop continues within the saved objective. Switching modes without an objective preserves it.',
  '- Composer Plan generates approval-required workflow stages. Its edit/delete/approve/regenerate/cancel controls validate the draft revision and session conversation. Approval enters the existing checkpoint outbox. `/taskplan` reads the executor’s separate durable `update_plan` document; completed labels are the executor’s report.',
  '- `/model` and `/reasoning` store a requested preference for the next `/ask`. `/status` reports the observed model; delivery acknowledgement is required before claiming a switch. `/models refresh:true` passively observes an existing account page.',
  '- `/new` reserves the existing local session through the outbox. Without a prompt it sends the stated opening instruction: “Start a new conversation. Await my next instruction.”',
  '- `/stop`, `/compact`, `/cancel` and worker sleep require owner-bound confirmation. Stop disables automation and requests the exact generation’s native Stop; cancellation remains unconfirmed until provider evidence. Pause saves and disables local automation; Resume restores only a mode paused through this bot.',
  '- Worker actions are restricted to the selected prime and exact run incarnation. Message delivery and sleep use the broker. `/workerlogs` searches at most 1,000 session summaries and reads at most ten events; it never treats a provider conversation ID as a local session ID.',
  '- Projects must already exist and be approved locally. Files lists directories read-only and preserves root/symlink checks; it does not expose file editing, root approval or arbitrary paths.',
  '- `/setup` requires a locally established administrator. Changes remain in a durable draft until Finish → Confirm Save. Model/default session/channel mapping, worker caps, planner/finish controls, grants, notifications and Loop timing are supported. Secrets, browser authentication, tunnels and folder approval require local bootstrap.',
  '- `/help` reads these same registration definitions and hides commands outside the user’s grants. Backend availability/local grants are shown; an offline backend can still provide help.',
  '- Progress/final notifications are opt-in and edit a persisted message. Exact recorded turn completion is separate from whole-task success. Channels can expose sensitive prose; use private channels and avoid unlabeled secrets.', '',
  '[Deployment and recovery](headless-vps.md) · [Architecture](headless-architecture.md) · [Validation](headless-validation.md)', '');
const output = lines.join('\n'), target = new URL('../docs/discord-commands.md', import.meta.url);
if (process.argv.includes('--check')) { if (await fs.readFile(target, 'utf8') !== output) throw new Error('Command reference is stale'); }
else await fs.writeFile(target, output);
console.log(`Validated reference for ${commands.length} implemented Discord commands.`);
