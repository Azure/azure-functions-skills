import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { buildTarget } from '../build/build-target.js';
import { loadHooks, loadMcpServers, loadSkills } from '../build/loader.js';
import { checkPackageUpdate, type CommandRunner, type PackageUpdateInfo } from './package-update.js';
import {
  prepareWorkspaceFile,
  resolveTelemetryEnabled,
  setTelemetryEnabled,
  telemetryConfigPath,
} from './workspace-assets.js';
import type { BuildData, CliAgentName } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

export interface LocalInstallOptions {
  readonly targetDir: string;
  readonly agents?: CliAgentName[];
  readonly dryRun?: boolean;
  readonly telemetryEnabled?: boolean;
  readonly checkForUpdates?: boolean;
  readonly runner?: CommandRunner;
}

export interface LocalInstallResult {
  readonly agents: CliAgentName[];
  readonly filesWritten: number;
  readonly plannedFiles: string[];
  readonly dryRun: boolean;
  readonly packageUpdate: PackageUpdateInfo;
}

export async function detectAgents(): Promise<CliAgentName[]> {
  const agents: CliAgentName[] = [];
  if (existsSync('.vscode') || process.env.VSCODE_PID || existsSync('.cursor')) agents.push('ghcp');
  for (const [name, command] of [
    ['claude', process.platform === 'win32' ? 'where claude' : 'which claude'],
    ['codex', process.platform === 'win32' ? 'where codex' : 'which codex'],
  ] as const) {
    try {
      execSync(command, { stdio: 'ignore' });
      agents.push(name);
    } catch {
      // The agent is not installed.
    }
  }
  return agents.length > 0 ? [...new Set(agents)] : ['ghcp'];
}

export async function installLocalSkills(options: LocalInstallOptions): Promise<LocalInstallResult> {
  const agents = options.agents || ['ghcp'];
  const packageUpdate = await checkPackageUpdate({
    enabled: options.checkForUpdates !== false,
    runner: options.runner,
  });
  const stagingRoot = mkdtempSync(join(tmpdir(), 'azure-functions-skills-'));
  const plannedFiles: string[] = [];
  let filesWritten = 0;

  try {
    const data = loadBuildData();
    const telemetryEnabled = resolveTelemetryEnabled(options.targetDir, options.telemetryEnabled);
    for (const agent of agents) {
      buildTarget(agent, data, stagingRoot);
      const agentRoot = join(stagingRoot, agent);
      if (telemetryEnabled !== undefined) {
        setTelemetryEnabled(telemetryConfigPath(agentRoot, agent), telemetryEnabled);
      }
      prepareWorkspaceTree(agentRoot, options.targetDir);
      plannedFiles.push(...listFiles(agentRoot));
    }
    if (!options.dryRun) {
      for (const agent of agents) {
        const agentRoot = join(stagingRoot, agent);
        removeManagedAssets(options.targetDir, agent, data.skills.map(skill => skill.id));
        filesWritten += copyTree(agentRoot, options.targetDir);
      }
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }

  return {
    agents,
    filesWritten,
    plannedFiles: [...new Set(plannedFiles)].sort(),
    dryRun: options.dryRun === true,
    packageUpdate,
  };
}

function loadBuildData(): BuildData {
  return {
    skills: loadSkills(join(TEMPLATES_DIR, 'skills')),
    mcpServers: loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml')),
    hooks: loadHooks(join(TEMPLATES_DIR, 'hooks')),
  };
}

function removeManagedAssets(targetDir: string, agent: CliAgentName, skillIds: string[]): void {
  removeLegacyAssets(targetDir, agent);
  const skillsRoot = join(targetDir, agent === 'ghcp' ? '.github' : agent === 'claude' ? '.claude' : '.agents', 'skills');
  for (const skillId of skillIds) {
    rmSync(join(skillsRoot, skillId), { recursive: true, force: true });
  }

  for (const path of managedTelemetryPaths(agent)) {
    rmSync(join(targetDir, path), { recursive: true, force: true });
  }
}

function removeLegacyAssets(targetDir: string, agent: CliAgentName): void {
  rmSync(join(targetDir, '.azure-functions-skills'), { recursive: true, force: true });
  if (agent === 'ghcp') {
    rmSync(join(targetDir, '.github', 'agents', 'functions-copilot.agent.md'), { force: true });
    rmSync(join(targetDir, '.github', 'hooks', 'welcome-setup.json'), { force: true });
  }
  removeLegacyInstructionBlock(
    join(targetDir, agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'),
  );
}

function removeLegacyInstructionBlock(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf-8');
  const cleaned = content
    .replace(/<!-- azure-functions-skills:start[^\n]* -->[\s\S]*?<!-- azure-functions-skills:end -->/g, '')
    .trim();
  if (cleaned.length === 0) {
    rmSync(path, { force: true });
  } else {
    writeFileSync(path, `${cleaned}\n`);
  }
}

function managedTelemetryPaths(agent: CliAgentName): string[] {
  const telemetryFiles = [
    'telemetry.config.json',
    join('scripts', 'track-telemetry.ps1'),
    join('scripts', 'track-telemetry.sh'),
  ];
  if (agent === 'ghcp') {
    return [
      join('.github', 'hooks', 'azure-functions-telemetry.json'),
      ...telemetryFiles.map(path => join('.github', 'hooks', path)),
    ];
  }
  if (agent === 'claude') {
    return [
      ...telemetryFiles.map(path => join('.claude', 'hooks', path)),
    ];
  }
  return [
    ...telemetryFiles.map(path => join('.codex', 'hooks', path)),
  ];
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  collectFiles(root, root, files);
  return files;
}

function collectFiles(root: string, current: string, files: string[]): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) collectFiles(root, fullPath, files);
    else if (entry.isFile()) files.push(relative(root, fullPath).replaceAll('\\', '/'));
  }
}

function prepareWorkspaceTree(source: string, destination: string, relativePath = ''): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    const entryRelativePath = relativePath ? join(relativePath, entry.name) : entry.name;
    if (entry.isDirectory()) {
      prepareWorkspaceTree(sourcePath, destinationPath, entryRelativePath);
    } else if (entry.isFile()) {
      prepareWorkspaceFile(entryRelativePath, destinationPath, sourcePath);
    }
  }
}

function copyTree(source: string, destination: string): number {
  let count = 0;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destinationPath, { recursive: true });
      count += copyTree(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      mkdirSync(dirname(destinationPath), { recursive: true });
      cpSync(sourcePath, destinationPath, { force: true });
      count++;
    }
  }
  return count;
}

export {
  checkPackageUpdate,
  type CommandRunner,
  type PackageUpdateInfo,
  type PackageUpdateOptions,
  type PackageUpdateStatus,
} from './package-update.js';
