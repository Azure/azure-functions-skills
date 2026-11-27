import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { durationFlag, parseArgs } from '../src/tools/app/args.js';
import { AzureClient, type FetchLike } from '../src/tools/app/azure.js';
import { createTokenProvider } from '../src/tools/app/auth.js';
import { COMMANDS, runCli } from '../src/tools/app/cli.js';
import { isNoise } from '../src/tools/app/commands/read.js';
import { findDoc, parseDoc, searchDocs } from '../src/tools/app/docs.js';
import { findOperations, type ApiIndex } from '../src/tools/app/api.js';
import { detectPlan, summarizeApp, type Site } from '../src/tools/app/inspect.js';
import { EXIT, ToolError } from '../src/tools/app/output.js';
import { redactSettings, scrubText } from '../src/tools/app/redact.js';
import { resolveApp } from '../src/tools/app/target.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import { APP_ID, SUB, deps, envelope, fakeFetch, on, response, type Call } from './helpers/fake-azure.js';

const AI_ID = `/subscriptions/${SUB}/resourceGroups/rg-demo/providers/Microsoft.Insights/components/appi-demo`;
const IKEY = '11111111-2222-3333-4444-555555555555';
const TEMP_DIRS: string[] = [];

afterEach(() => {
  while (TEMP_DIRS.length) removeDir(TEMP_DIRS.pop() as string);
});

describe('args', () => {
  it('parses values, inline values, and boolean flags', () => {
    const args = parseArgs(['settings', 'list', '--app', 'x', '--top=3', '--lean'], new Set(['lean']));
    expect(args.positionals).toEqual(['settings', 'list']);
    expect(args.flags.get('app')).toBe('x');
    expect(args.flags.get('top')).toBe('3');
    expect(args.flags.get('lean')).toBe(true);
  });

  it('converts durations to ISO 8601 and rejects out-of-range values', () => {
    expect(durationFlag(parseArgs(['--since', '30m']), 'since', '1h').iso).toBe('PT30M');
    expect(durationFlag(parseArgs([]), 'since', '7d').iso).toBe('P7D');
    expect(() => durationFlag(parseArgs(['--since', '91d']), 'since', '1h')).toThrow(ToolError);
    expect(() => durationFlag(parseArgs(['--since', '1w']), 'since', '1h')).toThrow(/30m, 6h, or 7d/);
  });
});

describe('redaction', () => {
  it('shows Key Vault references and plain values but hides secrets by name or value', () => {
    const views = redactSettings({
      FUNCTIONS_WORKER_RUNTIME: 'python',
      MY_API_KEY: 'abc',
      DB: 'Server=x;Password=hunter2',
      AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountKey=zzz',
      SECRET_FROM_VAULT: '@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/s/)',
    });
    expect(Object.fromEntries(views.map(view => [view.name, view.source]))).toEqual({
      AzureWebJobsStorage: 'redacted',
      DB: 'redacted',
      FUNCTIONS_WORKER_RUNTIME: 'plain',
      MY_API_KEY: 'redacted',
      SECRET_FROM_VAULT: 'keyVaultReference',
    });
    expect(JSON.stringify(views)).not.toMatch(/hunter2|zzz|"abc"/);
  });

  it('scrubs bearer tokens and key fragments from text', () => {
    expect(scrubText('Bearer eyJ.abc AccountKey=k1; https://x?sv=1&sig=s1')).toBe('Bearer <redacted> AccountKey=<redacted>; https://x?sv=1&sig=<redacted>');
  });
});

