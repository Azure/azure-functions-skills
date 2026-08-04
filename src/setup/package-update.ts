import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  (command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult>;
}

export type PackageUpdateStatus = 'current' | 'update-available' | 'check-failed' | 'disabled';

export interface PackageUpdateInfo {
  readonly status: PackageUpdateStatus;
  readonly packageName: string;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly command?: string;
  readonly message: string;
}

export interface PackageUpdateOptions {
  readonly packageName?: string;
  readonly currentVersion?: string;
  readonly runner?: CommandRunner;
  readonly enabled?: boolean;
}

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');
const DEFAULT_PACKAGE_NAME = '@azure/functions-skills';

export async function checkPackageUpdate(options: PackageUpdateOptions = {}): Promise<PackageUpdateInfo> {
  const packageName = options.packageName || DEFAULT_PACKAGE_NAME;
  const currentVersion = options.currentVersion || readCurrentPackageVersion();
  if (options.enabled === false || process.env.AZURE_FUNCTIONS_SKILLS_SKIP_UPDATE_CHECK === '1') {
    return {
      status: 'disabled',
      packageName,
      currentVersion,
      message: `Skipped npm update check for ${packageName}.`,
    };
  }

  const runner = options.runner || defaultRunner;
  const result = await runner('npm', ['view', packageName, 'version', '--json']);
  if (result.exitCode !== 0) {
    return {
      status: 'check-failed',
      packageName,
      currentVersion,
      message: `Could not check npm for ${packageName} updates: ${result.stderr || result.stdout || 'npm view failed'}`,
    };
  }

  const latestVersion = parseNpmVersionOutput(result.stdout);
  if (!latestVersion) {
    return {
      status: 'check-failed',
      packageName,
      currentVersion,
      message: `Could not check npm for ${packageName} updates: npm returned an empty version.`,
    };
  }

  if (isVersionGreater(latestVersion, currentVersion)) {
    const command = `npm install -g ${packageName}@latest`;
    return {
      status: 'update-available',
      packageName,
      currentVersion,
      latestVersion,
      command,
      message: `${packageName} ${latestVersion} is available. Update package-bundled skills with: ${command}`,
    };
  }

  return {
    status: 'current',
    packageName,
    currentVersion,
    latestVersion,
    message: `${packageName} ${currentVersion} is up to date.`,
  };
}

function parseNpmVersionOutput(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : null;
  } catch (_err) {
    return trimmed.replace(/^"|"$/g, '');
  }
}

function isVersionGreater(candidate: string, baseline: string): boolean {
  const candidateVersion = parseVersion(candidate);
  const baselineVersion = parseVersion(baseline);
  if (!candidateVersion || !baselineVersion) return candidate !== baseline;

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (candidateVersion[key] > baselineVersion[key]) return true;
    if (candidateVersion[key] < baselineVersion[key]) return false;
  }

  if (candidateVersion.prerelease === baselineVersion.prerelease) return false;
  if (candidateVersion.prerelease === null) return true;
  if (baselineVersion.prerelease === null) return false;
  return candidateVersion.prerelease.localeCompare(baselineVersion.prerelease) > 0;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.+)?$/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1] || '0', 10),
    minor: Number.parseInt(match[2] || '0', 10),
    patch: Number.parseInt(match[3] || '0', 10),
    prerelease: match[4] || null,
  };
}

function readCurrentPackageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as { version?: string };
    return packageJson.version || '0.0.0';
  } catch (_err) {
    return '0.0.0';
  }
}

async function defaultRunner(command: string, args: string[]) {
  const isWin = process.platform === 'win32';
  const execCommand = isWin ? 'cmd.exe' : command;
  const execArgs = isWin ? ['/d', '/s', '/c', command, ...args] : args;
  try {
    const stdout = execFileSync(execCommand, execArgs, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return {
      exitCode: err.status ?? 1,
      stdout: bufferToString(err.stdout),
      stderr: bufferToString(err.stderr) || err.message || '',
    };
  }
}

function bufferToString(value: Buffer | string | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toString('utf-8');
}
