import { SlashCommandBuilder } from 'discord.js';
import type { Permission } from './state.js';

type Option = { name: string; description: string; required?: boolean; autocomplete?: boolean; choices?: string[]; type?: 'integer' | 'boolean'; };
type Definition = { name: string; description: string; category: string; permission: Permission; example: string; options?: Option[]; };
const session: Option = { name: 'session', description: 'Local session; defaults to your selected session', autocomplete: true };
const prompt: Option = { name: 'prompt', description: 'Your task or question', required: true };
const project: Option = { name: 'project', description: 'Approved project', autocomplete: true };
const model: Option = { name: 'model', description: 'Account-observed model; confirmed on delivery', autocomplete: true };
const action: Option = { name: 'action', description: 'Operation', choices: ['on', 'off', 'status'], required: true };
export const definitions: Definition[] = [
  { name: 'ask', description: 'Send or queue a prompt through the durable outbox', category: 'Conversations', permission: 'send', example: '/ask prompt:Run the tests',
    options: [prompt, session, { name: 'delivery', description: 'Auto refuses an unapproved interruption', choices: ['auto', 'after-turn', 'finish'] }] },
  { name: 'new', description: 'Open a conversation using the existing input lifecycle', category: 'Conversations', permission: 'send', example: '/new prompt:Inspect the project',
    options: [{ ...prompt, required: false }, project, model, { name: 'reasoning', description: 'Supported effort', autocomplete: true }] },
  { name: 'sessions', description: 'Browse saved sessions and select one', category: 'Conversations', permission: 'read', example: '/sessions' },
  { name: 'select', description: 'Select your local session', category: 'Conversations', permission: 'read', example: '/select session:…', options: [{ ...session, required: true }] },
  { name: 'chat', description: 'Read recent recorded conversation messages', category: 'Conversations', permission: 'read', example: '/chat', options: [session] },
  { name: 'history', description: 'Browse recorded conversation history', category: 'Conversations', permission: 'read', example: '/history', options: [session] },
  { name: 'status', description: 'Inspect live session state and delivery', category: 'Conversations', permission: 'read', example: '/status', options: [session] },
  { name: 'stop', description: 'Request native Stop for the exact live turn', category: 'Conversations', permission: 'send', example: '/stop', options: [session] },
  { name: 'goal', description: 'Control the existing Goal engine and saved objective', category: 'Goal and Loop', permission: 'configure', example: '/goal action:on objective:Fix bugs and verify',
    options: [action, { name: 'objective', description: 'Save the requested finish line' }, session] },
  { name: 'loop', description: 'Control existing Loop continuation within the saved brief', category: 'Goal and Loop', permission: 'configure', example: '/loop action:on',
    options: [action, { name: 'delivery', description: 'Existing continuation boundary', choices: ['session-finish', 'after-turn'] }, session] },
  { name: 'plan', description: 'Generate a composer workflow for explicit review and approval', category: 'Plans and tasks', permission: 'plan', example: '/plan prompt:Refactor and verify', options: [prompt, session] },
  { name: 'taskplan', description: 'Read the executor’s durable update_plan progress', category: 'Plans and tasks', permission: 'read', example: '/taskplan', options: [session] },
  { name: 'planstatus', description: 'Inspect generated workflow review and checkpoint state', category: 'Plans and tasks', permission: 'read', example: '/planstatus', options: [session] },
  { name: 'model', description: 'Inspect or request the model for your next prompt', category: 'Models', permission: 'configure', example: '/model model:…', options: [model, session] },
  { name: 'models', description: 'Browse actual account-observed models', category: 'Models', permission: 'read', example: '/models', options: [{ name: 'refresh', description: 'Observe an existing ChatGPT page', type: 'boolean' }] },
  { name: 'reasoning', description: 'Inspect or request a supported next-prompt effort', category: 'Models', permission: 'configure', example: '/reasoning effort:high',
    options: [{ name: 'effort', description: 'Supported reasoning effort', autocomplete: true }, session] },
  { name: 'workers', description: 'Read workers owned by the selected prime session', category: 'Workers', permission: 'read', example: '/workers', options: [session] },
  { name: 'worker', description: 'Message or pause an owned broker worker', category: 'Workers', permission: 'workers', example: '/worker action:message run:… worker:worker-1 text:Review tests',
    options: [{ name: 'action', description: 'Broker operation', required: true, choices: ['message', 'sleep'] },
      { name: 'run', description: 'Exact run incarnation', required: true }, { name: 'worker', description: 'Worker ID within that run', required: true },
      { name: 'text', description: 'Follow-up assignment (required for message)' }, session] },
  { name: 'delegate', description: 'Delegate an independent task through the existing broker', category: 'Workers', permission: 'workers', example: '/delegate task:Review the tests',
    options: [{ name: 'task', description: 'Independent task and expected report', required: true }, { name: 'run', description: 'Existing owned run incarnation' }, session] },
  { name: 'workerlogs', description: 'Read bounded recorded activity of an owned worker', category: 'Workers', permission: 'read', example: '/workerlogs run:… worker:worker-1',
    options: [{ name: 'run', description: 'Exact run incarnation', required: true }, { name: 'worker', description: 'Owned worker ID', required: true }, session] },
  { name: 'compact', description: 'Compact and resume the same durable local session', category: 'Sessions and projects', permission: 'send', example: '/compact', options: [session] },
  { name: 'queue', description: 'Inspect pending, scheduled and uncertain inputs', category: 'Sessions and projects', permission: 'read', example: '/queue', options: [session] },
  { name: 'cancel', description: 'Withdraw a provably unsent input', category: 'Sessions and projects', permission: 'send', example: '/cancel input:…',
    options: [{ name: 'input', description: 'Exact outbox UUID', required: true }, session] },
  { name: 'pause', description: 'Disable this session’s local Goal or Loop automation', category: 'Sessions and projects', permission: 'configure', example: '/pause', options: [session] },
  { name: 'resume', description: 'Restore the automation mode explicitly paused here', category: 'Sessions and projects', permission: 'configure', example: '/resume', options: [session] },
  { name: 'project', description: 'Associate this session with an already approved project', category: 'Sessions and projects', permission: 'configure', example: '/project project:…', options: [{ ...project, required: true }, session] },
  { name: 'projects', description: 'List selectable approved projects', category: 'Sessions and projects', permission: 'read', example: '/projects' },
  { name: 'files', description: 'Browse an approved project directory read-only', category: 'Sessions and projects', permission: 'read', example: '/files project:… directory:src',
    options: [{ ...project, required: true }, { name: 'directory', description: 'Relative directory; no traversal or symlink escapes' }, { name: 'page', description: 'Page number', type: 'integer' }] },
  { name: 'logs', description: 'Read bounded redacted application diagnostics privately', category: 'System monitoring', permission: 'read', example: '/logs' },
  { name: 'monitor', description: 'Inspect VPS resources and backend connection health', category: 'System monitoring', permission: 'read', example: '/monitor' },
  { name: 'operations', description: 'Inspect recent operation receipts without resending', category: 'System monitoring', permission: 'read', example: '/operations', options: [session] },
  { name: 'operation', description: 'Check an exact operation receipt without resending', category: 'System monitoring', permission: 'read', example: '/operation id:…',
    options: [{ name: 'id', description: 'Exact operation UUID', required: true }] },
  { name: 'setup', description: 'Configure and validate the integration in an administrator wizard', category: 'Configuration', permission: 'admin', example: '/setup' },
  { name: 'help', description: 'Browse registered commands, permissions and availability', category: 'Configuration', permission: 'read', example: '/help command:plan',
    options: [{ name: 'command', description: 'Registered command', autocomplete: true }] }
];