describe('AzureClient', () => {
  it('retries reads on 429 using Retry-After, but never retries writes', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const fetch: FetchLike = async () => (++attempts < 3 ? response(429, {}, { 'retry-after': '2' }) : response(200, { ok: true }));
    const client = new AzureClient({ fetch, getToken: async () => 't', sleep: async ms => void sleeps.push(ms) });
    await expect(client.arm('GET', APP_ID, '2024-11-01')).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([2000, 2000]);

    attempts = 0;
    await expect(client.arm('PUT', APP_ID, '2024-11-01', { body: {} })).rejects.toMatchObject({ exitCode: EXIT.azure, httpStatus: 429 });
    expect(attempts).toBe(1);
  });

  it('maps 403 to exit 4 with an RBAC fix and never echoes the token', async () => {
    const client = new AzureClient({ fetch: fakeFetch([on('GET', 'sites', { error: { code: 'AuthorizationFailed', message: 'no access' } }, 403)]), getToken: async () => 'secret-token', sleep: async () => undefined });
    const error = await client.arm('GET', APP_ID, '2024-11-01').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ exitCode: EXIT.azure, azureCode: 'AuthorizationFailed' });
    expect((error as ToolError).options.findings?.[0].code).toBe('Forbidden');
    expect(JSON.stringify(error)).not.toContain('secret-token');
  });
});

describe('createTokenProvider', () => {
  it('falls back to azd when az fails and caches per resource', async () => {
    const commands: string[] = [];
    const provider = createTokenProvider(async command => {
      commands.push(command);
      return command === 'az' ? { ok: false, stdout: '' } : { ok: true, stdout: JSON.stringify({ token: 'from-azd' }) };
    });
    expect(await provider('https://management.azure.com')).toBe('from-azd');
    expect(await provider('https://management.azure.com')).toBe('from-azd');
    expect(commands).toEqual(['az', 'azd']);
  });

  it('fails with a pre-check error when neither tool is signed in', async () => {
    const provider = createTokenProvider(async () => ({ ok: false, stdout: '' }));
    await expect(provider('https://management.azure.com')).rejects.toMatchObject({ exitCode: EXIT.precheck });
  });
});

describe('resolveApp', () => {
  const client = (rows: unknown[], calls: Call[] = []): AzureClient =>
    new AzureClient({ fetch: fakeFetch([on('POST', 'Microsoft.ResourceGraph', { data: rows })], calls), getToken: async () => 't', sleep: async () => undefined });

  it('uses a resource ID directly without querying Resource Graph', async () => {
    const calls: Call[] = [];
    await expect(resolveApp(client([], calls), { app: APP_ID })).resolves.toMatchObject({ name: 'func-demo', resourceGroup: 'rg-demo', subscriptionId: SUB });
    expect(calls).toHaveLength(0);
  });

  it('rejects names that could inject into the Resource Graph query', async () => {
    await expect(resolveApp(client([]), { app: "x' or 1==1" })).rejects.toMatchObject({ exitCode: EXIT.usage });
  });

  it('asks for a narrower scope when a name is ambiguous', async () => {
    const rows = [
      { id: APP_ID, name: 'func-demo', resourceGroup: 'rg-demo', subscriptionId: SUB },
      { id: APP_ID.replace('rg-demo', 'rg-other'), name: 'func-demo', resourceGroup: 'rg-other', subscriptionId: SUB },
    ];
    await expect(resolveApp(client(rows), { app: 'func-demo' })).rejects.toMatchObject({ exitCode: EXIT.usage, message: expect.stringMatching(/2 apps/) });
  });
});

describe('docs', () => {
  const markdown = ['# Inspection', 'intro', '## 7. Logs (Application Insights)', 'Query logs.', '```bash', '# GET not a heading', '```', '## Output', 'Report it.'].join('\n');

  it('splits ## sections, ignores headings in code fences, and builds stable IDs', () => {
    const doc = parseDoc('inspection', markdown);
    expect(doc.title).toBe('Inspection');
    expect(doc.sections.map(section => section.id)).toEqual(['inspection/logs-application-insights', 'inspection/output']);
    expect(doc.sections[0].content).toContain('# GET not a heading');
  });

  it('finds sections by ID and ranks search hits by title matches', () => {
    const docs = [parseDoc('inspection', markdown)];
    expect(findDoc(docs, 'inspection/output')?.title).toBe('Output');
    expect(searchDocs(docs, 'application insights logs', 5)[0].id).toBe('inspection/logs-application-insights');
  });
});

