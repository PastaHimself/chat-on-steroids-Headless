import path from 'node:path';
import { z } from 'zod';
import { snowflake, type Permission, type BotSettings } from './state.js';

export interface Bootstrap { token: string; applicationId: string; admins: string[]; guilds: string[]; channels: string[]; apiDirectory: string; dataDirectory: string; }
const knownSecrets = new Set<string>();
export function rememberSecret(value: string): void {
  if (value.length < 8) return;
  knownSecrets.add(value);
  while (knownSecrets.size > 8) knownSecrets.delete(knownSecrets.values().next().value!);
}
function ids(value: string | undefined): string[] {
  const rows = (value ?? '').split(',').map(row => row.trim()).filter(Boolean);
  return z.array(snowflake).max(100).parse([...new Set(rows)]);
}
export function bootstrap(env = process.env): Bootstrap {
  const token = env.DISCORD_BOT_TOKEN;
  if (!token || token.length < 20 || /\s/.test(token)) throw new Error('Set DISCORD_BOT_TOKEN in the secure local environment file');
  rememberSecret(token);
  const admins = ids(env.DISCORD_ADMIN_IDS), guilds = ids(env.DISCORD_GUILD_IDS);
  if (!admins.length || !guilds.length) throw new Error('Local bootstrap requires explicit administrator and guild IDs');
  const applicationId = snowflake.parse(env.DISCORD_APPLICATION_ID);
  for (const key of ['COS_CONTROL_DIRECTORY', 'DISCORD_DATA_DIR'] as const)
    if (!env[key] || !path.isAbsolute(env[key]!)) throw new Error(`${key} must be an absolute path`);
  return { token, applicationId, admins, guilds, channels: ids(env.DISCORD_CHANNEL_IDS),
    apiDirectory: env.COS_CONTROL_DIRECTORY!, dataDirectory: env.DISCORD_DATA_DIR! };
}
export function authorized(config: Bootstrap, settings: BotSettings, user: string, guild: string | null, channel: string, permission: Permission): boolean {
  if (!guild || !config.guilds.includes(guild)) return false;
  if (config.channels.length && !config.channels.includes(channel)) return false;
  if (settings.channels.length && !settings.channels.includes(channel)) return false;
  if (config.admins.includes(user)) return true;
  const grants = settings.users[user] ?? [];
  // Administrator ownership is exclusively bootstrapped locally, never from a Discord role or form.
  return permission !== 'admin' && grants.includes(permission);
}
export function safeText(value: unknown, secrets: string[] = []): string {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'No recorded data.';
  for (const secret of [...knownSecrets, process.env.DISCORD_BOT_TOKEN ?? '', ...secrets]) if (secret) text = text.replaceAll(secret, '[redacted]');
  return text.replace(/(?:Bot|Bearer)\s+[A-Za-z0-9._-]+/gi, '[redacted]')
    .replace(/(?:mfa\.[\w-]{20,}|[\w-]{24,}\.[\w-]{6,}\.[\w-]{25,}|sk-[\w-]{16,})/g, '[redacted]')
    .replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}
