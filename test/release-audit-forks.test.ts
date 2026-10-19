import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publishedAudit = readFileSync(new URL('../.github/workflows/verify-release.yml', import.meta.url), 'utf8');
const publish = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');

describe('release asset verification on repository forks', () => {
  it('runs the reusable post-publication verifier without an upstream-only repository guard', () => {
    expect(publishedAudit).toMatch(/on:\s*\n[\s\S]*?workflow_call:/);
    expect(publishedAudit).toMatch(/workflow_dispatch:/);
    expect(publishedAudit).toMatch(/release:\s*\n\s+types: \[published\]/);
    expect(publishedAudit).toMatch(/jobs:\s*\n\s+verify:\s*\n/);
    expect(publishedAudit).not.toMatch(/if:\s*github\.repository\s*==\s*['"]totec448-spec\/chat-on-steroids['"]/);
    expect(publishedAudit).toContain('scripts/verify-headless-release.mjs');
  });

  it('does not demand full stable-release assets when the rolling canary prerelease is published', () => {
    const canary = readFileSync(new URL('../.github/workflows/canary.yml', import.meta.url), 'utf8');
    expect(canary).toContain('scripts/verify-headless-release.mjs');
    expect(canary).toContain('prerelease=true');
    expect(publishedAudit).toContain("if: (github.event_name != 'release' || github.event.release.prerelease == false) && inputs.tag != 'canary'");
    expect(publishedAudit).toContain('workflow_call:');
  });

  it('requires publish.yml to invoke this verifier after publishing, not before', () => {
    expect(publish).toMatch(/verify:\s*\n\s+name: Verify published files\s*\n\s+needs: publish\s*\n\s+uses: \.\/\.github\/workflows\/verify-release\.yml/);
    expect(publishedAudit).toContain('gh release download "$TAG" --repo "$GITHUB_REPOSITORY"');
  });

  it('keeps minimal read permissions and only grants issue creation for a failed audit', () => {
    expect(publishedAudit).toContain('contents: read');
    expect(publishedAudit).toContain('issues: write');
    expect(publishedAudit).toContain('if: failure()');
  });
});
