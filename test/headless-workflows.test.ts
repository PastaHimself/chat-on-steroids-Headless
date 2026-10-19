import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const read = (name: string): any => load(readFileSync(new URL(`../.github/${name}`, import.meta.url), 'utf8'));
const text = (name: string) => readFileSync(new URL(`../.github/${name}`, import.meta.url), 'utf8');

describe('Headless Actions deployment contract', () => {
  it('uses the supported Linux host and Node 24 instead of desktop CI runners', () => {
    const ci = read('workflows/ci.yml');
    expect(Object.values(ci.jobs).every((job: any) => job['runs-on'] === 'ubuntu-24.04')).toBe(true);
    expect(text('workflows/ci.yml')).not.toMatch(/windows-|macos-|node-version: 22|matrix/);
    expect(text('workflows/ci.yml')).toContain('npm run verify:ci');
    expect(text('workflows/ci.yml')).toContain('npm run headless:build');
    expect(text('workflows/ci.yml')).toContain('npm run verify:headless');
  });

  it('provisions both lockfiles and requires a sandboxed Brave smoke', () => {
    const setup = text('actions/setup-headless/action.yml');
    expect(setup).toContain('node-version: 24');
    expect(setup).toContain('discord/package-lock.json');
    expect(setup).toContain('npm ci --ignore-scripts');
    expect(setup).toContain('npm run discord:install');
    expect(setup).toContain('npm run headless:prepare');
    expect(setup).toContain('chmod 4755');
    expect(setup).not.toContain('--no-sandbox');
    expect(read('workflows/ci.yml').jobs.verify.env.COS_SMOKE_BROWSER).toBe('/usr/bin/brave-browser');
  });

  it('builds one sealed headless candidate and verifies the actual archive before upload', () => {
    const release = text('workflows/release.yml');
    expect(release).not.toMatch(/matrix|dist:|platforms:/);
    expect(release).toContain('npm run headless:build');
    expect(release).toContain('scripts/package-headless.mjs');
    expect(release).toContain('scripts/verify-headless-release.mjs release "$GITHUB_SHA"');
    expect(release).toContain('name: headless-candidate-${{ github.run_id }}');
  });

  it('publishes the same verified headless assets from the current run', () => {
    const publish = text('workflows/publish.yml');
    expect(publish).toContain('headless-candidate-${{ github.run_id }}');
    expect(publish).toContain('publish/Chat-On-Steroids-Headless-Linux-x64.tar.gz');
    expect(publish).toContain('publish/Chat-On-Steroids-Native-Sources.tar.gz');
    expect(publish).toContain('scripts/verify-headless-release.mjs publish "$GITHUB_SHA"');
    expect(publish).not.toMatch(/\.exe|\.dmg|\.AppImage|\.deb|macOS/);
    expect(read('workflows/publish.yml').jobs.publish.permissions).toEqual({ contents: 'write' });
  });
});
