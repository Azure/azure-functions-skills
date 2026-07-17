import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPluginPayload, buildTarget } from '../src/build/build-target.js';
import { loadHooks, loadMcpServers, loadSkills } from '../src/build/loader.js';
import { installLocalSkills } from '../src/setup/index.js';
import type { BuildData, BuildTargetName } from '../src/types.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMPLATES_DIR = join(import.meta.dirname, '..', 'templates');
const TEMP_DIRS: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

function buildData(): BuildData {
  return {
    skills: loadSkills(join(TEMPLATES_DIR, 'skills')),
    mcpServers: loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml')),
    hooks: loadHooks(join(TEMPLATES_DIR, 'hooks')),
    packageVersion: '1.2.3',
  };
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('simplified distribution', () => {
  it('builds one plugin payload containing only skills, MCP, telemetry hooks, and manifests', () => {
    const root = makeTempDir('af-skills-plugin-');

    buildPluginPayload(buildData(), root);

    expect(existsSync(join(root, 'skills', 'azure-functions-help', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    expect(existsSync(join(root, 'hooks', 'copilot-hooks.json'))).toBe(true);
    expect(existsSync(join(root, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(root, 'agents'))).toBe(false);
    expect(existsSync(join(root, 'prompts'))).toBe(false);

    const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf-8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      skills: './skills/',
      mcpServers: './.mcp.json',
    });
    expect(manifest).not.toHaveProperty('agents');
  });

  it.each([
    ['ghcp', join('.github', 'skills'), '.mcp.json', join('.github', 'hooks', 'azure-functions-telemetry.json')],
    ['claude', join('.claude', 'skills'), join('.claude', 'settings.json'), join('.claude', 'hooks', 'hooks.json')],
    ['codex', join('.agents', 'skills'), join('.codex', 'config.toml'), join('.codex', 'hooks.json')],
  ] as const)(
    'builds %s local assets without instruction, agent, or welcome files',
    (target: BuildTargetName, skillsPath: string, mcpPath: string, hookPath: string) => {
      const root = makeTempDir(`af-skills-local-${target}-`);

      buildTarget(target, buildData(), root);
      const targetRoot = join(root, target);

      expect(existsSync(join(targetRoot, skillsPath, 'azure-functions-help', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(targetRoot, mcpPath))).toBe(true);
      expect(existsSync(join(targetRoot, hookPath))).toBe(true);
      expect(existsSync(join(targetRoot, 'AGENTS.md'))).toBe(false);
      expect(existsSync(join(targetRoot, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(targetRoot, '.github', 'agents'))).toBe(false);
      expect(existsSync(join(targetRoot, '.github', 'hooks', 'welcome-setup.json'))).toBe(false);
    },
  );

  it('replaces bundled skills while preserving user-created Azure Functions skills', async () => {
    const root = makeTempDir('af-skills-replace-');
    const bundledSkill = join(root, '.github', 'skills', 'azure-functions-help', 'SKILL.md');
    const userSkillDir = join(root, '.github', 'skills', 'azure-functions-internal-runbook');
    const legacyStateDir = join(root, '.azure-functions-skills');
    const legacyAgent = join(root, '.github', 'agents', 'functions-copilot.agent.md');
    const instructions = join(root, 'AGENTS.md');
    mkdirSync(join(bundledSkill, '..'), { recursive: true });
    mkdirSync(userSkillDir, { recursive: true });
    mkdirSync(legacyStateDir, { recursive: true });
    mkdirSync(join(legacyAgent, '..'), { recursive: true });
    writeFileSync(bundledSkill, 'stale bundled content');
    writeFileSync(join(userSkillDir, 'SKILL.md'), 'user-owned');
    writeFileSync(join(legacyStateDir, 'state.local.json'), '{}');
    writeFileSync(legacyAgent, 'legacy');
    writeFileSync(instructions, [
      'customer content',
      '<!-- azure-functions-skills:start version=0.0.2 -->',
      'legacy routing',
      '<!-- azure-functions-skills:end -->',
      '',
    ].join('\n'));

    const result = await installLocalSkills({
      targetDir: root,
      agents: ['ghcp'],
      checkForUpdates: false,
    });

    expect(result.filesWritten).toBeGreaterThan(0);
    expect(readFileSync(bundledSkill, 'utf-8')).not.toBe('stale bundled content');
    expect(readFileSync(join(userSkillDir, 'SKILL.md'), 'utf-8')).toBe('user-owned');
    expect(existsSync(legacyStateDir)).toBe(false);
    expect(existsSync(legacyAgent)).toBe(false);
    expect(readFileSync(instructions, 'utf-8')).toBe('customer content\n');
    expect(existsSync(join(root, '.github', 'skills', 'azure-functions-help', 'SKILL.md'))).toBe(true);
  });

  it.each([
    ['ghcp', join('.github', 'hooks', 'scripts', 'custom-hook.js')],
    ['claude', join('.claude', 'hooks', 'custom-hook.json')],
    ['codex', join('.codex', 'hooks', 'custom-hook.json')],
  ] as const)('preserves non-Azure %s hook files during replacement', async (agent, customHookPath) => {
    const root = makeTempDir(`af-skills-preserve-${agent}-`);
    const customHook = join(root, customHookPath);
    mkdirSync(join(customHook, '..'), { recursive: true });
    writeFileSync(customHook, 'user-owned');

    await installLocalSkills({
      targetDir: root,
      agents: [agent],
      checkForUpdates: false,
    });

    expect(readFileSync(customHook, 'utf-8')).toBe('user-owned');
  });

  it.each([
    ['claude', join('.claude', 'hooks', 'hooks.json')],
    ['codex', join('.codex', 'hooks.json')],
  ] as const)('preserves registered user hooks in %s settings', async (agent, hookSettingsPath) => {
    const root = makeTempDir(`af-skills-preserve-${agent}-hook-settings-`);
    const hookSettings = join(root, hookSettingsPath);
    mkdirSync(join(hookSettings, '..'), { recursive: true });
    writeFileSync(hookSettings, JSON.stringify({
      hooks: {
        PostToolUse: [{
          hooks: [{ type: 'command', command: 'custom-hook' }],
        }],
      },
    }));

    await installLocalSkills({
      targetDir: root,
      agents: [agent],
      checkForUpdates: false,
    });

    const settings = JSON.parse(readFileSync(hookSettings, 'utf-8')) as {
      hooks: { PostToolUse: Array<{ hooks?: Array<{ command?: string }>; command?: string }> };
    };
    const serialized = JSON.stringify(settings.hooks.PostToolUse);
    expect(serialized).toContain('custom-hook');
    expect(serialized).toContain('track-telemetry.sh');
  });

  it('merges GHCP MCP settings without removing user servers', async () => {
    const root = makeTempDir('af-skills-preserve-ghcp-settings-');
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({
      inputs: [{ id: 'subscription' }],
      mcpServers: {
        custom: { command: 'custom-server', args: ['start'] },
        azure: { command: 'old-azure', args: [] },
      },
    }));

    await installLocalSkills({
      targetDir: root,
      agents: ['ghcp'],
      checkForUpdates: false,
    });

    const settings = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf-8')) as {
      inputs: Array<{ id: string }>;
      mcpServers: Record<string, { command: string }>;
    };
    expect(settings.inputs).toEqual([{ id: 'subscription' }]);
    expect(settings.mcpServers.custom.command).toBe('custom-server');
    expect(settings.mcpServers.azure.command).toBe('npx');
  });

  it('merges Claude MCP and telemetry hooks without removing user settings', async () => {
    const root = makeTempDir('af-skills-preserve-claude-settings-');
    const settingsPath = join(root, '.claude', 'settings.json');
    mkdirSync(join(settingsPath, '..'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      permissions: { allow: ['Read'] },
      mcpServers: { custom: { command: 'custom-server', args: [] } },
      hooks: {
        PostToolUse: [{
          matcher: 'Write',
          hooks: [{ type: 'command', command: 'custom-hook' }],
        }],
      },
    }));

    await installLocalSkills({
      targetDir: root,
      agents: ['claude'],
      checkForUpdates: false,
    });

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      permissions: { allow: string[] };
      mcpServers: Record<string, { command: string }>;
      hooks: { PostToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(settings.permissions.allow).toEqual(['Read']);
    expect(settings.mcpServers.custom.command).toBe('custom-server');
    expect(settings.mcpServers.azure.command).toBe('npx');
    expect(settings.hooks.PostToolUse.some(entry =>
      entry.hooks.some(hook => hook.command === 'custom-hook'))).toBe(true);
    expect(settings.hooks.PostToolUse.some(entry =>
      entry.hooks.some(hook => hook.command.includes('track-telemetry.sh')))).toBe(true);
  });

  it('updates the owned Codex MCP section without removing user TOML', async () => {
    const root = makeTempDir('af-skills-preserve-codex-settings-');
    const configPath = join(root, '.codex', 'config.toml');
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, [
      'model = "gpt-test"',
      '',
      '[mcp_servers.custom]',
      'command = "custom-server"',
      '',
      '[mcp_servers.azure]',
      'command = "old-azure"',
      '',
    ].join('\n'));

    await installLocalSkills({
      targetDir: root,
      agents: ['codex'],
      checkForUpdates: false,
    });

    const config = readFileSync(configPath, 'utf-8');
    expect(config).toContain('model = "gpt-test"');
    expect(config).toContain('[mcp_servers.custom]');
    expect(config).toContain('command = "custom-server"');
    expect(config).toContain('[mcp_servers.azure]');
    expect(config).toContain('command = "npx"');
    expect(config).not.toContain('command = "old-azure"');
    expect(config.match(/\[mcp_servers\.azure\]/g)).toHaveLength(1);
  });

  it('migrates legacy telemetry opt-out and preserves it across updates', async () => {
    const root = makeTempDir('af-skills-migrate-telemetry-');
    const legacyState = join(root, '.azure-functions-skills', 'state.local.json');
    mkdirSync(join(legacyState, '..'), { recursive: true });
    writeFileSync(legacyState, JSON.stringify({ telemetry: { enabled: false } }));

    await installLocalSkills({
      targetDir: root,
      agents: ['ghcp'],
      checkForUpdates: false,
    });

    const configPath = join(root, '.github', 'hooks', 'telemetry.config.json');
    const migrated = JSON.parse(readFileSync(configPath, 'utf-8')) as { enabled?: boolean };
    expect(migrated.enabled).toBe(false);
    expect(existsSync(join(root, '.azure-functions-skills'))).toBe(false);

    await installLocalSkills({
      targetDir: root,
      agents: ['ghcp'],
      checkForUpdates: false,
    });

    const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as { enabled?: boolean };
    expect(updated.enabled).toBe(false);
  });

  it('preserves a legacy workspace opt-out when agents update at different times', async () => {
    const root = makeTempDir('af-skills-migrate-multi-agent-telemetry-');
    const legacyState = join(root, '.azure-functions-skills', 'state.local.json');
    mkdirSync(join(legacyState, '..'), { recursive: true });
    writeFileSync(legacyState, JSON.stringify({ telemetry: { enabled: false } }));

    await installLocalSkills({
      targetDir: root,
      agents: ['ghcp'],
      checkForUpdates: false,
    });
    await installLocalSkills({
      targetDir: root,
      agents: ['claude'],
      checkForUpdates: false,
    });

    const claudeConfig = JSON.parse(
      readFileSync(join(root, '.claude', 'hooks', 'telemetry.config.json'), 'utf-8'),
    ) as { enabled?: boolean };
    expect(claudeConfig.enabled).toBe(false);
  });

  it('records a library telemetry opt-out without creating legacy state', async () => {
    const root = makeTempDir('af-skills-library-telemetry-');

    await installLocalSkills({
      targetDir: root,
      agents: ['codex'],
      telemetryEnabled: false,
      checkForUpdates: false,
    });

    const config = JSON.parse(
      readFileSync(join(root, '.codex', 'hooks', 'telemetry.config.json'), 'utf-8'),
    ) as { enabled?: boolean };
    expect(config.enabled).toBe(false);
    expect(existsSync(join(root, '.azure-functions-skills'))).toBe(false);
  });

  it('applies an explicit workspace opt-out to agents installed later', async () => {
    const root = makeTempDir('af-skills-explicit-multi-agent-telemetry-');

    await installLocalSkills({
      targetDir: root,
      agents: ['ghcp'],
      telemetryEnabled: false,
      checkForUpdates: false,
    });
    await installLocalSkills({
      targetDir: root,
      agents: ['claude'],
      checkForUpdates: false,
    });

    const config = JSON.parse(
      readFileSync(join(root, '.claude', 'hooks', 'telemetry.config.json'), 'utf-8'),
    ) as { enabled?: boolean };
    expect(config.enabled).toBe(false);
  });

  it('rejects malformed user settings before changing managed assets', async () => {
    const root = makeTempDir('af-skills-invalid-settings-');
    const bundledSkill = join(root, '.github', 'skills', 'azure-functions-help', 'SKILL.md');
    const legacyState = join(root, '.azure-functions-skills', 'state.local.json');
    mkdirSync(join(bundledSkill, '..'), { recursive: true });
    mkdirSync(join(legacyState, '..'), { recursive: true });
    writeFileSync(bundledSkill, 'original bundled content');
    writeFileSync(legacyState, JSON.stringify({ telemetry: { enabled: false } }));
    writeFileSync(join(root, '.mcp.json'), '{ invalid json');

    await expect(installLocalSkills({
      targetDir: root,
      agents: ['ghcp'],
      checkForUpdates: false,
    })).rejects.toThrow('Cannot safely update');

    expect(readFileSync(bundledSkill, 'utf-8')).toBe('original bundled content');
    expect(existsSync(legacyState)).toBe(true);
    expect(readFileSync(join(root, '.mcp.json'), 'utf-8')).toBe('{ invalid json');
  });
});
