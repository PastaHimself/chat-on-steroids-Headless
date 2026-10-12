import { verifyDurableFormats } from '../../runtime/durable-formats.mjs';
import { Client, GatewayIntentBits, Events, REST, Routes, Options } from 'discord.js';
import { bootstrap, safeText } from './config.js';
import { StateStore } from './state.js';
import { ControlClient } from './api.js';
import { commands } from './commands.js';
import { DiscordController } from './bot.js';
import { Notifications, type NotificationTransport } from './notifications.js';
import { HealthAlerts } from './health-alerts.js';

async function main(): Promise<void> {
  const config = bootstrap();
  if (process.getuid?.() === 0) throw new Error('Run the Discord bot as an unprivileged service account');
  if (process.argv.includes('--register')) {
    const rest = new REST({ version: '10' }).setToken(config.token);
    for (const guild of config.guilds) await rest.put(Routes.applicationGuildCommands(config.applicationId, guild), { body: commands });
    console.info(`Registered ${commands.length} commands in ${config.guilds.length} explicitly authorized guild(s).`);
    return;
  }
  const store = new StateStore(config.dataDirectory); await verifyDurableFormats(store.directory, false);
  await store.load();
  const api = new ControlClient(config.apiDirectory);
  const controller = new DiscordController(config, store, api);
  const client = new Client({ intents: [GatewayIntentBits.Guilds], rest: { retries: 0 },
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 20, UserManager: 100, GuildMemberManager: 0, PresenceManager: 0 }) });
  // A bounded messages cache is supplied by the channel fetches below; no message-content/member intent is required.
  const transport: NotificationTransport = { channel: async id => {
    const channel = await client.channels.fetch(id);
    if (!channel || !('guildId' in channel) || !channel.isSendable() || !('messages' in channel)) throw new Error('Notification channel is unavailable');
    return { guildId: channel.guildId, send: payload => channel.send(payload),
      edit: async (messageId, payload) => { await channel.messages.edit(messageId, payload); },
      recent: async () => [...(await channel.messages.fetch({ limit: 50 })).values()].filter(message => message.author.id === client.user?.id)
        .map(message => ({ id: message.id, marker: message.embeds[0]?.footer?.text ?? null })) };
  } };
  const notifications = new Notifications(config, store, api, transport, message => console.warn(message));
  const healthAlerts = new HealthAlerts(config, store, api, transport, message => console.warn(message));
  await store.upkeep();
  await verifyDurableFormats(store.directory);
  const upkeep = setInterval(() => { void store.upkeep().catch(() => console.warn('Receipt upkeep pending; unresolved receipts are retained')); }, 60 * 60_000);
  upkeep.unref();
  client.on(Events.InteractionCreate, interaction => { void controller.handle(interaction).catch(() => console.warn('Discord interaction failed')); });
  client.once(Events.ClientReady, () => { console.info('Discord bot connected'); notifications.start(); healthAlerts.start(); });
  client.on(Events.Error, () => console.warn('Discord transport error; reconnect recovery remains enabled'));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { clearInterval(upkeep); notifications.stop(); healthAlerts.stop(); client.destroy(); });
  await client.login(config.token);
}
void main().catch(error => { console.error(safeText(error instanceof Error ? error.message : 'Bot startup failed', [process.env.DISCORD_BOT_TOKEN ?? ''])); process.exitCode = 1; });
