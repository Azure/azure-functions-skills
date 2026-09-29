// Example preflight plugin for the update scenario. It is not part of the skill-bench core.
// It stops a paid run before the first model call when a pinned tool version differs
// or when a required local service (Azurite) does not accept connections.
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import type { PreflightPlugin, PreflightRunContext, PreflightRunReport } from '../../../src/plugins.ts';

export interface ToolPin {
  args: string[];
  version: string;
}

export interface HostOptions {
  tools: Record<string, ToolPin>;
  ports: Record<string, number>;
  readyTimeoutSeconds: number;
}

export interface ToolResult {
  status: number | null;
  stdout: string;
  error?: Error;
}

export type ToolSpawn = (command: string, env: NodeJS.ProcessEnv) => ToolResult;

const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const safeArg = /^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$|^--?[A-Za-z0-9][A-Za-z0-9._=-]{0,62}$/;
const exactVersion = /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`host-preflight: ${message}`);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseOptions(value: unknown): HostOptions {
  check(isObject(value), 'options must be an object.');
  const { tools, ports = {}, readyTimeoutSeconds = 60, ...rest } = value;
  check(Object.keys(rest).length === 0, `unknown option ${Object.keys(rest)[0]}.`);
  check(isObject(tools) && Object.keys(tools).length > 0, 'tools must map at least one tool name to a pin.');
  const parsed: Record<string, ToolPin> = {};
  for (const [name, pin] of Object.entries(tools)) {
    check(safeName.test(name), `the tool name ${JSON.stringify(name)} is not safe.`);
    check(isObject(pin), `the pin for ${name} must be an object.`);
    const { args, version } = pin;
    check(Array.isArray(args) && args.every(arg => typeof arg === 'string' && safeArg.test(arg)),
      `args for ${name} must be a list of simple arguments, such as --version.`);
    check(typeof version === 'string' && exactVersion.test(version),
      `the pin for ${name} must be an exact version, such as 4.15.1.`);
    parsed[name] = { args: args as string[], version };
  }
  check(isObject(ports) && Object.entries(ports).every(([name, port]) => safeName.test(name)
    && typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536),
  'ports must map names to TCP port numbers.');
  check(typeof readyTimeoutSeconds === 'number' && readyTimeoutSeconds > 0 && readyTimeoutSeconds <= 600,
    'readyTimeoutSeconds must be a number from 1 to 600.');
  return { tools: parsed, ports: ports as Record<string, number>, readyTimeoutSeconds };
}

/** Parts are validated, so the command line has no user input and no shell syntax. */
export function toolCommand(name: string, args: string[]): string {
  return [name, ...args].join(' ');
}

// npm installs `func` and `azurite` as .cmd files on Windows, and Node starts a .cmd file only through a shell.
const defaultSpawn: ToolSpawn = (command, env) => {
  const child = spawnSync(command, { env, shell: true, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: child.status, stdout: `${child.stdout ?? ''}\n${child.stderr ?? ''}`, error: child.error };
};

/**
 * Compare each installed tool with its pin. A difference stops the run, unless
 * the operator sets SKILL_BENCH_ALLOW_TOOL_DRIFT=1. Then it is a warning, and the
 * installed version is recorded.
 */
export function checkTools(options: HostOptions, env: NodeJS.ProcessEnv, operator: NodeJS.ProcessEnv = process.env,
  spawn: ToolSpawn = defaultSpawn): Required<PreflightRunReport> {
  const tools: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [name, pin] of Object.entries(options.tools)) {
    const child = spawn(toolCommand(name, pin.args), env);
    check(!child.error && child.status === 0,
      `cannot start ${name}. Install ${name} ${pin.version} and make sure that it is on PATH.`);
    const found = /\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?/.exec(child.stdout)?.[0];
    check(found, `${name} printed no version. Install ${name} ${pin.version}.`);
    tools[name] = found;
    if (found === pin.version) continue;
    const message = `${name} ${found} is installed, but this scenario pins ${pin.version}.`;
    check(operator.SKILL_BENCH_ALLOW_TOOL_DRIFT === '1', `${message} Install ${name} ${pin.version}, or set `
      + 'SKILL_BENCH_ALLOW_TOOL_DRIFT=1 to continue. The run then records the installed version as a warning.');
    warnings.push(message);
  }
  return { tools, warnings };
}

function probe(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(done => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (open: boolean) => { socket.destroy(); done(open); };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Wait until each loopback port accepts a TCP connection, for a bounded time. */
export async function checkPorts(ports: Record<string, number>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (const [name, port] of Object.entries(ports)) {
    for (;;) {
      if (await probe(port, Math.max(100, Math.min(1_000, deadline - Date.now())))) break;
      check(Date.now() < deadline, `${name} is not ready on 127.0.0.1:${port} after ${timeoutMs / 1000} s. `
        + 'Start the service (for example a dedicated Azurite instance), then run again.');
      await new Promise(done => { setTimeout(done, 100); });
    }
  }
}

export const preflight: PreflightPlugin = {
  name: 'host-preflight',
  validate(options) {
    parseOptions(options);
  },
  async run(context: PreflightRunContext) {
    const options = parseOptions(context.options);
    const report = checkTools(options, context.env);
    await checkPorts(options.ports, options.readyTimeoutSeconds * 1000);
    return report;
  },
};
