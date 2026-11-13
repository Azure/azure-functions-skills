import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyFunctionTemplate, TemplateError } from '../src/templates/index.js';
import { runCli, type CliDependencies } from '../src/tools/cli.js';
import { findTemplates } from '../src/tools/template/find.js';
import { writeTemplate } from '../src/tools/template/write.js';
import { EXIT } from '../src/tools/shared/output.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import { fakeRunner } from './helpers/deploy-fixture.js';

const TEMP_DIRS: string[] = [];

function tempDir(prefix = 'af-tools-template-'): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

/** A local manifest with two TypeScript templates and one Python template that share a source folder. */
function fixture(): { manifestUrl: string; sourceDir: string } {
  const root = tempDir();
  const sourceDir = join(root, 'source');
  mkdirSync(join(sourceDir, 'src', 'functions'), { recursive: true });
  mkdirSync(join(sourceDir, 'infra'), { recursive: true });
  writeFileSync(join(sourceDir, 'host.json'), '{"version":"2.0"}\n');
  writeFileSync(join(sourceDir, 'azure.yaml'), 'name: sample\n');
  writeFileSync(join(sourceDir, 'infra', 'main.bicep'), 'param location string\n');
  writeFileSync(join(sourceDir, 'package.json'), '{"engines":{"node":"{{nodeVersion}}"}}\n');
  writeFileSync(join(sourceDir, 'src', 'functions', 'httpTrigger.ts'), 'export const version = "{{nodeVersion}}";\n');
  const template = (id: string, language: string, resource: string, priority: number) => ({
    id, displayName: `${resource} (${language})`, shortDescription: `${resource} trigger for ${language}`,
    longDescription: 'A much longer description that the tool does not need to print.',
    language, resource, iac: 'bicep', priority,
    repositoryUrl: pathToFileURL(sourceDir).href, folderPath: '.', gitRef: 'main',
  });
  const manifestPath = join(root, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({
    runtimeVersions: { TypeScript: { default: '22' } },
    templates: [
      template('timer-trigger-typescript-azd', 'TypeScript', 'timer', 1),
      template('http-trigger-typescript-azd', 'TypeScript', 'http', 0),
      template('http-trigger-python-azd', 'Python', 'http', 0),
    ],
  }));
  return { manifestUrl: pathToFileURL(manifestPath).href, sourceDir };
}

afterAll(() => {
  for (const dir of TEMP_DIRS) removeDir(dir);
});

describe('template find', () => {
  it('lists the matching templates in priority order without long descriptions', async () => {
    const { manifestUrl } = fixture();
    const found = await findTemplates({ language: 'typescript' }, { manifestUrls: [manifestUrl] });

    expect(found.exitCode).toBe(EXIT.ok);
    expect(found.body.data.templates).toEqual([
      {
        id: 'http-trigger-typescript-azd', displayName: 'http (TypeScript)', description: 'http trigger for TypeScript',
        language: 'TypeScript', resource: 'http', iac: 'bicep',
      },
      {
        id: 'timer-trigger-typescript-azd', displayName: 'timer (TypeScript)', description: 'timer trigger for TypeScript',
        language: 'TypeScript', resource: 'timer', iac: 'bicep',
      },
    ]);
    expect(found.body.data.manifestSource).toBe('primary');
  });

  it('filters by resource', async () => {
    const { manifestUrl } = fixture();
    const found = await findTemplates({ language: 'typescript', resource: 'timer' }, { manifestUrls: [manifestUrl] });
    expect(found.body.data.templates?.map(template => template.id)).toEqual(['timer-trigger-typescript-azd']);
  });

  it('reports no match as a finding, not as a failure to run', async () => {
    const { manifestUrl } = fixture();
    const found = await findTemplates({ language: 'go' }, { manifestUrls: [manifestUrl] });
    expect(found.exitCode).toBe(EXIT.ok);
    expect(found.body.ok).toBe(false);
    expect(found.body.findings.map(finding => finding.id)).toEqual(['TEMPLATE-NONE-MATCH']);
  });

  it('uses the second manifest location when the first one fails and records the gap', async () => {
    const { manifestUrl } = fixture();
    const missing = pathToFileURL(join(tempDir(), 'missing.json')).href;
    const found = await findTemplates({ language: 'python' }, { manifestUrls: [missing, manifestUrl] });
    expect(found.body.data.templates).toHaveLength(1);
    expect(found.body.data.manifestSource).toBe('fallback');
    expect(found.body.gaps.map(gap => gap.check)).toEqual(['manifest-primary']);
  });

  it('is blocked when no manifest location can be read', async () => {
    const missing = pathToFileURL(join(tempDir(), 'missing.json')).href;
    const found = await findTemplates({ language: 'python' }, { manifestUrls: [missing] });
    expect(found.exitCode).toBe(EXIT.blocked);
    expect(found.body.findings.map(finding => finding.id)).toEqual(['TEMPLATE-MANIFEST-UNAVAILABLE']);
  });
});

