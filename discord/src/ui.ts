import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { safeText } from './config.js';

export const EmbedColor = {
  Success: 0x57f287,
  Warning: 0xfee75c,
  Danger: 0xed4245,
  Info: 0x5865f2,
  Neutral: 0x4f545c,
} as const;

export type PanelField = { name: string; value: string; inline?: boolean };

export function panel(
  title: string,
  text: unknown,
  components: any[] = [],
  secrets: string[] = [],
  options?: { color?: number; fields?: PanelField[] }
) {
  const description = safeText(text, secrets);
  const embed = new EmbedBuilder()
    .setTitle(safeText(title, secrets).slice(0, 256))
    .setDescription((description.length > 3900 ? '...\n' + description.slice(-3896) : description) || 'No recorded data.')
    .setFooter({ text: description.length > 3900 ? 'Display shortened; use history pages for more.' : 'Recorded state • refresh to inspect changes' });

  if (options?.color !== undefined) {
    embed.setColor(options.color);
  }

  if (options?.fields && options.fields.length > 0) {
    const safeFields = options.fields.slice(0, 25).map(f => ({
      name: safeText(f.name, secrets).slice(0, 256) || 'Field',
      value: safeText(f.value, secrets).slice(0, 1024) || '—',
      inline: f.inline ?? true,
    }));
    embed.addFields(safeFields);
  }

  return {
    embeds: [embed],
    components,
    allowedMentions: { parse: [] as [] },
  };
}

export function buttons(viewId: string, options: Array<[string, string, ButtonStyle?]>) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...options.slice(0, 5).map(([action, label, style]) =>
      new ButtonBuilder()
        .setCustomId(`${viewId}:${action}`)
        .setLabel(label)
        .setStyle(style ?? ButtonStyle.Secondary)
    )
  );
}

