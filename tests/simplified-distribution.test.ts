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

  it('replaces local managed assets without creating state or preserving stale skill files', async () => {
    const root = makeTempDir('af-skills-replace-');
    const staleSkillDir = join(root, '.github', 'skills', 'azure-functions-stale');
    const legacyStateDir = join(root, '.azure-functions-skills');
    const legacyAgent = join(root, '.github', 'agents', 'functions-copilot.agent.md');
    const instructions = join(root, 'AGENTS.md');
    mkdirSync(staleSkillDir, { recursive: true });
    mkdirSync(legacyStateDir, { recursive: true });
    mkdirSync(join(legacyAgent, '..'), { recursive: true });
    writeFileSync(join(staleSkillDir, 'SKILL.md'), 'stale');
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
    expect(existsSync(staleSkillDir)).toBe(false);
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
});
