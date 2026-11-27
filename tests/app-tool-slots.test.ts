import { describe, expect, it } from 'vitest';
import { runCli } from '../src/tools/app/cli.js';
import { EXIT } from '../src/tools/app/output.js';
import { APP_ID, deps, envelope, fakeFetch, on, sequence, type Call, type Route } from './helpers/fake-azure.js';

const SLOT_ID = `${APP_ID}/slots/staging`;
const SCM = (host: string) => [{ name: `${host}.azurewebsites.net`, hostType: 'Standard' }, { name: `${host}.scm.azurewebsites.net`, hostType: 'Repository' }];
const PROD_SITE = { id: APP_ID, name: 'func-demo', location: 'japaneast', properties: { state: 'Running', defaultHostName: 'func-demo.azurewebsites.net', hostNameSslStates: SCM('func-demo') } };
const SLOT_SITE = { id: SLOT_ID, name: 'func-demo/staging', location: 'japaneast', properties: { state: 'Running', defaultHostName: 'func-demo-staging.azurewebsites.net', hostNameSslStates: SCM('func-demo-staging') } };
const RUNNING = { state: 'Running', version: '4.1', processUptime: 60_000 };

/** Matches an ARM path exactly (ignoring the query string), so the production route does not answer slot calls. */
function arm(method: string, path: string, body: unknown, status = 200, headers?: Record<string, string>): Route {
  return call => (call.method === method && call.url.startsWith(`https://management.azure.com${path}?`) ? { status, body, headers } : undefined);
}

function settingsRoutes(prodShare: string, slotShare: string): Route[] {
  return [
    arm('POST', `${APP_ID}/config/appsettings/list`, { properties: { WEBSITE_CONTENTSHARE: prodShare, GREETING: 'secret-value' } }),
    arm('POST', `${SLOT_ID}/config/appsettings/list`, { properties: { WEBSITE_CONTENTSHARE: slotShare } }),
  ];
}

