import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyFunctionTemplate, listFunctionTemplates, type TemplateManifest } from '../src/templates/index.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const ROOT_DIR = join(import.meta.dirname, '..');
const CLI_PATH = join(ROOT_DIR, 'bin', 'azure-functions-skills.js');
const TEMP_DIRS: string[] = [];

interface Fixture {
  readonly manifestPath: string;
  readonly sourceDir: string;
}

function makeTempDir(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createTemplateFixture(): Fixture {
  const root = makeTempDir('af-skills-template-fixture-');
  const sourceDir = join(root, 'source');
  mkdirSync(join(sourceDir, 'src', 'functions'), { recursive: true });
  writeFileSync(join(sourceDir, 'host.json'), '{ "version": "2.0" }\n');
  writeJson(join(sourceDir, 'local.settings.json'), {
    IsEncrypted: false,
    Values: {
      FUNCTIONS_WORKER_RUNTIME: 'node',
      AzureWebJobsStorage: 'UseDevelopmentStorage=true',
    },
  });
  writeJson(join(sourceDir, 'package.json'), {
    name: 'sample-template',
    engines: { node: '{{nodeVersion}}' },
  });
  writeFileSync(join(sourceDir, 'src', 'functions', 'httpTrigger.ts'), 'export const nodeVersion = "{{nodeVersion}}";\n');

  const manifestPath = join(root, 'manifest.json');
  writeJson(manifestPath, {
    version: 'test',
    runtimeVersions: {
      TypeScript: { supported: ['22', '24'], default: '22' },
    },
    languages: ['TypeScript'],
    templates: [
      {
        id: 'http-trigger-typescript-azd',
        displayName: 'HTTP Trigger (TypeScript + AZD + Bicep)',
        shortDescription: 'HTTP trigger for TypeScript',
        longDescription: 'HTTP trigger for TypeScript',
        language: 'TypeScript',
        bindingType: 'trigger',
        resource: 'http',
        iac: 'bicep',
        priority: 0,
        categories: ['starters'],
        tags: ['HTTP', 'Azd'],
        author: 'Azure Functions Team',
        repositoryUrl: pathToFileURL(sourceDir).href,
        folderPath: '.',
        gitRef: 'main',
        whatsIncluded: ['HTTP trigger function'],
      },
      {
        id: 'timer-trigger-typescript-azd',
        displayName: 'Timer Trigger (TypeScript + AZD + Bicep)',
        shortDescription: 'Timer trigger for TypeScript',
        longDescription: 'Timer trigger for TypeScript',
        language: 'TypeScript',
        bindingType: 'trigger',
        resource: 'timer',
        iac: 'bicep',
        priority: 1,
        categories: ['starters'],
        tags: ['Timer', 'Azd'],
        author: 'Azure Functions Team',
        repositoryUrl: pathToFileURL(sourceDir).href,
        folderPath: '.',
        gitRef: 'main',
        whatsIncluded: ['Timer trigger function'],
      },
    ],
  });

  return { manifestPath, sourceDir };
}

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(() => {
  for (const dir of TEMP_DIRS) removeDir(dir);
});

describe('template library', () => {
  it('lists manifest templates with language, resource, and IaC filters', async () => {
    const fixture = createTemplateFixture();

    const result = await listFunctionTemplates({
      manifestUrl: pathToFileURL(fixture.manifestPath).href,
      language: 'typescript',
      resource: 'http',
      iac: 'bicep',
    });

    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]).toMatchObject({
      id: 'http-trigger-typescript-azd',
      language: 'TypeScript',
      resource: 'http',
      iac: 'bicep',
    });
  });

  it('applies a manifest-backed template and substitutes runtime placeholders', async () => {
    const fixture = createTemplateFixture();
    const targetDir = makeTempDir('af-skills-template-apply-');

    const result = await applyFunctionTemplate(targetDir, {
      manifestUrl: pathToFileURL(fixture.manifestPath).href,
      language: 'typescript',
      template: 'http-trigger-typescript-azd',
      runtimeVersion: '24',
      mode: 'new',
    });

    expect(result.filesWritten).toContain('host.json');
    expect(result.filesWritten).toContain('src/functions/httpTrigger.ts');
    expect(readFileSync(join(targetDir, 'package.json'), 'utf-8')).toContain('"node": "24"');
    expect(readFileSync(join(targetDir, 'src', 'functions', 'httpTrigger.ts'), 'utf-8')).toContain('"24"');
  });

  it('applies a manifest-backed template by template ID without requiring language', async () => {
    const fixture = createTemplateFixture();
    const targetDir = makeTempDir('af-skills-template-apply-without-language-');

    const result = await applyFunctionTemplate(targetDir, {
      manifestUrl: pathToFileURL(fixture.manifestPath).href,
      template: 'http-trigger-typescript-azd',
      mode: 'new',
    });

    expect(result.template.language).toBe('TypeScript');
    expect(readFileSync(join(targetDir, 'src', 'functions', 'httpTrigger.ts'), 'utf-8')).toContain('"22"');
  });

  it('adds function files to existing projects without overwriting project settings by default', async () => {
    const fixture = createTemplateFixture();
    const targetDir = makeTempDir('af-skills-template-add-');
    writeFileSync(join(targetDir, 'host.json'), '{ "version": "2.0", "custom": true }\n');
    writeJson(join(targetDir, 'local.settings.json'), { Values: { Existing: 'keep' } });

    const result = await applyFunctionTemplate(targetDir, {
      manifestUrl: pathToFileURL(fixture.manifestPath).href,
      language: 'typescript',
      template: 'http-trigger-typescript-azd',
      runtimeVersion: '22',
      mode: 'add',
    });

    expect(result.filesWritten).toContain('src/functions/httpTrigger.ts');
    expect(result.skippedFiles).toEqual(expect.arrayContaining(['host.json', 'local.settings.json', 'package.json']));
    expect(readFileSync(join(targetDir, 'host.json'), 'utf-8')).toContain('"custom": true');
    expect(readFileSync(join(targetDir, 'local.settings.json'), 'utf-8')).toContain('Existing');
    expect(existsSync(join(targetDir, 'src', 'functions', 'httpTrigger.ts'))).toBe(true);
  });

  it('lets force overwrite project files in add mode', async () => {
    const fixture = createTemplateFixture();
    const targetDir = makeTempDir('af-skills-template-add-force-');
    writeFileSync(join(targetDir, 'host.json'), '{ "version": "2.0", "custom": true }\n');
    writeJson(join(targetDir, 'local.settings.json'), { Values: { Existing: 'replace' } });
    writeJson(join(targetDir, 'package.json'), { name: 'existing-project' });

    const result = await applyFunctionTemplate(targetDir, {
      manifestUrl: pathToFileURL(fixture.manifestPath).href,
      template: 'http-trigger-typescript-azd',
      mode: 'add',
      force: true,
    });

    expect(result.filesWritten).toEqual(expect.arrayContaining(['host.json', 'local.settings.json', 'package.json']));
    expect(result.skippedFiles).not.toEqual(expect.arrayContaining(['host.json', 'local.settings.json', 'package.json']));
    expect(readFileSync(join(targetDir, 'host.json'), 'utf-8')).not.toContain('"custom": true');
    expect(readFileSync(join(targetDir, 'local.settings.json'), 'utf-8')).not.toContain('Existing');
    expect(readFileSync(join(targetDir, 'package.json'), 'utf-8')).toContain('"node": "22"');
  });

  it('rejects add mode when a template would copy a nested full project', async () => {
    const fixture = createTemplateFixture();
    mkdirSync(join(fixture.sourceDir, 'nested'), { recursive: true });
    writeFileSync(join(fixture.sourceDir, 'nested', 'host.json'), '{ "version": "2.0" }\n');
    const targetDir = makeTempDir('af-skills-template-add-reject-');
    writeFileSync(join(targetDir, 'host.json'), '{ "version": "2.0" }\n');

    await expect(applyFunctionTemplate(targetDir, {
      manifestUrl: pathToFileURL(fixture.manifestPath).href,
      language: 'typescript',
      template: 'http-trigger-typescript-azd',
      mode: 'add',
    })).rejects.toThrow('nested full project');
  });

  it('rejects unsafe local folder paths from manifests', async () => {
    const fixture = createTemplateFixture();
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf-8')) as {
      templates: Array<{ folderPath: string }>;
    };
    manifest.templates[0].folderPath = '..';
    writeJson(fixture.manifestPath, manifest);

    await expect(listFunctionTemplates({
      manifestUrl: pathToFileURL(fixture.manifestPath).href,
      language: 'typescript',
    })).resolves.toHaveProperty('templates');
    await expect(applyFunctionTemplate(makeTempDir('af-skills-template-unsafe-'), {
      manifestUrl: pathToFileURL(fixture.manifestPath).href,
      language: 'typescript',
      template: 'http-trigger-typescript-azd',
    })).rejects.toThrow('Unsafe template folder path');
  });

  it('downloads GitHub template files recursively and retries contents API with env token only when needed', async () => {
    vi.stubEnv('GH_TOKEN', 'github-token-for-test');
    const manifest: TemplateManifest = {
      version: 'test',
      runtimeVersions: {
        TypeScript: { default: '22' },
      },
      templates: [{
        id: 'http-trigger-typescript-azd',
        displayName: 'HTTP Trigger (TypeScript + AZD + Bicep)',
        shortDescription: 'HTTP trigger for TypeScript',
        language: 'TypeScript',
        resource: 'http',
        iac: 'bicep',
        repositoryUrl: 'https://github.com/Azure/azure-functions-templates',
        folderPath: 'templates/http',
        gitRef: 'refs/heads/main',
      }],
    };
    const calls: Array<{ readonly url: string; readonly authorization?: string }> = [];
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get('authorization') ?? undefined });

      if (url === 'https://example.test/manifest.json') {
        return Response.json(manifest);
      }
      if (url === 'https://api.github.com/repos/Azure/azure-functions-templates/contents/templates/http?ref=main') {
        if (!headers.has('authorization')) {
          return new Response(JSON.stringify({ message: 'rate limited' }), {
            status: 403,
            statusText: 'Forbidden',
            headers: { 'x-ratelimit-remaining': '0' },
          });
        }
        return Response.json([
          {
            type: 'file',
            path: 'templates/http/host.json',
            download_url: 'https://raw.githubusercontent.com/Azure/azure-functions-templates/main/templates/http/host.json',
          },
          {
            type: 'dir',
            path: 'templates/http/src',
            download_url: null,
          },
        ]);
      }
      if (url === 'https://api.github.com/repos/Azure/azure-functions-templates/contents/templates/http/src?ref=main') {
        return Response.json([{
          type: 'file',
          path: 'templates/http/src/functions/httpTrigger.ts',
          download_url: 'https://raw.githubusercontent.com/Azure/azure-functions-templates/main/templates/http/src/functions/httpTrigger.ts',
        }]);
      }
      if (url.endsWith('/host.json')) {
        return new Response('{ "version": "2.0" }\n');
      }
      if (url.endsWith('/httpTrigger.ts')) {
        return new Response('export const nodeVersion = "{{nodeVersion}}";\n');
      }

      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const targetDir = makeTempDir('af-skills-template-github-');

    const result = await applyFunctionTemplate(targetDir, {
      manifestUrl: 'https://example.test/manifest.json',
      template: 'http-trigger-typescript-azd',
      mode: 'new',
    });

    expect(result.filesWritten).toEqual(['host.json', 'src/functions/httpTrigger.ts']);
    expect(readFileSync(join(targetDir, 'src', 'functions', 'httpTrigger.ts'), 'utf-8')).toContain('"22"');
    expect(calls).toContainEqual({
      url: 'https://api.github.com/repos/Azure/azure-functions-templates/contents/templates/http?ref=main',
      authorization: undefined,
    });
    expect(calls).toContainEqual({
      url: 'https://api.github.com/repos/Azure/azure-functions-templates/contents/templates/http?ref=main',
      authorization: 'Bearer github-token-for-test',
    });
    expect(calls.filter(call => call.url.startsWith('https://raw.githubusercontent.com/'))).toEqual([
      {
        url: 'https://raw.githubusercontent.com/Azure/azure-functions-templates/main/templates/http/host.json',
        authorization: undefined,
      },
      {
        url: 'https://raw.githubusercontent.com/Azure/azure-functions-templates/main/templates/http/src/functions/httpTrigger.ts',
        authorization: undefined,
      },
    ]);
  });

});

