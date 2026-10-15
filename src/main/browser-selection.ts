import { getConfig } from './config.js';
import { runtimeMode } from './runtime-mode.js';
import type { ChatBrowser } from '../shared/types.js';

/** Headless owns the dedicated Brave profile; desktop bootstrap preferences stay on disk. */
export function selectedChatBrowser(env: NodeJS.ProcessEnv = process.env, browser?: ChatBrowser): ChatBrowser {
  return runtimeMode(env) === 'headless' ? 'brave' : browser ?? getConfig().ui.chatBrowser ?? 'chrome';
}
