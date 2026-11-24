import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TemplateManifest } from '../src/templates/index.js';
import { writeTemplate } from '../src/tools/template/write.js';
import { EXIT } from '../src/tools/shared/output.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];
const MANIFEST_URL = 'https://example.test/manifest.json';
const CONTENTS = 'https://api.github.com/repos/Azure-Samples/quickstart/contents';
const RAW = 'https://raw.githubusercontent.com/Azure-Samples/quickstart/main';

const MANIFEST: TemplateManifest = {
  runtimeVersions: { Python: { default: '3.12' } },
  templates: [{
    id: 'http-trigger-python-azd', displayName: 'HTTP', shortDescription: 'HTTP trigger', language: 'Python',
    resource: 'http', iac: 'bicep', priority: 0,
    repositoryUrl: 'https://github.com/Azure-Samples/quickstart', folderPath: '.', gitRef: 'main',
  }],
};

function file(path: string): { type: 'file'; path: string; download_url: string } {
  return { type: 'file', path, download_url: `${RAW}/${path}` };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(() => {
  for (const dir of TEMP_DIRS) removeDir(dir);
});

describe('template download from GitHub', () => {
  it('reads the manifest once and downloads the files in parallel', async () => {
    vi.stubEnv('GH_TOKEN', 'test-token');
    const counts = new Map<string, number>();
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = input.toString();
      counts.set(url, (counts.get(url) ?? 0) + 1);
      if (url === MANIFEST_URL) return Response.json(MANIFEST);
      if (url === `${CONTENTS}/?ref=main`) {
        return Response.json([file('host.json'), file('function_app.py'), { type: 'dir', path: 'infra', download_url: null }]);
      }
      if (url === `${CONTENTS}/infra?ref=main`) return Response.json([file('infra/main.bicep'), file('infra/app.bicep')]);
      if (url.startsWith(RAW)) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => { setTimeout(resolve, 20); });
        inFlight--;
        return new Response(`# ${url.slice(RAW.length + 1)} {{pythonVersion}}\n`);
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }));
    const dir = createTempDir('af-template-download-');
    TEMP_DIRS.push(dir);

    const written = await writeTemplate({ dir, template: 'http-trigger-python-azd', dryRun: false },
      { manifestUrls: [MANIFEST_URL] });

    expect(written.exitCode).toBe(EXIT.ok);
    expect(written.body.data.written).toEqual(['function_app.py', 'host.json', 'infra/app.bicep', 'infra/main.bicep']);
    expect(counts.get(MANIFEST_URL)).toBe(1);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(readFileSync(join(dir, 'infra', 'app.bicep'), 'utf-8')).toBe('# infra/app.bicep 3.12\n');
  });
});
