import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error The drafter is a plain Node script without type declarations.
import { draftReleaseNotes as draft, releaseNoteFor as noteFor, collectReleaseNoteHistory as collect } from '../scripts/draft-release-notes.mjs';

type Pr = { number: number; title: string; body?: string; closed_at: string; user: { login: string } };
const releaseNoteFor = noteFor as (pr: Pr) => string | null;
const draftReleaseNotes = draft as (input: { since: string; prs: Pr[] }) => string;
const pr = (number: number, title: string, body = '', login = 'someone', closed_at = `2026-10-0${number % 9 + 1}T00:00:00Z`): Pr =>
  ({ number, title, body, closed_at, user: { login } });

it('uses the optional Release note line, else the title, and leaves out "none"', () => {
  expect(releaseNoteFor(pr(1, 'Fix race in resume', 'Fixes #9\n\nRelease note: Compact & resume no longer stalls.\n'))).toBe('Compact & resume no longer stalls.');
  expect(releaseNoteFor(pr(2, 'Show the live activity row'))).toBe('Show the live activity row');
  expect(releaseNoteFor(pr(3, 'Refactor tests', 'release note: none'))).toBeNull();
});

it('drafts one line per merged PR, oldest first, without bots', () => {
  const text = draftReleaseNotes({ since: 'v2.1.21', prs: [
    pr(5, 'Second', '', 'lavalava45', '2026-10-05T00:00:00Z'),
    pr(4, 'First', 'Release note: The first thing users notice.', 'Haz4rdovisk', '2026-10-02T00:00:00Z'),
    pr(6, 'Bump deps', '', 'dependabot[bot]', '2026-10-03T00:00:00Z')
  ] });
  expect(text).toContain('## Draft: changes since v2.1.21');
  expect(text.split('\n').filter(line => line.startsWith('- '))).toEqual([
    '- The first thing users notice. (#4, @Haz4rdovisk)',
    '- Second (#5, @lavalava45)'
  ]);
});

const collectReleaseNoteHistory = collect as (repository: string, token: string) => Promise<{ since: string; prs: Pr[] }>;

afterEach(() => vi.unstubAllGlobals());

it('drafts a first stable release on a fork with only a canary prerelease', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/releases/latest')) return { status: 404, ok: false };
    if (url.includes('/search/issues?')) return { status: 200, ok: true, json: async () => ({
      items: [pr(1, 'First merged fix')]
    }) };
    throw new Error('Unexpected API request');
  }));
  const draft = await collectReleaseNoteHistory('Example/fork', 'synthetic-test-token');
  expect(draft.since).toBe('repository start (no stable release yet)');
  expect(draft.prs.map(row => row.number)).toEqual([1]);
  expect(calls).toHaveLength(2);
  const query = decodeURIComponent(calls[1] ?? '');
  expect(query).toContain('repo:Example/fork is:pr is:merged base:main merged:>1970-01-01');
  expect(draftReleaseNotes(draft)).toContain('First merged fix (#1, @someone)');
});

it('keeps last stable release as the cutoff when a stable release exists', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/releases/latest')) return { status: 200, ok: true, json: async () => ({
      tag_name: 'v2.1.22', published_at: '2026-10-11T12:30:00Z'
    }) };
    return { status: 200, ok: true, json: async () => ({ items: [] }) };
  }));
  const result = await collectReleaseNoteHistory('Example/fork', 'synthetic-test-token');
  expect(result).toEqual({ since: 'v2.1.22', prs: [] });
  expect(decodeURIComponent(calls[1] ?? '')).toContain('merged:>2026-10-11T12:30:00Z');
});

it('does not hide rate limit or authorization failures as an empty first-release draft', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 403, ok: false })));
  await expect(collectReleaseNoteHistory('Example/fork', 'synthetic-test-token')).rejects.toThrow('HTTP 403');
});
