import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildTargetName, LauncherId, PluginInstallMode } from '../types.js';

export const STATE_DIR_NAME = '.azure-functions-skills';
export const STATE_FILE_NAME = 'state.local.json';
export const STATE_IGNORE_ENTRY = `${STATE_DIR_NAME}/${STATE_FILE_NAME}`;

export type StateSetupStatus = 'not-run' | 'prompted' | 'completed';
export type StateInstallAction = 'install' | 'update';

export interface AgentState {
  installed: boolean;
  launcherId: LauncherId;
  installMode?: PluginInstallMode;
  lastInstalledAt?: string | null;
  lastUpdatedAt?: string | null;
  workspaceActivation?: {
    mcp: boolean;
    hooks: boolean;
    agentDefinition: boolean;
  };
}

export interface AzureFunctionsSkillsState {
  schemaVersion: 1;
  package: {
    name: string;
    version: string;
  };
  workspace: {
    root: string;
    stateFile: string;
    createdAt: string;
    updatedAt: string;
  };
  install: {
    mode: PluginInstallMode;
    source: string;
    scope: string;
    lastAction: StateInstallAction;
    lastRunAt: string;
  };
  agents: Record<BuildTargetName, AgentState>;
  chat: {
    defaultAgent: LauncherId | null;
    lastAgent: LauncherId | null;
    lastStartedAt: string | null;
  };
  setupSkill: {
    status: StateSetupStatus;
    promptedAt: string | null;
    completedAt: string | null;
    completedBy: LauncherId | null;
  };
}

export interface RecordInstallStateOptions {
  action: StateInstallAction;
  agents: BuildTargetName[];
  mode: PluginInstallMode;
  source: string;
  scope: string;
  includeMcp: boolean;
  includeHooks: boolean;
  includeAgent: boolean;
}

export interface GitignoreOptions {
  yes?: boolean;
  interactive?: boolean;
}

export interface GitignoreResult {
  status: 'already-ignored' | 'updated' | 'needs-approval';
  path: string;
  entry: string;
}

export type StateLauncherResolution =
  | { kind: 'resolved'; agent: LauncherId }
  | { kind: 'ambiguous'; agents: LauncherId[] }
  | { kind: 'none' };

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');

const TARGET_TO_LAUNCHER: Record<BuildTargetName, LauncherId> = {
  ghcp: 'github-copilot',
  claude: 'claude-code',
  codex: 'codex',
};

const INITIAL_AGENTS: Record<BuildTargetName, AgentState> = {
  ghcp: { installed: false, launcherId: 'github-copilot' },
  claude: { installed: false, launcherId: 'claude-code' },
  codex: { installed: false, launcherId: 'codex' },
};

export function stateFilePath(projectDir: string): string {
  return join(projectDir, STATE_DIR_NAME, STATE_FILE_NAME);
}

export function readState(projectDir: string): AzureFunctionsSkillsState | null {
  const filePath = stateFilePath(projectDir);
  if (!existsSync(filePath)) return null;
  try {
    return normalizeState(JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<AzureFunctionsSkillsState>, projectDir);
  } catch {
    return null;
  }
}

