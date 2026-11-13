import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { buildInvocation, resolveExecutable } from '../shared/exec.js';
import type { BackgroundProcess, HttpRequest, HttpResponse, LocalDependencies, Starter } from './verify.js';

const OUTPUT_LIMIT = 64 * 1024;
const STOP_GRACE_MS = 5_000;

type Environment = Readonly<Record<string, string | undefined>>;

export function createStarter(environment: Environment = process.env, platform = process.platform): Starter {
  return (command, args, options) => {
    const env = options.env ?? environment;
    const file = resolveExecutable(command, {
      platform, path: env.PATH ?? env.Path ?? '', pathExt: env.PATHEXT, exists: existsSync,
    });
    if (!file) return null;
    const invocation = buildInvocation(file, args, platform);
    const child = spawn(invocation.file, invocation.args, {
      cwd: options.cwd,
      env: { ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: invocation.verbatim,
      // A separate process group lets POSIX stop the host together with its worker.
      detached: platform !== 'win32',
    });
    let output = '';
    let exit: number | null | undefined;
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString('utf-8')).slice(-OUTPUT_LIMIT);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const exited = new Promise<void>(resolve => {
      child.on('exit', code => { exit = code; resolve(); });
      child.on('error', error => { output += `\n${error.message}`; exit = null; resolve(); });
    });

    const closePipes = () => {
      child.stdout.destroy();
      child.stderr.destroy();
    };

    const process_: BackgroundProcess = {
      pid: child.pid,
      output: () => output,
      exitCode: () => exit,
      release: () => {
        closePipes();
        child.unref();
      },
      stop: async () => {
        const pid = child.pid;
        if (pid === undefined) return;
        if (platform === 'win32') {
          if (exit === undefined) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else {
          // Signal the group even after the parent ended: its worker may still run.
          if (signalGroup(pid, 'SIGTERM')) {
            await Promise.race([exited, delay(STOP_GRACE_MS)]);
            if (groupAlive(pid)) {
              const deadline = Date.now() + STOP_GRACE_MS;
              while (groupAlive(pid) && Date.now() < deadline) await delay(100);
              if (groupAlive(pid)) signalGroup(pid, 'SIGKILL');
            }
          }
        }
        await Promise.race([exited, delay(STOP_GRACE_MS)]);
        closePipes();
      },
    };
    return process_;
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, milliseconds).unref(); });
}

/** Sends a signal to a process group. Returns `false` when the group no longer exists. */
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Requests a loopback URL directly. Proxy settings are deliberately ignored. */
export const loopbackRequest: HttpRequest = (url, options = {}) => new Promise<HttpResponse | null>(resolvePromise => {
  const target = new URL(url);
  if (target.protocol !== 'http:') {
    resolvePromise(null);
    return;
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  let settled = false;
  const resolve = (value: HttpResponse | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    resolvePromise(value);
  };
  const body = options.body;
  const outgoing = request({
    host: target.hostname,
    port: target.port || 80,
    path: `${target.pathname}${target.search}`,
    method: options.method ?? 'GET',
    agent: false,
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    timeout: timeoutMs,
  }, response => {
    let text = '';
    response.setEncoding('utf-8');
    response.on('data', (chunk: string) => { if (text.length < OUTPUT_LIMIT) text += chunk; });
    response.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
      }
      resolve({ status: response.statusCode ?? 0, headers, body: text });
    });
    response.on('error', () => resolve(null));
    response.on('close', () => resolve(null));
  });
  // `timeout` only covers idle sockets; this bounds a server that trickles data.
  const deadline = setTimeout(() => { outgoing.destroy(); resolve(null); }, timeoutMs);
  deadline.unref();
  outgoing.on('timeout', () => outgoing.destroy());
  outgoing.on('error', () => resolve(null));
  if (body !== undefined) outgoing.write(body);
  outgoing.end();
});

export function portInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (inUse: boolean) => { socket.destroy(); resolve(inUse); };
    socket.setTimeout(1_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No free port was found'))));
    });
  });
}

export function localDependencies(
  base: Pick<LocalDependencies, 'run' | 'sleep' | 'now'>,
  environment: Environment = process.env,
  platform = process.platform,
): LocalDependencies {
  return {
    ...base,
    start: createStarter(environment, platform),
    http: loopbackRequest,
    portInUse,
    freePort,
    platform,
    env: environment,
  };
}