describe('template write from the manifest', () => {
  it('writes a new project and fills in the runtime version', async () => {
    const { manifestUrl } = fixture();
    const dir = join(tempDir(), 'new-app');
    const written = await writeTemplate({ dir, template: 'http-trigger-typescript-azd', dryRun: false },
      { manifestUrls: [manifestUrl] });

    expect(written.exitCode).toBe(EXIT.ok);
    expect(written.body.data).toMatchObject({
      source: 'manifest', template: 'http-trigger-typescript-azd', mode: 'new', dryRun: false,
      written: ['azure.yaml', 'host.json', 'infra/main.bicep', 'package.json', 'src/functions/httpTrigger.ts'],
      skipped: [],
    });
    expect(readFileSync(join(dir, 'src', 'functions', 'httpTrigger.ts'), 'utf-8')).toContain('"22"');
  });

  it('adds only function files to an existing project and never overwrites', async () => {
    const { manifestUrl } = fixture();
    const dir = tempDir();
    writeFileSync(join(dir, 'host.json'), '{"version":"2.0","custom":true}\n');
    mkdirSync(join(dir, 'src', 'functions'), { recursive: true });
    writeFileSync(join(dir, 'src', 'functions', 'httpTrigger.ts'), 'mine\n');

    const written = await writeTemplate({ dir, template: 'http-trigger-typescript-azd', dryRun: false },
      { manifestUrls: [manifestUrl] });

    expect(written.body.data).toMatchObject({ mode: 'add', written: [] });
    expect(written.body.data.skipped).toEqual(
      ['azure.yaml', 'host.json', 'infra/main.bicep', 'package.json', 'src/functions/httpTrigger.ts']);
    expect(readFileSync(join(dir, 'host.json'), 'utf-8')).toContain('custom');
    expect(readFileSync(join(dir, 'src', 'functions', 'httpTrigger.ts'), 'utf-8')).toBe('mine\n');
  });

  it('lists the files without writing them in a dry run', async () => {
    const { manifestUrl } = fixture();
    const dir = join(tempDir(), 'dry');
    const written = await writeTemplate({ dir, template: 'http-trigger-typescript-azd', dryRun: true },
      { manifestUrls: [manifestUrl] });
    expect(written.body.data.dryRun).toBe(true);
    expect(written.body.data.written).toHaveLength(5);
    expect(existsSync(dir)).toBe(false);
  });

  it.each([
    ['an unknown template', { template: 'nope' }, 'TEMPLATE-NOT-FOUND'],
    ['a template in another language', { template: 'http-trigger-python-azd', language: 'typescript' }, 'TEMPLATE-NOT-FOUND'],
  ])('is blocked for %s and writes nothing', async (_name, options, findingId) => {
    const { manifestUrl } = fixture();
    const dir = join(tempDir(), 'blocked');
    const written = await writeTemplate({ dir, dryRun: false, ...options }, { manifestUrls: [manifestUrl] });
    expect(written.exitCode).toBe(EXIT.blocked);
    expect(written.body.findings.map(finding => finding.id)).toEqual([findingId]);
    expect(existsSync(dir)).toBe(false);
  });

  it('refuses to write through a link that leaves the target folder', async () => {
    const { manifestUrl } = fixture();
    const dir = tempDir();
    const outside = tempDir();
    symlinkSync(outside, join(dir, 'src'), 'junction');

    const written = await writeTemplate({ dir, template: 'http-trigger-typescript-azd', dryRun: false },
      { manifestUrls: [manifestUrl] });

    expect(written.exitCode).toBe(EXIT.blocked);
    expect(written.body.findings.map(finding => finding.id)).toEqual(['TEMPLATE-UNSAFE-PATH']);
    expect(existsSync(join(outside, 'functions'))).toBe(false);
  });

  it('applies the same link check in the library', async () => {
    const { manifestUrl } = fixture();
    const dir = tempDir();
    symlinkSync(tempDir(), join(dir, 'infra'), 'junction');
    await expect(applyFunctionTemplate(dir, { manifestUrl, template: 'http-trigger-typescript-azd' }))
      .rejects.toMatchObject({ code: 'unsafe-path' } satisfies Partial<TemplateError>);
  });
});