describe('findOperations', () => {
  const index: ApiIndex = {
    schemaVersion: 1,
    sources: [],
    operations: [
      { id: 'WebApps_ListApplicationSettings', method: 'POST', path: '/subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{name}/config/appsettings/list', apiVersion: '2024-11-01', summary: 'Gets the application settings of an app.' },
      { id: 'WebApps_UpdateAuthSettingsV2', method: 'PUT', path: '/subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{name}/config/authsettingsV2', apiVersion: '2024-11-01', summary: 'Updates site\'s Authentication / Authorization settings.' },
      { id: 'WebApps_GetAuthSettingsV2', method: 'GET', path: '/subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{name}/config/authsettingsV2/list', apiVersion: '2024-11-01', summary: 'Gets site\'s Authentication / Authorization settings.' },
    ],
  };

  it('ranks operations by ID words and filters by method', () => {
    expect(findOperations(index, 'application settings', { limit: 3 })[0].id).toBe('WebApps_ListApplicationSettings');
    expect(findOperations(index, 'auth settings v2', { method: 'put', limit: 3 }).map(hit => hit.id)).toEqual(['WebApps_UpdateAuthSettingsV2']);
  });

  it('maps portal words to API terms without diluting coverage', () => {
    expect(findOperations(index, 'update easy auth', { method: 'put', limit: 3 }).map(hit => hit.id)).toEqual(['WebApps_UpdateAuthSettingsV2']);
  });
});

describe('isNoise', () => {
  it('treats policy evaluations and list actions as reads', () => {
    expect(isNoise('Microsoft.Authorization/policies/auditIfNotExists/action')).toBe(true);
    expect(isNoise('Microsoft.Web/sites/host/listkeys/action')).toBe(true);
    expect(isNoise('Microsoft.Web/sites/write')).toBe(false);
    expect(isNoise('Microsoft.Web/sites/restart/action')).toBe(false);
  });
});

describe('summarizeApp', () => {
  const site = (properties: Partial<Site['properties']>): Site => ({ id: APP_ID, name: 'func-demo', location: 'eastus', properties: { state: 'Running', httpsOnly: true, ...properties } });

  it('detects hosting plans', () => {
    expect(detectPlan(site({ functionAppConfig: {} }))).toBe('FlexConsumption');
    expect(detectPlan(site({}), { name: 'p', sku: { tier: 'Dynamic' } })).toBe('Consumption');
    expect(detectPlan(site({}), { name: 'p', sku: { tier: 'ElasticPremium' } })).toBe('Premium');
    expect(detectPlan(site({ managedEnvironmentId: '/x' }))).toBe('ContainerApps');
    expect(detectPlan(site({}), { name: 'p', sku: { tier: 'Standard' } })).toBe('Dedicated');
  });

  it('flags Flex-incompatible settings, key-based storage, and weak transport security', () => {
    const { data, findings } = summarizeApp(
      site({ functionAppConfig: { runtime: { name: 'python', version: '3.12' } }, httpsOnly: false }),
      { properties: { minTlsVersion: '1.0', ftpsState: 'AllAllowed' } },
      undefined,
      { FUNCTIONS_WORKER_RUNTIME: 'python', AzureWebJobsStorage: 'x', APPLICATIONINSIGHTS_CONNECTION_STRING: 'y' },
    );
    expect(data).toMatchObject({ hostingPlan: 'FlexConsumption', runtime: { stack: 'python', version: '3.12' }, hostStorage: 'connectionString' });
    expect(findings.map(finding => finding.code).sort()).toEqual(['FlexUnsupportedSetting', 'FtpAllowed', 'HttpsNotEnforced', 'StorageKeyAuth', 'WeakTls']);
  });
});

