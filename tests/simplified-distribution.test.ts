import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPluginPayload, buildTarget } from '../src/build/build-target.js';
import { loadHooks, loadMcpServers, loadSkills } from '../src/build/loader.js';
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
    expectSuspendedTelemetry(root, 'hooks', 'skills');
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
      const hookRoot = target === 'ghcp' ? '.github' : target === 'claude' ? '.claude' : '.codex';
      expectSuspendedTelemetry(targetRoot, join(hookRoot, 'hooks'), skillsPath);
      expect(existsSync(join(targetRoot, 'AGENTS.md'))).toBe(false);
      expect(existsSync(join(targetRoot, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(targetRoot, '.github', 'agents'))).toBe(false);
      expect(existsSync(join(targetRoot, '.github', 'hooks', 'welcome-setup.json'))).toBe(false);
    },
  );

});

function expectSuspendedTelemetry(root: string, hooksPath: string, skillsPath: string): void {
  for (const script of ['track-telemetry.sh', 'track-telemetry.ps1']) {
    const content = readFileSync(join(root, hooksPath, 'scripts', script), 'utf-8');
    expect(content).toContain('{"continue":true}');
    expect(content).not.toMatch(/\b(?:npx|npm|node|curl|wget)\b/);
  }
  for (const path of [
    join(skillsPath, 'azure-functions-deploy', 'SKILL.md'),
    join(skillsPath, 'azure-functions-hosted-skills', 'SKILL.md'),
    join(skillsPath, 'azure-functions-hosted-skills', 'references', 'infra-and-deployment.md'),
  ]) {
    const content = readFileSync(join(root, path), 'utf-8');
    expect(content).not.toContain('telemetry deployment-observed');
    expect(content).not.toContain('perform the one-time internal deployment-observation');
    expect(content).toContain('Automatic plugin telemetry is temporarily disabled.');
  }
}
