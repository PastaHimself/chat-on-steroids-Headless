import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

const workflow = (name: string): any => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

describe('Headless Actions entry points', () => {
  it('uses the same read-only Linux build for PRs, candidates and tagged releases', () => {
    for (const name of ['ci', 'canary', 'publish']) {
      const entry = workflow(name);
      const build = Object.values(entry.jobs).find((job: any) => job.uses === './.github/workflows/release.yml');
      expect(build, name).toBeDefined();
      expect(entry.permissions).toEqual({ contents: 'read' });
    }
    const build = workflow('release');
    expect(build.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(build.jobs)).toEqual(['headless']);
    expect(build.jobs.headless['runs-on']).toBe('ubuntu-24.04');
    expect(build.jobs.headless.env.COS_TEST_WORKERS).toBe('2');
    const steps = build.jobs.headless.steps;
    const setup = steps.find((step: any) => step.uses?.startsWith('actions/setup-node@'));
    expect(setup.with['node-version']).toBe(24);
    expect(setup.with['cache-dependency-path']).toContain('discord/package-lock.json');
    const commands = steps.map((step: any) => step.run || '').join('\n');
    for (const command of ['npm ci --ignore-scripts', 'npm run discord:install', 'npm run headless:prepare', 'npm run verify:ci', 'npm run headless:build', 'npm run verify:headless-build', 'npm run verify:deployment', 'npm run verify:headless']) {
      expect(commands, command).toContain(command);
    }
    expect(commands.indexOf('apt-get install')).toBeLessThan(commands.indexOf('npm run headless:prepare'));
    expect(commands.indexOf('npm run verify:ci')).toBeLessThan(commands.indexOf('npm run headless:build'));
    expect(commands).not.toMatch(/--no-sandbox|npm run dist|verify:ui/);
    expect(commands).toContain('COS_SMOKE_BROWSER');
  });

  it('does not automatically publish a rolling desktop canary or run desktop runners', () => {
    const canary = workflow('canary');
    expect(Object.keys(canary.on)).toEqual(['workflow_dispatch']);
    expect(canary.jobs.publish).toBeUndefined();
    const ci = workflow('ci');
    expect(ci.on).toHaveProperty('pull_request');
    expect(ci.on.push.branches).toEqual(['main']);
    expect(ci.concurrency['cancel-in-progress']).toBe(true);
    for (const name of ['ci', 'canary', 'release']) {
      expect(JSON.stringify(workflow(name))).not.toMatch(/windows-2025|macos-15|contents":"write/);
    }
  });

  it('keeps inherited desktop jobs manual and separate from Headless publication', () => {
    for (const name of ['desktop-ci', 'desktop-canary', 'desktop-publish', 'desktop-verify-release']) {
      expect(workflow(name).on).not.toHaveProperty('push');
      expect(workflow(name).on).not.toHaveProperty('pull_request');
      expect(workflow(name).on).not.toHaveProperty('release');
    }
    expect(workflow('desktop-publish').jobs.candidate.uses).toBe('./.github/workflows/desktop-release.yml');
  });

  it('publishes only from this repository after tag preflight and audits the exact commit', () => {
    const publish = workflow('publish');
    expect(publish.jobs.preflight.if).toContain("github.repository == 'PastaHimself/chat-on-steroids-Headless'");
    expect(publish.jobs.candidate.needs).toBe('preflight');
    expect(publish.jobs.publish.permissions).toEqual({ contents: 'write' });
    const commands = publish.jobs.publish.steps.map((step: any) => step.run || '').join('\n');
    expect(commands).toContain('scripts/headless-candidate.mjs verify');
    expect(commands).toContain('scripts/check-release-absent.mjs');
    expect(commands).toContain('--repo "$GITHUB_REPOSITORY"');
    expect(commands).toContain('--verify-tag');
    expect(commands).not.toMatch(/gh release delete|--clobber|totec448-spec/);
    expect(workflow('verify-release').jobs.verify.steps.some((step: any) => step.run?.includes('scripts/headless-candidate.mjs verify'))).toBe(true);
  });
});
