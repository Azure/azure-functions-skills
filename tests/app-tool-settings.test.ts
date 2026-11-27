import { describe, expect, it } from 'vitest';
import { runCli } from '../src/tools/app/cli.js';
import { EXIT } from '../src/tools/app/output.js';
import { APP_ID, deps, envelope, fakeFetch, on, sequence, type Call } from './helpers/fake-azure.js';

const PREMIUM_SITE = { id: APP_ID, name: 'func-demo', location: 'japaneast', properties: { serverFarmId: '/subscriptions/x/resourceGroups/rg-demo/providers/Microsoft.Web/serverfarms/plan' } };
const PREMIUM_PLAN = { name: 'plan', sku: { name: 'EP1', tier: 'ElasticPremium' } };
const FLEX_SITE = { id: APP_ID, name: 'func-demo', location: 'japaneast', properties: { functionAppConfig: { runtime: { name: 'python' } } } };
const EXISTING = { AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=a;AccountKey=TOPSECRET', MODE: 'blue' };

function siteRoutes(site: unknown = PREMIUM_SITE): ReturnType<typeof on>[] {
  return [on('GET', 'func-demo?api-version', site), on('GET', '/serverfarms/plan', PREMIUM_PLAN)];
}

function puts(calls: Call[], fragment: string): Call[] {
  return calls.filter(call => call.method === 'PUT' && call.url.includes(fragment));
}

describe('settings set', () => {
  it('returns an R1 plan for a new setting without writing anything', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch([...siteRoutes(), on('POST', '/config/appsettings/list', { properties: EXISTING })], calls);
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--name', 'FEATURE_X', '--value', 'on'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.approval);
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(0);
    const data = envelope(result.output).data as { risk: string; changes: { name: string; action: string; value: string }[] };
    expect(data.risk).toBe('R1');
    expect(data.changes).toEqual([{ name: 'FEATURE_X', action: 'add', value: 'on' }]);
    expect(JSON.stringify(result.output)).not.toContain('TOPSECRET');
  });

  it('merges into the full collection, keeps secrets it never prints, and verifies the read-back', async () => {
    const calls: Call[] = [];
    const after = { ...EXISTING, FEATURE_X: 'on' };
    const fetch = fakeFetch([
      ...siteRoutes(),
      sequence('POST', '/config/appsettings/list', [{ status: 200, body: { properties: EXISTING } }, { status: 200, body: { properties: after } }]),
      on('PUT', '/config/appsettings', { properties: after }),
    ], calls);
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--name', 'FEATURE_X', '--value', 'on', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(puts(calls, '/config/appsettings')[0].body).toEqual({ properties: after });
    expect((envelope(result.output).data as { verified: boolean }).verified).toBe(true);
    expect(JSON.stringify(result.output)).not.toContain('TOPSECRET');
  });

  it('treats replacing an existing value as R2 and never prints a secret from --value-file', async () => {
    const fetch = fakeFetch([...siteRoutes(), on('POST', '/config/appsettings/list', { properties: EXISTING })]);
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--name', 'AzureWebJobsStorage', '--value-file', '-'], deps(fetch, { readInput: async () => 'AccountKey=NEWSECRET\n' }));
    expect(result.exitCode).toBe(EXIT.approval);
    expect((envelope(result.output).data as { risk: string }).risk).toBe('R2');
    expect(JSON.stringify(result.output)).not.toContain('NEWSECRET');
  });

  it('does nothing when the value is already set', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch([...siteRoutes(), on('POST', '/config/appsettings/list', { properties: EXISTING })], calls);
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--set', 'MODE=blue', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(0);
  });

  it('marks new settings as slot settings with --sticky and keeps the existing sticky names', async () => {
    const calls: Call[] = [];
    const after = { ...EXISTING, FEATURE_X: 'on' };
    const fetch = fakeFetch([
      ...siteRoutes(),
      on('GET', '/slots/staging?api-version', { ...PREMIUM_SITE, id: `${APP_ID}/slots/staging`, name: 'func-demo/staging' }),
      sequence('POST', '/config/appsettings/list', [{ status: 200, body: { properties: EXISTING } }, { status: 200, body: { properties: after } }]),
      on('PUT', '/config/appsettings', { properties: after }),
      sequence('GET', '/config/slotConfigNames', [{ status: 200, body: { properties: { appSettingNames: ['MODE'], connectionStringNames: null } } }, { status: 200, body: { properties: { appSettingNames: ['MODE'], connectionStringNames: null } } }, { status: 200, body: { properties: { appSettingNames: ['MODE', 'FEATURE_X'], connectionStringNames: [] } } }]),
      on('PUT', '/config/slotConfigNames', {}),
    ], calls);
    const unapproved = await runCli(['settings', 'set', '--app', APP_ID, '--slot', 'staging', '--name', 'FEATURE_X', '--value', 'on', '--sticky'], deps(fetch));
    expect(unapproved.exitCode).toBe(EXIT.approval);
    expect(JSON.stringify(envelope(unapproved.output).data)).toContain('slotConfigNames');
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--slot', 'staging', '--name', 'FEATURE_X', '--value', 'on', '--sticky', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const sticky = puts(calls, '/config/slotConfigNames');
    expect(sticky).toHaveLength(1);
    expect(sticky[0].url).toContain('/sites/func-demo/config/slotConfigNames');
    expect(sticky[0].body).toEqual({ properties: { appSettingNames: ['MODE', 'FEATURE_X'], connectionStringNames: [] } });
    expect(envelope(result.output).data).toMatchObject({ verified: true, sticky: ['FEATURE_X'] });
  });

  it('makes an unchanged setting sticky without rewriting the settings', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch([
      ...siteRoutes(),
      on('POST', '/config/appsettings/list', { properties: EXISTING }),
      sequence('GET', '/config/slotConfigNames', [{ status: 200, body: { properties: { appSettingNames: [] } } }, { status: 200, body: { properties: { appSettingNames: [] } } }, { status: 200, body: { properties: { appSettingNames: ['MODE'] } } }]),
      on('PUT', '/config/slotConfigNames', {}),
    ], calls);
    const unapproved = await runCli(['settings', 'set', '--app', APP_ID, '--set', 'MODE=blue', '--sticky'], deps(fetch));
    expect(unapproved.exitCode).toBe(EXIT.approval);
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--set', 'MODE=blue', '--sticky', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(puts(calls, '/config/appsettings')).toHaveLength(0);
    expect(puts(calls, '/config/slotConfigNames')).toHaveLength(1);
  });


  it('blocks settings that Flex Consumption does not use', async () => {
    const fetch = fakeFetch([...siteRoutes(FLEX_SITE), on('POST', '/config/appsettings/list', { properties: {} })]);
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--set', 'WEBSITE_RUN_FROM_PACKAGE=1'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.precheck);
    expect(envelope(result.output).findings.map(finding => finding.code)).toContain('FlexUnsupportedSetting');
  });

  it('checks that a new Key Vault reference resolves', async () => {
    const ref = '@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/db)';
    const after = { ...EXISTING, DB: ref };
    const fetch = fakeFetch([
      ...siteRoutes(),
      sequence('POST', '/config/appsettings/list', [{ status: 200, body: { properties: EXISTING } }, { status: 200, body: { properties: after } }]),
      on('PUT', '/config/appsettings', { properties: after }),
      on('GET', '/config/configreferences/appsettings/DB', { name: 'DB', properties: { status: 'AccessToKeyVaultDenied', details: 'Forbidden' } }),
    ]);
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--name', 'DB', '--value', ref, '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(envelope(result.output).findings.map(finding => finding.code)).toContain('KeyVaultReferenceUnresolved');
  });

  it('reports a resolved Key Vault reference so no extra check is needed', async () => {
    const ref = '@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/db)';
    const after = { ...EXISTING, DB: ref };
    const fetch = fakeFetch([
      ...siteRoutes(),
      sequence('POST', '/config/appsettings/list', [{ status: 200, body: { properties: EXISTING } }, { status: 200, body: { properties: after } }]),
      on('PUT', '/config/appsettings', { properties: after }),
      on('GET', '/config/configreferences/appsettings/DB', { name: 'DB', properties: { status: 'Resolved' } }),
    ]);
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--name', 'DB', '--value', ref, '--approve'], deps(fetch));
    const output = envelope(result.output);
    expect(output.data).toMatchObject({ keyVaultReferences: [{ name: 'DB', status: 'Resolved' }] });
    expect(output.summary).toContain('Key Vault reference resolved');
  });

  it('writes connection strings with their type and targets a slot', async () => {
    const calls: Call[] = [];
    const before = { Existing: { value: 'Server=x;Password=OLDPASS', type: 'SQLAzure' } };
    const after = { ...before, Cache: { value: 'redis:6380', type: 'RedisCache' } };
    const fetch = fakeFetch([
      on('GET', 'slots/staging?api-version', PREMIUM_SITE),
      on('GET', '/serverfarms/plan', PREMIUM_PLAN),
      sequence('POST', '/config/connectionstrings/list', [{ status: 200, body: { properties: before } }, { status: 200, body: { properties: after } }]),
      on('PUT', '/config/connectionstrings', { properties: after }),
    ], calls);
    const result = await runCli(['settings', 'set', '--app', APP_ID, '--slot', 'staging', '--connection-string', '--type', 'RedisCache', '--name', 'Cache', '--value', 'redis:6380', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const put = puts(calls, '/config/connectionstrings')[0];
    expect(put.url).toContain('/slots/staging/config/connectionstrings');
    expect(put.body).toEqual({ properties: after });
    expect(JSON.stringify(result.output)).not.toContain('OLDPASS');
  });
});

