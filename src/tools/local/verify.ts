import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Runner } from '../shared/exec.js';
import { EXIT, fail, succeed, type Finding, type Gap, type ToolResult } from '../shared/output.js';
import { redact } from '../shared/redact.js';
import { ensureToolDir, toolDir } from '../shared/work-dir.js';
import {
  detectWorker, findFunctionDir, readLocalSettings, scanTriggers, STORAGE_TRIGGERS, storageConnection,
  workerRuntimeSetting, type StorageConnection, type TriggerKind, type WorkerFamily,
} from './project.js';

const COMMAND = 'local verify';
const DEFAULT_PORT = 7071;
const DEFAULT_TIMEOUT_SECONDS = 120;
const AZURITE_TIMEOUT_MS = 60_000;
const POLL_MS = 1_000;
const INDEX_RETRIES = 3;
const INSTALL_TIMEOUT_MS = 900_000;
const BODY_PREVIEW = 500;
const OUTPUT_TAIL_LINES = 40;
const AZURITE_PORTS = { blob: 10000, queue: 10001, table: 10002 } as const;
const AZURITE_IMAGE = 'mcr.microsoft.com/azure-storage/azurite';

export interface StartOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** A long-running process this command started and owns. */
export interface BackgroundProcess {
  readonly pid: number | undefined;
  /** The most recent stdout and stderr text. */
  output(): string;
  /** `undefined` while running; the exit code or `null` after it ended. */
  exitCode(): number | null | undefined;
  /** Stops the process and its children. */
  stop(): Promise<void>;
  /** Leaves the process running and lets this command exit without waiting for it. */
  release(): void;
}

/** Starts a command in the background. Returns `null` when the command is not on PATH. */
export type Starter = (command: string, args: readonly string[], options: StartOptions) => BackgroundProcess | null;

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface HttpRequestOptions {
  readonly method?: string;
  readonly body?: string;
  readonly timeoutMs?: number;
}

/** A direct loopback request without any proxy. Returns `null` when nothing answered. */
export type HttpRequest = (url: string, options?: HttpRequestOptions) => Promise<HttpResponse | null>;

