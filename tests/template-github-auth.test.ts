import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir } from './helpers/fs.js';
import type { TemplateManifest } from '../src/templates/index.js';

const TEMP_DIRS: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => 'gh-cli-token-for-test\n'),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterAll(() => {
  for (const dir of TEMP_DIRS) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe('template GitHub authentication', () => {
  it('falls back to gh auth token when retrying GitHub contents without env tokens', async () => {
    vi.stubEnv('GH_TOKEN', '');
    vi.stubEnv('GITHUB_TOKEN', '');
    const { execFileSync } = await import('node:child_process');
    const { applyFunctionTemplate } = await import('../src/templates/index.js');
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
        gitRef: 'main',
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
          return new Response(JSON.stringify({ message: 'not found anonymously' }), {
            status: 404,
            statusText: 'Not Found',
          });
        }
        return Response.json([{
          type: 'file',
          path: 'templates/http/host.json',
          download_url: 'https://raw.githubusercontent.com/Azure/azure-functions-templates/main/templates/http/host.json',
        }]);
      }
      if (url.endsWith('/host.json')) {
        return new Response('{ "version": "2.0" }\n');
      }

      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const targetDir = makeTempDir('af-skills-template-github-gh-token-');

    const result = await applyFunctionTemplate(targetDir, {
      manifestUrl: 'https://example.test/manifest.json',
      template: 'http-trigger-typescript-azd',
      mode: 'new',
    });

    expect(execFileSync).toHaveBeenCalledWith('gh', ['auth', 'token'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(result.filesWritten).toEqual(['host.json']);
    expect(readFileSync(join(targetDir, 'host.json'), 'utf-8')).toContain('"version"');
    expect(calls).toContainEqual({
      url: 'https://api.github.com/repos/Azure/azure-functions-templates/contents/templates/http?ref=main',
      authorization: 'Bearer gh-cli-token-for-test',
    });
    expect(calls.filter(call => call.url.startsWith('https://raw.githubusercontent.com/'))).toEqual([{
      url: 'https://raw.githubusercontent.com/Azure/azure-functions-templates/main/templates/http/host.json',
      authorization: undefined,
    }]);
  });
});