describe('settings delete', () => {
  it('removes only the named setting as R2 and verifies it is gone', async () => {
    const calls: Call[] = [];
    const after = { AzureWebJobsStorage: EXISTING.AzureWebJobsStorage };
    const fetch = fakeFetch([
      ...siteRoutes(),
      sequence('POST', '/config/appsettings/list', [{ status: 200, body: { properties: EXISTING } }, { status: 200, body: { properties: EXISTING } }, { status: 200, body: { properties: after } }]),
      on('PUT', '/config/appsettings', { properties: after }),
    ], calls);
    const plan = await runCli(['settings', 'delete', '--app', APP_ID, '--name', 'MODE'], deps(fetch));
    expect(plan.exitCode).toBe(EXIT.approval);
    expect((envelope(plan.output).data as { risk: string }).risk).toBe('R2');
    const result = await runCli(['settings', 'delete', '--app', APP_ID, '--name', 'MODE', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(puts(calls, '/config/appsettings')[0].body).toEqual({ properties: after });
    expect((envelope(result.output).data as { verified: boolean }).verified).toBe(true);
  });
});

describe('settings list', () => {
  it('marks slot (sticky) settings', async () => {
    const fetch = fakeFetch([
      on('POST', '/config/appsettings/list', { properties: { MODE: 'blue', OTHER: 'x' } }),
      on('POST', '/config/connectionstrings/list', { properties: {} }),
      on('GET', '/config/slotConfigNames', { properties: { appSettingNames: ['MODE'] } }),
    ]);
    const result = await runCli(['settings', 'list', '--app', APP_ID], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const data = envelope(result.output).data as { appSettings: { name: string; sticky?: boolean }[] };
    expect(data.appSettings.find(item => item.name === 'MODE')?.sticky).toBe(true);
    expect(data.appSettings.find(item => item.name === 'OTHER')?.sticky).toBeUndefined();
  });
});