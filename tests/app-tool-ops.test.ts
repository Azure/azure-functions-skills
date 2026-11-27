import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFlag, parseArgs } from '../src/tools/app/args.js';
import { runCli } from '../src/tools/app/cli.js';
import { findFreePrefix } from '../src/tools/app/commands/network.js';
import { EXIT } from '../src/tools/app/output.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import { APP_ID, SUB, deps, envelope, fakeFetch, on, sequence, type Call } from './helpers/fake-azure.js';

const TEMP_DIRS: string[] = [];
afterEach(() => {
  while (TEMP_DIRS.length) removeDir(TEMP_DIRS.pop() as string);
});

function referencesWithIndex(): string {
  const dir = createTempDir('app-tool-ops-');
  TEMP_DIRS.push(dir);
  writeFileSync(
    join(dir, 'api-index.json'),
    JSON.stringify({
      schemaVersion: 1,
      sources: [],
      operations: [
        { id: 'WebApps_Get', method: 'GET', path: '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Web/sites/{name}', apiVersion: '2024-11-01', summary: 'Get app' },
        { id: 'WebApps_ListApplicationSettings', method: 'POST', path: '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Web/sites/{name}/config/appsettings/list', apiVersion: '2024-11-01', summary: 'List settings' },
      ],
    }),
  );
  return dir;
}

const VNET_ID = `/subscriptions/${SUB}/resourceGroups/rg-demo/providers/Microsoft.Network/virtualNetworks/vnet-demo`;
const SUBNET_ID = `${VNET_ID}/subnets/snet-func`;
const FLEX_SITE = { id: APP_ID, name: 'func-demo', location: 'japaneast', properties: { functionAppConfig: { runtime: { name: 'python' } }, virtualNetworkSubnetId: null } };

describe('args', () => {
  it('keeps every value of a repeated flag', () => {
    expect(listFlag(parseArgs(['--query', 'a=1', '--query', 'b=2']), 'query')).toEqual(['a=1', 'b=2']);
  });
});

describe('rest', () => {
  it('fills api-version from the index and redacts secret fields', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch([on('GET', '/sites/func-demo', { name: 'func-demo', properties: { publishingPassword: 'p@ss', state: 'Running' } })], calls);
    const result = await runCli(['rest', 'GET', APP_ID], deps(fetch, { referencesDir: referencesWithIndex() }));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls[0].url).toBe(`https://management.azure.com${APP_ID}?api-version=2024-11-01`);
    expect(JSON.stringify(result.output)).not.toContain('p@ss');
    expect(JSON.stringify(result.output)).toContain('Running');
  });

  it('returns the plan with exit 5 for an unapproved write and warns about collection replacement', async () => {
    const calls: Call[] = [];
    const result = await runCli(['rest', 'PUT', `${APP_ID}/config/appsettings`, '--api-version', '2024-11-01', '--body-file', 'body.json'], deps(fakeFetch([], calls), { readInput: async () => '{"properties":{"A":"1"}}' }));
    expect(result.exitCode).toBe(EXIT.approval);
    expect(calls).toHaveLength(0);
    expect(envelope(result.output).findings.map(finding => finding.code)).toContain('ReplacesCollection');
  });

  it('rejects hosts outside the allowlist', async () => {
    const result = await runCli(['rest', 'GET', 'https://example.com/x'], deps(fakeFetch([])));
    expect(result.exitCode).toBe(EXIT.usage);
  });

  it('never resends a write whose outcome is unknown', async () => {
    const calls: Call[] = [];
    const fetch = async (url: string, init: { method: string; body?: string }): Promise<never> => {
      calls.push({ method: init.method, url });
      throw new Error('socket hang up');
    };
    const result = await runCli(['rest', 'POST', `${APP_ID}/restart`, '--api-version', '2024-11-01', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.azure);
    expect(calls).toHaveLength(1);
    expect(envelope(result.output).findings.map(finding => finding.code)).toContain('OutcomeUnknown');
  });

  it('polls a long-running write until it finishes', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      [
        on('PUT', '/subnets/snet-func', { name: 'snet-func' }, 201, { 'azure-asyncoperation': 'https://management.azure.com/op/1?api-version=2024-05-01' }),
        sequence('GET', '/op/1', [{ status: 200, body: { status: 'InProgress' } }, { status: 200, body: { status: 'Succeeded' } }]),
      ],
      calls,
    );
    const result = await runCli(['rest', 'PUT', SUBNET_ID, '--api-version', '2024-05-01', '--body-file', '-', '--approve'], deps(fetch, { readInput: async () => '{"properties":{"addressPrefix":"10.0.1.0/27"}}' }));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect(calls[0].body).toEqual({ properties: { addressPrefix: '10.0.1.0/27' } });
    expect(envelope(result.output).data).toMatchObject({ operationStatus: 'Succeeded' });
  });

  it('treats list POSTs as reads and keeps only key names', async () => {
    const fetch = fakeFetch([on('POST', '/host/default/listkeys', { masterKey: 'mk-secret', functionKeys: { default: 'fk-secret' } })]);
    const result = await runCli(['rest', 'POST', `${APP_ID}/host/default/listkeys`, '--api-version', '2024-11-01'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const text = JSON.stringify(result.output);
    expect(text).not.toContain('mk-secret');
    expect(text).not.toContain('fk-secret');
    expect(text).toContain('default');
  });
});