export const commands = definitions.map(definition => {
  const builder = new SlashCommandBuilder().setName(definition.name).setDescription(definition.description).setDMPermission(false);
  for (const option of definition.options ?? []) {
    if (option.type === 'boolean') builder.addBooleanOption(field => field.setName(option.name).setDescription(option.description).setRequired(option.required ?? false));
    else if (option.type === 'integer') builder.addIntegerOption(field => field.setName(option.name).setDescription(option.description).setMinValue(1).setMaxValue(100).setRequired(option.required ?? false));
    else builder.addStringOption(field => {
      field.setName(option.name).setDescription(option.description).setRequired(option.required ?? false).setMaxLength(['prompt', 'task', 'text', 'objective'].includes(option.name) ? 4000 : 256);
      if (option.autocomplete) field.setAutocomplete(true);
      if (option.choices) field.addChoices(...option.choices.map(value => ({ name: value, value })));
      return field;
    });
  }
  return builder.toJSON();
});
export function helpDescription(name: string): string {
  const definition = definitions.find(row => row.name === name);
  const wire = commands.find(row => row.name === name);
  if (!definition || !wire) throw new Error('Unknown command');
  return [`/${wire.name} — ${wire.description}`, `Permission: ${definition.permission}`, ...((wire.options ?? []).map(option =>
    `${option.name}${'required' in option && option.required ? ' (required)' : ' (optional)'}: ${option.description}${'choices' in option && option.choices ? ` [${option.choices.map(choice => choice.value).join(', ')}]` : ''}`)),
    `Example: ${definition.example}`].join('\n');
}
