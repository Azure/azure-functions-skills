import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/tools/app/cli.js';
import { LEARN_INDEX_FILE, type LearnIndex, searchLearn } from '../src/tools/app/learn.js';
import { EXIT } from '../src/tools/app/output.js';
import { type Call, deps, envelope, fakeFetch, on } from './helpers/fake-azure.js';

const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const INDEX: LearnIndex = {
  schemaVersion: 1,
  source: { repository: 'MicrosoftDocs/azure-docs', commit: 'abc123', generatedAt: '2026-01-01T00:00:00Z', license: 'CC-BY-4.0', attribution: 'Microsoft Learn' },
  articles: [
    {
      id: 'flex-consumption-plan',
      title: 'Azure Functions Flex Consumption plan hosting',
      url: 'https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan',
      date: '01/02/2026',
      sections: [
        { id: 'flex-consumption-plan-hosting', title: 'Flex Consumption plan hosting', text: 'Flex Consumption is a Linux-based serverless hosting plan.' },
        { id: 'virtual-network-integration', title: 'Virtual network integration', text: 'Flex Consumption supports virtual network integration with a subnet delegated to Microsoft.App/environments. The subnet must be /27 or larger.' },
      ],
    },
    {
      id: 'functions-bindings-http-webhook-trigger',
      title: 'Azure Functions HTTP trigger',
      url: 'https://learn.microsoft.com/azure/azure-functions/functions-bindings-http-webhook-trigger',
      sections: [
        { id: 'example', title: 'Example', text: 'C# HTTP trigger example with HttpRequestData.', pivots: ['programming-language-csharp'] },
        { id: 'example-2', title: 'Example', text: 'Python HTTP trigger example with func.HttpRequest.', pivots: ['programming-language-python'] },
        { id: 'authorization-level', title: 'Authorization level', text: 'The HTTP trigger authorization level decides which keys are required.' },
      ],
    },
    {
      id: 'functions-networking-options',
      title: 'Azure Functions networking options',
      url: 'https://learn.microsoft.com/azure/azure-functions/functions-networking-options',
      sections: [
        { id: 'premium-subnet', title: 'Subnets', text: 'Premium plan virtual network integration needs a subnet delegated to Microsoft.Web/serverFarms.', pivots: ['premium-plan', 'dedicated-plan'] },
        { id: 'flex-subnet', title: 'Subnets', text: 'Flex Consumption virtual network integration needs a subnet delegated to Microsoft.App/environments.', pivots: ['flex-consumption-plan'] },
      ],
    },
  ],
};

function workspace(index: LearnIndex | null = INDEX): { referencesDir: string; assetsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'learn-'));
  DIRS.push(root);
  const referencesDir = join(root, 'references');
  const assetsDir = join(root, 'assets');
  mkdirSync(referencesDir);
  mkdirSync(assetsDir);
  writeFileSync(join(referencesDir, 'networking.md'), '# Networking recipes\n\n## 4. VNet integration\nRun `vnet integrate` to connect the app to a subnet.\n');
  if (index) writeFileSync(join(assetsDir, LEARN_INDEX_FILE), gzipSync(JSON.stringify(index)));
  return { referencesDir, assetsDir };
}

interface SearchData {
  recipes: { id: string }[];
  learn: { id: string; title: string; url: string; pivots?: string[] }[];
}