describe('restart', () => {
  const status = (instanceId: string, processUptime: number) => ({ status: 200, body: { state: 'Running', instanceId, processUptime, version: '4.1' } });

  it('needs approval', async () => {
    const calls: Call[] = [];
    const result = await runCli(['restart', '--app', APP_ID], deps(fakeFetch([on('GET', '/host/status', status('a', 1).body)], calls)));
    expect(result.exitCode).toBe(EXIT.approval);
    expect(calls.some(call => call.method === 'POST')).toBe(false);
  });

  it('restarts once and verifies through the host status', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch([sequence('GET', '/host/status', [status('a', 500_000), status('b', 3_000)]), on('POST', '/restart', '')], calls);
    const result = await runCli(['restart', '--app', APP_ID, '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.filter(call => call.url.includes('/restart'))).toHaveLength(1);
    expect(envelope(result.output).data).toMatchObject({ verified: true });
  });

  it('reports an unverified restart without restarting again', async () => {
    const calls: Call[] = [];
    let uptime = 500_000;
    const fetch = fakeFetch([call => (call.url.includes('/host/status') ? { status: 200, body: { state: 'Running', instanceId: 'a', processUptime: (uptime += 10_000) } } : undefined), on('POST', '/restart', '')], calls);
    const result = await runCli(['restart', '--app', APP_ID, '--approve', '--wait', '30'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.filter(call => call.url.includes('/restart'))).toHaveLength(1);
    expect(envelope(result.output).findings.map(finding => finding.code)).toContain('RestartNotVerified');
  });
});

describe('host status and keys', () => {
  it('flags a host that is not running', async () => {
    const result = await runCli(['host', 'status', '--app', APP_ID], deps(fakeFetch([on('GET', '/host/status', { state: 'Error', version: '4.1', errors: ['Storage unreachable'] })])));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(envelope(result.output).findings.map(finding => finding.code)).toContain('HostNotRunning');
  });

  it('lists key names without values', async () => {
    const fetch = fakeFetch([on('POST', '/host/default/listkeys', { masterKey: 'mk-secret', functionKeys: { default: 'fk-secret' }, systemKeys: { durabletask_extension: 'sk-secret' } })]);
    const result = await runCli(['keys', 'list', '--app', APP_ID], deps(fetch));
    const text = JSON.stringify(result.output);
    expect(text).not.toMatch(/mk-secret|fk-secret|sk-secret/);
    expect(envelope(result.output).data).toMatchObject({ functionKeys: ['default'], systemKeys: ['durabletask_extension'], masterKey: true });
  });

  it('targets a deployment slot with --slot', async () => {
    const calls: Call[] = [];
    const result = await runCli(['host', 'status', '--app', APP_ID, '--slot', 'staging'], deps(fakeFetch([on('GET', '/slots/staging/hostruntime/admin/host/status', { state: 'Running', version: '4.1' })], calls)));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls[0].url).toContain('/sites/func-demo/slots/staging/hostruntime');
    expect(envelope(result.output).summary).toContain('func-demo/staging');
  });

  it('returns the raw host status with --full', async () => {
    const raw = { state: 'Running', version: '4.1', extensionBundle: { id: 'b' }, functionsRuntimeAdminIsolationEnabled: false };
    const result = await runCli(['host', 'status', '--app', APP_ID, '--full'], deps(fakeFetch([on('GET', '/host/status', raw)])));
    expect(envelope(result.output).data).toMatchObject({ functionsRuntimeAdminIsolationEnabled: false });
  });

  it('lists function-level key names without values', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch([on('POST', '/functions/HttpTrigger/listkeys', { default: 'fn-secret', partner: 'p-secret' })], calls);
    const result = await runCli(['keys', 'list', '--app', APP_ID, '--function', 'HttpTrigger'], deps(fetch));
    expect(JSON.stringify(result.output)).not.toMatch(/fn-secret|p-secret/);
    expect(envelope(result.output).data).toMatchObject({ function: 'HttpTrigger', keys: ['default', 'partner'] });
  });
});