export function writeState(projectDir: string, state: AzureFunctionsSkillsState): AzureFunctionsSkillsState {
  const filePath = stateFilePath(projectDir);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function recordInstallState(projectDir: string, options: RecordInstallStateOptions): AzureFunctionsSkillsState {
  const existing = readState(projectDir);
  const now = new Date().toISOString();
  const state = existing || createDefaultState(projectDir, now);

  state.package = packageInfo();
  state.workspace.updatedAt = now;
  state.install = {
    mode: options.mode,
    source: options.source,
    scope: options.scope,
    lastAction: options.action,
    lastRunAt: now,
  };

  for (const target of options.agents) {
    const previous = state.agents[target] || INITIAL_AGENTS[target];
    state.agents[target] = {
      ...previous,
      installed: true,
      launcherId: TARGET_TO_LAUNCHER[target],
      installMode: options.mode,
      lastInstalledAt: options.action === 'install' ? now : previous.lastInstalledAt || now,
      lastUpdatedAt: options.action === 'update' ? now : previous.lastUpdatedAt || null,
      workspaceActivation: {
        mcp: options.includeMcp,
        hooks: options.includeHooks,
        agentDefinition: target === 'ghcp' ? options.includeAgent : false,
      },
    };
  }

  const installedLaunchers = getInstalledLaunchers(state);
  if (state.chat.defaultAgent && !installedLaunchers.includes(state.chat.defaultAgent)) {
    state.chat.defaultAgent = null;
  }
  if (!state.chat.defaultAgent && installedLaunchers.length === 1) {
    state.chat.defaultAgent = installedLaunchers[0];
  }

  return writeState(projectDir, state);
}

export function markSetupPrompted(projectDir: string, agent: LauncherId | null): AzureFunctionsSkillsState {
  const now = new Date().toISOString();
  const state = readState(projectDir) || createDefaultState(projectDir, now);
  if (state.setupSkill.status !== 'completed') {
    state.setupSkill.status = 'prompted';
    state.setupSkill.promptedAt = now;
  }
  state.chat.lastAgent = agent;
  state.chat.lastStartedAt = now;
  return writeState(projectDir, state);
}

export function markSetupComplete(projectDir: string, completedBy: LauncherId | null): AzureFunctionsSkillsState {
  const now = new Date().toISOString();
  const state = readState(projectDir) || createDefaultState(projectDir, now);
  state.setupSkill = {
    status: 'completed',
    promptedAt: state.setupSkill.promptedAt,
    completedAt: now,
    completedBy,
  };
  state.workspace.updatedAt = now;
  return writeState(projectDir, state);
}

export function getInstalledTargets(state: AzureFunctionsSkillsState): BuildTargetName[] {
  return (Object.keys(state.agents) as BuildTargetName[]).filter(target => state.agents[target]?.installed === true);
}

/**
 * Resolve the install mode for a set of agents from state.
 * Prefers per-agent `installMode`; falls back to top-level `install.mode`.
 * Returns `'mixed'` when selected agents have different modes.
 */
export function resolveInstallMode(state: AzureFunctionsSkillsState, agents: BuildTargetName[]): PluginInstallMode | 'mixed' {
  const modes = new Set(
    agents.map(target => state.agents[target]?.installMode ?? state.install.mode),
  );
  if (modes.size === 1) return [...modes][0];
  return 'mixed';
}

export function getInstalledLaunchers(state: AzureFunctionsSkillsState): LauncherId[] {
  return getInstalledTargets(state).map(target => state.agents[target].launcherId);
}

export function resolveStateLauncher(state: AzureFunctionsSkillsState | null): StateLauncherResolution {
  if (!state) return { kind: 'none' };
  const installedLaunchers = getInstalledLaunchers(state);
  if (state.chat.defaultAgent && installedLaunchers.includes(state.chat.defaultAgent)) {
    return { kind: 'resolved', agent: state.chat.defaultAgent };
  }
  if (installedLaunchers.length === 1) return { kind: 'resolved', agent: installedLaunchers[0] };
  if (installedLaunchers.length > 1) return { kind: 'ambiguous', agents: installedLaunchers };
  return { kind: 'none' };
}

export function ensureStateIgnored(projectDir: string, options: GitignoreOptions = {}): GitignoreResult {
  const gitignorePath = join(projectDir, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  if (stateAlreadyIgnored(existing)) {
    return { status: 'already-ignored', path: gitignorePath, entry: STATE_IGNORE_ENTRY };
  }

  if (!options.yes) {
    return { status: 'needs-approval', path: gitignorePath, entry: STATE_IGNORE_ENTRY };
  }

  const nextContent = appendGitignoreEntry(existing, STATE_IGNORE_ENTRY);
  writeFileSync(gitignorePath, nextContent);
  return { status: 'updated', path: gitignorePath, entry: STATE_IGNORE_ENTRY };
}

function createDefaultState(projectDir: string, now: string): AzureFunctionsSkillsState {
  return {
    schemaVersion: 1,
    package: packageInfo(),
    workspace: {
      root: '.',
      stateFile: STATE_FILE_NAME,
      createdAt: now,
      updatedAt: now,
    },
    install: {
      mode: 'plugin',
      source: 'marketplace',
      scope: 'workspace',
      lastAction: 'install',
      lastRunAt: now,
    },
    agents: structuredClone(INITIAL_AGENTS),
    chat: {
      defaultAgent: null,
      lastAgent: null,
      lastStartedAt: null,
    },
    setupSkill: {
      status: 'not-run',
      promptedAt: null,
      completedAt: null,
      completedBy: null,
    },
  };
}

function normalizeState(raw: Partial<AzureFunctionsSkillsState>, projectDir: string): AzureFunctionsSkillsState {
  const now = new Date().toISOString();
  const defaults = createDefaultState(projectDir, now);
  return {
    ...defaults,
    ...raw,
    schemaVersion: 1,
    package: raw.package || defaults.package,
    workspace: { ...defaults.workspace, ...(raw.workspace || {}) },
    install: { ...defaults.install, ...(raw.install || {}) },
    agents: { ...structuredClone(INITIAL_AGENTS), ...(raw.agents || {}) },
    chat: { ...defaults.chat, ...(raw.chat || {}) },
    setupSkill: { ...defaults.setupSkill, ...(raw.setupSkill || {}) },
  };
}

function stateAlreadyIgnored(gitignoreContent: string): boolean {
  return gitignoreContent
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\/+/, ''))
    .some(line => line === STATE_IGNORE_ENTRY
      || line === `${STATE_DIR_NAME}/*.local.json`
      || line === STATE_DIR_NAME
      || line === `${STATE_DIR_NAME}/`);
}

function appendGitignoreEntry(existing: string, entry: string): string {
  if (!existing.trim()) return `${entry}\n`;
  const prefix = existing.endsWith('\n') ? existing : `${existing}\n`;
  return `${prefix}${entry}\n`;
}

function packageInfo(): AzureFunctionsSkillsState['package'] {
  try {
    const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as { name?: string; version?: string };
    return {
      name: packageJson.name || '@azure/functions-skills',
      version: packageJson.version || '0.0.0',
    };
  } catch {
    return { name: '@azure/functions-skills', version: '0.0.0' };
  }
}