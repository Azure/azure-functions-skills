import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  BackgroundProcess, HttpResponse, LocalDependencies, StartOptions,
} from '../src/tools/local/verify.js';
import { createStarter, loopbackRequest } from '../src/tools/local/processes.js';
import { verifyLocal } from '../src/tools/local/verify.js';
import type { Finding } from '../src/tools/shared/output.js';
import { runCli } from '../src/tools/cli.js';
import { fakeRunner, result, type FakeRunner } from './helpers/deploy-fixture.js';

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'local-verify-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const HTTP_PY = `import azure.functions as func
app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

@app.route(route="hello")
def hello(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("Hello")
`;

const TIMER_PY = `import azure.functions as func
app = func.FunctionApp()

@app.timer_trigger(schedule="0 */5 * * * *", arg_name="timer")
def tick(timer: func.TimerRequest) -> None:
    pass
`;

function writePython(source: string): void {
  writeFileSync(join(dir, 'host.json'), '{"version":"2.0"}');
  writeFileSync(join(dir, 'function_app.py'), source);
  writeFileSync(join(dir, 'requirements.txt'), 'azure-functions\n');
}

interface FakeProcess extends BackgroundProcess {
  command: string;
  args: readonly string[];
  options: StartOptions;
  stopped: boolean;
  released: boolean;
  exit: (code: number, output?: string) => void;
}

interface Harness {
  readonly deps: LocalDependencies;
  readonly runner: FakeRunner;
  readonly started: FakeProcess[];
  readonly requests: string[];
}

type Route = (url: string, method: string) => HttpResponse | null | undefined;

interface HarnessOptions {
  readonly runner?: FakeRunner;
  readonly http?: Route;
  readonly missing?: readonly string[];
  readonly portsInUse?: readonly number[];
  readonly onStart?: (process: FakeProcess) => void;
}

const RUNNING = { status: 200, headers: {}, body: JSON.stringify({ state: 'Running' }) };

function functionsBody(functions: ReadonlyArray<{ name: string; trigger: string; methods?: string[]; route?: string }>,
  port = 7071): HttpResponse {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify(functions.map(fn => ({
      name: fn.name,
      invoke_url_template: fn.trigger === 'httpTrigger' ? `http://localhost:${port}/api/${fn.route ?? fn.name}` : null,
      config: { bindings: [{ type: fn.trigger, direction: 'in', ...(fn.methods ? { methods: fn.methods } : {}) }] },
    }))),
  };
}

function harness(options: HarnessOptions = {}): Harness {
  const started: FakeProcess[] = [];
  const requests: string[] = [];
  let clock = 0;
  const runner = options.runner ?? fakeRunner({ 'uv --version': result({ notFound: true, code: null }) });
  const deps: LocalDependencies = {
    run: runner.run,
    start: (command, args, startOptions) => {
      if (options.missing?.includes(command)) return null;
      let exitCode: number | null | undefined;
      let output = '';
      const process: FakeProcess = {
        command, args, options: startOptions, stopped: false, released: false, pid: 1000 + started.length,
        output: () => output,
        exitCode: () => exitCode,
        stop: async () => { process.stopped = true; },
        release: () => { process.released = true; },
        exit: (code, text = '') => { exitCode = code; output = text; },
      };
      started.push(process);
      options.onStart?.(process);
      return process;
    },
    http: async (url, request = {}) => {
      const method = request.method ?? 'GET';
      requests.push(`${method} ${url}`);
      const answer = options.http?.(url, method);
      if (answer !== undefined) return answer;
      if (url.includes(':1000')) return null;
      if (url.endsWith('/admin/host/status')) return RUNNING;
      if (url.endsWith('/admin/functions')) return functionsBody([{ name: 'hello', trigger: 'httpTrigger', route: 'hello' }]);
      if (url.includes('/api/')) return { status: 200, headers: {}, body: 'Hello' };
      return null;
    },
    sleep: async milliseconds => { clock += milliseconds; },
    now: () => new Date(clock),
    portInUse: async port => options.portsInUse?.includes(port) ?? false,
    freePort: async () => 51234,
    platform: 'linux',
    env: { PATH: '/usr/bin' },
  };
  return { deps, runner, started, requests };
}

