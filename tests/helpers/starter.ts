import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadSkills } from '../../src/build/loader.js';
import type { TelemetryRuntime } from '../../src/build/telemetry-runtime.js';
import { buildStarterFiles, DEFAULT_STARTER_ENDPOINTS, type StarterEndpoints, type StarterFiles } from '../../src/starter/build.js';
import { loadToolInstallTable, parseStarterConfig, type StarterConfig } from '../../src/starter/config.js';
import { writeStarterFiles } from '../../src/starter/payload.js';

export const ROOT = join(import.meta.dirname, '..', '..');
export const SKILLS = loadSkills(join(ROOT, 'templates', 'skills'));
export const TOOLS = loadToolInstallTable(join(ROOT, 'templates', 'starter', 'tool-install.json'));

export const FAKE_RUNTIME: TelemetryRuntime = {
  code: 'export async function runHook() {}\n',
  notices: 'notices\n',
  sdkPackage: '{"name":"applicationinsights","version":"0.0.0"}',
};

export const TEST_ENDPOINTS: StarterEndpoints = {
  ...DEFAULT_STARTER_ENDPOINTS,
  telemetry: 'https://telemetry.invalid',
  instrumentationKey: '00000000-0000-4000-8000-000000000000',
};

export function testConfig(overrides: Partial<StarterConfig> = {}): StarterConfig {
  return parseStarterConfig({
    schemaVersion: 1,
    source: { repository: 'contoso/starter-repo', branch: 'main', path: 'starter' },
    bundles: {
      functions: {
        title: 'Test Functions',
        akaLink: 'https://aka.ms/test-functions',
        prompt: 'Read https://aka.ms/test-functions and follow it.',
        handoff: 'azure-functions-help',
        skills: ['azure-functions-help', 'azure-functions-setup'],
        tools: ['node', 'func', 'az', 'azd'],
      },
      extras: {
        title: 'Test Extras',
        akaLink: 'https://aka.ms/test-extras',
        prompt: 'Read https://aka.ms/test-extras and follow it.',
        handoff: 'azure-functions-feedback',
        skills: ['azure-functions-feedback'],
        tools: ['node'],
      },
    },
    ...overrides,
  });
}

export function buildFixture(options: {
  config?: StarterConfig;
  runtime?: TelemetryRuntime;
  endpoints?: Partial<StarterEndpoints>;
  packageVersion?: string;
} = {}): StarterFiles {
  return buildStarterFiles({
    root: ROOT,
    config: options.config ?? testConfig(),
    tools: TOOLS,
    skills: SKILLS,
    runtime: options.runtime ?? FAKE_RUNTIME,
    packageVersion: options.packageVersion ?? '0.0.7-preview',
    endpoints: { ...TEST_ENDPOINTS, ...options.endpoints },
  });
}

export function writeFixture(files: StarterFiles, directory: string): string {
  writeStarterFiles(files, directory);
  return directory;
}

export type Shell = 'sh' | 'pwsh' | 'powershell';

function available(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { encoding: 'utf-8', windowsHide: true, timeout: 30_000 });
  return result.status === 0;
}

export const SHELLS: Shell[] = [
  ...(available('sh', ['-c', 'exit 0']) ? ['sh' as const] : []),
  ...(available('pwsh', ['-NoProfile', '-Command', 'exit 0']) ? ['pwsh' as const] : []),
  ...(process.platform === 'win32' && available('powershell', ['-NoProfile', '-Command', 'exit 0']) ? ['powershell' as const] : []),
];

