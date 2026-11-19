import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { type StarterFiles } from '../src/starter/build.js';
import { loadStarterConfig, parseStarterConfig, type StarterConfig } from '../src/starter/config.js';
import { buildRepositoryStarter } from '../src/starter/payload.js';
import {
  checkTemplateManifest, loadStarterLock, parseTemplateManifest, refreshTemplate, templateLockEntry, verifyTemplateCache, type StarterLock,
} from '../src/starter/template-lock.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import { buildFixture, ROOT, runBootstrap, SHELLS, testConfig, writeFixture } from './helpers/starter.js';

const UPSTREAM_SHA = 'a'.repeat(40);
let temp: string;

beforeAll(() => {
  temp = createTempDir('af-starter-template ');
});

afterAll(() => removeDir(temp));

function text(files: StarterFiles, path: string): string {
  const content = files.get(path);
  if (!content) throw new Error(`Missing ${path}`);
  return content.toString('utf-8');
}

function rows(files: StarterFiles, manifest: string): string[] {
  return text(files, manifest).trim().split('\n').map(line => {
    const [scope, , source, destination] = line.split('\t');
    return `${scope} ${source} -> ${destination}`;
  });
}

/** testConfig with `extras` turned into a template bundle with instruction files. */
function templateConfig(
  appDir = 'tests/fixtures/starter/app-timer',
  agentFiles: string | undefined = 'tests/fixtures/starter/agent-files',
  manifest: { manifestId?: string; manifestCategories?: string[] } = {},
): StarterConfig {
  const bundles = JSON.parse(JSON.stringify(testConfig().bundles)) as Record<string, Record<string, unknown>>;
  return parseStarterConfig({
    schemaVersion: 1,
    source: testConfig().source,
    bundles: {
      functions: bundles.functions,
      extras: {
        ...bundles.extras,
        akaLink: undefined,
        prompt: undefined,
        ...(agentFiles ? { agentFiles } : {}),
        ...(manifest.manifestCategories ? { manifestCategories: manifest.manifestCategories } : {}),
        templates: { timer: {
          akaLink: 'https://aka.ms/test-timer', prompt: 'Read https://aka.ms/test-timer.', appDir,
          ...(manifest.manifestId ? { manifestId: manifest.manifestId } : {}),
        } },
      },
    },
  });
}

function fixtureLock(appDir = join(ROOT, 'tests', 'fixtures', 'starter', 'app-timer')): StarterLock {
  return {
    schemaVersion: 1,
    templates: {
      'extras/timer': { repository: 'contoso/sample-app', ref: 'v1.0.0', commit: UPSTREAM_SHA, files: templateLockEntry(appDir) },
    },
  };
}

describe('starter instruction files', () => {
  it('maps a bundle\'s instruction files to each agent', () => {
    const files = buildFixture({ config: templateConfig() });
    expect(rows(files, 'extras/files.tsv').filter(row => row.includes('agent-files/'))).toEqual([
      'common agent-files/AGENTS.md -> AGENTS.md',
      'claude agent-files/CLAUDE.md -> CLAUDE.md',
      'copilot agent-files/copilot-instructions.md -> .github/copilot-instructions.md',
    ]);
    expect(text(files, 'extras/agent-files/AGENTS.md')).toContain('Shared instructions.');
    expect(rows(files, 'functions/files.tsv').some(row => row.includes('agent-files/'))).toBe(false);
  });

  it('rejects an instruction file that has no agent mapping', () => {
    expect(() => buildFixture({ config: templateConfig(undefined, 'tests/fixtures/starter/agent-files-unknown') }))
      .toThrow(/agentFiles has GEMINI\.md/);
    expect(() => parseStarterConfig({ ...JSON.parse(JSON.stringify(templateConfig())), bundles: {
      ...JSON.parse(JSON.stringify(templateConfig().bundles)),
      extras: { ...JSON.parse(JSON.stringify(templateConfig().bundles.extras)), agentFiles: '../outside' },
    } })).toThrow(/agentFiles/);
  });
});

