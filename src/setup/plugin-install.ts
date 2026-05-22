/**
 * Plugin install module — register plugins natively with each platform.
 *
 * Instead of copying files, this registers the plugin at its npm package location,
 * so the platform manages updates and lifecycle.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { BuildTargetName } from '../types.js';
import type { CommandRunner } from './prerequisites/types.js';
import { applyWorkspace } from './workspace.js';

interface PluginInstallResult {
  target: BuildTargetName;
  method: string;
  path: string;
  instructions: string;
}

interface CodexMarketplacePlugin {
  name: string;
  [key: string]: unknown;
}

interface CodexMarketplace {
  plugins?: CodexMarketplacePlugin[];
  [key: string]: unknown;
}

export type PluginOperationAction = 'install' | 'update';
export type PluginOperationScope = 'workspace' | 'user';
export type PluginOperationSource = 'marketplace' | 'local' | 'github';

export interface PluginOperationOptions {
  action: PluginOperationAction;
  agents: BuildTargetName[];
  projectDir: string;
  dryRun?: boolean;
  scope?: PluginOperationScope;
  source?: PluginOperationSource;
  version?: string;
  workspace?: boolean;
  runner?: CommandRunner;
  platform?: NodeJS.Platform;
  yes?: boolean;
}

export interface PluginOperationStep {
  target: BuildTargetName;
  kind: 'plugin-registration' | 'workspace-activation';
  description: string;
  commands?: string[];
  path?: string;
}

export interface PluginOperationResult {
  action: PluginOperationAction;
  agents: BuildTargetName[];
  dryRun: boolean;
  scope: PluginOperationScope;
  source: PluginOperationSource;
  version: string;
  steps: PluginOperationStep[];
  filesWritten: number;
}

interface PluginCommand {
  command: string;
  args: string[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');

/**
 * Get the absolute path to a built plugin directory within this package.
 * @param {'ghcp' | 'claude' | 'codex'} target
 * @returns {string}
 */
export function getPluginDir(_target: BuildTargetName): string {
  return join(PACKAGE_ROOT, 'dist', 'plugin', 'azure-functions-skills');
}

/**
 * Generate VS Code settings entries to register the GHCP plugin.
 * @param {string} pluginPath - Absolute path to the plugin directory
 * @returns {object} Settings to merge into .vscode/settings.json
 */
export function generateVscodeSettings(pluginPath: string): Record<string, unknown> {
  return {
    'chat.plugins.enabled': true,
    'chat.pluginLocations': {
      [pluginPath]: true,
    },
  };
}

/**
 * Generate a Codex marketplace entry pointing to the plugin.
 * @param {string} pluginPath - Absolute path to the plugin directory
 * @returns {object} Marketplace JSON
 */
export function generateCodexMarketplaceEntry(pluginPath: string): CodexMarketplace {
  return {
    name: 'azure-functions-local',
    interface: {
      displayName: 'Azure Functions (local)',
    },
    plugins: [
      {
        name: 'azure-functions-skills',
        source: {
          source: 'local',
          path: pluginPath,
        },
        policy: {
          installation: 'INSTALLED_BY_DEFAULT',
          authentication: 'ON_INSTALL',
        },
        category: 'Development',
      },
    ],
  };
}

/**
 * Generate Claude settings additions for plugin registration.
 * Uses --add-dir equivalent in settings to point to plugin skills directory.
 * @param {string} pluginPath - Absolute path to the Claude plugin directory
 * @returns {object} Settings to merge
 */
export function generateClaudeSettings(pluginPath: string): Record<string, unknown> {
  return {
    pluginDir: pluginPath,
  };
}

/**
 * Install plugin natively for a given platform.
 * @param {'ghcp' | 'claude' | 'codex'} target
 * @param {string} projectDir - The project directory
 * @returns {{target: string, method: string, path: string, instructions: string}}
 */
