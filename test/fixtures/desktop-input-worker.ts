import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { vi } from 'vitest';
import { APP_VERSION, BRIDGE_PROTOCOL } from '../../src/main/version.js';

const source = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
const activeTabsSource = readFileSync(new URL('../../extension/active-tabs.js', import.meta.url), 'utf8').replace('export function', 'function');

type Tab = { id: number; url?: string; pendingUrl?: string; windowId?: number; active?: boolean; pinned?: boolean };
export async function worker(inputs: Array<{ id: string; conversationId: string | null; directTurn?: { id: string; startedAt: number }; supersededConversationId?: string; project?: string; branch?: { conversationId: string; messageId: string } }>, modelCatalogRequest?: { nonce: string; expiresAt: number }, priorLocal: Record<string, unknown> = {}, priorSession: Record<string, unknown> = {}, rendered?: Set<number>) {
  const tabs: Tab[] = [];
  const event = { addListener: () => {} };
  const tabUpdated = { addListener: vi.fn() };
  const localSaved: Record<string, unknown> = { port: 8765, token: 'test-pairing', ...priorLocal };
  const local = { get: async () => ({ ...localSaved }), set: vi.fn(async (value: object) => { Object.assign(localSaved, value); }), remove: async () => {} };
  const saved: Record<string, unknown> = { ...priorSession };
  const session = { get: async () => ({ ...saved }), set: async (value: object) => { Object.assign(saved, value); }, remove: async (key: string) => { delete saved[key]; } };
  const create = vi.fn(async ({ url, windowId }: { url: string; windowId?: number }): Promise<Tab> => {
    const tab = { id: tabs.length + 1, pendingUrl: url, windowId }; tabs.push(tab); return tab;
  });
  const windows = {
    get: vi.fn(async (id: number) => ({ id })),
    create: vi.fn(async ({ url }: { url: string }) => ({ id: 80, tabs: [await create({ url, windowId: 80 })] })),
    update: vi.fn()
  };
  const remove = vi.fn(async (_id: number) => {});
  const query = vi.fn(async () => [...tabs]);
  const reload = vi.fn(async (_id: number) => {});
  const sendMessage = vi.fn(async (_id: number, _message: any): Promise<{ ok: boolean; ready?: boolean }> => ({ ok: true, ready: true }));
  const debuggerApi = {
    onEvent: event, onDetach: event,
    attach: vi.fn(async () => {}),
    detach: vi.fn(async ({ tabId }: { tabId: number }) => { rendered?.delete(tabId); }),
    sendCommand: vi.fn(async ({ tabId }: { tabId: number }, method: string) => {
      if (method === 'Emulation.setFocusEmulationEnabled') rendered?.add(tabId);
    }),
    getTargets: async () => [...(rendered || [])].map(tabId => ({ tabId, attached: true }))
  };
  // tabs.update only clears the pending URL when the call itself navigates the tab;
  // policy flips like autoDiscardable leave a still-loading page's target intact.
  const update = vi.fn(async (id: number, patch: Partial<Tab>) => { const tab = tabs.find(tab => tab.id === id)!; Object.assign(tab, patch); if (patch.url !== undefined) delete tab.pendingUrl; return tab; });
  const fetch = vi.fn(async (input: string, _init?: RequestInit): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({
    ok: true, status: 200,
    json: async () => new URL(input).pathname === '/hello'
      ? { app: 'chat-on-steroids', bridge: BRIDGE_PROTOCOL, compatible: true, paired: true }
      : { ok: true, inputs, background: true, modelCatalogRequest,
        ...(rendered ? { inputOpeningIds: inputs.map(input => input.id), commandIds: [], nonDiscardableConversations: inputs.map(input => input.conversationId).filter(Boolean) } : {}) }
  }));
  const scripting = { executeScript: vi.fn(async ({ target, func }: any): Promise<any[]> => {
    const documentId = (saved.tabDocuments as Record<string, string> | undefined)?.[target.tabId];
    return func && target.documentIds?.includes(documentId)
      ? [{ documentId, frameId: 0, result: tabs.find(tab => tab.id === target.tabId)?.url }] : [];
  }), insertCSS: async () => {} };
  const context = vm.createContext({
    chrome: {
      ...(rendered ? { debugger: debuggerApi } : {}),
      storage: { local, session },
      windows,
      runtime: { getManifest: () => ({ version: APP_VERSION }), onMessage: event, onInstalled: event, onStartup: event },
      tabs: { query, get: async (id: number) => tabs.find(tab => tab.id === id), remove, reload, create, update, sendMessage, onCreated: event, onUpdated: tabUpdated, onRemoved: event },
      alarms: { onAlarm: event, create: () => {}, clear: async () => true },
      scripting
    },
    createBrowserControl: () => ({ pump: async () => {} }),
    fetch, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, TextEncoder, console
  });
  vm.runInContext(activeTabsSource, context);
  vm.runInContext(`${source}\nglobalThis.testMaintenance = { load, maintain, releaseTab, serializeTab, noteTabConversation, createChatTab, authorizeDocument, ackDesktopInput, drainCommandAcks, inspectRequestedModels, desktopInput: HANDLERS.desktop_input, catalog: HANDLERS.model_catalog, events: HANDLERS.events, bind: HANDLERS.bind, closed: HANDLERS.closed, loadFailure: HANDLERS.load_failure, correlate: HANDLERS.correlate, applyRequestedBrowserPreferences };`, context);
  const api = context.testMaintenance as { releaseTab(...args: any[]): Promise<any>; serializeTab(tab: number, operation: () => Promise<any>): Promise<any>; noteTabConversation(source: any, conversationId: string): Promise<any>; applyRequestedBrowserPreferences(request: object): Promise<void>; authorizeDocument(sender: unknown, message: unknown): Promise<any>; catalog(message: unknown, sender: unknown, source: unknown): Promise<any>; load(): Promise<void>; maintain(): Promise<void>; createChatTab(url: string, background: boolean): Promise<Tab> };
  await api.load();
  Object.assign(api, { query });
  const updated = (id: number, change: object) => tabUpdated.addListener.mock.calls[0]![0](id, change, tabs.find(tab => tab.id === id));
  vm.runInContext('Object.assign(testMaintenance, { offerStopTurns, noteTabConversation, ackCommand })', context);
  return { ...api, scripting, updated, update, inspectModels: (context.testMaintenance as any).inspectRequestedModels as (request: unknown, background: boolean) => Promise<void>, ackDesktopInput: (context.testMaintenance as any).ackDesktopInput as (...args: string[]) => Promise<any>, drainCommandAcks: (context.testMaintenance as any).drainCommandAcks as () => Promise<any>, desktopInput: (context.testMaintenance as any).desktopInput as (...args: any[]) => Promise<any>, events: (context.testMaintenance as any).events as (message: any, sender: any, source: any) => Promise<any>, bind: (context.testMaintenance as any).bind as (message: any, sender: any, source: any) => Promise<any>, correlate: (context.testMaintenance as any).correlate as (message: any, sender: any, source: any) => Promise<any>, closed: (context.testMaintenance as any).closed as (message: any, sender: any, source: any) => Promise<any>, loadFailure: (context.testMaintenance as any).loadFailure as (message: any, sender: any, source: any) => Promise<any>, create, sendMessage, tabs, fetch, windows, remove, reload, local, localSaved, saved };
}