describe('starter template lock', () => {
  it('accepts a cache that matches the lock and records the template provenance (ST-014)', () => {
    const config = templateConfig();
    const lock = fixtureLock();
    expect(verifyTemplateCache(ROOT, config, lock)).toEqual([]);
    const files = buildFixture({ config, lock });
    expect(rows(files, 'extras/templates/timer/files.tsv')).toContain('common template.json -> .azure-functions-skills/templates/timer.json');
    expect(JSON.parse(text(files, 'extras/templates/timer/template.json'))).toEqual({
      schemaVersion: 1, bundle: 'extras', template: 'timer', repository: 'contoso/sample-app', ref: 'v1.0.0', commit: UPSTREAM_SHA,
    });
  });

  it('reports a changed, missing, or extra cache file and a template without a lock entry', () => {
    const root = join(temp, 'drift-root');
    const appDir = join(root, 'apps', 'timer');
    cpSync(join(ROOT, 'tests', 'fixtures', 'starter', 'app-timer'), appDir, { recursive: true });
    const config = templateConfig('apps/timer');
    const lock = fixtureLock(appDir);
    writeFileSync(join(appDir, 'README.md'), 'edited by hand\n');
    writeFileSync(join(appDir, 'EXTRA.md'), 'not in the lock\n');
    const missing = { ...lock.templates['extras/timer'], files: { ...lock.templates['extras/timer'].files, 'GONE.md': '0'.repeat(64) } };
    const errors = verifyTemplateCache(root, config, { schemaVersion: 1, templates: { 'extras/timer': missing } });
    expect(errors.join('\n')).toMatch(/README\.md/);
    expect(errors.join('\n')).toMatch(/EXTRA\.md/);
    expect(errors.join('\n')).toMatch(/GONE\.md/);
    expect(verifyTemplateCache(root, config, { schemaVersion: 1, templates: {} }).join('\n')).toMatch(/extras\/timer/);
  });

  it('keeps the committed cache equal to starter.lock.json', () => {
    const config = loadStarterConfig(join(ROOT, 'starter.config.json'));
    expect(verifyTemplateCache(ROOT, config, loadStarterLock(join(ROOT, 'starter.lock.json')))).toEqual([]);
  });
});

function manifestEntry(id: string, folderPath: string, gitRef = 'refs/tags/v1.0.0', categories = ['starters', 'hosted-skills']): Record<string, unknown> {
  return { id, repositoryUrl: 'https://github.com/contoso/sample-app', folderPath, gitRef, categories, priority: 60 };
}

describe('templates manifest', () => {
  it('reads the repository, folder, and ref of each template', () => {
    const manifest = parseTemplateManifest({ version: '1.0.0', templates: [manifestEntry('sample-timer', 'timer'), manifestEntry('root-app', '.', 'refs/heads/main')] });
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.templates).toEqual([
      { id: 'sample-timer', repository: 'contoso/sample-app', path: 'timer', ref: 'v1.0.0', categories: ['starters', 'hosted-skills'] },
      { id: 'root-app', repository: 'contoso/sample-app', path: '.', ref: 'main', categories: ['starters', 'hosted-skills'] },
    ]);
  });

  it('sets aside a template outside GitHub or with an unsafe folder without failing the others', () => {
    const manifest = parseTemplateManifest({ version: '1', templates: [
      { ...manifestEntry('elsewhere', 'timer'), repositoryUrl: 'https://example.com/a/b' },
      manifestEntry('escape', '../outside'),
      manifestEntry('root-empty', ''),
    ] });
    expect(manifest.templates.map(template => `${template.id}:${template.path}`)).toEqual(['root-empty:.']);
    expect(manifest.rejected.elsewhere).toMatch(/repositoryUrl/);
    expect(manifest.rejected.escape).toMatch(/folderPath/);
    const config = templateConfig('tests/fixtures/starter/app-timer', undefined, { manifestId: 'escape' });
    expect(checkTemplateManifest(config, { schemaVersion: 1, templates: {} }, manifest))
      .toEqual(['extras/timer: manifest template escape cannot be used: unsafe folderPath.']);
  });

  it('reports manifest starters that are not cached and cached templates that differ from the manifest', () => {
    const config = templateConfig('tests/fixtures/starter/app-timer', undefined, { manifestId: 'sample-timer', manifestCategories: ['starters', 'hosted-skills'] });
    const lock: StarterLock = { schemaVersion: 1, templates: {
      'extras/timer': { ...fixtureLock().templates['extras/timer'], manifestId: 'sample-timer', path: 'timer' },
    } };
    const current = parseTemplateManifest({ version: '1', templates: [
      manifestEntry('sample-timer', 'timer'),
      manifestEntry('not-a-starter', 'other', 'refs/tags/v1.0.0', ['hosted-skills', 'workflows']),
    ] });
    expect(checkTemplateManifest(config, lock, current)).toEqual([]);
    const moved = parseTemplateManifest({ version: '2', templates: [
      manifestEntry('sample-timer', 'timer', 'refs/tags/v1.2.0'),
      manifestEntry('sample-queue', 'queue'),
    ] });
    expect(checkTemplateManifest(config, lock, moved)).toEqual([
      'extras/timer: the manifest has contoso/sample-app/timer@v1.2.0; the cache has contoso/sample-app/timer@v1.0.0.',
      'extras: manifest starter sample-queue is not cached.',
    ]);
    expect(checkTemplateManifest(config, lock, parseTemplateManifest({ version: '3', templates: [] })))
      .toEqual(['extras/timer: manifest template sample-timer is missing.']);
  });
});

