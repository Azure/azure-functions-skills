import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getPluginDir,
  generateVscodeSettings,
  generateCodexMarketplaceEntry,
  generateClaudeSettings,
  planPluginOperation,
  runPluginOperation,
} from '../src/setup/plugin-install.js';
import type { CommandRunner } from '../src/setup/prerequisites/types.js';
import { createTempDir, removeDir } from './helpers/fs.js';

type TestRunner = CommandRunner & { calls: Array<{ command: string; args: string[] }> };

function acceptingRunner(): TestRunner {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner = (async (command, args) => {
    calls.push({ command, args });
    return { exitCode: 0, stdout: 'ok\n', stderr: '' };
  }) as TestRunner;
  runner.calls = calls;
  return runner;
}

function missingToolsRunner(missingTools: string[]): TestRunner {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner = (async (command, args) => {
    calls.push({ command, args });
    const checkedTool = checkedToolName(command, args);
    if (checkedTool) {
      return missingTools.includes(checkedTool)
        ? { exitCode: 1, stdout: '', stderr: `${checkedTool} not found` }
        : { exitCode: 0, stdout: checkedTool, stderr: '' };
    }
    return { exitCode: 0, stdout: 'ok\n', stderr: '' };
  }) as TestRunner;
  runner.calls = calls;
  return runner;
}

function checkedToolName(command: string, args: string[]): string | undefined {
  if (command === 'where.exe') return args[0];
  if (command === 'sh' && args[0] === '-c') return args[1]?.replace(/^command -v /, '');
  return undefined;
}

describe('getPluginDir', () => {
  it('returns the common plugin payload path under dist/', () => {
    const dir = getPluginDir('ghcp');
    expect(dir).toContain('dist');
    expect(dir).toMatch(/dist[\\/]plugin[\\/]azure-functions-skills$/);
  });

  it('returns the same self-contained plugin payload for all targets', () => {
    const dirs = (['ghcp', 'claude', 'codex'] as const).map(target => getPluginDir(target));

    expect(new Set(dirs).size).toBe(1);
  });
});

describe('generateVscodeSettings', () => {
  it('returns settings JSON with pluginLocations', () => {
    const pluginPath = '/path/to/plugin';
    const settings = generateVscodeSettings(pluginPath);
    const locations = settings['chat.pluginLocations'] as Record<string, boolean>;
    expect(settings['chat.plugins.enabled']).toBe(true);
    expect(locations).toBeTruthy();
    expect(locations[pluginPath]).toBe(true);
  });
});

describe('generateCodexMarketplaceEntry', () => {
  it('returns marketplace JSON with correct plugin reference', () => {
    const pluginPath = '/path/to/plugin';
    const mp = generateCodexMarketplaceEntry(pluginPath);
    const plugin = mp.plugins?.[0] as { name: string; source: { path: string; source: string } };
    expect(mp.plugins).toBeInstanceOf(Array);
    expect(plugin.name).toBe('azure-functions-skills');
    expect(plugin.source.path).toBe(pluginPath);
    expect(plugin.source.source).toBe('local');
  });
});

describe('generateClaudeSettings', () => {
  it('returns settings with add_dirs pointing to plugin', () => {
    const pluginPath = '/path/to/plugin';
    const settings = generateClaudeSettings(pluginPath);
    // Claude uses the plugin dir as an additional directory for skill discovery
    expect(settings).toBeTruthy();
  });
});