export function select(
  viewId: string,
  action: string,
  placeholder: string,
  options: Array<{ label: string; value: string; description?: string }>
) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${viewId}:${action}`)
      .setPlaceholder(placeholder)
      .addOptions(
        options.slice(0, 25).map(option => ({
          ...option,
          label: safeText(option.label).slice(0, 100),
          description: option.description ? safeText(option.description).slice(0, 100) : undefined,
        }))
      )
  );
}

export function sessionStatusIndicator(detail: any): { emoji: string; text: string; color: number } {
  const live = detail?.live;
  if (live?.blocked) {
    return { emoji: '🔴', text: 'Blocked', color: EmbedColor.Danger };
  }
  if (live?.stopPending) {
    return { emoji: '🔴', text: 'Stop Requested', color: EmbedColor.Danger };
  }
  if (live?.recovery?.some((row: any) => row.kind === 'provider-limit')) {
    return { emoji: '🟡', text: 'Rate Limited', color: EmbedColor.Warning };
  }
  if (live?.job?.needsAttention || live?.goalStatus?.needsAttention) {
    return { emoji: '🟡', text: 'Attention Needed', color: EmbedColor.Warning };
  }
  if (live?.recovery?.some((row: any) => row.kind === 'pickup-stopped' || row.kind === 'goal-expired' || row.kind === 'goal-delivery-uncertain')) {
    return { emoji: '🟡', text: 'Recovery Stopped', color: EmbedColor.Warning };
  }
  if (live?.recovery?.some((row: any) => ['post-reload', 'assistant-error', 'tab-recovery', 'pickup'].includes(row.kind))) {
    return { emoji: '🟡', text: 'Recovering', color: EmbedColor.Warning };
  }
  if (live?.activeTurnId) {
    return { emoji: '🔵', text: 'Turn Open', color: EmbedColor.Info };
  }
  if (live?.goalWait) {
    return { emoji: '🟡', text: 'Waiting', color: EmbedColor.Warning };
  }
  if (live?.goalStatus?.stage === 'failed') return { emoji: '🟡', text: 'Decision Failed', color: EmbedColor.Warning };
  if (live?.goalStatus?.stage === 'ready') return { emoji: '🟡', text: 'Continuation Ready', color: EmbedColor.Warning };
  if (live?.goalStatus?.pending || ['sending', 'answering'].includes(live?.goalStatus?.stage))
    return { emoji: '🟡', text: 'Goal Pending', color: EmbedColor.Warning };
  return { emoji: '⚪', text: 'Idle', color: EmbedColor.Info };
}

/** These diagnostics describe existing authority; a time or pending row never permits a retry. */
export function goalDescription(live: any): string {
  const goal = live?.goalStatus;
  if (!goal) return `Automation: ${live?.automation ?? 'unavailable'}${live?.goalWait ? `\nWaiting: ${live.goalWait.reason}` : ''}`;
  return [
    `Automation: ${live.automation ?? 'unavailable'}`,
    goal.pending ? 'Pending continuation: saved source reply still owes a decision or delivery.' : 'Pending continuation: none recorded.',
    goal.sourceTurnId ? `Source turn: ${goal.sourceTurnId}` : '',
    Number.isFinite(goal.acceptedAt) ? `Reply accepted: ${new Date(goal.acceptedAt).toISOString()}` : '',
    goal.finalConfirmed === null || goal.finalConfirmed === undefined ? '' : `Canonical final: ${goal.finalConfirmed ? 'confirmed (turn only)' : 'not confirmed'}`,
    goal.stage === 'no-reply' ? 'Goal decision: no further instruction. This is the decision result, not independent proof of objective completion.'
      : goal.stage ? `Goal decision: ${goal.stage}` : '',
    live.goalWait ? `Waiting: ${live.goalWait.reason}` : '',
    goal.pending || live.goalWait || goal.stage === 'failed' ? `Waiting on: ${goal.owner}` : '',
    goal.pending || live.goalWait ? `Next reevaluation: ${Number.isFinite(goal.nextCheckAt) ? new Date(goal.nextCheckAt).toISOString() : 'time unknown; depends on new owner/browser evidence.'}` : '',
    goal.error ? `Goal diagnostic: ${goal.error}` : '',
    goal.needsAttention ? 'Manual intervention: required; inspect the diagnostic and existing receipts before retrying.'
      : 'Manual intervention: not currently indicated.'
  ].filter(Boolean).join('\n');
}

/** Read-only projection of the outbox's proof; inspecting it never authorizes retry. */
export function inputDeliveryDescription(input: any): string {
  if (!input) return 'No recent input proof. Inspect /queue and /operations.';
  const project = input.state === 'queued' && input.delivery === 'pending' ? input.projectWait : null;
  const phase = input.delivery === 'sent' ? 'Provider receipt confirmed; recorded history may still be catching up.'
    : input.delivery === 'not_sent' ? 'Not sent; this attempt ended before delivery.'
    : input.delivery === 'unconfirmed' ? 'Send may have reached ChatGPT; provider receipt unconfirmed. Inspect /queue and /operations before more work. Do not repeat /new.'
    : project ? ['failed', 'uncertain'].includes(project.state)
      ? `Queued; blocked by ChatGPT Project (${project.state})${project.error ? `: ${project.error}` : '.'}\nThe message is saved. Repair the project's link locally; do not repeat /new.`
      : `Queued; waiting for ChatGPT Project (${project.state}) creation before browser delivery.`
    : input.state === 'browser' ? 'Browser claimed; preparing the provider page/model. Send is not authorized yet.'
    : input.transportIntent === 'tool' ? 'Queued; waiting for its exact tool recipient.'
    : input.mode === 'after-turn' ? 'Queued; waiting for turn completion before browser claim.'
    : input.mode === 'finish' ? 'Queued; waiting for a finish boundary before browser claim.'
    : 'Queued; waiting for browser claim. Check the paired browser, provider sign-in and model readiness.';
  const preparation = input.delivery === 'pending' && input.state === 'queued' && input.browserPreparation
    ? `\nLast browser preparation: ${input.browserPreparation.stage} (${input.browserPreparation.reason}). This is not a Send receipt.` : '';
  return `Input: ${input.id}\nOutbox: ${input.state}\n${phase}${preparation}${input.error ? `\nDelivery diagnostic: ${input.error}` : ''}`;
}

export function sessionDescription(detail: any): PanelField[] {
  const session = detail.session, live = detail.live;
  const status = sessionStatusIndicator(detail);

  const fields: PanelField[] = [];

  fields.push({
    name: 'Session',
    value: `**Title:** ${session.title || 'Untitled session'}\n**Model:** ${session.model ?? 'unknown'}\n**State:** ${status.emoji} ${status.text}`,
    inline: false
  });

  const automation = [];
  automation.push(`**Mode:** ${live?.automation ?? 'unavailable'}`);
  if (live?.blocked) automation.push(`**Blocked:** ${live.blocked}`);
  if (live?.goalWait) automation.push(`**Waiting:** ${live.goalWait.reason}`);
  if (live?.recovery && live.recovery.length > 0) {
    automation.push(`**Recovery:**\n${live.recovery.map((row: any) => `• ${row.kind}${Number.isFinite(row.deadline) ? ` (deadline: <t:${Math.floor(row.deadline / 1000)}:R>)` : ''}`).join('\n')}`);
  }
  const gd = goalDescription(live);
  if (gd && !gd.startsWith('Automation:')) automation.push(gd);
  else if (gd && live?.automation === 'goal') {
      const gdl = gd.split('\n').slice(1).join('\n');
      if (gdl) automation.push(gdl);
  }
  fields.push({ name: 'Automation & Health', value: automation.join('\n'), inline: false });

  if (live?.job) {
    const jobInfo = [
      `**Stage:** ${live.job.stage}`,
      `**Handoff Send:** ${live.job.sourceSend ?? 'unknown'}`,
      `**Replacement Send:** ${live.job.destinationSend ?? 'unknown'}`,
      live.job.needsAttention ? `⚠️ **Needs attention:** ${live.job.error ?? 'Inspect browser/handoff receipts.'}` : (live.job.error ? `**Note:** ${live.job.error}` : '')
    ].filter(Boolean);
    fields.push({ name: 'Compact & Resume', value: jobInfo.join('\n'), inline: false });
  }

  fields.push({
    name: 'Activity',
    value: `**Outcome:** ${session.lastTurnOutcome ?? 'unknown'}\n**Updated:** <t:${Math.floor(new Date(session.updatedAt).getTime() / 1000)}:R>`,
    inline: false
  });

  return fields;
}