export interface ScriptResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface BootstrapOptions {
  readonly bundle?: string;
  readonly template?: string;
  readonly agent?: string;
  readonly destination: string;
  readonly commit?: string;
  readonly resultFile?: string;
  readonly check?: boolean;
  readonly noTelemetry?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly path?: string;
  readonly cwd?: string;
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Runs a PowerShell script file the way the installer does: as a script block. */
export function powerShellScriptBlock(shell: 'pwsh' | 'powershell', script: string, parameters: Record<string, string | boolean>, epilogue: string): string[] {
  const args = Object.entries(parameters)
    .filter(([, value]) => value !== false)
    .map(([key, value]) => (typeof value === 'string' ? `-${key} ${psQuote(value)}` : `-${key}`))
    .join(' ');
  const command = `$sb = [scriptblock]::Create([IO.File]::ReadAllText(${psQuote(script)})); ${epilogue.replace('{{CALL}}', `& $sb ${args}`)}`;
  const base = ['-NoLogo', '-NoProfile', '-NonInteractive'];
  if (shell === 'powershell') base.push('-ExecutionPolicy', 'Restricted');
  return [...base, '-Command', command];
}

export async function runProcess(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string } = {}): Promise<ScriptResult> {
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    windowsHide: true,
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.stdin.on('error', () => { /* The child may exit before reading stdin. */ });
  child.stdin.end(options.input ?? '');
  const timer = setTimeout(() => child.kill(), 110_000);
  try {
    const [status] = await once(child, 'close') as [number | null];
    return { status, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

export function shellCommand(shell: Shell): string {
  return shell;
}

export async function runBootstrap(shell: Shell, starter: string, options: BootstrapOptions): Promise<ScriptResult & { json: Record<string, unknown> }> {
  const env = { ...process.env, ...options.env };
  if (options.path !== undefined) {
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
    env.PATH = options.path;
  }
  let result: ScriptResult;
  if (shell === 'sh') {
    const args = [toShPath(join(starter, 'bootstrap.sh')), '--bundle', options.bundle ?? 'functions', '--agent', options.agent ?? 'claude',
      '--destination', toShPath(options.destination), '--json'];
    if (options.template) args.push('--template', options.template);
    if (options.commit) args.push('--commit', options.commit);
    if (options.resultFile) args.push('--result-file', toShPath(options.resultFile));
    if (options.check) args.push('--check');
    if (options.noTelemetry) args.push('--no-telemetry');
    result = await runProcess(shellExecutable('sh'), args, { env, cwd: options.cwd });
  } else {
    const parameters: Record<string, string | boolean> = {
      SourceRoot: starter,
      Bundle: options.bundle ?? 'functions',
      Agent: options.agent ?? 'claude',
      Destination: options.destination,
      Json: true,
      Check: options.check ?? false,
      NoTelemetry: options.noTelemetry ?? false,
    };
    if (options.template) parameters.Template = options.template;
    if (options.commit) parameters.Commit = options.commit;
    if (options.resultFile) parameters.ResultFile = options.resultFile;
    result = await runProcess(shellExecutable(shell), powerShellScriptBlock(shell, join(starter, 'bootstrap.ps1'), parameters, '$code = {{CALL}}; exit $code'),
      { env, cwd: options.cwd });
  }
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
  } catch {
    // Callers assert on stdout when JSON is expected.
  }
  return { ...result, json };
}

/** Git for Windows' sh needs POSIX paths; elsewhere paths are unchanged. */
export function toShPath(path: string): string {
  if (process.platform !== 'win32') return path;
  return path.replace(/^([A-Za-z]):[\\/]/, (_match, drive: string) => `/${drive.toLowerCase()}/`).replaceAll('\\', '/');
}

const resolved = new Map<string, string>();
/** Absolute path of a shell, so that a reduced PATH still finds it. */
export function shellExecutable(shell: Shell): string {
  const cached = resolved.get(shell);
  if (cached) return cached;
  const lookup = process.platform === 'win32'
    ? spawnSync('where.exe', [shell === 'sh' ? 'sh.exe' : `${shell}.exe`], { encoding: 'utf-8', windowsHide: true })
    : spawnSync('sh', ['-c', `command -v ${shell}`], { encoding: 'utf-8' });
  const path = lookup.stdout.split(/\r?\n/).find(line => line.trim().length > 0)?.trim() ?? shell;
  resolved.set(shell, path);
  return path;
}

/** Commands the tool probes look for; a minimal PATH must not contain any of them. */
const DEVELOPER_TOOLS = new Set(['node', 'nodejs', 'func', 'az', 'azd', 'python', 'python3', 'azurite', 'npm', 'npx']);
const minimalBins = new Map<Shell, string>();

/**
 * A PATH with the shell and OS commands, but no developer tools. On Windows the
 * system directories hold none. On POSIX, CI images install tools such as `az`
 * into `/usr/bin`, so the PATH is one private directory that links every
 * command from the shell's directory, `/usr/bin`, and `/bin` except the
 * developer tools.
 */
export function minimalPath(shell: Shell): string {
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const system = [join(systemRoot, 'System32'), systemRoot, join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')];
    return [dirname(shellExecutable(shell)), ...system].join(';');
  }
  const cached = minimalBins.get(shell);
  if (cached !== undefined) return cached;
  const bin = mkdtempSync(join(tmpdir(), 'afs-minimal-path-'));
  process.once('exit', () => rmSync(bin, { recursive: true, force: true }));
  for (const directory of [dirname(shellExecutable(shell)), '/usr/bin', '/bin']) {
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      if (DEVELOPER_TOOLS.has(name) || existsSync(join(bin, name))) continue;
      const source = join(directory, name);
      try {
        if (!statSync(source).isFile()) continue;
        symlinkSync(source, join(bin, name));
      } catch {
        // Dangling or unreadable entries are not commands the bootstrap needs.
      }
    }
  }
  minimalBins.set(shell, bin);
  return bin;
}

export const REPORT_KEYS = [
  'schemaVersion', 'mode', 'ready', 'bundle', 'template', 'agent', 'destination', 'sourceCommit',
  'installed', 'skills', 'files', 'missingTools', 'telemetry', 'coexistence', 'error',
];

/** Validates the report schema documented in FRD-0004 section 4. */
export function assertReportSchema(report: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const keys = Object.keys(report);
  if (keys.join(',') !== REPORT_KEYS.join(',')) problems.push(`keys: ${keys.join(',')}`);
  if (report.schemaVersion !== 1) problems.push('schemaVersion');
  if (report.mode !== 'apply' && report.mode !== 'check') problems.push('mode');
  if (typeof report.ready !== 'boolean') problems.push('ready');
  if (typeof report.bundle !== 'string') problems.push('bundle');
  if (report.template !== null && typeof report.template !== 'string') problems.push('template');
  if (!['copilot', 'claude', 'codex'].includes(String(report.agent))) problems.push('agent');
  if (typeof report.destination !== 'string') problems.push('destination');
  if (typeof report.sourceCommit !== 'string') problems.push('sourceCommit');
  const installed = report.installed as Record<string, unknown> | undefined;
  if (!installed || !['bundleCommit', 'runtimeCommit'].every(key => installed[key] === null || typeof installed[key] === 'string')) problems.push('installed');
  if (!Array.isArray(report.skills) || report.skills.some(skill => typeof skill !== 'string')) problems.push('skills');
  const files = report.files as Record<string, unknown> | undefined;
  if (!files || Object.keys(files).join(',') !== 'created,current,outdated,modified' || Object.values(files).some(value => typeof value !== 'number')) problems.push('files');
  if (!Array.isArray(report.missingTools) || report.missingTools.some(tool => {
    const entry = tool as Record<string, unknown>;
    return Object.keys(entry).join(',') !== 'tool,reason,command,docs' || typeof entry.tool !== 'string'
      || typeof entry.reason !== 'string' || (entry.command !== null && typeof entry.command !== 'string') || typeof entry.docs !== 'string';
  })) problems.push('missingTools');
  const telemetry = report.telemetry as Record<string, unknown> | undefined;
  if (!telemetry || typeof telemetry.preferenceEnabled !== 'boolean'
    || !['installed', 'needs-merge', 'merged', 'absent'].includes(String(telemetry.hooks))
    || (telemetry.hookSnippet !== null && typeof telemetry.hookSnippet !== 'string')) problems.push('telemetry');
  if (report.coexistence !== 'none' && report.coexistence !== 'workspace') problems.push('coexistence');
  if (report.error !== null) problems.push('error');
  return problems;
}
