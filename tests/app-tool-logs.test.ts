import { describe, expect, it } from 'vitest';
import { runCli } from '../src/tools/app/cli.js';
import { EXIT } from '../src/tools/app/output.js';
import { APP_ID, deps, envelope, fakeFetch, on, type Call, type Route } from './helpers/fake-azure.js';

const SCM = 'func-demo.scm.azurewebsites.net';
const SENTINEL = `https://${SCM}/api/vfs/LogFiles/Application/Functions/Host/debug_sentinel`;

function site(kind = 'functionapp', extra: Record<string, unknown> = {}): unknown {
  return {
    id: APP_ID,
    name: 'func-demo',
    location: 'japanwest',
    kind,
    properties: { state: 'Running', defaultHostName: 'func-demo.azurewebsites.net', hostNameSslStates: [{ name: SCM, hostType: 'Repository' }], ...extra },
  };
}

const WELCOME = '2026-01-02T00:00:00  Welcome, you are now connected to log-streaming service. The default timeout is 2 hours.\r\n';
const EXECUTING = "2026-01-02T00:00:05.393 [Information] Executing 'Functions.Hello' (Reason='This function was programmatically called via the host APIs.', Id=1)\r\n";
const EXECUTED = "2026-01-02T00:00:05.396 [Information] Executed 'Functions.Hello' (Succeeded, Id=1, Duration=6ms)\r\n";

/** Streams never time out in tests; short waits (the delay before --invoke) resolve at once. */
const sleep = (ms: number): Promise<void> => (ms >= 10_000 ? new Promise(() => undefined) : Promise.resolve());

function routes(kind: string, chunks: string[], extra: Route[] = []): Route[] {
  return [
    on('GET', `${APP_ID}/instances`, { value: [{ name: 'a1b2c3' }, { name: 'd4e5f6' }] }),
    on('GET', `${APP_ID}?`, site(kind)),
    on('PUT', SENTINEL, '', 201),
    call => (call.url.includes('/api/logstream') ? { status: 200, chunks } : undefined),
    ...extra,
  ];
}

describe('logs tail', () => {
  it('turns on Functions file logging on Windows, streams the function log, and drops the banner and duplicate lines', async () => {
    const calls: Call[] = [];
    const result = await runCli(['logs', 'tail', '--app', APP_ID, '--seconds', '20'], deps(fakeFetch(routes('functionapp', [WELCOME, EXECUTING, EXECUTED, EXECUTING, 'storage AccountKey=abc123 failed\n']), calls), { sleep }));
    const out = envelope(result.output);
    expect(result.exitCode).toBe(EXIT.ok);
    const sentinel = calls.find(call => call.url === SENTINEL);
    expect(sentinel?.method).toBe('PUT');
    expect(sentinel?.headers?.['If-Match']).toBe('*');
    expect(calls.some(call => call.url === `https://${SCM}/api/logstream/application/functions`)).toBe(true);
    const data = out.data as { lines: string[]; instances: { count: number }; debugMode: string; seconds: number };
    expect(data.lines).toEqual([EXECUTING.trim(), EXECUTED.trim(), 'storage AccountKey=<redacted> failed']);
    expect(data.instances.count).toBe(2);
    expect(data.seconds).toBe(20);
    expect(data.debugMode).toMatch(/15 min/);
    expect(JSON.stringify(out)).not.toContain('abc123');
    expect(JSON.stringify(out)).not.toContain('secret-token');
  });

  it('calls --invoke once the stream is open and reports the result with the lines', async () => {
    const calls: Call[] = [];
    const fn = { name: 'Hello', properties: { invoke_url_template: 'https://func-demo.azurewebsites.net/api/hello', config: { bindings: [{ type: 'httpTrigger', direction: 'in', authLevel: 'anonymous', methods: ['get'] }] } } };
    const extra = [on('GET', `${APP_ID}/functions/Hello?`, fn), on('GET', 'https://func-demo.azurewebsites.net/api/hello', { message: 'hi' })];
    const result = await runCli(['logs', 'tail', '--app', APP_ID, '--invoke', 'Hello'], deps(fakeFetch(routes('functionapp', [WELCOME, EXECUTING, EXECUTED], extra), calls), { sleep }));
    const data = envelope(result.output).data as { invoke: { status: number; function: string }; lines: string[] };
    expect(result.exitCode).toBe(EXIT.ok);
    expect(data.invoke).toMatchObject({ function: 'Hello', status: 200 });
    expect(data.lines).toHaveLength(2);
    const stream = calls.findIndex(call => call.url.includes('/api/logstream'));
    const invoke = calls.findIndex(call => call.url === 'https://func-demo.azurewebsites.net/api/hello');
    expect(invoke).toBeGreaterThan(stream);
  });

  it('streams the container log on Linux without touching debug mode', async () => {
    const calls: Call[] = [];
    const result = await runCli(['logs', 'tail', '--app', APP_ID], deps(fakeFetch(routes('functionapp,linux', [WELCOME, EXECUTED]), calls), { sleep }));
    expect(result.exitCode).toBe(EXIT.ok);
    expect(calls.some(call => call.method === 'PUT')).toBe(false);
    expect(calls.some(call => call.url === `https://${SCM}/api/logstream`)).toBe(true);
    expect((envelope(result.output).data as { lines: string[] }).lines).toEqual([EXECUTED.trim()]);
  });

  it('drops a line cut off at the end of the window when it repeats an earlier line', async () => {
    const result = await runCli(['logs', 'tail', '--app', APP_ID], deps(fakeFetch(routes('functionapp', [WELCOME, EXECUTING, EXECUTED, '2026-01-02T00:00:05.'])), { sleep }));
    expect((envelope(result.output).data as { lines: string[] }).lines).toEqual([EXECUTING.trim(), EXECUTED.trim()]);
  });

  it('says how to see logs instead when nothing arrives', async () => {
    const result = await runCli(['logs', 'tail', '--app', APP_ID], deps(fakeFetch(routes('functionapp', [WELCOME])), { sleep }));
    const out = envelope(result.output);
    expect(result.exitCode).toBe(EXIT.ok);
    expect(out.findings.map(f => f.code)).toContain('NoLogLines');
  });

  it('points Flex Consumption apps to Application Insights', async () => {
    const flex = [on('GET', `${APP_ID}?`, site('functionapp,linux', { functionAppConfig: { runtime: { name: 'node' } } }))];
    const result = await runCli(['logs', 'tail', '--app', APP_ID], deps(fakeFetch(flex), { sleep }));
    expect(result.exitCode).toBe(EXIT.unsupported);
    expect(JSON.stringify(envelope(result.output))).toContain('logs query');
  });

  it('rejects windows longer than two minutes', async () => {
    const result = await runCli(['logs', 'tail', '--app', APP_ID, '--seconds', '600'], deps(fakeFetch([]), { sleep }));
    expect(result.exitCode).toBe(EXIT.usage);
  });
});
