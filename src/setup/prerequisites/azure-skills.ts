import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildTargetName } from '../../types.js';
import type { PrerequisiteContext, PrerequisiteProvider, PrerequisiteResult } from './types.js';

const REQUIRED_AZURE_SKILLS = ['azure-deploy', 'azure-prepare', 'azure-validate'];
const COPILOT_MARKETPLACE_COMMAND = '/plugin marketplace add microsoft/azure-skills';
const COPILOT_INSTALL_COMMAND = '/plugin install azure@azure-skills';

export const azureSkillsManualCommands = [
  COPILOT_MARKETPLACE_COMMAND,
  COPILOT_INSTALL_COMMAND,
];

export const azureSkillsProvider: PrerequisiteProvider = {
  id: 'azure-skills',

  supports(target: BuildTargetName): boolean {
    return target === 'ghcp';
  },

  async check(context: PrerequisiteContext): Promise<PrerequisiteResult> {
    const pluginList = await run(context, 'copilot', ['plugin', 'list']);
    if (pluginList.exitCode === 0 && hasAzureSkillsPlugin(pluginList.stdout)) {
      return result(context.target, 'present', 'Azure Skills plugin is installed for GitHub Copilot.');
    }

    if (hasWorkspaceAzureSkills(context.projectDir)) {
      return result(
        context.target,
        'present',
        'Azure Skills are present in the workspace fallback layout.',
      );
    }

    return result(
      context.target,
      'manual-action-required',
      'Azure Skills plugin is not installed for GitHub Copilot.',
      azureSkillsManualCommands,
    );
  },

  async install(context: PrerequisiteContext): Promise<PrerequisiteResult> {
    const addMarketplace = await run(context, 'copilot', ['plugin', 'marketplace', 'add', 'microsoft/azure-skills']);
    if (addMarketplace.exitCode !== 0) {
      return manualInstallResult(context.target, addMarketplace.stderr || addMarketplace.stdout);
    }

    const installPlugin = await run(context, 'copilot', ['plugin', 'install', 'azure@azure-skills']);
    if (installPlugin.exitCode !== 0) {
      return manualInstallResult(context.target, installPlugin.stderr || installPlugin.stdout);
    }

    return result(
      context.target,
      'installed',
      'Azure Skills plugin installed for GitHub Copilot. Reload or restart the host if skills are not visible immediately.',
    );
  },
};

function hasAzureSkillsPlugin(output: string): boolean {
  return /(^|\s)(azure|azure-skills)(\s|$)/i.test(output);
}

function hasWorkspaceAzureSkills(projectDir: string): boolean {
  return REQUIRED_AZURE_SKILLS.every(skill => existsSync(join(projectDir, '.github', 'skills', skill, 'SKILL.md')));
}

async function run(context: PrerequisiteContext, command: string, args: string[]) {
  const runner = context.runner || defaultRunner;
  return runner(command, args, { cwd: context.projectDir });
}

async function defaultRunner(command: string, args: string[]) {
  const { execFileSync } = await import('node:child_process');
  // On Windows, wrap with cmd.exe instead of shell: true to avoid DEP0190
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

function manualInstallResult(target: BuildTargetName, detail?: string): PrerequisiteResult {
  return result(
    target,
    'manual-action-required',
    'Azure Skills plugin could not be installed automatically for GitHub Copilot. Install it manually and reload the host.',
    azureSkillsManualCommands,
    detail ? [detail] : undefined,
  );
}

function result(
  target: BuildTargetName,
  status: PrerequisiteResult['status'],
  message: string,
  commands?: string[],
  details?: string[],
): PrerequisiteResult {
  return {
    id: 'azure-skills',
    target,
    status,
    message,
    commands,
    details,
  };
}