describe('runCli', () => {
  it('returns exit 3 with REST fallback guidance for unknown commands', async () => {
    const result = await runCli(['backup', 'create', '--app', 'x'], deps(fakeFetch([])));
    expect(result.exitCode).toBe(EXIT.unsupported);
    expect(envelope(result.output).status).toBe('unsupported');
    expect(envelope(result.output).next.join(' ')).toMatch(/docs search.*api find/);
  });

  it('returns exit 2 when a required flag is missing', async () => {
    const result = await runCli(['settings', 'list'], deps(fakeFetch([])));
    expect(result.exitCode).toBe(EXIT.usage);
    expect(envelope(result.output).summary).toMatch(/--app/);
  });

  it('lists settings with secrets redacted and reports unresolved Key Vault references', async () => {
    const fetch = fakeFetch([
      on('POST', '/config/appsettings/list', { properties: { API_KEY: 'plain-secret', REF: '@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/a/)', MODE: 'prod' } }),
      on('POST', '/config/connectionstrings/list', { properties: { Db: { value: 'Server=x;Password=p', type: 'SQLAzure' } } }),
      on('GET', '/config/configreferences/appsettings', { value: [{ name: 'func-demo/REF', properties: { status: 'AccessToKeyVaultDenied', details: 'Forbidden' } }] }),
    ]);
    const result = await runCli(['settings', 'list', '--app', APP_ID], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const text = JSON.stringify(result.output);
    expect(text).not.toMatch(/plain-secret|Password=p/);
    expect(envelope(result.output).findings.map(finding => finding.code)).toEqual(['KeyVaultReferenceUnresolved']);
  });

  it('prints only data with --lean', async () => {
    const fetch = fakeFetch([on('GET', '/functions', { value: [{ name: 'func-demo/hello', properties: { config: { bindings: [{ type: 'httpTrigger', route: 'hello', methods: ['get'] }] } } }] })]);
    const result = await runCli(['functions', 'list', '--app', APP_ID, '--lean'], deps(fetch));
    expect(result.output).toEqual([{ name: 'hello', trigger: 'httpTrigger', route: 'hello', methods: ['get'], isDisabled: false }]);
  });

  it('locates Application Insights from the instrumentation key and filters presets by role name', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      [
        on('POST', '/config/appsettings/list', { properties: { APPLICATIONINSIGHTS_CONNECTION_STRING: `InstrumentationKey=${IKEY};IngestionEndpoint=https://x` } }),
        on('POST', 'Microsoft.ResourceGraph', { data: [{ id: AI_ID, name: 'appi-demo', resourceGroup: 'rg-demo', subscriptionId: SUB }] }),
        on('POST', 'api.loganalytics.io', { tables: [{ columns: [{ name: 'message', type: 'string' }], rows: [['boom']] }] }),
      ],
      calls,
    );
    const result = await runCli(['logs', 'query', '--app', APP_ID, '--preset', 'traces', '--since', '2h'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const query = calls.find(call => call.url.includes('api.loganalytics.io'));
    expect(query?.url).toBe(`https://api.loganalytics.io/v1${AI_ID}/query`);
    expect(query?.body).toMatchObject({ timespan: 'PT2H', query: expect.stringContaining("cloud_RoleName =~ 'func-demo'") });
    expect(JSON.stringify(result.output)).not.toContain(IKEY);
  });

  it('serves docs from the references folder', async () => {
    const dir = createTempDir('app-tool-docs-');
    TEMP_DIRS.push(dir);
    mkdirSync(join(dir, 'core'));
    writeFileSync(join(dir, 'core', 'ARM-CORE.md'), '# ARM Core\n## Long-running operations\nPoll Azure-AsyncOperation.\n');
    const search = await runCli(['docs', 'search', 'long', 'running'], deps(fakeFetch([]), { referencesDir: dir }));
    expect(envelope(search.output).data).toMatchObject({ recipes: [{ id: 'core/arm-core/long-running-operations' }] });
    const get = await runCli(['docs', 'get', 'core/arm-core/long-running-operations'], deps(fakeFetch([]), { referencesDir: dir }));
    expect(JSON.stringify(get.output)).toContain('Poll Azure-AsyncOperation.');
  });
});

describe('SKILL.md command table', () => {
  it('documents every tool command', () => {
    const skill = readFileSync(join('templates', 'skills', 'azure-functions-app', 'SKILL.md'), 'utf8');
    const missing = COMMANDS.map(command => command.name).filter(name => !skill.includes(`| \`${name}`));
    expect(missing).toEqual([]);
  });
});