describe('starter template refresh', () => {
  it('downloads the manifest folder of one upstream commit, maps special files, skips local settings, and updates the lock', async () => {
    const stage = join(temp, 'upstream', `sample-app-${UPSTREAM_SHA}`);
    for (const [path, content] of Object.entries({
      'README.md': '# Repository readme, not cached\n',
      'other/README.md': '# Another sample, not cached\n',
      'timer/README.md': '# Sample\n',
      'timer/.gitignore': 'node_modules/\n',
      'timer/src/local.settings.json': '{"secret": "do not copy"}\n',
      'timer/src/local.settings.json.sample': '{"Values": {}}\n',
      'timer/.github/workflows/ci.yml': 'name: ci\n',
    })) {
      mkdirSync(join(stage, ...path.split('/').slice(0, -1)), { recursive: true });
      writeFileSync(join(stage, ...path.split('/')), content);
    }
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const archive = join(temp, 'upstream.tar.gz');
    const packed = spawnSync(tar, ['-czf', archive, `sample-app-${UPSTREAM_SHA}`], { cwd: join(temp, 'upstream'), encoding: 'utf-8' });
    expect(packed.status, packed.stderr).toBe(0);
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? '');
      if (request.url === '/manifest.json') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ version: '1.0.0', templates: [manifestEntry('sample-other', 'other'), manifestEntry('sample-timer', 'timer')] }));
      } else if (request.url === '/repos/contoso/sample-app/commits/v1.0.0') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end(UPSTREAM_SHA);
      } else if (request.url === `/contoso/sample-app/tar.gz/${UPSTREAM_SHA}`) {
        response.writeHead(200, { 'Content-Type': 'application/gzip' });
        response.end(readFileSync(archive));
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const root = join(temp, 'refresh-root');
      mkdirSync(join(root, 'apps', 'timer'), { recursive: true });
      writeFileSync(join(root, 'apps', 'timer', 'STALE.md'), 'removed by refresh\n');
      const config = templateConfig('apps/timer', 'tests/fixtures/starter/agent-files', { manifestId: 'sample-timer' });
      const lockPath = join(root, 'starter.lock.json');
      const entry = await refreshTemplate({
        root, config, lockPath, bundle: 'extras', template: 'timer',
        manifestUrl: `${base}/manifest.json`, apiBase: base, codeloadBase: base,
      });
      expect(entry).toMatchObject({ manifestId: 'sample-timer', repository: 'contoso/sample-app', path: 'timer', ref: 'v1.0.0', commit: UPSTREAM_SHA });
      expect(Object.keys(entry.files).sort()).toEqual(['README.md', 'gitignore.template', 'src/local.settings.json.sample']);
      expect(existsSync(join(root, 'apps', 'timer', 'STALE.md'))).toBe(false);
      expect(existsSync(join(root, 'apps', 'timer', 'src', 'local.settings.json'))).toBe(false);
      expect(readFileSync(join(root, 'apps', 'timer', 'gitignore.template'), 'utf-8')).toBe('node_modules/\n');
      expect(loadStarterLock(lockPath).templates['extras/timer']).toEqual(entry);
      expect(verifyTemplateCache(root, config, loadStarterLock(lockPath))).toEqual([]);
      expect(requests).toEqual(['/manifest.json', '/repos/contoso/sample-app/commits/v1.0.0', `/contoso/sample-app/tar.gz/${UPSTREAM_SHA}`]);
      await expect(refreshTemplate({
        root, config: templateConfig('apps/timer'), lockPath, bundle: 'extras', template: 'timer',
        manifestUrl: `${base}/manifest.json`, apiBase: base, codeloadBase: base,
      })).rejects.toThrow(/manifestId/);
    } finally {
      server.close();
    }
  }, 60_000);
});

