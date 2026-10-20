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

export function sessionDescription(detail: any): string {
  const session = detail.session, live = detail.live;
  const status = sessionStatusIndicator(detail);

  return [
    `Session: ${session.title || 'Untitled session'}`,
    `Observed model: ${session.model ?? 'unknown'}`,
    `State: ${status.emoji} ${status.text.toLowerCase()}`,
    goalDescription(live),
    live?.blocked ? `Blocked: ${live.blocked}` : '',
    ...(live?.recovery ?? []).map((row: any) => `Recovery: ${row.kind}${Number.isFinite(row.deadline) ? ` · ${new Date(row.deadline).toISOString()}` : ''}`),
    ...(live?.job ? [
      `Compact & Resume: ${live.job.stage}`,
      `Handoff Send: ${live.job.sourceSend ?? 'unknown'}`,
      `Replacement Send: ${live.job.destinationSend ?? 'unknown'}`,
      live.job.needsAttention ? `Compaction needs attention: ${live.job.error ?? 'Inspect the paired browser and existing handoff receipts.'}` :
        live.job.error ? `Compaction note: ${live.job.error}` : ''
    ] : []),
    `Last recorded outcome (turn only): ${session.lastTurnOutcome ?? 'unknown'}`,
    `Updated: ${new Date(session.updatedAt).toISOString()}`,
    'An open recorded turn does not prove current provider activity. A stopped generation alone does not prove task success.'
  ].filter(Boolean).join('\n');
}

export function historyDescription(events: any[]): string {
  if (!events || events.length === 0) return 'No recorded history events.';
  return events
    .map(event => {
      const emoji = event.kind === 'user_message' ? '💬' : event.kind === 'assistant_message' ? '🤖' : '⚙️';
      if (event.kind === 'tool_call' && event.tool) {
        const tool = event.tool;
        const result = typeof tool.result?.text === 'string' ? tool.result.text : null;
        const changes = Array.isArray(tool.changes) ? tool.changes : [];
        const files = changes.slice(0, 4).map((change: any) =>
          `${String(change.path ?? '').replace(/\s+/g, ' ').slice(0, 180)} (+${change.added ?? 0} / -${change.removed ?? 0})`);
        return [
          `**${emoji} ${event.kind} · ${event.position}**`,
          tool.summary?.title ?? tool.name ?? 'Recorded action',
          tool.summary?.detail,
          `Outcome: ${tool.outcome && tool.outcome !== 'null' ? tool.outcome : 'not recorded'}${Number.isFinite(tool.durationMs) ? ` · ${tool.durationMs} ms` : ''}`,
          result === null ? 'Result: not recorded' : `Result: ${result.slice(0, 400)}${tool.result?.truncated || result.length > 400 ? '\n[result shortened]' : ''}`,
          files.length ? `Files: ${files.join('; ')}${changes.length > 4 ? `; … ${changes.length - 4} more recorded changes` : ''}` : ''
        ].filter(Boolean).join('\n');
      }
      return `**${emoji} ${event.kind} · ${event.position}**\n${event.message?.text ?? event.tool?.summary?.title ?? event.detail ?? event.outcome ?? event.delivery ?? ''}${event.message?.truncated ? '\n[recorded display shortened]' : ''}`;
    })
    .join('\n\n');
}

export function taskPlanDescription(plan: any): string {
  if (!plan) return 'No durable executor update_plan document is recorded.';
  const completed = plan.plan.filter((row: any) => row.status === 'completed').length;
  return [
    `**Progress:** ${completed}/${plan.plan.length} steps marked completed by executor.`,
    plan.explanation ? `*Explanation:* ${plan.explanation}` : '',
    ...plan.plan.map((row: any, index: number) => `${index + 1}. ${row.status === 'completed' ? '✅' : row.status === 'in_progress' ? '▶️' : '⚪'} **${row.step}**\n${row.details ? `└ ${row.details}` : ''}`),
    '\n*These are the executor’s recorded progress labels; inspect results for verification.*'
  ].filter(Boolean).join('\n');
}

export function resourceDescription(resource: any): string {
  const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  const browsers = resource.processes.filter((row: any) => row.kind === 'browser');
  return [
    `💻 **CPU:** ${resource.cpuCount} cores · load ${resource.loadAverage.map((value: number) => value.toFixed(2)).join(' / ')}`,
    `🧠 **Physical RAM:** ${gib(resource.memory.totalBytes)} · available ${gib(resource.memory.availableBytes)} · pressure ${resource.pressure}`,
    `⚡ **Backend Resident Memory:** ${gib(resource.memory.app.rss)}`,
    `💾 **Disk:** ${gib(resource.disk.availableBytes)} available / ${gib(resource.disk.totalBytes)}`,
    ...resource.swaps.map((row: any) => `🔄 ${row.kind === 'zram' ? 'ZRAM' : 'Disk swap'}: ${gib(row.usedBytes)} used / ${gib(row.bytes)} · priority ${row.priority}`),
    `🌐 **Browser Processes:** ${browsers.length} · combined RSS ${gib(browsers.reduce((sum: number, row: any) => sum + row.rssBytes, 0))} (shared pages may be counted more than once)`,
    `🐚 **Terminal Shells:** ${resource.processes.filter((row: any) => row.kind === 'terminal').length}`,
    `❓ **Possible Orphan PIDs:** ${resource.possibleOrphans.slice(0, 12).join(', ') || 'none observed'} (parent PID 1 can also mean a managed process)`,
    `🌐 **Dedicated Browser Profile:** ${resource.browser?.configured ? resource.browser.accessible ? 'accessible' : 'unavailable' : 'not configured'}`,
    ...(resource.systemd.services ?? []).map((row: any) => `⚙️ ${row.name}: ${row.active} / ${row.state}`),
    resource.systemd.available ? '' : '⚠️ Systemd state unavailable; check systemctl locally.',
    '\nDiagnostics never terminate active work. Browser presence does not prove ChatGPT authentication.'
  ].filter(Boolean).join('\n');
}
