import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { safeText } from './config.js';

export function panel(title: string, text: unknown, components: any[] = [], secrets: string[] = []) {
  const description = safeText(text, secrets);
  return { embeds: [new EmbedBuilder().setTitle(safeText(title, secrets).slice(0, 256)).setDescription(description.slice(0, 3900) || 'No recorded data.')
    .setFooter({ text: description.length > 3900 ? 'Display shortened; use history pages for more.' : 'Recorded state • refresh to inspect changes' })],
    components, allowedMentions: { parse: [] as [] } };
}
export function buttons(viewId: string, options: Array<[string, string, ButtonStyle?]>) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...options.slice(0, 5).map(([action, label, style]) =>
    new ButtonBuilder().setCustomId(`${viewId}:${action}`).setLabel(label).setStyle(style ?? ButtonStyle.Secondary)));
}
export function select(viewId: string, action: string, placeholder: string, options: Array<{ label: string; value: string; description?: string }>) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${viewId}:${action}`)
    .setPlaceholder(placeholder).addOptions(options.slice(0, 25).map(option => ({ ...option, label: safeText(option.label).slice(0, 100),
      description: option.description ? safeText(option.description).slice(0, 100) : undefined }))));
}
export function sessionDescription(detail: any): string {
  const session = detail.session, live = detail.live;
  return [`Session: ${session.title || session.id}`, `Local ID: ${session.id}`, `Project: ${session.projectId ?? 'unfiled'}`,
    `Observed model: ${session.model ?? 'unknown'}`, `State: ${live?.activeTurnId ? 'working' : live?.stopPending ? 'stop requested' : 'no proven active turn'}`,
    `Automation: ${live?.automation ?? 'unavailable'}`, live?.blocked ? `Blocked: ${live.blocked}` : '',
    live?.goalWait ? `Waiting: ${live.goalWait.reason}` : '', live?.job ? `Compact & Resume: ${live.job.stage}` : '',
    `Last recorded outcome: ${session.lastTurnOutcome ?? 'unknown'}`, `Updated: ${new Date(session.updatedAt).toISOString()}`,
    'A stopped generation alone does not prove task success.'].filter(Boolean).join('\n');
}
export function historyDescription(events: any[]): string {
  return events.map(event => `**${event.kind} · ${event.position}**\n${event.message?.text ?? event.tool?.summary?.title ?? event.detail ?? event.outcome ?? event.delivery ?? ''}${event.message?.truncated ? '\n[recorded display shortened]' : ''}`).join('\n\n');
}
export function taskPlanDescription(plan: any): string {
  if (!plan) return 'No durable executor update_plan document is recorded.';
  const completed = plan.plan.filter((row: any) => row.status === 'completed').length;
  return [`${completed}/${plan.plan.length} steps marked completed by the executor.`, plan.explanation ?? '',
    ...plan.plan.map((row: any, index: number) => `${index + 1}. ${row.status === 'completed' ? '✓' : row.status === 'in_progress' ? '▶' : '○'} ${row.step}\n${row.details ?? ''}`),
    'These are the executor’s recorded progress labels; inspect results for verification.'].join('\n');
}
export function resourceDescription(resource: any): string {
  const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  const browsers = resource.processes.filter((row: any) => row.kind === 'browser');
  return [`CPU: ${resource.cpuCount} cores · load ${resource.loadAverage.map((value: number) => value.toFixed(2)).join(' / ')}`,
    `Physical RAM: ${gib(resource.memory.totalBytes)} · available ${gib(resource.memory.availableBytes)} · pressure ${resource.pressure}`,
    `Backend resident memory: ${gib(resource.memory.app.rss)}`,
    `Disk: ${gib(resource.disk.availableBytes)} available / ${gib(resource.disk.totalBytes)}`,
    ...resource.swaps.map((row: any) => `${row.kind === 'zram' ? 'ZRAM' : 'Disk swap'}: ${gib(row.usedBytes)} used / ${gib(row.bytes)} · priority ${row.priority}`),
    `Browser processes: ${browsers.length} · combined RSS ${gib(browsers.reduce((sum: number, row: any) => sum + row.rssBytes, 0))} (shared pages may be counted more than once)`,
    `Terminal shells: ${resource.processes.filter((row: any) => row.kind === 'terminal').length}`,
    `Possible orphan PIDs: ${resource.possibleOrphans.slice(0, 12).join(', ') || 'none observed'} (parent PID 1 can also mean a managed process)`,
    `Dedicated browser profile: ${resource.browser?.configured ? resource.browser.accessible ? 'accessible' : 'unavailable' : 'not configured'}`,
    ...(resource.systemd.services ?? []).map((row: any) => `${row.name}: ${row.active} / ${row.state}`),
    resource.systemd.available ? '' : 'Systemd state unavailable; check systemctl locally.',
    'Diagnostics never terminate active work. Browser presence does not prove ChatGPT authentication.'].filter(Boolean).join('\n');
}
