import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTelemetryRuntime } from '../src/build/telemetry-runtime.js';
import { powerShellCommand, posixCommand, sha256, type StarterFiles } from '../src/starter/build.js';
import { loadStarterConfig, parseStarterConfig } from '../src/starter/config.js';
import { hookScript, STARTER_AGENTS, STARTER_HOOK_MARKER } from '../src/starter/hooks.js';
import { buildRepositoryStarter, compareStarterFiles, writeStarterFiles } from '../src/starter/payload.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import { buildFixture, ROOT, TEST_ENDPOINTS, testConfig } from './helpers/starter.js';

let temp: string;
let real: StarterFiles;

beforeAll(() => {
  temp = createTempDir('af-starter-build ');
  real = buildRepositoryStarter({ root: ROOT }).files;
}, 120_000);

afterAll(() => removeDir(temp));

function text(files: StarterFiles, path: string): string {
  const content = files.get(path);
  if (!content) throw new Error(`Missing ${path}`);
  return content.toString('utf-8');
}

describe('starter build', () => {
  it('matches the committed starter payload byte for byte (ST-011)', () => {
    expect(compareStarterFiles(real, join(ROOT, 'starter'))).toEqual([]);
  });

  it('ships the bundled tool with the skill that carries it, for both agents', () => {
    const source = 'skills/azure-functions-common/scripts/functions-tools.mjs';
    expect(text(real, `functions/${source}`)).toContain('deploy plan');
    const rows = text(real, 'functions/files.tsv');
    expect(rows).toContain(`.agents/skills/azure-functions-common/scripts/functions-tools.mjs`);
    expect(rows).toContain(`.claude/skills/azure-functions-common/scripts/functions-tools.mjs`);
  });

  it('detects a hand edit, a missing file, and an extra file (ST-011)', () => {
    const copy = join(temp, 'edited');
    writeStarterFiles(real, copy);
    writeFileSync(join(copy, 'install.sh'), `${readFileSync(join(copy, 'install.sh'), 'utf-8')}# edit\n`);
    writeFileSync(join(copy, 'extra.txt'), 'extra');
    expect(compareStarterFiles(real, copy)).toEqual(['Changed generated file: install.sh', 'Unexpected file: extra.txt']);
  });

  it('stores text with LF line endings and lists every payload file in a manifest with its hash (ST-011, ST-012)', () => {
    for (const [path, content] of real) {
      if (!content.includes(0)) expect(content.includes('\r\n'), path).toBe(false);
    }
    for (const manifest of ['runtime/files.tsv', 'functions/files.tsv']) {
      const base = manifest.split('/')[0];
      for (const line of text(real, manifest).trim().split('\n')) {
        const [, digest, source] = line.split('\t');
        expect(sha256(real.get(`${base}/${source}`) as Buffer), source).toBe(digest);
      }
    }
  });

  it('gives each bundle a start.md with one command per OS and the configured link in the README prompt (ST-001, ST-003)', () => {
    const config = loadStarterConfig(join(ROOT, 'starter.config.json'));
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
    const entries = Object.entries(config.bundles).flatMap(([name, bundle]): Array<{ name: string; template: string | null; link: string; prompt: string }> => bundle.templates
      ? Object.entries(bundle.templates).map(([template, value]) => ({ name, template, link: value.akaLink, prompt: value.prompt }))
      : [{ name, template: null, link: bundle.akaLink ?? '', prompt: bundle.prompt ?? '' }]);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const { name, template, link, prompt } of entries) {
      expect(prompt).toContain(link);
      expect(prompt).toMatch(/I authorize that one command for this directory only/);
      expect(readme).toContain(prompt);
      const start = text(real, template ? `${name}/templates/${template}/start.md` : `${name}/start.md`);
      const input = { config, endpoints: { ...TEST_ENDPOINTS, raw: 'https://raw.githubusercontent.com' } };
      expect(start).toContain(powerShellCommand(input, name, template, '<agent>'));
      expect(start).toContain(posixCommand(input, name, template, '<agent>'));
      expect(start.match(/^```(?:powershell|sh)$/gm)).toHaveLength(2);
      expect(start).toContain('Ask once');
      expect(start).not.toMatch(/\{\{|__AFS_/);
    }
  });

  it('takes repository identity only from the configuration (ST-006)', () => {
    const config = parseStarterConfig({
      ...JSON.parse(JSON.stringify(testConfig())),
      source: { repository: 'fabrikam/moved-skills', branch: 'release', path: 'boot/strap' },
    });
    const files = buildFixture({ config });
    const generated = ['install.ps1', 'install.sh', 'bootstrap.ps1', 'bootstrap.sh', 'functions/start.md', 'extras/start.md']
      .map(path => text(files, path)).join('\n');
    expect(generated).not.toMatch(/Azure\/azure-functions-skills|azure-functions-skills-|contoso/i);
    expect(text(files, 'install.sh')).toContain("repository='fabrikam/moved-skills'");
    expect(text(files, 'install.sh')).toContain("archive_prefix='moved-skills-'");
    expect(text(files, 'install.sh')).toContain("payload_path='boot/strap'");
    expect(text(files, 'install.ps1')).toContain("$branch = 'release'");
    expect(text(files, 'functions/start.md')).toContain('https://raw.githubusercontent.com/fabrikam/moved-skills/release/boot/strap/install.ps1');
  });

  it('adds a template without changing skills or engine, with one start.md per template (ST-014)', () => {
    const bundles = JSON.parse(JSON.stringify(testConfig().bundles)) as Record<string, Record<string, unknown>>;
    const withTemplates = (templates: Record<string, unknown>) => parseStarterConfig({
      schemaVersion: 1,
      source: testConfig().source,
      bundles: {
        functions: bundles.functions,
        extras: { ...bundles.extras, akaLink: undefined, prompt: undefined, templates },
      },
    });
    const timer = { akaLink: 'https://aka.ms/test-timer', prompt: 'Read https://aka.ms/test-timer.', appDir: 'tests/fixtures/starter/app-timer' };
    const second = { akaLink: 'https://aka.ms/test-second', prompt: 'Read https://aka.ms/test-second.', appDir: 'tests/fixtures/starter/app-second' };
    const one = buildFixture({ config: withTemplates({ timer }) });
    const two = buildFixture({ config: withTemplates({ timer, second }) });
    for (const [path, content] of one) expect(two.get(path)?.equals(content), path).toBe(true);
    const added = [...two.keys()].filter(path => !one.has(path)).sort();
    expect(added).toEqual([
      'extras/templates/second/app-gitignore.template',
      'extras/templates/second/app/README.md',
      'extras/templates/second/files.tsv',
      'extras/templates/second/start.md',
    ]);
    expect(text(two, 'extras/templates/second/start.md')).toContain('-Bundle extras -Template second -Agent <agent>');
    expect(text(one, 'extras/templates/timer/start.md')).toContain('--bundle extras --template timer --agent <agent>');
    expect(one.has('extras/start.md')).toBe(false);
    const rows = text(one, 'extras/templates/timer/files.tsv').trim().split('\n').map(line => line.split('\t').slice(2).join(' -> '));
    expect(rows).toEqual([
      'app/README.md -> README.md',
      'app/gitignore.template -> .gitignore',
      'app/src/local.settings.json.sample -> src/local.settings.json.sample',
      'app/src/local.settings.json.sample -> src/local.settings.json',
    ]);
  });

  it('rejects invalid configurations', () => {
    const base = JSON.parse(JSON.stringify(testConfig())) as { bundles: Record<string, { skills: string[]; handoff: string; akaLink: string }> };
    const shared = structuredClone(base);
    shared.bundles.extras.skills.push('azure-functions-help');
    expect(() => parseStarterConfig({ schemaVersion: 1, source: testConfig().source, bundles: shared.bundles })).toThrow(/listed in bundles/);
    const badLink = structuredClone(base);
    badLink.bundles.functions.akaLink = 'https://example.com/x';
    expect(() => parseStarterConfig({ schemaVersion: 1, source: testConfig().source, bundles: badLink.bundles })).toThrow(/aka\.ms/);
    const unknown = structuredClone(base);
    unknown.bundles.functions.skills.push('azure-functions-nope');
    expect(() => buildFixture({ config: parseStarterConfig({ schemaVersion: 1, source: testConfig().source, bundles: unknown.bundles }) }))
      .toThrow(/unknown skill/);
  });

  it('builds hook commands that are safe in both shells and carry the merge marker (ST-008, ST-013)', () => {
    for (const agent of STARTER_AGENTS) {
      const script = hookScript(agent);
      expect(script).not.toMatch(/["$`]/);
      expect(script).toContain(STARTER_HOOK_MARKER);
      expect(script).toContain("f.existsSync(p.join(d,'.git'))");
      const snippet = text(real, `runtime/hooks/${agent}.json`);
      expect(snippet).toContain(STARTER_HOOK_MARKER);
    }
    expect(text(real, 'runtime/hooks/copilot.json')).toContain('"timeoutSec": 8');
    expect(text(real, 'runtime/hooks/claude.json')).toContain('"timeout": 8');
  });

  it('ships the same telemetry runtime as the plugin payload', () => {
    const runtime = buildTelemetryRuntime(join(ROOT, 'templates', 'skills'));
    expect(text(real, 'runtime/telemetry.mjs')).toBe(runtime.code.replaceAll('\r\n', '\n'));
    expect(readFileSync(join(ROOT, '.github', 'plugins', 'azure-functions-skills', 'hooks', 'runtime', 'telemetry.mjs'), 'utf-8')
      .replaceAll('\r\n', '\n')).toBe(text(real, 'runtime/telemetry.mjs'));
  }, 120_000);
});
