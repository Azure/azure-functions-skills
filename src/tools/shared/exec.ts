import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join, win32 } from 'node:path';

export interface RunResult {
  /** Process exit code. `null` when the process did not start or was stopped. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly notFound: boolean;
  readonly timedOut: boolean;
}

export interface RunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

/** Runs a command with an argument array. Never builds a shell command from text. */
export type Runner = (command: string, args: readonly string[], options?: RunOptions) => Promise<RunResult>;

export interface ResolveEnvironment {
  readonly platform: NodeJS.Platform;
  readonly path: string;
  readonly pathExt?: string;
  readonly exists: (path: string) => boolean;
}

export interface Invocation {
  readonly file: string;
  readonly args: string[];
  /** True when `args` is already a complete cmd.exe command line. */
  readonly verbatim: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const NATIVE_FIRST = ['.exe', '.com'];
const UNSAFE_FOR_CMD = /["%^&|<>!\r\n]/;

/** Finds a command on PATH. On Windows a native executable wins over a command script. */
export function resolveExecutable(command: string, environment: ResolveEnvironment): string | null {
  const isWindows = environment.platform === 'win32';
  const separator = isWindows ? ';' : delimiter;
  const joinPath = isWindows ? win32.join : join;
  const extensions = isWindows
    ? orderExtensions((environment.pathExt || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean))
    : [''];
  for (const directory of environment.path.split(separator).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = joinPath(directory, `${command}${extension}`);
      if (environment.exists(candidate)) return candidate;
    }
  }
  return null;
}

function orderExtensions(extensions: string[]): string[] {
  const lower = extensions.map(extension => extension.toLowerCase());
  return [...lower.filter(extension => NATIVE_FIRST.includes(extension)),
    ...lower.filter(extension => !NATIVE_FIRST.includes(extension))];
}

/**
 * Node cannot start `.cmd` files directly, so they go through cmd.exe. Arguments
 * that cmd.exe would interpret are refused instead of escaped.
 */
export function buildInvocation(file: string, args: readonly string[], platform: NodeJS.Platform): Invocation {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(file)) return { file, args: [...args], verbatim: false };
  const unsafe = args.find(argument => UNSAFE_FOR_CMD.test(argument));
  if (unsafe !== undefined) throw new Error(`Unsafe argument for a Windows command script: ${JSON.stringify(unsafe)}`);
  const quoted = args.map(argument => (argument === '' || /\s/.test(argument) ? `"${argument}"` : argument));
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${[`"${file}"`, ...quoted].join(' ')}"`], verbatim: true };
}

export function createRunner(environment: NodeJS.ProcessEnv = process.env, platform = process.platform): Runner {
  return (command, args, options = {}) => new Promise<RunResult>(resolve => {
    const file = resolveExecutable(command, {
      platform, path: environment.PATH || environment.Path || '', pathExt: environment.PATHEXT, exists: existsSync,
    });
    if (!file) return resolve({ code: null, stdout: '', stderr: '', notFound: true, timedOut: false });

    let invocation: Invocation;
    try {
      invocation = buildInvocation(file, args, platform);
    } catch (error) {
      return resolve({ code: null, stdout: '', stderr: (error as Error).message, notFound: false, timedOut: false });
    }

    const child = spawn(invocation.file, invocation.args, {
      cwd: options.cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: invocation.verbatim,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || error.message, notFound: false, timedOut });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout, stderr, notFound: false, timedOut });
    });
  });
}