describe('planPluginOperation', () => {
  it('uses the package version when no version is specified', () => {
    const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8')) as { version: string };

    const plan = planPluginOperation({
      action: 'install',
      agents: ['ghcp'],
      projectDir: '/workspace/project',
      dryRun: true,
    });

    expect(plan.version).toBe(packageJson.version);
    expect(plan.steps.map(step => step.description).join('\n')).toContain(packageJson.version);
  });

  it('plans plugin install with workspace activation without writing files', () => {
    const plan = planPluginOperation({
      action: 'install',
      agents: ['ghcp'],
      projectDir: '/workspace/project',
      dryRun: true,
      scope: 'workspace',
      source: 'marketplace',
      version: '0.12.1',
      workspace: true,
    });

    expect(plan.action).toBe('install');
    expect(plan.dryRun).toBe(true);
    expect(plan.steps).toContainEqual(expect.objectContaining({ target: 'ghcp', kind: 'plugin-registration' }));
    expect(plan.steps).toContainEqual(expect.objectContaining({ target: 'ghcp', kind: 'workspace-activation' }));
    expect(plan.steps.find(step => step.target === 'ghcp' && step.kind === 'plugin-registration')?.commands).toEqual([
      'copilot plugin marketplace add Azure/azure-functions-skills',
      'copilot plugin install azure-functions-skills@azure-functions-skills',
    ]);
    expect(plan.steps.map(step => step.description).join('\n')).toContain('0.12.1');
  });

  it('plans official plugin install commands for GHCP and Codex plus Claude plugin-from-source validation', () => {
    const plan = planPluginOperation({
      action: 'install',
      agents: ['ghcp', 'claude', 'codex'],
      projectDir: '/workspace/project',
      dryRun: true,
      scope: 'workspace',
      workspace: false,
    });

    const pluginSteps = plan.steps.filter(step => step.kind === 'plugin-registration');
    const normalizedSteps = pluginSteps.map(step => [step.target, step.commands?.map(command => command.replaceAll('\\', '/'))]);
    expect(normalizedSteps).toEqual([
      ['ghcp', [
        'copilot plugin marketplace add Azure/azure-functions-skills',
        'copilot plugin install azure-functions-skills@azure-functions-skills',
      ]],
      ['claude', [
        'git clone https://github.com/Azure/azure-functions-skills.git /workspace/project/.azure-functions-skills/source/azure-functions-skills',
        'claude plugin validate /workspace/project/.azure-functions-skills/source/azure-functions-skills/.github/plugins/azure-functions-skills',
      ]],
      ['codex', [
        'codex plugin marketplace add Azure/azure-functions-skills',
        'codex plugin add azure-functions-skills@azure-functions-skills',
      ]],
    ]);
  });

  it('runs official plugin install commands before workspace activation', async () => {
    const dir = createTempDir('af-skills-plugin-official-install-');
    const runner = acceptingRunner();
    try {
      const result = await runPluginOperation({
        action: 'install',
        agents: ['ghcp', 'claude', 'codex'],
        projectDir: dir,
        dryRun: false,
        scope: 'workspace',
        workspace: true,
        runner,
      });

      const installCalls = runner.calls.filter(call => !checkedToolName(call.command, call.args));
      expect(installCalls).toEqual([
        { command: 'copilot', args: ['plugin', 'marketplace', 'add', 'Azure/azure-functions-skills'] },
        { command: 'copilot', args: ['plugin', 'install', 'azure-functions-skills@azure-functions-skills'] },
        { command: 'git', args: ['clone', 'https://github.com/Azure/azure-functions-skills.git', join(dir, '.azure-functions-skills', 'source', 'azure-functions-skills')] },
        { command: 'claude', args: ['plugin', 'validate', join(dir, '.azure-functions-skills', 'source', 'azure-functions-skills', '.github', 'plugins', 'azure-functions-skills')] },
        { command: 'codex', args: ['plugin', 'marketplace', 'add', 'Azure/azure-functions-skills'] },
        { command: 'codex', args: ['plugin', 'add', 'azure-functions-skills@azure-functions-skills'] },
      ]);
      expect(existsSync(join(dir, '.github', 'copilot-instructions.md'))).toBe(true);
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
      expect(result.filesWritten).toBeGreaterThan(0);
    } finally {
      removeDir(dir);
    }
  });

  it('reports missing Claude prerequisites with install guidance before running install commands', async () => {
    const dir = createTempDir('af-skills-plugin-missing-claude-');
    const runner = missingToolsRunner(['git', 'claude']);
    try {
      await expect(runPluginOperation({
        action: 'install',
        agents: ['claude'],
        projectDir: dir,
        dryRun: false,
        workspace: true,
        runner,
      })).rejects.toThrow(/Cannot install Azure Functions Skills plugin for Claude Code[\s\S]*git[\s\S]*claude[\s\S]*https:\/\/git-scm\.com\/downloads[\s\S]*https:\/\/claude\.ai\/download/);

      expect(runner.calls.some(call => call.command === 'git' && call.args[0] === 'clone')).toBe(false);
      expect(runner.calls.some(call => call.command === 'claude' && call.args[0] === 'plugin')).toBe(false);
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
    } finally {
      removeDir(dir);
    }
  });

  it('reports missing GitHub Copilot CLI with retry guidance', async () => {
    const dir = createTempDir('af-skills-plugin-missing-ghcp-');
    const runner = missingToolsRunner(['copilot']);
    try {
      await expect(runPluginOperation({
        action: 'install',
        agents: ['ghcp'],
        projectDir: dir,
        dryRun: false,
        workspace: true,
        runner,
      })).rejects.toThrow(/Cannot install Azure Functions Skills plugin for GitHub Copilot CLI[\s\S]*copilot[\s\S]*GitHub Copilot CLI[\s\S]*azure-functions-skills plugin install --agent ghcp/);

      expect(runner.calls.some(call => call.command === 'copilot')).toBe(false);
      expect(existsSync(join(dir, '.github', 'copilot-instructions.md'))).toBe(false);
    } finally {
      removeDir(dir);
    }
  });

  it('checks required tools with command -v on Linux-like platforms', async () => {
    const dir = createTempDir('af-skills-plugin-linux-preflight-');
    const runner = acceptingRunner();
    try {
      await runPluginOperation({
        action: 'install',
        agents: ['claude'],
        projectDir: dir,
        dryRun: false,
        workspace: false,
        platform: 'linux',
        runner,
      });

      expect(runner.calls.slice(0, 2)).toEqual([
        { command: 'sh', args: ['-c', 'command -v git'] },
        { command: 'sh', args: ['-c', 'command -v claude'] },
      ]);
      const installCalls = runner.calls.filter(call => !checkedToolName(call.command, call.args));
      expect(installCalls.map(call => call.command)).toEqual(['git', 'claude']);
    } finally {
      removeDir(dir);
    }
  });

  it('uses the current repository plugin payload for Claude when source is local', () => {
    const plan = planPluginOperation({
      action: 'install',
      agents: ['claude'],
      projectDir: '/workspace/project',
      source: 'local',
      dryRun: true,
      workspace: false,
    });

    const command = plan.steps[0].commands?.[0] || '';
    expect(command).toContain('claude plugin validate');
    expect(command).toContain('.github');
    expect(command).toContain('plugins');
    expect(command).toContain('azure-functions-skills');
  });

  it('plans plugin update without workspace activation when disabled', () => {
    const plan = planPluginOperation({
      action: 'update',
      agents: ['claude', 'codex'],
      projectDir: '/workspace/project',
      dryRun: true,
      scope: 'user',
      source: 'local',
      workspace: false,
    });

    expect(plan.action).toBe('update');
    expect(plan.steps.filter(step => step.kind === 'plugin-registration')).toHaveLength(2);
    expect(plan.steps.some(step => step.kind === 'workspace-activation')).toBe(false);
    expect(plan.steps.map(step => step.target)).toEqual(['claude', 'codex']);
  });
});
