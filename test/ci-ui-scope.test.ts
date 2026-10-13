import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Check the real macOS/Windows UI job scope filters, not a duplicated matcher.
 * Backend-driven UI changes must not silently pass without Electron checks.
 */
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const filters = [...workflow.matchAll(/grep -qE '([^']+)'/g)].map(([, expression]) => new RegExp(expression));

describe('GitHub Actions Electron UI coverage', () => {
  it('uses a scope filter for both macOS and Windows UI jobs', () => {
    expect(filters).toHaveLength(2);
    expect(filters[0].source).toBe(filters[1].source);
  });

  it('runs both UI suites for main-process session, recovery and IPC changes', () => {
    const uiImpact = [
      'src/main/bridge.ts',
      'src/main/goal.ts',
      'src/main/session/continuation.ts',
      'src/main/ipc.ts',
      'src/main/control-api.ts',
      'src/renderer/index.ts',
      'src/preload/index.ts',
      'src/shared/control-api.ts',
      'extension/content.js',
      'scripts/verify-plan-collapse.cjs',
      '.github/workflows/ci.yml'
    ];
    for (const filter of filters) {
      for (const file of uiImpact) expect(filter.test(file), file).toBe(true);
    }
  });

  it('does not run Electron suites solely for docs, tests or Discord-only changes', () => {
    const unrelated = ['README.md', 'docs/headless-vps.md', 'test/ci-ui-scope.test.ts', 'discord/src/bot.ts'];
    for (const filter of filters) {
      for (const file of unrelated) expect(filter.test(file), file).toBe(false);
    }
  });
});