describe('template find recommendation', () => {
  it('names the closest template first so the agent can write it without another lookup', async () => {
    const { manifestUrl } = fixture();
    const found = await findTemplates({ language: 'typescript', resource: 'timer' }, { manifestUrls: [manifestUrl] });
    expect(found.body.data.recommended).toBe('timer-trigger-typescript-azd');
    expect(found.body.next?.command).toContain('--template timer-trigger-typescript-azd');
  });
});

describe('template write with automatic selection', () => {
  it('chooses the template that matches the language and resource', async () => {
    const { manifestUrl } = fixture();
    const dir = join(tempDir(), 'auto');
    const written = await writeTemplate({ dir, language: 'typescript', resource: 'timer', dryRun: false },
      { manifestUrls: [manifestUrl] });

    expect(written.exitCode).toBe(EXIT.ok);
    expect(written.body.data).toMatchObject({
      template: 'timer-trigger-typescript-azd', language: 'TypeScript', runtimeVersion: '22',
      selection: { by: 'language+resource', alternatives: [] },
    });
    expect(existsSync(join(dir, 'host.json'))).toBe(true);
  });

  it('chooses the highest priority template when only the language is known', async () => {
    const { manifestUrl } = fixture();
    const written = await writeTemplate({ dir: join(tempDir(), 'auto'), language: 'typescript', dryRun: true },
      { manifestUrls: [manifestUrl] });
    expect(written.body.data.template).toBe('http-trigger-typescript-azd');
    expect(written.body.data.selection).toEqual({ by: 'language', alternatives: ['timer-trigger-typescript-azd'] });
  });

  it('is blocked when nothing matches and lists what exists for the language', async () => {
    const { manifestUrl } = fixture();
    const dir = join(tempDir(), 'none');
    const written = await writeTemplate({ dir, language: 'typescript', resource: 'cosmos', dryRun: false },
      { manifestUrls: [manifestUrl] });
    expect(written.exitCode).toBe(EXIT.blocked);
    expect(written.body.findings[0]).toMatchObject({ id: 'TEMPLATE-NONE-MATCH' });
    expect(written.body.findings[0].detail).toContain('http, timer');
    expect(existsSync(dir)).toBe(false);
  });

  it('points to the local check after writing a new project', async () => {
    const { manifestUrl } = fixture();
    const dir = join(tempDir(), 'next');
    const written = await writeTemplate({ dir, template: 'http-trigger-typescript-azd', dryRun: false },
      { manifestUrls: [manifestUrl] });
    expect(written.body.next).toMatchObject({ action: 'local-verify' });
    expect(written.body.next?.command).toContain('local verify --dir');
  });
});

describe('template write --stage', () => {
  it('writes the whole template into a git-ignored staging folder of an existing project', async () => {
    const { manifestUrl } = fixture();
    const dir = tempDir();
    writeFileSync(join(dir, 'host.json'), '{"version":"2.0","custom":true}\n');

    const written = await writeTemplate({ dir, template: 'timer-trigger-typescript-azd', stage: true, dryRun: false },
      { manifestUrls: [manifestUrl] });

    const staged = join(dir, '.azure-functions-skills', 'templates', 'timer-trigger-typescript-azd');
    expect(written.exitCode).toBe(EXIT.ok);
    expect(written.body.data).toMatchObject({ mode: 'new', stagedDir: staged });
    expect(existsSync(join(staged, 'src', 'functions', 'httpTrigger.ts'))).toBe(true);
    expect(readFileSync(join(dir, '.azure-functions-skills', '.gitignore'), 'utf-8')).toBe('*\n');
    expect(readFileSync(join(dir, 'host.json'), 'utf-8')).toContain('custom');
    expect(written.body.next).toMatchObject({ action: 'merge-staged' });
  });
});

