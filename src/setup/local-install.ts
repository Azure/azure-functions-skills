import { execFileSync } from 'node:child_process';
import { normalize, resolve } from 'node:path';
import {
  ensureStateIgnored,
  recordInstallState,
  type AzureFunctionsSkillsState,
  type GitignoreResult,
  type TelemetryStateSource,
} from './state.js';
import { checkPackageUpdate, type PackageUpdateInfo } from './package-update.js';
import type { CliAgentName, SetupResult } from '../types.js';
import type { CommandRunner, PrerequisiteMode } from './prerequisites/types.js';

export type GitRepoResultStatus = 'skipped' | 'detected' | 'initialized' | 'not-initialized' | 'git-unavailable';

export interface GitRepoResult {
  readonly status: GitRepoResultStatus;
}

export interface LocalInstallOptions {
  readonly targetDir: string;
  readonly agents?: CliAgentName[];
  readonly dryRun?: boolean;
  readonly yes?: boolean;
  readonly prerequisites?: PrerequisiteMode;
  readonly scope?: string;
  readonly runner?: CommandRunner;
  readonly checkForUpdates?: boolean;
  readonly initializeGitForGhcp?: boolean;
  readonly telemetryEnabled?: boolean;
  readonly telemetrySource?: TelemetryStateSource;
  readonly approveStateGitignore?: () => Promise<boolean>;
  readonly approveGitInit?: () => Promise<boolean>;
}

export interface LocalInstallResult {
  readonly agents: CliAgentName[];
  readonly filesWritten: number;
  readonly plannedFiles: string[];
  readonly dryRun: boolean;
  readonly state: AzureFunctionsSkillsState | null;
  readonly gitignoreResult: GitignoreResult;
  readonly gitRepoResult: GitRepoResult;
  readonly packageUpdate: PackageUpdateInfo;
  readonly setup: SetupResult | null;
}

export async function installLocalSkills(options: LocalInstallOptions): Promise<LocalInstallResult> {
  const agents: CliAgentName[] = options.agents || ['ghcp'];
  const dryRun = options.dryRun === true;
  const packageUpdate = await checkPackageUpdate({
    enabled: options.checkForUpdates !== false,
    runner: options.runner,
  });

  if (dryRun) {
    return {
      agents,
      filesWritten: 0,
      plannedFiles: agents.map(agent => `${agent}: workspace setup files from bundled npm package assets`),
      dryRun,
      state: null,
      gitignoreResult: { status: 'needs-approval', path: '', entry: '.azure-functions-skills/state.local.json' },
      gitRepoResult: { status: 'skipped' },
      packageUpdate,
      setup: null,
    };
  }

  const { applySetup } = await import('./index.js');
  const setup = await applySetup(options.targetDir, {
    agents,
    prerequisites: options.prerequisites || 'auto',
    prerequisiteRunner: options.runner,
  });
  const state = recordInstallState(options.targetDir, {
    action: 'install',
    agents,
    mode: 'local',
    source: 'local',
    scope: options.scope || 'workspace',
    includeMcp: true,
    includeHooks: true,
    includeAgent: agents.includes('ghcp'),
    telemetryEnabled: options.telemetryEnabled,
    telemetrySource: options.telemetrySource || (options.telemetryEnabled === false ? 'install-option' : undefined),
  });
  const gitignoreResult = await updateStateGitignore(options);
  const gitRepoResult = await ensureGhcpGitRepo(options, agents);

  return {
    agents,
    filesWritten: setup.filesWritten,
    plannedFiles: [],
    dryRun,
    state,
    gitignoreResult,
    gitRepoResult,
    packageUpdate,
    setup,
  };
}

async function updateStateGitignore(options: LocalInstallOptions): Promise<GitignoreResult> {
  let result = ensureStateIgnored(options.targetDir, { yes: options.yes });
  if (result.status === 'needs-approval' && options.approveStateGitignore && await options.approveStateGitignore()) {
    result = ensureStateIgnored(options.targetDir, { yes: true });
  }
  return result;
}

async function ensureGhcpGitRepo(options: LocalInstallOptions, agents: CliAgentName[]): Promise<GitRepoResult> {
  if (options.initializeGitForGhcp === false || !agents.includes('ghcp')) {
    return { status: 'skipped' };
  }

  try {
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: options.targetDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim();
    if (normalize(resolve(options.targetDir)).toLowerCase() === normalize(resolve(toplevel)).toLowerCase()) {
      return { status: 'detected' };
    }
  } catch (_err) {
    // Continue to optional initialization below.
  }

  if (options.yes || (options.approveGitInit && await options.approveGitInit())) {
    try {
      execFileSync('git', ['init'], { cwd: options.targetDir, stdio: 'pipe' });
      return { status: 'initialized' };
    } catch (_err) {
      return { status: 'git-unavailable' };
    }
  }

  return { status: 'not-initialized' };
}