const firstError = (outcome: { body: { findings: readonly Finding[] } }): Finding =>
  outcome.body.findings.find(finding => finding.severity === 'error') ?? outcome.body.findings[0];

const funcProcesses = (h: Harness) => h.started.filter(process => process.command === 'func');

describe('local verify', () => {
  it('prepares a Python HTTP app, starts the host, invokes the function and stops the host', async () => {
    writePython(HTTP_PY);
    const h = harness();

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(outcome.exitCode).toBe(0);
    const data = outcome.body.data;
    expect(data.worker).toBe('python');
    expect(data.triggers).toEqual(['http']);
    expect(data.settings).toEqual({ path: join(dir, 'local.settings.json'), created: true });
    expect(JSON.parse(readFileSync(join(dir, 'local.settings.json'), 'utf-8'))).toEqual({
      IsEncrypted: false,
      Values: { FUNCTIONS_WORKER_RUNTIME: 'python', AzureWebJobsStorage: 'UseDevelopmentStorage=true' },
    });
    expect(h.runner.calls).toContain('python3 -m venv .venv');
    expect(h.runner.calls).toContain(`${join(dir, '.venv', 'bin', 'python')} -m pip install -r requirements.txt`);
    const [host] = funcProcesses(h);
    expect(host.args).toEqual(['start', '--port', '7071']);
    expect(host.options.cwd).toBe(dir);
    expect(host.options.env?.PATH?.startsWith(join(dir, '.venv', 'bin'))).toBe(true);
    expect(host.options.env?.VIRTUAL_ENV).toBe(join(dir, '.venv'));
    expect(data.host).toMatchObject({ port: 7071, state: 'Running' });
    expect(data.functions).toEqual([{ name: 'hello', trigger: 'httpTrigger' }]);
    expect(data.invocation).toEqual({ function: 'hello', method: 'GET', url: 'http://127.0.0.1:7071/api/hello', status: 200, body: 'Hello' });
    expect(host.stopped).toBe(true);
    expect(data.storage).toMatchObject({ connection: 'development', need: 'optional', azurite: 'not-running' });
    expect(outcome.body.next?.action).toBe('deploy');
  });

  it('uses uv when it is available', async () => {
    writePython(HTTP_PY);
    const h = harness({ runner: fakeRunner() });

    await verifyLocal({ dir }, h.deps);

    expect(h.runner.calls).toContain('uv venv .venv');
    expect(h.runner.calls).toContain(`uv pip install -r requirements.txt --python ${join(dir, '.venv', 'bin', 'python')}`);
  });

  it('skips the dependency install when requirements did not change', async () => {
    writePython(HTTP_PY);
    const first = harness();
    await verifyLocal({ dir }, first.deps);
    mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(dir, '.venv', 'bin', 'python'), '');

    const second = harness();
    const outcome = await verifyLocal({ dir }, second.deps);

    expect(second.runner.calls.some(call => call.includes('pip install'))).toBe(false);
    expect(outcome.body.data.install).toMatchObject({ skipped: true });
  });

  it('keeps an existing local.settings.json unchanged', async () => {
    writePython(HTTP_PY);
    const existing = '{ "IsEncrypted": false, "Values": { "FUNCTIONS_WORKER_RUNTIME": "python", "AzureWebJobsStorage": "" } }';
    writeFileSync(join(dir, 'local.settings.json'), existing);
    const h = harness();

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(readFileSync(join(dir, 'local.settings.json'), 'utf-8')).toBe(existing);
    expect(outcome.body.data.settings.created).toBe(false);
    expect(outcome.body.data.storage.connection).toBe('missing');
  });

  it('blocks a timer app on development storage when Azurite is not running', async () => {
    writePython(TIMER_PY);
    const h = harness();

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(outcome.exitCode).toBe(3);
    expect(firstError(outcome)).toMatchObject({ id: 'AZURITE-NOT-RUNNING' });
    expect(firstError(outcome).fix).toContain('--start-azurite');
    expect(funcProcesses(h)).toHaveLength(0);
  });

  it('starts Azurite when asked, then stops only what it started', async () => {
    writePython(TIMER_PY);
    let azuriteUp = false;
    const h = harness({
      onStart: process => { if (process.command === 'azurite') azuriteUp = true; },
      http: url => {
        if (url.includes(':1000')) return azuriteUp ? { status: 400, headers: { server: 'Azurite-Blob/3.34.0' }, body: '' } : null;
        if (url.endsWith('/admin/functions')) return functionsBody([{ name: 'tick', trigger: 'timerTrigger' }]);
        return undefined;
      },
    });

    const outcome = await verifyLocal({ dir, startAzurite: true }, h.deps);

    expect(outcome.exitCode).toBe(0);
    const azurite = h.started.find(process => process.command === 'azurite');
    expect(azurite?.args).toEqual(expect.arrayContaining(['--silent', '--location', join(dir, '.azure-functions-skills', 'azurite')]));
    expect(outcome.body.data.storage.azurite).toBe('started');
    expect(outcome.body.data.invocation).toBeNull();
    expect(azurite?.stopped).toBe(true);
    expect(funcProcesses(h)[0].stopped).toBe(true);
  });

  it('falls back to Docker for Azurite and stops the container it started', async () => {
    writePython(TIMER_PY);
    let azuriteUp = false;
    const runner = fakeRunner({
      'uv --version': result({ notFound: true, code: null }),
      'docker run': () => { azuriteUp = true; return result({ stdout: 'abc123\n' }); },
    });
    const h = harness({
      runner,
      missing: ['azurite'],
      http: url => {
        if (url.includes(':1000')) return azuriteUp ? { status: 400, headers: { server: 'Azurite-Blob/3.34.0' }, body: '' } : null;
        if (url.endsWith('/admin/functions')) return functionsBody([{ name: 'tick', trigger: 'timerTrigger' }]);
        return undefined;
      },
    });

    const outcome = await verifyLocal({ dir, startAzurite: true }, h.deps);

    expect(outcome.exitCode).toBe(0);
    expect(runner.calls.find(call => call.startsWith('docker run'))).toContain('mcr.microsoft.com/azure-storage/azurite');
    expect(runner.calls).toContain('docker stop abc123');
  });

  it('reports a port that answers but is not Azurite', async () => {
    writePython(TIMER_PY);
    const h = harness({
      http: url => (url.includes(':10000') ? { status: 200, headers: { server: 'nginx' }, body: '' } : undefined),
    });

    const outcome = await verifyLocal({ dir, startAzurite: true }, h.deps);

    expect(outcome.exitCode).toBe(3);
    expect(firstError(outcome).id).toBe('AZURITE-PORT-CONFLICT');
    expect(h.started).toHaveLength(0);
  });

  it('reports a conflict on the queue port even when blob is Azurite', async () => {
    writePython(TIMER_PY);
    const h = harness({
      http: url => {
        if (url.includes(':10000')) return { status: 400, headers: { server: 'Azurite-Blob/3.34.0' }, body: '' };
        if (url.includes(':10001')) return { status: 200, headers: { server: 'nginx' }, body: '' };
        return undefined;
      },
    });

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(outcome.exitCode).toBe(3);
    expect(firstError(outcome)).toMatchObject({ id: 'AZURITE-PORT-CONFLICT', detail: 'Ports: 10001' });
  });

  it('blocks when Azurite runs without a service the triggers need', async () => {
    writePython(`import azure.functions as func
app = func.FunctionApp()

@app.queue_trigger(arg_name="msg", queue_name="items", connection="AzureWebJobsStorage")
def work(msg: func.QueueMessage) -> None:
    pass
`);
    const h = harness({
      http: url => (url.includes(':10000') ? { status: 400, headers: { server: 'Azurite-Blob/3.34.0' }, body: '' } : undefined),
    });

    const outcome = await verifyLocal({ dir, startAzurite: true }, h.deps);

    expect(outcome.exitCode).toBe(3);
    expect(firstError(outcome).id).toBe('AZURITE-INCOMPLETE');
    expect(firstError(outcome).title).toContain('queue');
    expect(h.started).toHaveLength(0);
  });

  it('accepts a blob-only Azurite for a timer app', async () => {
    writePython(TIMER_PY);
    const h = harness({
      http: url => {
        if (url.includes(':10000')) return { status: 400, headers: { server: 'Azurite-Blob/3.34.0' }, body: '' };
        if (url.endsWith('/admin/functions')) return functionsBody([{ name: 'tick', trigger: 'timerTrigger' }]);
        return undefined;
      },
    });

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.body.data.storage.azurite).toBe('running');
  });

  it('releases a kept Azurite so the command can exit', async () => {
    writePython(TIMER_PY);
    let azuriteUp = false;
    const h = harness({
      onStart: process => { if (process.command === 'azurite') azuriteUp = true; },
      http: url => {
        if (url.includes(':1000')) return azuriteUp ? { status: 400, headers: { server: 'Azurite' }, body: '' } : null;
        if (url.endsWith('/admin/functions')) return functionsBody([{ name: 'tick', trigger: 'timerTrigger' }]);
        return undefined;
      },
    });

    const outcome = await verifyLocal({ dir, startAzurite: true, keepAzurite: true }, h.deps);

    const azurite = h.started.find(process => process.command === 'azurite');
    expect(outcome.body.data.cleanup.azurite).toBe('kept');
    expect(azurite).toMatchObject({ released: true, stopped: false });
  });

  it('chooses a free port when 7071 is taken and no port was given', async () => {
    writePython(HTTP_PY);
    const h = harness({ portsInUse: [7071] });

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(funcProcesses(h)[0].args).toEqual(['start', '--port', '51234']);
    expect(outcome.body.data.host?.port).toBe(51234);
  });

  it('blocks when an explicit port is in use', async () => {
    writePython(HTTP_PY);
    const h = harness({ portsInUse: [7072] });

    const outcome = await verifyLocal({ dir, port: 7072 }, h.deps);

    expect(outcome.exitCode).toBe(3);
    expect(firstError(outcome).id).toBe('PORT-IN-USE');
  });

  it('reports the output tail when the host exits before it is ready', async () => {
    writePython(HTTP_PY);
    const h = harness({
      onStart: process => { if (process.command === 'func') process.exit(1, 'line\nAccountKey=secret123;\nWorker failed to index functions'); },
      http: url => (url.endsWith('/admin/host/status') ? null : undefined),
    });

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(outcome.exitCode).toBe(4);
    expect(firstError(outcome).id).toBe('HOST-EXITED');
    expect(firstError(outcome).detail).toContain('Worker failed to index functions');
    expect(firstError(outcome).detail).not.toContain('secret123');
  });

  it('fails when the host is running but indexed no functions', async () => {
    writePython(HTTP_PY);
    const h = harness({ http: url => (url.endsWith('/admin/functions') ? { status: 200, headers: {}, body: '[]' } : undefined) });

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(outcome.exitCode).toBe(4);
    expect(firstError(outcome).id).toBe('NO-FUNCTIONS-INDEXED');
    expect(funcProcesses(h)[0].stopped).toBe(true);
  });

  it('times out when the host never reports Running', async () => {
    writePython(HTTP_PY);
    const h = harness({ http: url => (url.endsWith('/admin/host/status') ? null : undefined) });

    const outcome = await verifyLocal({ dir, timeoutSeconds: 5 }, h.deps);

    expect(outcome.exitCode).toBe(4);
    expect(firstError(outcome).id).toBe('HOST-NOT-READY');
    expect(funcProcesses(h)[0].stopped).toBe(true);
  });

  it('blocks when Azure Functions Core Tools is missing', async () => {
    writePython(HTTP_PY);
    const h = harness({ missing: ['func'] });

    const outcome = await verifyLocal({ dir, noInstall: true }, h.deps);

    expect(outcome.exitCode).toBe(3);
    expect(firstError(outcome).id).toBe('FUNC-NOT-FOUND');
  });

  it('sends POST to a POST-only function and skips route parameters', async () => {
    writePython(HTTP_PY);
    const h = harness({
      http: (url, method) => {
        if (url.endsWith('/admin/functions')) {
          return functionsBody([
            { name: 'byId', trigger: 'httpTrigger', route: 'items/{id}' },
            { name: 'create', trigger: 'httpTrigger', methods: ['post'] },
          ]);
        }
        if (url.endsWith('/api/create')) return { status: 201, headers: {}, body: method };
        return undefined;
      },
    });

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(outcome.body.data.invocation).toMatchObject({ function: 'create', method: 'POST', status: 201 });
  });

  it('prefers GET over POST and never sends POST to a PUT-only function', async () => {
    writePython(HTTP_PY);
    const routes = (functions: Parameters<typeof functionsBody>[0]): Route => url =>
      (url.endsWith('/admin/functions') ? functionsBody(functions) : undefined);

    const mixed = harness({ http: routes([
      { name: 'create', trigger: 'httpTrigger', methods: ['post'] },
      { name: 'read', trigger: 'httpTrigger', methods: ['get'] },
    ]) });
    expect((await verifyLocal({ dir }, mixed.deps)).body.data.invocation).toMatchObject({ function: 'read', method: 'GET' });

    const putOnly = harness({ http: routes([{ name: 'replace', trigger: 'httpTrigger', methods: ['put'] }]) });
    const outcome = await verifyLocal({ dir }, putOnly.deps);
    expect(outcome.body.data.invocation).toBeNull();
    expect(outcome.body.gaps[0]?.reason).toContain('GET or POST');
    expect(putOnly.requests.some(request => request.includes('/api/'))).toBe(false);

    const named = harness({ http: routes([{ name: 'replace', trigger: 'httpTrigger', methods: ['put', 'delete'] }]) });
    const explicit = await verifyLocal({ dir, invoke: 'replace' }, named.deps);
    expect(explicit.body.data.invocation).toBeNull();
    expect(explicit.body.gaps[0]?.reason).toContain('PUT, DELETE');
  });

  it('invokes the requested function', async () => {
    writePython(HTTP_PY);
    const h = harness({
      http: url => (url.endsWith('/admin/functions')
        ? functionsBody([{ name: 'a', trigger: 'httpTrigger' }, { name: 'b', trigger: 'httpTrigger' }])
        : undefined),
    });

    const outcome = await verifyLocal({ dir, invoke: 'b' }, h.deps);

    expect(outcome.body.data.invocation?.function).toBe('b');
  });

  it('installs and builds a Node.js app', async () => {
    writeFileSync(join(dir, 'host.json'), '{"version":"2.0"}');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' }, dependencies: { '@azure/functions': '^4' } }));
    mkdirSync(join(dir, 'src', 'functions'), { recursive: true });
    writeFileSync(join(dir, 'src', 'functions', 'hello.ts'), "app.http('hello', { handler });");
    const h = harness();

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(outcome.body.data.worker).toBe('node');
    expect(h.runner.calls).toEqual(expect.arrayContaining(['npm install', 'npm run build']));
    expect(JSON.parse(readFileSync(join(dir, 'local.settings.json'), 'utf-8')).Values.FUNCTIONS_WORKER_RUNTIME).toBe('node');
  });

  it('reports a failed dependency install without starting the host', async () => {
    writePython(HTTP_PY);
    const runner = fakeRunner({
      'uv --version': result({ notFound: true, code: null }),
      [`${join(dir, '.venv', 'bin', 'python')} -m pip install`]: result({ code: 1, stderr: 'No matching distribution' }),
    });
    const h = harness({ runner });

    const outcome = await verifyLocal({ dir }, h.deps);

    expect(outcome.exitCode).toBe(4);
    expect(firstError(outcome).id).toBe('INSTALL-FAILED');
    expect(funcProcesses(h)).toHaveLength(0);
  });

  it('finds the function project from azure.yaml', async () => {
    writeFileSync(join(dir, 'azure.yaml'), 'name: app\nservices:\n  api:\n    project: ./src\n    language: python\n    host: function\n');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'host.json'), '{"version":"2.0"}');
    writeFileSync(join(dir, 'src', 'function_app.py'), HTTP_PY);
    const h = harness();

    const outcome = await verifyLocal({ dir, noInstall: true }, h.deps);

    expect(outcome.body.data.functionDir).toBe(join(dir, 'src'));
    expect(existsSync(join(dir, 'src', 'local.settings.json'))).toBe(true);
  });

  it('blocks when no host.json exists', async () => {
    const outcome = await verifyLocal({ dir }, harness().deps);

    expect(outcome.exitCode).toBe(3);
    expect(firstError(outcome).id).toBe('NO-FUNCTIONS-PROJECT');
  });

  it('reports Java as not supported by this command', async () => {
    writeFileSync(join(dir, 'host.json'), '{"version":"2.0"}');
    writeFileSync(join(dir, 'pom.xml'), '<project/>');
    const outcome = await verifyLocal({ dir }, harness().deps);

    expect(outcome.exitCode).toBe(3);
    expect(firstError(outcome).id).toBe('LOCAL-WORKER-UNSUPPORTED');
  });
});

