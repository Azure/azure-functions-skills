import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildPluginPayload, buildTarget } from '../src/build/build-target.js';
import { loadHooks, loadMcpServers, loadSkills } from '../src/build/loader.js';
import { buildTelemetryRuntime } from '../src/build/telemetry-runtime.js';
import type { BuildData, BuildTargetName } from '../src/types.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMPLATES_DIR = join(import.meta.dirname, '..', 'templates');
const ROOT = join(TEMPLATES_DIR, '..');
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
    hooks: loadHooks(join(TEMPLATES_DIR, 'hooks'), buildTelemetryRuntime(join(TEMPLATES_DIR, 'skills'))),
    packageVersion: '1.2.3',
  };
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('simplified distribution', () => {
  it('excludes local hidden files from the embedded telemetry reference allowlist', () => {
    const root = makeTempDir('af-skills-allowlist-');
    const skill = join(root, 'azure-functions-help');
    mkdirSync(join(skill, '.cache'), { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '# Help');
    writeFileSync(join(skill, '.DS_Store'), 'local metadata');
    writeFileSync(join(skill, '.cache', 'private-name.md'), 'local metadata');
    const runtime = buildTelemetryRuntime(root).code;
    expect(runtime).toContain('azure-functions-help/SKILL.md');
    expect(runtime.includes('.DS_Store')).toBe(false);
    expect(runtime.includes('private-name.md')).toBe(false);
  });

  it('keeps the published build command independent of development dependencies', () => {
    const root = makeTempDir('af-skills-packed-build ');
    for (const path of ['bin', 'lib', 'templates']) cpSync(join(ROOT, path), join(root, path), { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(root, 'package.json'));
    const plugin = join(root, 'dist', 'plugin', 'azure-functions-skills');
    mkdirSync(plugin, { recursive: true });
    buildPluginPayload(buildData(), plugin);
    const output = join(root, 'built assets');
    const result = spawnSync(process.execPath, [
      join(root, 'bin', 'azure-functions-skills.js'), 'build', '--dist-dir', output,
    ], { cwd: root, encoding: 'utf-8', timeout: 30_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(output, 'plugin', 'azure-functions-skills', 'hooks', 'runtime', 'telemetry.mjs'), 'utf-8'))
      .toBe(readFileSync(join(plugin, 'hooks', 'runtime', 'telemetry.mjs'), 'utf-8'));
  }, 60_000);

  it('builds one plugin payload containing only skills, MCP, telemetry hooks, and manifests', () => {
    const root = makeTempDir('af-skills-plugin-');

    buildPluginPayload(buildData(), root);

    expect(existsSync(join(root, 'skills', 'azure-functions-help', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    expect(existsSync(join(root, 'hooks', 'copilot-hooks.json'))).toBe(true);
    expect(existsSync(join(root, 'hooks', 'hooks.json'))).toBe(true);
    expectLocalTelemetry(root, 'hooks', 'skills');
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
      expectLocalTelemetry(targetRoot, join(hookRoot, 'hooks'), skillsPath);
      expect(existsSync(join(targetRoot, 'AGENTS.md'))).toBe(false);
      expect(existsSync(join(targetRoot, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(targetRoot, '.github', 'agents'))).toBe(false);
      expect(existsSync(join(targetRoot, '.github', 'hooks', 'welcome-setup.json'))).toBe(false);
    },
  );

});

function expectLocalTelemetry(root: string, hooksPath: string, skillsPath: string): void {
  const runtime = readFileSync(join(root, hooksPath, 'runtime', 'telemetry.mjs'), 'utf-8');
  expect(runtime).toContain('AzureFunctionsSkillsPluginExecuted');
  expect(runtime).toContain('a5ea7fbd-8657-4d92-8dd1-c059329b11e8');
  expect(existsSync(join(root, hooksPath, 'runtime', 'THIRD-PARTY-NOTICES.txt'))).toBe(true);
  for (const script of ['track-telemetry.sh', 'track-telemetry.ps1']) {
    const content = readFileSync(join(root, hooksPath, 'scripts', script), 'utf-8');
    expect(content).toContain('{"continue":true}');
    expect(content).toContain('telemetry.mjs');
    expect(content).not.toMatch(/\b(?:npx|npm|curl|wget)\b/);
  }
  for (const path of [
    join(skillsPath, 'azure-functions-deploy', 'SKILL.md'),
    join(skillsPath, 'azure-functions-hosted-skills', 'SKILL.md'),
    join(skillsPath, 'azure-functions-hosted-skills', 'references', 'infra-and-deployment.md'),
  ]) {
    const content = readFileSync(join(root, path), 'utf-8');
    expect(content).not.toContain('Automatic plugin telemetry is temporarily disabled.');
    if (path.endsWith('infra-and-deployment.md') || path.includes('azure-functions-deploy')) {
      expect(content).toContain('telemetry.mjs');
      expect(content).toContain('deployment-observed');
      expect(content).not.toContain('npx -y @azure/functions-skills');
    }
  }
}