describe('docs search with the Learn layer', () => {
  it('returns recipes and Learn sections with section URLs', async () => {
    const result = await runCli(['docs', 'search', 'vnet', 'integration', 'subnet'], deps(fakeFetch([]), workspace()));
    expect(result.exitCode).toBe(EXIT.ok);
    const data = envelope(result.output).data as SearchData;
    expect(data.recipes[0].id).toBe('networking/vnet-integration');
    expect(data.learn[0]).toMatchObject({ id: 'learn:flex-consumption-plan#virtual-network-integration', url: 'https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan#virtual-network-integration' });
  });

  it('filters pivoted sections by language and plan, keeping shared sections', async () => {
    const byLang = await runCli(['docs', 'search', 'http', 'trigger', 'example', '--layer', 'learn', '--lang', 'python'], deps(fakeFetch([]), workspace()));
    const ids = (envelope(byLang.output).data as SearchData).learn.map(hit => hit.id);
    expect(ids).toContain('learn:functions-bindings-http-webhook-trigger#example-2');
    expect(ids).toContain('learn:functions-bindings-http-webhook-trigger#authorization-level');
    expect(ids).not.toContain('learn:functions-bindings-http-webhook-trigger#example');

    const byPlan = await runCli(['docs', 'search', 'subnet', 'delegated', '--layer', 'learn', '--plan', 'flex'], deps(fakeFetch([]), workspace()));
    const planIds = (envelope(byPlan.output).data as SearchData).learn.map(hit => hit.id);
    expect(planIds).toContain('learn:functions-networking-options#flex-subnet');
    expect(planIds).not.toContain('learn:functions-networking-options#premium-subnet');
  });

  it('rejects unknown layers', async () => {
    const result = await runCli(['docs', 'search', 'x', '--layer', 'web'], deps(fakeFetch([]), workspace()));
    expect(result.exitCode).toBe(EXIT.usage);
  });

  it('asks the online Learn search only when nothing matches locally', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      [on('GET', 'learn.microsoft.com/api/search', { results: [
        { title: 'Quotas', url: 'https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale', description: 'Limits' },
        { title: 'Other service', url: 'https://learn.microsoft.com/en-us/azure/storage/x', description: 'No' },
      ] })],
      calls,
    );
    const result = await runCli(['docs', 'search', 'zzqx', '--layer', 'learn'], deps(fetch, workspace()));
    const output = envelope(result.output);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('search=zzqx');
    expect((output.data as SearchData).learn).toEqual([expect.objectContaining({ title: 'Quotas', url: 'https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale', online: true })]);

    const local = await runCli(['docs', 'search', 'flex'], deps(fetch, workspace()));
    expect(local.exitCode).toBe(EXIT.ok);
    expect(calls).toHaveLength(1);
  });

  it('still searches recipes when the Learn index is missing', async () => {
    const result = await runCli(['docs', 'search', 'vnet'], deps(fakeFetch([]), workspace(null)));
    const output = envelope(result.output);
    expect((output.data as SearchData).recipes).toHaveLength(1);
    expect(output.findings.map(finding => finding.code)).toContain('LearnIndexMissing');
  });
});

describe('docs get for Learn IDs', () => {
  it('returns a section with its URL and attribution', async () => {
    const result = await runCli(['docs', 'get', 'learn:flex-consumption-plan#virtual-network-integration'], deps(fakeFetch([]), workspace()));
    expect(envelope(result.output).data).toMatchObject({
      id: 'learn:flex-consumption-plan#virtual-network-integration',
      url: 'https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan#virtual-network-integration',
      content: expect.stringContaining('/27'),
      source: { license: 'CC-BY-4.0', commit: 'abc123' },
    });
  });

  it('returns an article outline with section IDs when the article is requested', async () => {
    const result = await runCli(['docs', 'get', 'learn:functions-bindings-http-webhook-trigger'], deps(fakeFetch([]), workspace()));
    expect(envelope(result.output).data).toMatchObject({
      title: 'Azure Functions HTTP trigger',
      sections: [
        { id: 'learn:functions-bindings-http-webhook-trigger#example', pivots: ['programming-language-csharp'] },
        { id: 'learn:functions-bindings-http-webhook-trigger#example-2' },
        { id: 'learn:functions-bindings-http-webhook-trigger#authorization-level' },
      ],
    });
  });

  it('suggests IDs for an unknown Learn ID', async () => {
    const result = await runCli(['docs', 'get', 'learn:flex-consumption-plan#nope'], deps(fakeFetch([]), workspace()));
    expect(result.exitCode).toBe(EXIT.usage);
  });
});

describe('searchLearn ranking', () => {
  it('prefers a section whose title matches over boilerplate body mentions', () => {
    const filler = 'Configure triggers, bindings, hosting, and deployment for your function app. '.repeat(60);
    const intro = (name: string): LearnIndex['articles'][number] => ({
      id: `functions-bindings-${name}`,
      title: `Azure ${name} binding for Azure Functions`,
      url: `https://learn.microsoft.com/azure/azure-functions/functions-bindings-${name}`,
      sections: [{ id: name, title: `Azure ${name} binding`, text: 'This article supports the Python v2 programming model and Node.js v4.' }],
    });
    const index: LearnIndex = {
      ...INDEX,
      articles: [
        intro('blob'), intro('queue'), intro('table'),
        {
          id: 'functions-reference-python',
          title: 'Python developer reference for Azure Functions',
          url: 'https://learn.microsoft.com/azure/azure-functions/functions-reference-python',
          sections: [{ id: 'programming-model', title: 'Programming model', text: `The v2 model uses decorators. ${filler}` }],
        },
      ],
    };
    const hits = searchLearn(index, 'python v2 programming model', {}, 3);
    expect(hits[0].id).toBe('learn:functions-reference-python#programming-model');
  });
});