export function historyDescription(events: any[]): string {
  if (!events || events.length === 0) return 'No recorded history events.';
  return events
    .map(event => {
      const emoji = event.kind === 'user_message' ? '💬' : event.kind === 'assistant_message' ? '🤖' : '⚙️';
      let content = event.message?.text ?? event.tool?.summary?.title ?? event.detail ?? event.outcome ?? event.delivery ?? '';
      if (content) {
        content = content.split('\n').map((line: string) => `> ${line}`).join('\n');
      }
      return `**${emoji} ${event.kind} · ${event.position}**\n${content}${event.message?.truncated ? '\n> *[recorded display shortened]*' : ''}`;
    })
    .join('\n\n');
}

export function taskPlanDescription(plan: any): string {
  if (!plan) return 'No durable executor update_plan document is recorded.';
  const completed = plan.plan.filter((row: any) => row.status === 'completed').length;

  const progressLine = `**Progress:** \`${completed}/${plan.plan.length}\` steps marked completed by executor.`;
  const explanation = plan.explanation ? `\n> *${plan.explanation}*\n` : '';

  const steps = plan.plan.map((row: any, index: number) => {
    const icon = row.status === 'completed' ? '✅' : row.status === 'in_progress' ? '▶️' : '⚪';
    return `${icon} **Step ${index + 1}:** ${row.step}${row.details ? `\n   └ ${row.details}` : ''}`;
  }).join('\n\n');

  return `${progressLine}${explanation}\n${steps}\n\n*These are the executor’s recorded progress labels; inspect results for verification.*`;
}

export function resourceDescription(resource: any): PanelField[] {
  const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  const browsers = resource.processes.filter((row: any) => row.kind === 'browser');

  const fields: PanelField[] = [];

  fields.push({
    name: '💻 CPU & RAM',
    value: `**Cores:** ${resource.cpuCount}\n**Load:** \`${resource.loadAverage.map((value: number) => value.toFixed(2)).join(' / ')}\`\n**Physical:** ${gib(resource.memory.totalBytes)} (av: ${gib(resource.memory.availableBytes)})\n**Pressure:** ${resource.pressure}\n**App RSS:** ${gib(resource.memory.app.rss)}`,
    inline: true
  });

  const diskInfo = [
    `**Available:** ${gib(resource.disk.availableBytes)} / ${gib(resource.disk.totalBytes)}`,
    ...resource.swaps.map((row: any) => `🔄 ${row.kind === 'zram' ? 'ZRAM' : 'Disk swap'}: ${gib(row.usedBytes)} used / ${gib(row.bytes)}`)
  ];
  fields.push({
    name: '💾 Storage & Swap',
    value: diskInfo.join('\n'),
    inline: true
  });

  fields.push({
    name: '🌐 Processes',
    value: `**Browsers:** ${browsers.length}\n**RSS:** ${gib(browsers.reduce((sum: number, row: any) => sum + row.rssBytes, 0))}\n**Shells:** ${resource.processes.filter((row: any) => row.kind === 'terminal').length}\n**Profile:** ${resource.browser?.configured ? resource.browser.accessible ? 'Accessible' : 'Unavailable' : 'Not configured'}`,
    inline: false
  });

  const sysInfo = [];
  if (resource.possibleOrphans && resource.possibleOrphans.length > 0) {
    sysInfo.push(`**Orphans:** \`${resource.possibleOrphans.slice(0, 12).join(', ')}\``);
  }
  if (resource.systemd.available) {
    sysInfo.push(...(resource.systemd.services ?? []).map((row: any) => `⚙️ ${row.name}: \`${row.active} / ${row.state}\``));
  } else {
    sysInfo.push('⚠️ *Systemd state unavailable*');
  }
  if (sysInfo.length > 0) {
    fields.push({
      name: '⚙️ System Services',
      value: sysInfo.join('\n'),
      inline: false
    });
  }

  return fields;
}