export function installPlugin(target: BuildTargetName, projectDir: string): PluginInstallResult {
  const pluginPath = getPluginDir(target);

  if (!existsSync(pluginPath)) {
    throw new Error(
      `Plugin not built for ${target}. Run 'npm run build' first, or use 'setup' without --as-plugin.`
    );
  }

  const result = { target, path: pluginPath, method: '', instructions: '' };

  switch (target) {
    case 'ghcp': {
      // Register in .vscode/settings.json
      const settingsPath = join(projectDir, '.vscode', 'settings.json');
      const settings = mergeJsonFile(settingsPath, generateVscodeSettings(pluginPath));
      mkdirSync(join(projectDir, '.vscode'), { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      result.method = 'chat.pluginLocations in .vscode/settings.json';
      result.instructions = 'Reload VS Code window (Ctrl+Shift+P → "Developer: Reload Window")';
      break;
    }
    case 'codex': {
      // Register in ~/.agents/plugins/marketplace.json
      const mpDir = join(homedir(), '.agents', 'plugins');
      const mpPath = join(mpDir, 'marketplace.json');
      mkdirSync(mpDir, { recursive: true });
      const marketplace = generateCodexMarketplaceEntry(pluginPath);
      if (existsSync(mpPath)) {
        const existing = JSON.parse(readFileSync(mpPath, 'utf-8')) as CodexMarketplace;
        // Merge: add our plugin if not already present
        const names = existing.plugins?.map(p => p.name) || [];
        if (!names.includes('azure-functions-skills')) {
          existing.plugins = [...(existing.plugins || []), ...(marketplace.plugins || [])];
          writeFileSync(mpPath, JSON.stringify(existing, null, 2));
        }
      } else {
        writeFileSync(mpPath, JSON.stringify(marketplace, null, 2));
      }
      result.method = 'marketplace.json in ~/.agents/plugins/';
      result.instructions = 'Restart Codex to discover the plugin';
      break;
    }
    case 'claude': {
      // Claude: register the self-contained plugin directory via --add-dir.
      const claudeDir = join(projectDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      const settingsPath = join(claudeDir, 'settings.local.json');
      const mcpPath = join(pluginPath, '.mcp.json');
      if (existsSync(mcpPath)) {
        const mcpSettings = JSON.parse(readFileSync(mcpPath, 'utf-8'));
        const merged = mergeJsonFile(settingsPath, mcpSettings);
        writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
      }
      result.method = '.claude/settings.local.json + --add-dir';
      result.instructions = `Run: claude --add-dir "${pluginPath}"`;
      break;
    }
    default:
      throw new Error(`Unknown target: ${target}`);
  }

  return result;
}

export function planPluginOperation(options: PluginOperationOptions): PluginOperationResult {
  const dryRun = options.dryRun === true;
  const scope = options.scope || 'workspace';
  const source = options.source || 'marketplace';
  const version = options.version || packageVersion();
  const includeWorkspace = options.workspace !== false;
  const steps: PluginOperationStep[] = [];

  for (const target of options.agents) {
    const commands = officialPluginCommands(target, options);
    steps.push({
      target,
      kind: 'plugin-registration',
      path: source === 'local' ? getPluginDir(target) : undefined,
      description: pluginRegistrationDescription(options.action, target, scope, source, version),
      commands: commands.map(formatCommand),
    });

    if (includeWorkspace) {
      steps.push({
        target,
        kind: 'workspace-activation',
        description: `Apply workspace activation with workspace apply --agent ${target} --mode plugin-reference${options.action === 'update' ? ' --update' : ''}.`,
      });
    }
  }

  return {
    action: options.action,
    agents: options.agents,
    dryRun,
    scope,
    source,
    version,
    steps,
    filesWritten: 0,
  };
}

export async function runPluginOperation(options: PluginOperationOptions): Promise<PluginOperationResult> {
  const result = planPluginOperation(options);
  if (result.dryRun) return result;

  await ensureRequiredTools(options);

  for (const target of result.agents) {
    for (const pluginCommand of officialPluginCommands(target, options)) {
      const commandResult = await runCommand(options, pluginCommand);
      if (commandResult.exitCode !== 0) {
        throw new Error(`Plugin ${options.action} failed for ${target}: ${commandResult.stderr || commandResult.stdout}`);
      }
    }
  }

  if (options.workspace !== false) {
    const workspaceResult = await applyWorkspace(options.projectDir, {
      agents: result.agents,
      mode: 'plugin-reference',
      mergeStrategy: 'managed-block',
      update: options.action === 'update',
      yes: options.yes,
    });
    result.filesWritten += workspaceResult.filesWritten;
  }

  return result;
}

async function ensureRequiredTools(options: PluginOperationOptions): Promise<void> {
  const requiredTools = unique(options.agents.flatMap(target => officialPluginCommands(target, options).map(pluginCommand => pluginCommand.command)));
  const missingTools: string[] = [];

  for (const tool of requiredTools) {
    if (!await toolExists(options, tool)) missingTools.push(tool);
  }

  if (missingTools.length > 0) {
    throw new Error(missingToolsMessage(options, missingTools));
  }
}

async function toolExists(options: PluginOperationOptions, tool: string): Promise<boolean> {
  const runner = options.runner || defaultRunner;
  const checkCommand = toolCheckCommand(options, tool);
  const result = await runner(checkCommand.command, checkCommand.args, { cwd: options.projectDir });
  return result.exitCode === 0;
}

function toolCheckCommand(options: PluginOperationOptions, tool: string): PluginCommand {
  if (runtimePlatform(options) === 'win32') return { command: 'where.exe', args: [tool] };
  return { command: 'sh', args: ['-c', `command -v ${tool}`] };
}

function missingToolsMessage(options: PluginOperationOptions, missingTools: string[]): string {
  return [
    `Cannot ${options.action} Azure Functions Skills plugin for ${agentLabel(options.agents)}.`,
    '',
    'Missing required tools:',
    ...missingTools.map(tool => `  - ${tool}: ${toolPurpose(tool)}`),
    '',
    'Install:',
    ...missingTools.map(tool => `  - ${toolInstallLabel(tool)}: ${toolInstallUrl(tool)}`),
    '',
    'Then retry:',
    `  azure-functions-skills plugin ${options.action}${options.agents.map(agent => ` --agent ${agent}`).join('')}`,
  ].join('\n');
}

function agentLabel(agents: BuildTargetName[]): string {
  return agents.map(agent => ({
    ghcp: 'GitHub Copilot CLI',
    claude: 'Claude Code',
    codex: 'Codex',
  })[agent]).join(', ');
}

function toolPurpose(tool: string): string {
  if (tool === 'git') return 'required to clone https://github.com/Azure/azure-functions-skills.git for Claude plugin-from-source.';
  if (tool === 'claude') return 'required to validate and load the Claude plugin payload.';
  if (tool === 'copilot') return 'required to run GitHub Copilot plugin marketplace and install commands.';
  if (tool === 'codex') return 'required to run Codex plugin marketplace and install commands.';
  return 'required to install the plugin.';
}

function toolInstallLabel(tool: string): string {
  if (tool === 'git') return 'Git';
  if (tool === 'claude') return 'Claude Code';
  if (tool === 'copilot') return 'GitHub Copilot CLI';
  if (tool === 'codex') return 'Codex CLI';
  return tool;
}

function toolInstallUrl(tool: string): string {
  if (tool === 'git') return 'https://git-scm.com/downloads';
  if (tool === 'claude') return 'https://claude.ai/download';
  if (tool === 'copilot') return 'https://docs.github.com/copilot/github-copilot-in-the-cli/using-github-copilot-in-the-cli';
  if (tool === 'codex') return 'https://developers.openai.com/codex/cli';
  return 'See the tool documentation.';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function officialPluginCommands(target: BuildTargetName, options: PluginOperationOptions): PluginCommand[] {
  if (target === 'ghcp') {
    return [
      { command: 'copilot', args: ['plugin', 'marketplace', 'add', 'Azure/azure-functions-skills'] },
      { command: 'copilot', args: ['plugin', 'install', 'azure-functions-skills@azure-functions-skills'] },
    ];
  }

  if (target === 'claude') {
    return claudePluginCommands(options);
  }

  return [
    { command: 'codex', args: ['plugin', 'marketplace', 'add', 'Azure/azure-functions-skills'] },
    { command: 'codex', args: ['plugin', 'add', 'azure-functions-skills@azure-functions-skills'] },
  ];
}

function claudePluginCommands(options: PluginOperationOptions): PluginCommand[] {
  const pluginPath = claudePluginPayloadPath(options);
  if (options.source === 'local') {
    return [{ command: 'claude', args: ['plugin', 'validate', pluginPath] }];
  }

  const cloneDir = claudeRepositoryCloneDir(options.projectDir);
  const syncCommand = options.action === 'update'
    ? { command: 'git', args: ['-C', cloneDir, 'pull', '--ff-only'] }
    : { command: 'git', args: ['clone', 'https://github.com/Azure/azure-functions-skills.git', cloneDir] };

  return [
    syncCommand,
    { command: 'claude', args: ['plugin', 'validate', pluginPath] },
  ];
}

function claudePluginPayloadPath(options: PluginOperationOptions): string {
  if (options.source === 'local') return localPluginPayloadPath();
  return join(claudeRepositoryCloneDir(options.projectDir), '.github', 'plugins', 'azure-functions-skills');
}

function claudeRepositoryCloneDir(projectDir: string): string {
  return join(projectDir, '.azure-functions-skills', 'source', 'azure-functions-skills');
}

function localPluginPayloadPath(): string {
  const repoPluginPath = join(PACKAGE_ROOT, '.github', 'plugins', 'azure-functions-skills');
  return existsSync(repoPluginPath) ? repoPluginPath : getPluginDir('claude');
}

function formatCommand(pluginCommand: PluginCommand): string {
  return [pluginCommand.command, ...pluginCommand.args].join(' ');
}

async function runCommand(options: PluginOperationOptions, pluginCommand: PluginCommand) {
  const runner = options.runner || defaultRunner;
  return runner(pluginCommand.command, pluginCommand.args, { cwd: options.projectDir });
}

async function defaultRunner(command: string, args: string[]) {
  const { execFileSync } = await import('node:child_process');
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: runtimePlatform() === 'win32',
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

function runtimePlatform(options?: PluginOperationOptions): NodeJS.Platform {
  return options?.platform || process.platform;
}

function bufferToString(value: Buffer | string | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toString('utf-8');
}

function pluginRegistrationDescription(
  action: PluginOperationAction,
  target: BuildTargetName,
  scope: PluginOperationScope,
  source: PluginOperationSource,
  version: string,
): string {
  if (source === 'local') {
    return `${capitalize(action)} ${target} plugin from local package build at ${scope} scope.`;
  }
  return `${capitalize(action)} ${target} plugin from ${source} source version ${version} at ${scope} scope.`;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function packageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as { version?: string };
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function mergeJsonFile(filePath: string, newEntries: Record<string, unknown>): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // corrupt file, overwrite
    }
  }
  return { ...existing, ...newEntries };
}