describe('template write from Azure MCP output', () => {
  function mcpFile(content: unknown): string {
    const path = join(tempDir(), 'template.json');
    writeFileSync(path, JSON.stringify(content));
    return path;
  }

  it('writes every file list in the MCP result and returns the merge instructions', async () => {
    const dir = join(tempDir(), 'mcp-app');
    const from = mcpFile({
      status: 200,
      results: {
        language: 'typescript',
        templateName: 'http-trigger-typescript-azd',
        projectFiles: [{ fileName: 'host.json', content: '{"version":"2.0"}' }],
        functionFiles: [{ fileName: 'src/functions/hello.ts', content: 'export {};\n' }],
        files: [{ fileName: 'infra\\main.bicep', content: 'param location string\n' }],
        mergeInstructions: 'Add @azure/functions to package.json.',
      },
    });

    const written = await writeTemplate({ dir, from, dryRun: false }, { manifestUrls: [] });

    expect(written.exitCode).toBe(EXIT.ok);
    expect(written.body.data).toMatchObject({
      source: 'mcp-file', template: 'http-trigger-typescript-azd',
      written: ['host.json', 'infra/main.bicep', 'src/functions/hello.ts'], skipped: [],
      mergeInstructions: 'Add @azure/functions to package.json.',
    });
    expect(readFileSync(join(dir, 'src', 'functions', 'hello.ts'), 'utf-8')).toBe('export {};\n');
  });

  it('skips files that already exist', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'host.json'), 'mine');
    const from = mcpFile({ files: [{ fileName: 'host.json', content: 'theirs' }, { fileName: 'new.txt', content: 'x' }] });
    const written = await writeTemplate({ dir, from, dryRun: false }, { manifestUrls: [] });
    expect(written.body.data).toMatchObject({ written: ['new.txt'], skipped: ['host.json'] });
    expect(readFileSync(join(dir, 'host.json'), 'utf-8')).toBe('mine');
  });

  it.each([
    ['../escape.txt'], ['/etc/passwd'], ['C:\\Windows\\x.txt'], ['a/../../b.txt'],
  ])('refuses the file name %j and writes nothing', async fileName => {
    const dir = join(tempDir(), 'unsafe');
    const from = mcpFile({ files: [{ fileName: 'ok.txt', content: 'ok' }, { fileName, content: 'bad' }] });
    const written = await writeTemplate({ dir, from, dryRun: false }, { manifestUrls: [] });
    expect(written.exitCode).toBe(EXIT.blocked);
    expect(written.body.findings.map(finding => finding.id)).toEqual(['TEMPLATE-UNSAFE-PATH']);
    expect(existsSync(join(dir, 'ok.txt'))).toBe(false);
  });

  it.each([
    ['a file that is not JSON', 'not json'],
    ['JSON without template files', '{"results":{"language":"typescript"}}'],
  ])('is blocked for %s', async (_name, text) => {
    const from = join(tempDir(), 'bad.json');
    writeFileSync(from, text);
    const written = await writeTemplate({ dir: tempDir(), from, dryRun: false }, { manifestUrls: [] });
    expect(written.exitCode).toBe(EXIT.blocked);
    expect(written.body.findings.map(finding => finding.id)).toEqual(['TEMPLATE-INPUT-INVALID']);
  });
});

describe('template commands on the command line', () => {
  const dependencies: CliDependencies = {
    run: fakeRunner().run, now: () => new Date(0), fetchStatus: async () => 200, sleep: async () => undefined,
  };

  it.each([
    [['template', 'find']],
    [['template', 'write', '--dir', '.']],
    [['template', 'write', '--dir', '.', '--template', 'a', '--from', 'b']],
    [['template', 'find', '--language', 'python', '--manifest-url', 'https://example.invalid/m.json']],
    [['template', 'write', '--dir', '.', '--template', 'a', '--force']],
    [['template', 'write', '--dir', '.', '--template', 'a', '--resource', 'http']],
    [['template', 'write', '--dir', '.', '--from', 'a', '--stage']],
  ])('reports %j as a usage error', async argv => {
    expect((await runCli(argv, dependencies)).exitCode).toBe(EXIT.usage);
  });

  it('routes template find with an injected manifest location', async () => {
    const { manifestUrl } = fixture();
    const found = await runCli(['template', 'find', '--language', 'python'], { ...dependencies, manifestUrls: [manifestUrl] });
    expect(found.exitCode).toBe(EXIT.ok);
    expect(found.body.command).toBe('template find');
  });
});
