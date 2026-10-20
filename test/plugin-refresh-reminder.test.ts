import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let dom: JSDOM;
beforeEach(() => {
  vi.resetModules();
  dom = new JSDOM(readFileSync('src/renderer/index.html', 'utf8'), { url: 'https://local.test/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
});
afterEach(() => dom.window.close());

it('silently baselines connector schemas, persists a changed-schema reminder and rearms only for another schema', async () => {
  let { paintPluginRefreshReminder: paint } = await import('../src/renderer/plugin-refresh-reminder.js');
  const notice = document.getElementById('pluginRefreshReminder')!;
  const dismiss = document.getElementById('dismissPluginRefreshReminder')!;
  await paint({ core: 'schema-a' });
  expect(notice.hidden).toBe(true);
  await paint({ core: 'schema-b' });
  expect(notice.hidden).toBe(false);
  vi.resetModules();
  ({ paintPluginRefreshReminder: paint } = await import('../src/renderer/plugin-refresh-reminder.js'));
  await paint({ core: 'schema-b' });
  expect(notice.hidden).toBe(false);
  dismiss.click();
  await paint({ core: 'schema-b' });
  expect(notice.hidden).toBe(true);
  vi.resetModules();
  ({ paintPluginRefreshReminder: paint } = await import('../src/renderer/plugin-refresh-reminder.js'));
  await paint({ core: 'schema-b' });
  expect(notice.hidden).toBe(true);
  await paint({ core: 'schema-c' });
  expect(notice.hidden).toBe(false);
  dismiss.click();
  await paint({ core: 'schema-c' });
  expect(notice.hidden).toBe(true);
});

it('does not invent refresh debt when a connector is first published or temporarily absent', async () => {
  const { paintPluginRefreshReminder } = await import('../src/renderer/plugin-refresh-reminder.js');
  const notice = document.getElementById('pluginRefreshReminder')!;
  await paintPluginRefreshReminder({});
  expect(notice.hidden).toBe(true);
  await paintPluginRefreshReminder({ core: 'core-a' });
  expect(notice.hidden).toBe(true);
  await paintPluginRefreshReminder({});
  expect(notice.hidden).toBe(true);
  await paintPluginRefreshReminder({ core: 'core-a', plugins: 'plugins-a' });
  expect(notice.hidden).toBe(true);
  await paintPluginRefreshReminder({ core: 'core-a', plugins: 'plugins-b' });
  expect(notice.hidden).toBe(false);
});

it('dismisses only the reminder and leaves simultaneous extension or update notices visible', async () => {
  const { paintPluginRefreshReminder } = await import('../src/renderer/plugin-refresh-reminder.js');
  const update = document.getElementById('updateNotice')!;
  update.hidden = false;
  await paintPluginRefreshReminder({ core: 'schema-a' });
  await paintPluginRefreshReminder({ core: 'schema-b' });
  document.getElementById('dismissPluginRefreshReminder')!.click();
  expect(document.getElementById('pluginRefreshReminder')!.hidden).toBe(true);
  expect(update.hidden).toBe(false);
});

it('does not ask for a manual refresh once ChatGPT confirmed the new schema, and asks again for a later one', async () => {
  let { paintPluginRefreshReminder: paint } = await import('../src/renderer/plugin-refresh-reminder.js');
  const notice = document.getElementById('pluginRefreshReminder')!;
  await paint({ core: 'schema-a' }, { core: 'schema-a' });
  await paint({ core: 'schema-b' }, { core: 'schema-a' });
  expect(notice.hidden).toBe(false);
  // Automatic plugin refresh finished: ChatGPT now holds schema-b.
  await paint({ core: 'schema-b' }, { core: 'schema-b' });
  expect(notice.hidden).toBe(true);
  vi.resetModules();
  ({ paintPluginRefreshReminder: paint } = await import('../src/renderer/plugin-refresh-reminder.js'));
  await paint({ core: 'schema-b' }, {});
  expect(notice.hidden).toBe(true);
  await paint({ core: 'schema-c' }, { core: 'schema-b' });
  expect(notice.hidden).toBe(false);
});


it('persists only a digest, never arbitrary schema text received with settings', async () => {
  const { paintPluginRefreshReminder: paint } = await import('../src/renderer/plugin-refresh-reminder.js');
  await paint({ core: 'synthetic-sensitive-schema-text' });
  const stored = JSON.stringify(window.localStorage);
  expect(stored).not.toContain('synthetic-sensitive-schema-text');
  expect(stored).toContain('cos.plugins.refreshReminder.acknowledgedSchemaDigests');
});

it('migrates existing acknowledgements to digests without asking again or retaining plaintext', async () => {
  window.localStorage.setItem('cos.plugins.refreshReminder.acknowledgedSchemas', JSON.stringify({ core: 'legacy-schema' }));
  vi.resetModules();
  const { paintPluginRefreshReminder: paint } = await import('../src/renderer/plugin-refresh-reminder.js');
  await paint({ core: 'legacy-schema' });
  expect(document.getElementById('pluginRefreshReminder')!.hidden).toBe(true);
  expect(window.localStorage.getItem('cos.plugins.refreshReminder.acknowledgedSchemas')).toBeNull();
  expect(JSON.stringify(window.localStorage)).not.toContain('legacy-schema');
  await paint({ core: 'changed-schema' });
  expect(document.getElementById('pluginRefreshReminder')!.hidden).toBe(false);
});

it('does not publish an older reminder after a newer digest finishes first', async () => {
  const { paintPluginRefreshReminder: paint } = await import('../src/renderer/plugin-refresh-reminder.js');
  await paint({ core: 'baseline' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  const paused = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(async (algorithm, data) => {
    await gate; return original(algorithm, data);
  });
  const older = paint({ core: 'older' });
  try {
    await paint({ core: 'newest' });
    release(); await older;
    document.getElementById('dismissPluginRefreshReminder')!.click();
    await paint({ core: 'newest' });
    expect(document.getElementById('pluginRefreshReminder')!.hidden).toBe(true);
  } finally { release(); await older; paused.mockRestore(); }
});