describe('vnet', () => {
  it('finds the first free aligned prefix', () => {
    expect(findFreePrefix(['10.0.0.0/16'], ['10.0.0.0/24', '10.0.1.0/27'], 27)).toBe('10.0.1.32/27');
    expect(findFreePrefix(['10.0.0.0/27'], ['10.0.0.0/27'], 27)).toBeUndefined();
  });

  const subnet = (prefix: string, delegation?: string) => ({ id: SUBNET_ID, name: 'snet-func', properties: { addressPrefix: prefix, delegations: delegation ? [{ properties: { serviceName: delegation } }] : [] } });
  const baseRoutes = (subnetBody: unknown, registration = 'Registered') => [
    on('GET', '/providers/Microsoft.App?', { registrationState: registration }),
    on('GET', '/subnets/snet-func', subnetBody),
    on('GET', '/virtualNetworks/vnet-demo?', { id: VNET_ID, location: 'japaneast', properties: { addressSpace: { addressPrefixes: ['10.0.0.0/16'] }, subnets: [subnetBody] } }),
  ];

  it('plans an integration with an existing subnet and applies it after approval', async () => {
    const planCalls: Call[] = [];
    const plan = await runCli(['vnet', 'integrate', '--app', APP_ID, '--subnet', SUBNET_ID], deps(fakeFetch([on('GET', '/sites/func-demo?', FLEX_SITE), ...baseRoutes(subnet('10.0.1.0/27', 'Microsoft.App/environments'))], planCalls)));
    expect(plan.exitCode).toBe(EXIT.approval);
    expect(planCalls.some(call => call.method !== 'GET' && !call.url.includes('ResourceGraph'))).toBe(false);

    const calls: Call[] = [];
    const integrated = { ...FLEX_SITE, properties: { ...FLEX_SITE.properties, virtualNetworkSubnetId: SUBNET_ID } };
    const fetch = fakeFetch([sequence('GET', '/sites/func-demo?', [{ status: 200, body: FLEX_SITE }, { status: 200, body: integrated }]), on('PATCH', '/sites/func-demo?', integrated), ...baseRoutes(subnet('10.0.1.0/27', 'Microsoft.App/environments'))], calls);
    const result = await runCli(['vnet', 'integrate', '--app', APP_ID, '--subnet', SUBNET_ID, '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.find(call => call.method === 'PATCH')?.body).toEqual({ properties: { virtualNetworkSubnetId: SUBNET_ID } });
    expect(envelope(result.output).data).toMatchObject({ verified: true });
  });

  it('fails the pre-check for a subnet that is too small or wrongly delegated', async () => {
    const result = await runCli(['vnet', 'integrate', '--app', APP_ID, '--subnet', SUBNET_ID], deps(fakeFetch([on('GET', '/sites/func-demo?', FLEX_SITE), ...baseRoutes(subnet('10.0.1.0/28', 'Microsoft.Web/serverFarms'))])));
    expect(result.exitCode).toBe(EXIT.precheck);
    expect(envelope(result.output).findings.map(finding => finding.code)).toEqual(expect.arrayContaining(['SubnetTooSmall', 'SubnetDelegatedElsewhere']));
  });

  it('plans a new delegated subnet and provider registration', async () => {
    const result = await runCli(['vnet', 'integrate', '--app', APP_ID, '--vnet', VNET_ID, '--create-subnet'], deps(fakeFetch([on('GET', '/sites/func-demo?', FLEX_SITE), ...baseRoutes(subnet('10.0.0.0/24'), 'NotRegistered')])));
    expect(result.exitCode).toBe(EXIT.approval);
    const steps = (envelope(result.output).data as { steps: { action: string; body?: unknown }[] }).steps;
    expect(steps.map(step => step.action)).toEqual(['register Microsoft.App', 'create subnet', 'integrate app']);
    expect(steps[1].body).toMatchObject({ properties: { addressPrefix: '10.0.1.0/27', delegations: [{ properties: { serviceName: 'Microsoft.App/environments' } }] } });
  });

  it('picks an address space that no existing VNet uses for --create-vnet', async () => {
    const fetch = fakeFetch([
      on('GET', '/sites/func-demo?', FLEX_SITE),
      on('GET', '/providers/Microsoft.App?', { registrationState: 'Registered' }),
      on('POST', 'ResourceGraph', { data: [{ id: VNET_ID, prefixes: ['10.0.0.0/16'] }, { id: `${VNET_ID}2`, prefixes: ['10.1.0.0/16', '10.2.0.0/15'] }] }),
    ]);
    const result = await runCli(['vnet', 'integrate', '--app', APP_ID, '--create-vnet'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.approval);
    const steps = (envelope(result.output).data as { steps: { action: string; body?: { properties: { addressSpace: { addressPrefixes: string[] }; subnets: { properties: { addressPrefix: string } }[] } } }[] }).steps;
    const vnet = steps.find(step => step.action === 'create vnet');
    expect(vnet?.body?.properties.addressSpace.addressPrefixes).toEqual(['10.4.0.0/16']);
    expect(vnet?.body?.properties.subnets[0].properties.addressPrefix).toBe('10.4.0.0/27');
  });

  it('reports when the host does not come back after integration', async () => {
    const integrated = { ...FLEX_SITE, properties: { ...FLEX_SITE.properties, virtualNetworkSubnetId: SUBNET_ID } };
    const fetch = fakeFetch([
      sequence('GET', '/sites/func-demo?', [{ status: 200, body: FLEX_SITE }, { status: 200, body: integrated }]),
      on('PATCH', '/sites/func-demo?', integrated),
      on('GET', '/host/status', { state: 'Error', errors: ['Unable to reach storage'] }),
      ...baseRoutes(subnet('10.0.1.0/27', 'Microsoft.App/environments')),
    ]);
    const result = await runCli(['vnet', 'integrate', '--app', APP_ID, '--subnet', SUBNET_ID, '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(envelope(result.output).data).toMatchObject({ verified: true, hostState: 'Error' });
    expect(envelope(result.output).findings.map(item => item.code)).toContain('HostNotVerified');
  });

  it('removes the integration and verifies it', async () => {
    const calls: Call[] = [];
    const integrated = { ...FLEX_SITE, properties: { ...FLEX_SITE.properties, virtualNetworkSubnetId: SUBNET_ID } };
    const fetch = fakeFetch([sequence('GET', '/sites/func-demo?', [{ status: 200, body: integrated }, { status: 200, body: FLEX_SITE }]), on('DELETE', '/networkConfig/virtualNetwork', '')], calls);
    const result = await runCli(['vnet', 'remove', '--app', APP_ID, '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
    expect(envelope(result.output).data).toMatchObject({ verified: true, subnetKept: SUBNET_ID });
  });
});

describe('read command additions', () => {
  it('reads KQL from a file', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      [
        on('POST', '/config/appsettings/list', { properties: { APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=11111111-2222-3333-4444-555555555555;' } }),
        on('POST', 'ResourceGraph', { data: [{ id: `/subscriptions/${SUB}/resourceGroups/rg-demo/providers/Microsoft.Insights/components/appi`, name: 'appi', resourceGroup: 'rg-demo', subscriptionId: SUB }] }),
        on('POST', '/query', { tables: [{ columns: [{ name: 'n', type: 'long' }], rows: [[1]] }] }),
      ],
      calls,
    );
    const result = await runCli(['logs', 'query', '--app', APP_ID, '--kql-file', 'q.kql'], deps(fetch, { readInput: async () => "requests | where name has '&'" }));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.find(call => call.url.includes('/query'))?.body).toMatchObject({ query: "requests | where name has '&'" });
  });

  const aiRoutes = [
    on('POST', '/config/appsettings/list', { properties: { APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=11111111-2222-3333-4444-555555555555;' } }),
    on('POST', 'ResourceGraph', { data: [{ id: `/subscriptions/${SUB}/resourceGroups/rg-demo/providers/Microsoft.Insights/components/appi`, name: 'appi', resourceGroup: 'rg-demo', subscriptionId: SUB }] }),
  ];

  it('reports the role names that do have telemetry when a preset returns no rows', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      [
        ...aiRoutes,
        sequence('POST', '/query', [
          { status: 200, body: { tables: [{ columns: [{ name: 'timestamp', type: 'datetime' }], rows: [] }] } },
          { status: 200, body: { tables: [{ columns: [{ name: 'cloud_RoleName', type: 'string' }, { name: 'count_', type: 'long' }], rows: [['func-demo-staging', 12]] }] } },
        ]),
      ],
      calls,
    );
    const result = await runCli(['logs', 'query', '--app', APP_ID, '--preset', 'traces'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const finding = envelope(result.output).findings.find(item => item.code === 'NoRowsForRoleName');
    expect(JSON.stringify(finding)).toContain('func-demo-staging');
  });

  it('adds a KQL hint when the query is rejected', async () => {
    const fetch = fakeFetch([...aiRoutes, on('POST', '/query', { error: { code: 'BadArgumentError', message: 'Syntax error' } }, 400)]);
    const result = await runCli(['logs', 'query', '--app', APP_ID, '--kql', 'requests | project timestamp, count'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.azure);
    expect(envelope(result.output).findings.map(item => item.code)).toContain('KqlRejected');
  });

  it('adds a portal link to app find results', async () => {
    const fetch = fakeFetch([on('POST', 'ResourceGraph', { data: [{ id: APP_ID, name: 'func-demo', resourceGroup: 'rg-demo', subscriptionId: SUB }] })]);
    const result = await runCli(['app', 'find'], deps(fetch));
    expect(envelope(result.output).data).toEqual([expect.objectContaining({ portal: `https://portal.azure.com/#@/resource${APP_ID}` })]);
  });
});