describe('local verify command line', () => {
  it('rejects a port that is not a number', async () => {
    const h = harness();
    const outcome = await runCli(['local', 'verify', '--dir', dir, '--port', 'abc'], {
      run: h.deps.run, now: h.deps.now, sleep: h.deps.sleep, fetchStatus: async () => 200, local: h.deps,
    });

    expect(outcome.exitCode).toBe(2);
  });

  it('passes options to local verify', async () => {
    writePython(HTTP_PY);
    const h = harness();
    const outcome = await runCli(['local', 'verify', '--dir', dir, '--port', '7080', '--no-install'], {
      run: h.deps.run, now: h.deps.now, sleep: h.deps.sleep, fetchStatus: async () => 200, local: h.deps,
    });

    expect(outcome.exitCode).toBe(0);
    expect(funcProcesses(h)[0].args).toEqual(['start', '--port', '7080']);
    expect(h.runner.calls.some(call => call.includes('pip install'))).toBe(false);
  });
});
describe('local process helpers', () => {
  it('gives up on a server that keeps trickling data past the deadline', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200);
      const timer = setInterval(() => response.write('.'), 20);
      response.on('close', () => clearInterval(timer));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const started = Date.now();
      const response = await loopbackRequest(`http://127.0.0.1:${port}/`, { timeoutMs: 300 });
      expect(response).toBeNull();
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('returns the status, headers and body of a loopback response', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(201, { server: 'Azurite-Blob/3.34.0' });
      response.end('ok');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      expect(await loopbackRequest(`http://127.0.0.1:${port}/`)).toEqual({
        status: 201, headers: expect.objectContaining({ server: 'Azurite-Blob/3.34.0' }), body: 'ok',
      });
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('stops a started process and can release one without stopping it', async () => {
    const start = createStarter();
    const script = 'setInterval(() => {}, 1000)';
    const owned = start('node', ['-e', script], { cwd: dir });
    expect(owned?.pid).toBeTypeOf('number');
    await owned?.stop();
    expect(owned?.exitCode()).not.toBeUndefined();

    const kept = start('node', ['-e', script], { cwd: dir });
    kept?.release();
    expect(kept?.exitCode()).toBeUndefined();
    await kept?.stop();
    expect(kept?.exitCode()).not.toBeUndefined();
  }, 20_000);
});