describe('hosted-skills bundle configuration', () => {
  it('caches the five manifest starters, each with its own link, prompt, lock entry, and examples (ST-001, ST-014)', () => {
    const config = loadStarterConfig(join(ROOT, 'starter.config.json'));
    const lock = loadStarterLock(join(ROOT, 'starter.lock.json'));
    const bundle = config.bundles['hosted-skills'];
    expect(bundle.manifestCategories).toEqual(['starters', 'hosted-skills']);
    const expected: Record<string, string> = {
      timer: 'ai-hosted-skills-python',
      queue: 'ai-hosted-skills-starter-queue-python',
      servicebus: 'ai-hosted-skills-starter-servicebus-python',
      blob: 'ai-hosted-skills-starter-blob-python',
      cosmos: 'ai-hosted-skills-starter-cosmos-python',
    };
    expect(Object.keys(bundle.templates ?? {}).sort()).toEqual(Object.keys(expected).sort());
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
    const files = buildRepositoryStarter({ root: ROOT }).files;
    const handoffs = new Set<string>();
    for (const [name, manifestId] of Object.entries(expected)) {
      const template = bundle.templates?.[name];
      expect(template?.manifestId).toBe(manifestId);
      expect(template?.akaLink).toBe(`https://aka.ms/hosted-skills-${name}-starter`);
      expect(template?.appDir).toBe(`templates/starter/apps/${name}`);
      expect(readme).toContain(template?.prompt ?? '<missing>');
      expect(lock.templates[`hosted-skills/${name}`]?.manifestId).toBe(manifestId);
      const start = text(files, `hosted-skills/templates/${name}/start.md`);
      expect(start).toContain(`-Bundle hosted-skills -Template ${name} -Agent <agent>`);
      expect(start).toContain('azure-functions-hosted-skills-migrate');
      expect(rows(files, `hosted-skills/templates/${name}/files.tsv`).filter(row => row.endsWith(' -> .gitignore'))).toHaveLength(1);
      handoffs.add(start.slice(start.indexOf('Offer examples')));
    }
    expect(handoffs.size).toBe(Object.keys(expected).length);
  }, 120_000);

  it('defines the Hosted Skills bundle with the timer template and its prompt (ST-001, ST-014)', () => {
    const config = loadStarterConfig(join(ROOT, 'starter.config.json'));
    const bundle = config.bundles['hosted-skills'];
    expect(bundle.skills).toEqual([
      'azure-functions-hosted-skills', 'azure-functions-hosted-skills-migrate',
      'azure-functions-connector-create', 'azure-functions-connector-mcp', 'azure-functions-connector-validate',
    ]);
    expect(bundle.handoff).toBe('azure-functions-hosted-skills');
    expect(bundle.tools).toEqual(['python', 'func', 'azurite', 'azd', 'az', 'node']);
    const timer = bundle.templates?.timer;
    expect(timer?.akaLink).toBe('https://aka.ms/hosted-skills-timer-starter');
    expect(timer?.prompt).toMatch(/I authorize that one command for this directory only/);
    expect(readFileSync(join(ROOT, 'README.md'), 'utf-8')).toContain(timer?.prompt ?? '<missing>');
    const files = buildRepositoryStarter({ root: ROOT }).files;
    expect(text(files, 'hosted-skills/templates/timer/start.md')).toContain('-Bundle hosted-skills -Template timer -Agent <agent>');
    expect(text(files, 'hosted-skills/templates/timer/start.md')).toContain('azure-functions-hosted-skills');
    expect(files.has('hosted-skills/agent-files/AGENTS.md')).toBe(true);
  }, 120_000);
});

describe.each(SHELLS)('template bundle install (%s)', shell => {
  it.each(['claude', 'copilot', 'codex'])('installs the app, the instruction files for %s, and the provenance', async agent => {
    const starter = writeFixture(buildFixture({ config: templateConfig(), lock: fixtureLock() }), join(temp, `payload ${shell} ${agent}`));
    const destination = join(temp, `app ${shell} ${agent}`);
    mkdirSync(destination);
    const result = await runBootstrap(shell, starter, { destination, agent, bundle: 'extras', template: 'timer', noTelemetry: true });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.json).toMatchObject({ ready: true, bundle: 'extras', template: 'timer', error: null });
    for (const path of ['README.md', '.gitignore', 'src/local.settings.json', 'src/local.settings.json.sample', 'AGENTS.md',
      '.azure-functions-skills/templates/timer.json']) {
      expect(existsSync(join(destination, ...path.split('/'))), path).toBe(true);
    }
    expect(existsSync(join(destination, 'CLAUDE.md'))).toBe(agent === 'claude');
    expect(existsSync(join(destination, '.github', 'copilot-instructions.md'))).toBe(agent === 'copilot');
  }, 240_000);
});