export interface LocalDependencies {
  readonly run: Runner;
  readonly start: Starter;
  readonly http: HttpRequest;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => Date;
  readonly portInUse: (port: number) => Promise<boolean>;
  readonly freePort: () => Promise<number>;
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface LocalVerifyOptions {
  readonly dir: string;
  readonly port?: number;
  readonly timeoutSeconds?: number;
  readonly invoke?: string;
  readonly startAzurite?: boolean;
  readonly keepAzurite?: boolean;
  readonly noInstall?: boolean;
}

export type AzuriteState = 'not-needed' | 'running' | 'started' | 'not-running' | 'incomplete' | 'conflict';

export type AzuriteService = 'blob' | 'queue' | 'table';

export interface IndexedFunction {
  readonly name: string;
  readonly trigger: string;
}

export interface Invocation {
  readonly function: string;
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly status: number | null;
  readonly body: string;
}

export interface LocalVerifyData {
  readonly functionDir: string | null;
  readonly worker: WorkerFamily | null;
  readonly triggers: TriggerKind[];
  readonly settings: { readonly path: string; created: boolean };
  readonly storage: { connection: StorageConnection; need: 'required' | 'optional' | 'none'; azurite: AzuriteState };
  readonly install: { skipped: boolean; readonly steps: string[] };
  host: { readonly port: number; state: string; readyMs: number | null } | null;
  functions: IndexedFunction[];
  invocation: Invocation | null;
  readonly cleanup: { host: 'stopped' | 'not-started'; azurite: 'stopped' | 'kept' | 'not-started' };
}

interface AzuriteHandle {
  readonly stop: () => Promise<void>;
  readonly release: () => void;
  readonly description: string;
}

interface Context {
  readonly options: LocalVerifyOptions;
  readonly deps: LocalDependencies;
  readonly root: string;
  readonly functionDir: string;
  readonly data: LocalVerifyData;
  readonly findings: Finding[];
  readonly gaps: Gap[];
  azurite: AzuriteHandle | null;
  host: BackgroundProcess | null;
  index: AdminFunction[];
}

class Stop extends Error {
  constructor(readonly exitCode: typeof EXIT.blocked | typeof EXIT.stepFailed, readonly summary: string) {
    super(summary);
  }
}

export async function verifyLocal(options: LocalVerifyOptions, deps: LocalDependencies): Promise<ToolResult<LocalVerifyData>> {
  const root = resolve(options.dir);
  const functionDir = existsSync(root) ? findFunctionDir(root) : null;
  if (!functionDir) {
    return fail(COMMAND, EXIT.blocked, 'No Azure Functions project was found', {
      findings: [{
        id: 'NO-FUNCTIONS-PROJECT', severity: 'error', title: `No host.json in ${root} or its function service folder`,
        fix: 'Pass --dir with the folder that contains host.json, or create the project with template write.',
      }],
    });
  }

  const settings = readLocalSettings(functionDir);
  const worker = detectWorker(functionDir, settings);
  const triggers = scanTriggers(functionDir);
  const context: Context = {
    options, deps, root, functionDir,
    data: {
      functionDir, worker, triggers,
      settings: { path: settings.path, created: false },
      storage: { connection: 'missing', need: 'none', azurite: 'not-needed' },
      install: { skipped: false, steps: [] },
      host: null, functions: [], invocation: null,
      cleanup: { host: 'not-started', azurite: 'not-started' },
    },
    findings: [], gaps: [], azurite: null, host: null, index: [],
  };

  try {
    if (!worker || worker === 'java' || worker === 'custom') throw unsupportedWorker(context, worker);
    const values = ensureSettings(context, worker, settings);
    await prepareStorage(context, values);
    await checkCoreTools(context);
    const env = await installDependencies(context, worker);
    const port = await choosePort(context);
    await startHost(context, port, env);
    await readFunctionIndex(context, port);
    await invokeHttp(context, port);
  } catch (error) {
    await cleanUp(context);
    if (error instanceof Stop) {
      return fail(COMMAND, error.exitCode, error.summary, { data: context.data, findings: context.findings, gaps: context.gaps });
    }
    throw error;
  }
  await cleanUp(context);

  const invoked = context.data.invocation;
  const summary = invoked
    ? `The host ran ${context.data.functions.length} function(s); ${invoked.method} ${invoked.function} returned ${invoked.status}`
    : `The host ran ${context.data.functions.length} function(s)`;
  return succeed(COMMAND, summary, context.data, {
    findings: context.findings,
    gaps: context.gaps,
    next: { action: 'deploy', reason: 'The app starts and indexes its functions locally.', command: `deploy plan --dir "${root}"` },
  });
}

function unsupportedWorker(context: Context, worker: WorkerFamily | null): Stop {
  context.findings.push(worker === 'java'
    ? {
      id: 'LOCAL-WORKER-UNSUPPORTED', severity: 'error', title: 'Java apps are not run by this command',
      fix: 'Run `mvn clean package`, then `mvn azure-functions:run` (or `func start` in the staging folder under target/azure-functions).',
    }
    : {
      id: 'LOCAL-WORKER-UNSUPPORTED', severity: 'error',
      title: worker ? `The ${worker} worker is not run by this command` : 'The worker runtime could not be detected',
      fix: 'Set FUNCTIONS_WORKER_RUNTIME in local.settings.json, or run `func start` manually.',
    });
  return new Stop(EXIT.blocked, 'This app cannot be verified by local verify');
}

function ensureSettings(context: Context, worker: WorkerFamily, settings: ReturnType<typeof readLocalSettings>): Readonly<Record<string, string>> {
  if (settings.exists) {
    if (!settings.values.FUNCTIONS_WORKER_RUNTIME) {
      context.findings.push({
        id: 'SETTINGS-NO-WORKER', severity: 'warn', title: 'local.settings.json has no FUNCTIONS_WORKER_RUNTIME',
        fix: `Add "FUNCTIONS_WORKER_RUNTIME": "${workerRuntimeSetting(worker)}" under Values.`,
      });
    }
    return settings.values;
  }
  const values = { FUNCTIONS_WORKER_RUNTIME: workerRuntimeSetting(worker), AzureWebJobsStorage: 'UseDevelopmentStorage=true' };
  writeFileSync(settings.path, `${JSON.stringify({ IsEncrypted: false, Values: values }, null, 2)}\n`);
  context.data.settings.created = true;
  return values;
}

async function prepareStorage(context: Context, values: Readonly<Record<string, string>>): Promise<void> {
  const { data, options } = context;
  const connection = storageConnection(values);
  const need = data.triggers.some(kind => STORAGE_TRIGGERS.has(kind)) ? 'required' : 'optional';
  data.storage.connection = connection;
  data.storage.need = need;

  if (connection === 'missing') {
    if (need === 'required') {
      context.findings.push({
        id: 'STORAGE-NOT-CONFIGURED', severity: 'error',
        title: `AzureWebJobsStorage is empty, but ${data.triggers.filter(kind => STORAGE_TRIGGERS.has(kind)).join(', ')} triggers need storage`,
        fix: 'Set "AzureWebJobsStorage": "UseDevelopmentStorage=true" in local.settings.json and use Azurite.',
      });
      throw new Stop(EXIT.blocked, 'Local storage is not configured');
    }
    return;
  }
  if (connection === 'other') return;

  const required = azuriteServices(data.triggers);
  const probe = await probeAzurite(context.deps, required);
  data.storage.azurite = probe.state;
  if (probe.state === 'conflict') {
    context.findings.push({
      id: 'AZURITE-PORT-CONFLICT', severity: need === 'required' ? 'error' : 'warn',
      title: 'Another program answers on an Azurite port (10000-10002)',
      detail: `Ports: ${probe.foreign.map(service => AZURITE_PORTS[service]).join(', ')}`,
      fix: 'Stop that program, or point AzureWebJobsStorage at a running Azurite instance.',
    });
    if (need === 'required') throw new Stop(EXIT.blocked, 'Azurite ports are used by another program');
    return;
  }
  if (probe.state === 'incomplete') {
    context.findings.push({
      id: 'AZURITE-INCOMPLETE', severity: need === 'required' ? 'error' : 'warn',
      title: `Azurite is running without the ${probe.missing.join(', ')} service`,
      detail: `This app needs ${required.join(', ')}. Missing ports: ${probe.missing.map(service => AZURITE_PORTS[service]).join(', ')}`,
      fix: 'Restart Azurite with all services (the `azurite` command, not `azurite-blob` alone), then run this command again.',
    });
    if (need === 'required') throw new Stop(EXIT.blocked, 'Azurite is missing a required service');
    return;
  }
  if (probe.state === 'running') return;
  if (options.startAzurite) {
    await startAzurite(context, required);
    data.storage.azurite = 'started';
    return;
  }
  if (need === 'required') {
    context.findings.push({
      id: 'AZURITE-NOT-RUNNING', severity: 'error',
      title: 'The app uses development storage, and Azurite is not running',
      fix: 'Run this command again with --start-azurite, or start Azurite yourself.',
    });
    throw new Stop(EXIT.blocked, 'Azurite is not running');
  }
  context.findings.push({
    id: 'AZURITE-NOT-RUNNING', severity: 'info',
    title: 'Azurite is not running. HTTP functions run without it; add --start-azurite to start it.',
  });
}

/** The Azurite services the host and these triggers use. */
export function azuriteServices(triggers: readonly TriggerKind[]): AzuriteService[] {
  const services = new Set<AzuriteService>(['blob']);
  if (triggers.some(kind => kind === 'queue' || kind === 'blob' || kind === 'durable')) services.add('queue');
  if (triggers.includes('durable')) services.add('table');
  return [...services];
}

interface AzuriteProbe {
  readonly state: 'running' | 'not-running' | 'incomplete' | 'conflict';
  readonly missing: AzuriteService[];
  readonly foreign: AzuriteService[];
}

async function probeAzurite(deps: LocalDependencies, required: readonly AzuriteService[]): Promise<AzuriteProbe> {
  const services = Object.keys(AZURITE_PORTS) as AzuriteService[];
  const responses = await Promise.all(services.map(service =>
    deps.http(`http://127.0.0.1:${AZURITE_PORTS[service]}/`, { timeoutMs: 2_000 })));
  const answer = new Map(services.map((service, index) => [service, responses[index]]));
  const foreign = services.filter(service => {
    const response = answer.get(service);
    return response !== null && response !== undefined && !/azurite/i.test(response.headers.server ?? '');
  });
  const missing = required.filter(service => !answer.get(service));
  if (foreign.length > 0) return { state: 'conflict', missing, foreign };
  if (missing.length === 0) return { state: 'running', missing, foreign };
  if (responses.every(response => !response)) return { state: 'not-running', missing, foreign };
  return { state: 'incomplete', missing, foreign };
}

async function startAzurite(context: Context, required: readonly AzuriteService[]): Promise<void> {
  const { deps, root } = context;
  const location = join(toolDir(root), 'azurite');
  ensureToolDir(root, 'azurite');
  const process = deps.start('azurite', ['--silent', '--skipApiVersionCheck', '--location', location], { cwd: root });
  if (process) {
    context.azurite = {
      stop: () => process.stop(), release: () => process.release(),
      description: `azurite (pid ${process.pid ?? 'unknown'})`,
    };
  } else {
    const ports = Object.values(AZURITE_PORTS).flatMap(port => ['-p', `127.0.0.1:${port}:${port}`]);
    const run = await deps.run('docker', ['run', '-d', '--rm', ...ports, AZURITE_IMAGE], { timeoutMs: INSTALL_TIMEOUT_MS });
    const containerId = run.stdout.trim().split(/\s+/).pop() ?? '';
    if (run.notFound || run.code !== 0 || !containerId) {
      context.findings.push({
        id: 'AZURITE-UNAVAILABLE', severity: 'error', title: 'Azurite could not be started',
        detail: run.notFound ? 'Neither the azurite command nor docker is on PATH.' : redact(tail(run.stderr || run.stdout)),
        fix: 'Install Azurite with `npm install -g azurite`, or start Docker Desktop, then run this command again.',
      });
      throw new Stop(EXIT.blocked, 'Azurite could not be started');
    }
    context.azurite = {
      stop: async () => { await deps.run('docker', ['stop', containerId], { timeoutMs: 60_000 }); },
      release: () => undefined,
      description: `docker container ${containerId.slice(0, 12)}`,
    };
  }

  const deadline = deps.now().getTime() + AZURITE_TIMEOUT_MS;
  while (deps.now().getTime() < deadline) {
    if (process && process.exitCode() !== undefined) break;
    if ((await probeAzurite(deps, required)).state === 'running') return;
    await deps.sleep(500);
  }
  context.findings.push({
    id: 'AZURITE-NOT-READY', severity: 'error', title: `Azurite did not start answering for ${required.join(', ')}`,
    detail: process ? redact(tail(process.output())) : undefined,
    fix: 'Start Azurite manually and check its output.',
  });
  throw new Stop(EXIT.stepFailed, 'Azurite did not become ready');
}

async function checkCoreTools(context: Context): Promise<void> {
  const version = await context.deps.run('func', ['--version'], { timeoutMs: 30_000 });
  if (version.notFound) throw funcNotFound(context);
}

function funcNotFound(context: Context): Stop {
  context.findings.push({
    id: 'FUNC-NOT-FOUND', severity: 'error', title: 'Azure Functions Core Tools (func) is not on PATH',
    fix: 'Install Core Tools v4: https://learn.microsoft.com/azure/azure-functions/functions-run-local#install-the-azure-functions-core-tools',
  });
  return new Stop(EXIT.blocked, 'Azure Functions Core Tools is missing');
}

type HostEnv = Readonly<Record<string, string | undefined>> | undefined;

async function installDependencies(context: Context, worker: WorkerFamily): Promise<HostEnv> {
  if (worker === 'python') return installPython(context);
  if (worker === 'node') await installNode(context);
  else context.data.install.skipped = true;
  return undefined;
}

async function installPython(context: Context): Promise<HostEnv> {
  const { deps, functionDir, data, options } = context;
  const scripts = deps.platform === 'win32' ? 'Scripts' : 'bin';
  const venv = join(functionDir, '.venv');
  const binDir = join(venv, scripts);
  const python = join(binDir, deps.platform === 'win32' ? 'python.exe' : 'python');
  const requirements = join(functionDir, 'requirements.txt');
  const hash = existsSync(requirements) ? hashFiles([requirements]) : null;
  const venvExists = existsSync(python);

  if (options.noInstall || (venvExists && (hash === null || readMarker(context, 'python') === hash))) {
    data.install.skipped = true;
  } else {
    const uv = await deps.run('uv', ['--version'], { timeoutMs: 30_000 });
    const useUv = !uv.notFound && uv.code === 0;
    if (!venvExists) {
      if (useUv) await step(context, 'uv', ['venv', '.venv']);
      else await step(context, await basePython(context), ['-m', 'venv', '.venv']);
    }
    if (hash !== null) {
      if (useUv) await step(context, 'uv', ['pip', 'install', '-r', 'requirements.txt', '--python', python]);
      else await step(context, python, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
      writeMarker(context, 'python', hash);
    }
  }
  if (!existsSync(binDir) && data.install.skipped && !venvExists) return undefined;
  return withPath(deps, binDir, { VIRTUAL_ENV: venv, languageWorkers__python__defaultExecutablePath: python });
}

async function basePython(context: Context): Promise<string> {
  const candidates = context.deps.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const candidate of candidates) {
    const version = await context.deps.run(candidate, ['--version'], { timeoutMs: 30_000 });
    if (!version.notFound && version.code === 0) return candidate;
  }
  context.findings.push({
    id: 'PYTHON-NOT-FOUND', severity: 'error', title: 'Python is not on PATH',
    fix: 'Install a Python version that Azure Functions supports (3.10 to 3.13), or install uv.',
  });
  throw new Stop(EXIT.blocked, 'Python is missing');
}

async function installNode(context: Context): Promise<void> {
  const { functionDir, data, options } = context;
  const packageJsonPath = join(functionDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    data.install.skipped = true;
    return;
  }
  const hash = hashFiles([packageJsonPath, join(functionDir, 'package-lock.json')]);
  const installed = existsSync(join(functionDir, 'node_modules')) && readMarker(context, 'node') === hash;
  if (options.noInstall) {
    data.install.skipped = true;
    return;
  }
  if (installed) data.install.skipped = true;
  else {
    await step(context, 'npm', ['install']);
    writeMarker(context, 'node', hash);
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { scripts?: Record<string, unknown> };
  if (typeof packageJson.scripts?.build === 'string') await step(context, 'npm', ['run', 'build']);
}

async function step(context: Context, command: string, args: readonly string[]): Promise<void> {
  const line = [command, ...args].join(' ');
  context.data.install.steps.push(line);
  const outcome = await context.deps.run(command, args, { cwd: context.functionDir, timeoutMs: INSTALL_TIMEOUT_MS });
  if (outcome.code === 0) return;
  context.findings.push({
    id: 'INSTALL-FAILED', severity: 'error', title: `\`${line}\` failed`,
    detail: outcome.notFound ? `${command} is not on PATH.` : redact(tail(outcome.stderr || outcome.stdout)),
    fix: 'Fix the dependency problem, then run local verify again.',
  });
  throw new Stop(EXIT.stepFailed, 'Installing dependencies failed');
}

async function choosePort(context: Context): Promise<number> {
  const { deps, options } = context;
  if (options.port !== undefined) {
    if (!await deps.portInUse(options.port)) return options.port;
    context.findings.push({
      id: 'PORT-IN-USE', severity: 'error', title: `Port ${options.port} is already in use`,
      fix: 'Stop the program that uses the port, or omit --port to use a free port.',
    });
    throw new Stop(EXIT.blocked, `Port ${options.port} is in use`);
  }
  return await deps.portInUse(DEFAULT_PORT) ? deps.freePort() : DEFAULT_PORT;
}

async function startHost(context: Context, port: number, env: HostEnv): Promise<void> {
  const { deps, functionDir, options, data } = context;
  const host = deps.start('func', ['start', '--port', String(port)], { cwd: functionDir, ...(env ? { env } : {}) });
  if (!host) throw funcNotFound(context);
  context.host = host;
  data.host = { port, state: 'Starting', readyMs: null };
  const started = deps.now().getTime();
  const deadline = started + (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;

  while (deps.now().getTime() < deadline) {
    if (host.exitCode() !== undefined) {
      data.host.state = 'Exited';
      context.findings.push({
        id: 'HOST-EXITED', severity: 'error', title: `func start exited with code ${host.exitCode() ?? 'unknown'} before it was ready`,
        detail: redact(tail(host.output())),
        fix: 'Read the host output in detail. Fix the error, then run local verify again.',
      });
      throw new Stop(EXIT.stepFailed, 'The Functions host stopped during startup');
    }
    const status = await deps.http(`http://127.0.0.1:${port}/admin/host/status`, { timeoutMs: 5_000 });
    const state = status?.status === 200 ? hostState(status.body) : null;
    if (state) data.host.state = state;
    if (state === 'Running') {
      data.host.readyMs = deps.now().getTime() - started;
      return;
    }
    await deps.sleep(POLL_MS);
  }
  context.findings.push({
    id: 'HOST-NOT-READY', severity: 'error',
    title: `The host did not report Running within ${options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS} seconds (last state: ${data.host.state})`,
    detail: redact(tail(host.output())),
    fix: 'Read the host output. If a proxy is configured, add localhost and 127.0.0.1 to NO_PROXY.',
  });
  throw new Stop(EXIT.stepFailed, 'The Functions host did not become ready');
}

function hostState(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { state?: unknown };
    return typeof parsed.state === 'string' ? parsed.state : null;
  } catch {
    return null;
  }
}

interface AdminFunction {
  readonly name?: unknown;
  readonly invoke_url_template?: unknown;
  readonly config?: { readonly bindings?: ReadonlyArray<{ readonly type?: unknown; readonly methods?: unknown }> };
}

async function readFunctionIndex(context: Context, port: number): Promise<void> {
  const { deps } = context;
  let functions: AdminFunction[] = [];
  for (let attempt = 0; attempt < INDEX_RETRIES && functions.length === 0; attempt++) {
    if (attempt > 0) await deps.sleep(POLL_MS);
    const response = await deps.http(`http://127.0.0.1:${port}/admin/functions`, { timeoutMs: 10_000 });
    functions = response?.status === 200 ? parseFunctions(response.body) : [];
  }
  context.index = functions;
  context.data.functions = functions.map(fn => ({ name: String(fn.name), trigger: triggerType(fn) }));
  if (functions.length > 0) return;
  context.findings.push({
    id: 'NO-FUNCTIONS-INDEXED', severity: 'error', title: 'The host is running but found no functions',
    detail: redact(tail(context.host?.output() ?? '')),
    fix: 'Check that the function code is registered (decorators, app.* calls, or attributes) and that the build output is current.',
  });
  throw new Stop(EXIT.stepFailed, 'No functions were indexed');
}

function parseFunctions(body: string): AdminFunction[] {
  try {
    const parsed = JSON.parse(body) as unknown;
    return Array.isArray(parsed) ? (parsed as AdminFunction[]).filter(fn => typeof fn?.name === 'string') : [];
  } catch {
    return [];
  }
}

function triggerType(fn: AdminFunction): string {
  const binding = fn.config?.bindings?.find(item => typeof item.type === 'string' && /trigger$/i.test(item.type));
  return typeof binding?.type === 'string' ? binding.type : 'unknown';
}

async function invokeHttp(context: Context, port: number): Promise<void> {
  const { deps, options, data } = context;
  const functions = context.index.filter(fn => /^httptrigger$/i.test(triggerType(fn)));
  const methodsOf = (fn: AdminFunction): string[] => {
    const methods = fn.config?.bindings?.find(item => /^httptrigger$/i.test(String(item.type)))?.methods;
    return Array.isArray(methods) ? methods.map(method => String(method).toLowerCase()) : [];
  };
  const callable = (fn: AdminFunction) => typeof fn.invoke_url_template === 'string' && !fn.invoke_url_template.includes('{');

  const methodOf = (fn: AdminFunction): 'GET' | 'POST' | null => {
    const methods = methodsOf(fn);
    if (methods.length === 0 || methods.includes('get')) return 'GET';
    return methods.includes('post') ? 'POST' : null;
  };

  let target: AdminFunction | undefined;
  if (options.invoke) {
    target = functions.find(fn => fn.name === options.invoke);
    if (!target) {
      context.findings.push({
        id: 'INVOKE-NOT-FOUND', severity: 'warn', title: `No HTTP function named ${options.invoke} was indexed`,
        detail: `HTTP functions: ${functions.map(fn => String(fn.name)).join(', ') || 'none'}`,
      });
      return;
    }
    if (!callable(target)) {
      context.gaps.push({ check: `invoke ${options.invoke}`, reason: 'The route has parameters. Request it manually with real values.' });
      return;
    }
  } else {
    const candidates = functions.filter(callable);
    target = candidates.find(fn => methodOf(fn) === 'GET') ?? candidates.find(fn => methodOf(fn) === 'POST');
    if (!target) {
      if (candidates.length > 0) {
        context.gaps.push({ check: 'invoke', reason: 'No HTTP function accepts GET or POST. Request one manually.' });
      } else if (functions.length > 0) {
        context.gaps.push({ check: 'invoke', reason: 'Every HTTP function has route parameters. Request one manually.' });
      }
      return;
    }
  }

  const method = methodOf(target);
  if (!method) {
    context.gaps.push({
      check: `invoke ${String(target.name)}`,
      reason: `The function accepts only ${methodsOf(target).join(', ').toUpperCase()}. Request it manually.`,
    });
    return;
  }
  const url = String(target.invoke_url_template).replace(/^https?:\/\/[^/]+/i, `http://127.0.0.1:${port}`);
  const response = await deps.http(url, { method, timeoutMs: 30_000, ...(method === 'POST' ? { body: '{}' } : {}) });
  data.invocation = {
    function: String(target.name), method, url,
    status: response?.status ?? null,
    body: redact((response?.body ?? '').slice(0, BODY_PREVIEW)),
  };
  if (!response || response.status >= 500) {
    context.findings.push({
      id: 'INVOKE-FAILED', severity: 'error',
      title: response ? `${method} ${target.name} returned ${response.status}` : `${method} ${target.name} got no response`,
      detail: redact(tail(context.host?.output() ?? '')),
      fix: 'Read the host output for the exception, fix the function, and run local verify again.',
    });
    throw new Stop(EXIT.stepFailed, 'The HTTP function failed');
  }
  if (response.status >= 400) {
    context.findings.push({
      id: 'INVOKE-CLIENT-ERROR', severity: 'warn', title: `${method} ${target.name} returned ${response.status}`,
      detail: 'The function may need a query string or a request body.',
    });
  }
}

async function cleanUp(context: Context): Promise<void> {
  const { data } = context;
  if (context.host) {
    await context.host.stop();
    data.cleanup.host = 'stopped';
    context.host = null;
  }
  if (context.azurite) {
    if (context.options.keepAzurite) {
      context.azurite.release();
      data.cleanup.azurite = 'kept';
      context.findings.push({ id: 'AZURITE-KEPT', severity: 'info', title: `Azurite is still running: ${context.azurite.description}` });
    } else {
      await context.azurite.stop();
      data.cleanup.azurite = 'stopped';
    }
    context.azurite = null;
  }
}

function withPath(deps: LocalDependencies, directory: string, extra: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...deps.env };
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  const separator = deps.platform === 'win32' ? ';' : ':';
  env[key] = env[key] ? `${directory}${separator}${env[key]}` : directory;
  return { ...env, ...extra };
}

function hashFiles(paths: readonly string[]): string {
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path);
    hash.update('\0');
    if (existsSync(path)) hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

type MarkerFile = Record<string, Record<string, string>>;

function markerPath(root: string): string {
  return join(toolDir(root), 'local-install.json');
}

function readMarkers(root: string): MarkerFile {
  try {
    return JSON.parse(readFileSync(markerPath(root), 'utf-8')) as MarkerFile;
  } catch {
    return {};
  }
}

function readMarker(context: Context, worker: string): string | undefined {
  return readMarkers(context.root)[context.functionDir]?.[worker];
}

function writeMarker(context: Context, worker: string, hash: string): void {
  ensureToolDir(context.root);
  const markers = readMarkers(context.root);
  markers[context.functionDir] = { ...markers[context.functionDir], [worker]: hash };
  writeFileSync(markerPath(context.root), `${JSON.stringify(markers, null, 2)}\n`);
}

function tail(text: string): string {
  return text.split(/\r?\n/).filter(line => line.trim()).slice(-OUTPUT_TAIL_LINES).join('\n');
}