describe('template CLI', () => {
  it('documents language as an optional apply disambiguation hint', () => {
    const stdout = runCli(['template', 'apply', '--help']);

    expect(stdout).toContain('--language <name>');
    expect(stdout).toContain('Disambiguate');
    expect(stdout).not.toContain('Template language (required)');
  });

  it('lists templates from a manifest without printing template file contents', () => {
    const fixture = createTemplateFixture();

    const stdout = runCli([
      'template',
      'list',
      '--manifest-url',
      pathToFileURL(fixture.manifestPath).href,
      '--language',
      'typescript',
      '--resource',
      'http',
    ]);

    expect(stdout).toContain('http-trigger-typescript-azd');
    expect(stdout).not.toContain('export const nodeVersion');
  });

  it('applies templates end-to-end using CLI parameters', () => {
    const fixture = createTemplateFixture();
    const targetDir = makeTempDir('af-skills-template-cli-');

    const stdout = runCli([
      'template',
      'apply',
      '--manifest-url',
      pathToFileURL(fixture.manifestPath).href,
      '--dir',
      targetDir,
      '--template',
      'http-trigger-typescript-azd',
      '--runtime-version',
      '24',
    ]);

    expect(stdout).toContain('Template applied.');
    expect(readFileSync(join(targetDir, 'src', 'functions', 'httpTrigger.ts'), 'utf-8')).toContain('"24"');
  });

  it('prints add-mode dry-run as written and skipped files', () => {
    const fixture = createTemplateFixture();
    const targetDir = makeTempDir('af-skills-template-cli-dry-run-');
    writeFileSync(join(targetDir, 'host.json'), '{ "version": "2.0", "custom": true }\n');

    const stdout = runCli([
      'template',
      'apply',
      '--manifest-url',
      pathToFileURL(fixture.manifestPath).href,
      '--dir',
      targetDir,
      '--template',
      'http-trigger-typescript-azd',
      '--mode',
      'add',
      '--dry-run',
    ]);

    expect(stdout).toContain('Planned template apply:');
    expect(stdout).toContain('  + src/functions/httpTrigger.ts');
    expect(stdout).toContain('  - host.json (skipped)');
    expect(stdout).not.toContain('  + host.json');
  });
});