describe('slots list', () => {
  it('lists production and slots with sticky setting names and flags a shared content share', async () => {
    const fetch = fakeFetch([
      arm('GET', APP_ID, PROD_SITE),
      arm('GET', `${APP_ID}/slots`, { value: [SLOT_SITE] }),
      arm('GET', `${APP_ID}/config/slotConfigNames`, { properties: { appSettingNames: ['GREETING'], connectionStringNames: null } }),
      ...settingsRoutes('func-demo-share', 'func-demo-share'),
    ]);
    const result = await runCli(['slots', 'list', '--app', APP_ID], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const output = envelope(result.output);
    expect(output.data).toMatchObject({
      slots: [{ name: 'production', state: 'Running', hostName: 'func-demo.azurewebsites.net' }, { name: 'staging', hostName: 'func-demo-staging.azurewebsites.net' }],
      stickySettings: { appSettings: ['GREETING'], connectionStrings: [] },
    });
    expect(output.findings.map(finding => finding.code)).toContain('SharedContentShare');
    expect(JSON.stringify(result.output)).not.toContain('secret-value');
  });
});

describe('slots swap', () => {
  const precheckRoutes = (slotState = RUNNING): Route[] => [
    arm('GET', APP_ID, PROD_SITE),
    arm('GET', SLOT_ID, SLOT_SITE),
    arm('GET', `${APP_ID}/hostruntime/admin/host/status`, RUNNING),
    arm('GET', `${SLOT_ID}/hostruntime/admin/host/status`, slotState),
    ...settingsRoutes('share-prod', 'share-staging'),
  ];

  it('needs approval and shows the rollback', async () => {
    const calls: Call[] = [];
    const result = await runCli(['slots', 'swap', '--app', APP_ID, '--slot', 'staging'], deps(fakeFetch(precheckRoutes(), calls)));
    expect(result.exitCode).toBe(EXIT.approval);
    expect(calls.some(call => call.url.includes('slotsswap'))).toBe(false);
    expect(JSON.stringify(envelope(result.output).data)).toContain('slots swap --app func-demo --slot staging');
  });

  it('refuses to swap a slot whose host is not running', async () => {
    const calls: Call[] = [];
    const result = await runCli(['slots', 'swap', '--app', APP_ID, '--slot', 'staging', '--approve'], deps(fakeFetch(precheckRoutes({ ...RUNNING, state: 'Error' }), calls)));
    expect(result.exitCode).toBe(EXIT.precheck);
    expect(calls.some(call => call.url.includes('slotsswap'))).toBe(false);
  });

  it('requires the production slot as the target unless --target is given', async () => {
    const result = await runCli(['slots', 'swap', '--app', APP_ID], deps(fakeFetch([])));
    expect(result.exitCode).toBe(EXIT.usage);
  });

  const swapRoutes = (): Route[] => {
    const swapped = { ...PROD_SITE, properties: { ...PROD_SITE.properties, slotSwapStatus: { timestampUtc: '2026-01-02T00:01:00Z', sourceSlotName: 'staging', destinationSlotName: 'production' } } };
    return [
      arm('POST', `${SLOT_ID}/slotsswap`, '', 202, { location: 'https://management.azure.com/op/swap?api-version=2024-11-01' }),
      sequence('GET', '/op/swap', [{ status: 202 }, { status: 200 }]),
      sequence('GET', `${APP_ID}?api-version`, [{ status: 200, body: PROD_SITE }, { status: 200, body: swapped }]),
      sequence('GET', 'func-demo.scm.azurewebsites.net/api/deployments', [{ status: 200, body: [{ id: 'build-v1', active: true }] }, { status: 200, body: [{ id: 'build-v2', active: true }] }]),
      sequence('GET', 'func-demo-staging.scm.azurewebsites.net/api/deployments', [{ status: 200, body: [{ id: 'build-v2', active: true }] }, { status: 200, body: [{ id: 'build-v1', active: true }] }]),
      arm('GET', `${APP_ID}/config/configreferences/appsettings`, { value: [{ name: 'func-demo/GREETING', properties: { status: 'AccessToKeyVaultDenied', details: 'no access' } }] }),
      arm('GET', `${SLOT_ID}/config/configreferences/appsettings`, { value: [] }),
      ...precheckRoutes(),
    ];
  };

  it('swaps once, waits for the operation, and verifies builds, hosts, and Key Vault references', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(swapRoutes(), calls);
    const result = await runCli(['slots', 'swap', '--app', APP_ID, '--slot', 'staging', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const swaps = calls.filter(call => call.url.includes('slotsswap'));
    expect(swaps).toHaveLength(1);
    expect(swaps[0].body).toEqual({ targetSlot: 'production', preserveVnet: true });
    const output = envelope(result.output);
    expect(output.data).toMatchObject({ verified: true, builds: { before: { production: 'build-v1', staging: 'build-v2' } } });
    expect(output.findings.map(finding => finding.code)).toContain('KeyVaultReferenceUnresolved');
  });

  it('re-syncs a slot whose host rejects its keys after the swap, then checks it again', async () => {
    const calls: Call[] = [];
    const hello = (host: string) => ({ name: 'func-demo/Hello', properties: { invoke_url_template: `https://${host}.azurewebsites.net/api/hello`, config: { bindings: [{ type: 'httpTrigger', direction: 'in', authLevel: 'function', methods: ['get'] }] } } });
    const fetch = fakeFetch([
      arm('GET', `${APP_ID}/functions/Hello`, hello('func-demo')),
      arm('GET', `${SLOT_ID}/functions/Hello`, hello('func-demo-staging')),
      arm('POST', `${APP_ID}/functions/Hello/listkeys`, { default: 'k1' }),
      arm('POST', `${SLOT_ID}/functions/Hello/listkeys`, { default: 'k2' }),
      on('GET', 'func-demo.azurewebsites.net/api/hello', { build: 'v2' }),
      sequence('GET', 'func-demo-staging.azurewebsites.net/api/hello', [{ status: 401, body: '' }, { status: 200, body: { build: 'v1' } }]),
      arm('POST', `${SLOT_ID}/syncfunctiontriggers`, ''),
      ...swapRoutes(),
    ], calls);
    const result = await runCli(['slots', 'swap', '--app', APP_ID, '--slot', 'staging', '--check-function', 'Hello', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    const syncs = calls.filter(call => call.url.includes('syncfunctiontriggers'));
    expect(syncs).toHaveLength(1);
    expect(syncs[0].url).toContain('/slots/staging/syncfunctiontriggers');
    const output = envelope(result.output);
    expect(output.data).toMatchObject({ checks: [{ slot: 'production', status: 200 }, { slot: 'staging', status: 200, resynced: true }] });
    const codes = output.findings.map(finding => finding.code);
    expect(codes).toContain('KeysResynced');
    expect(codes).not.toContain('KeyRejected');
  });
});

describe('functions invoke', () => {
  const httpFunction = (authLevel: string) => ({
    name: 'func-demo/Hello',
    properties: { invoke_url_template: 'https://func-demo.azurewebsites.net/api/hello', config: { bindings: [{ type: 'httpTrigger', direction: 'in', authLevel, methods: ['get', 'post'] }] } },
  });

  it('calls an HTTP function with a key from ARM and never prints the key', async () => {
    const calls: Call[] = [];
    const seen: Record<string, string>[] = [];
    const routes = fakeFetch([
      arm('GET', `${APP_ID}/functions/Hello`, httpFunction('function')),
      arm('POST', `${APP_ID}/functions/Hello/listkeys`, { default: 'fk-secret' }),
      on('GET', 'func-demo.azurewebsites.net/api/hello?name=a', { build: 'v2' }),
    ], calls);
    const fetch: typeof routes = async (url, init) => {
      seen.push(init.headers);
      return routes(url, init);
    };
    const result = await runCli(['functions', 'invoke', '--app', APP_ID, '--function', 'Hello', '--query', 'name=a'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(seen.at(-1)?.['x-functions-key']).toBe('fk-secret');
    expect(JSON.stringify(result.output)).not.toContain('fk-secret');
    expect(envelope(result.output).data).toMatchObject({ status: 200, body: { build: 'v2' } });
  });

  it('does not fetch a key for an anonymous function', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch([arm('GET', `${APP_ID}/functions/Hello`, httpFunction('anonymous')), on('GET', '/api/hello', 'hi')], calls);
    const result = await runCli(['functions', 'invoke', '--app', APP_ID, '--function', 'Hello'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.some(call => call.url.includes('listkeys'))).toBe(false);
  });

  it('needs approval for a non-GET HTTP call', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch([arm('GET', `${APP_ID}/functions/Hello`, httpFunction('anonymous')), on('POST', '/api/hello', { ok: true })], calls);
    const result = await runCli(['functions', 'invoke', '--app', APP_ID, '--function', 'Hello', '--method', 'POST', '--body', '{"a":1}'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.approval);
    expect(calls.some(call => call.url.includes('/api/hello'))).toBe(false);
  });

  it('explains a rejected key', async () => {
    const fetch = fakeFetch([
      arm('GET', `${APP_ID}/functions/Hello`, httpFunction('function')),
      arm('POST', `${APP_ID}/functions/Hello/listkeys`, { default: 'fk-secret' }),
      on('GET', '/api/hello', '', 401),
    ]);
    const result = await runCli(['functions', 'invoke', '--app', APP_ID, '--function', 'Hello'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(envelope(result.output).data).toMatchObject({ status: 401 });
    expect(envelope(result.output).findings.map(finding => finding.code)).toContain('KeyRejected');
  });

  it('runs a non-HTTP function through the admin endpoint with the master key after approval', async () => {
    const calls: Call[] = [];
    const timer = { name: 'func-demo/Heartbeat', properties: { invoke_url_template: null, config: { bindings: [{ type: 'timerTrigger', direction: 'in', schedule: '0 */5 * * * *' }] } } };
    const fetch = fakeFetch([
      arm('GET', `${APP_ID}/functions/Heartbeat`, timer),
      arm('GET', APP_ID, PROD_SITE),
      arm('POST', `${APP_ID}/host/default/listkeys`, { masterKey: 'mk-secret' }),
      on('POST', 'func-demo.azurewebsites.net/admin/functions/Heartbeat', '', 202),
    ], calls);
    const unapproved = await runCli(['functions', 'invoke', '--app', APP_ID, '--function', 'Heartbeat'], deps(fetch));
    expect(unapproved.exitCode).toBe(EXIT.approval);
    const result = await runCli(['functions', 'invoke', '--app', APP_ID, '--function', 'Heartbeat', '--approve'], deps(fetch));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.filter(call => call.url.includes('/admin/functions/Heartbeat'))).toHaveLength(1);
    expect(calls.find(call => call.url.includes('/admin/functions/'))?.body).toEqual({ input: '' });
    expect(JSON.stringify(result.output)).not.toContain('mk-secret');
  });
});
