import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkills } from '../src/build/loader.js';
import { applyWorkspace } from '../src/setup/workspace.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');
const TEMP_DIRS: string[] = [];

function makeTempDir(): string {
  const dir = createTempDir('af-skills-workspace-apply-');
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) {
    removeDir(dir);
  }
});

describe('applyWorkspace', () => {
  it('copy mode forwards repository template source options to local setup', async () => {
    const marker = 'WORKSPACE_APPLY_REPOSITORY_TEMPLATE_MARKER';
    const repoDir = createGeneratedWorkspaceSource(marker);
    const dir = makeTempDir();

    const result = await applyWorkspace(dir, {
      agents: ['ghcp'],
      mode: 'copy',
      templateSource: { mode: 'repository', repositoryPath: repoDir },
    });

    const installedSkill = readFileSync(join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8');
    expect(installedSkill).toContain(marker);
    expect(result.templateSource?.kind).toBe('repository');
    expect(result.warnings).toEqual([]);
  });

  it('copy mode supports package-only template source for library callers', async () => {
    const marker = 'WORKSPACE_APPLY_IGNORED_REPOSITORY_TEMPLATE_MARKER';
    const repoDir = createGeneratedWorkspaceSource(marker);
    const dir = makeTempDir();

    const result = await applyWorkspace(dir, {
      agents: ['ghcp'],
      mode: 'copy',
      templateSource: { mode: 'package', repositoryPath: repoDir },
    });

    const installedSkill = readFileSync(join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8');
    expect(installedSkill).not.toContain(marker);
    expect(result.templateSource?.kind).toBe('package');
    expect(result.warnings).toEqual([]);
  });

  it('copy mode returns template source fallback warnings to library callers', async () => {
    const dir = makeTempDir();

    const result = await applyWorkspace(dir, {
      agents: ['ghcp'],
      mode: 'copy',
      templateSource: { mode: 'auto', repositoryPath: join(dir, 'missing-repository') },
    });

    expect(existsSync(join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
    expect(result.templateSource?.kind).toBe('package');
    expect(result.warnings?.some(warning => warning.includes('Falling back'))).toBe(true);
  });

  it('saves aside generated routing without modifying existing Claude instructions when not approved', async () => {
    const dir = makeTempDir();
    const claudePath = join(dir, 'CLAUDE.md');
    writeFileSync(claudePath, ['# Project Rules', '', 'Keep this file careful.'].join('\n'));

    const result = await applyWorkspace(dir, {
      agents: ['claude'],
      mode: 'plugin-reference',
      mergeStrategy: 'managed-block',
    });

    expect(readFileSync(claudePath, 'utf-8')).not.toContain('azure-functions-skills:start');
    expect(readFileSync(claudePath, 'utf-8')).toContain('Keep this file careful.');
    expect(existsSync(join(dir, 'CLAUDE.azure-functions-skills-new.md'))).toBe(true);
    expect(result.savedAside).toHaveLength(1);
  });

  it('saves aside generated routing when existing Claude instructions are customer-owned', async () => {
    const dir = makeTempDir();
    const claudePath = join(dir, 'CLAUDE.md');
    writeFileSync(claudePath, ['# Project Rules', '', 'Keep this file careful.'].join('\n'));

    const result = await applyWorkspace(dir, {
      agents: ['claude'],
      mode: 'plugin-reference',
      mergeStrategy: 'managed-block',
      yes: true,
    });

    const content = readFileSync(claudePath, 'utf-8');
    expect(content).toContain('Keep this file careful.');
    expect(content).not.toContain('<!-- azure-functions-skills:start');
    const asidePath = join(dir, 'CLAUDE.azure-functions-skills-new.md');
    expect(existsSync(asidePath)).toBe(true);
    expect(readFileSync(asidePath, 'utf-8')).toContain('Azure Functions Skills');
    expect(result.filesWritten).toBeGreaterThan(0);
    expect(result.savedAside).toEqual([{ original: 'CLAUDE.md', aside: 'CLAUDE.azure-functions-skills-new.md' }]);
  });

  it('preserves customer content while replacing the managed block', async () => {
    const dir = makeTempDir();
    const claudePath = join(dir, 'CLAUDE.md');
    writeFileSync(
      claudePath,
      [
        '# Project Rules',
        '',
        'Keep this introduction.',
        '',
        '<!-- azure-functions-skills:start version=old -->',
        'old generated content',
        '<!-- azure-functions-skills:end -->',
        '',
        'Keep this footer.',
      ].join('\n'),
    );

    const result = await applyWorkspace(dir, {
      agents: ['claude'],
      mode: 'plugin-reference',
      mergeStrategy: 'managed-block',
      update: true,
    });

    const content = readFileSync(claudePath, 'utf-8');
    expect(content).toContain('Keep this introduction.');
    expect(content).toContain('Keep this footer.');
    expect(content).toContain('<!-- azure-functions-skills:start');
    expect(content).toContain('For Azure Functions work, prefer the Azure Functions Skills plugin');
    expect(content).not.toContain('old generated content');
    expect(result.filesWritten).toBeGreaterThan(0);
  });

  it('generates routing guidance from current skill templates', async () => {
    const dir = makeTempDir();

    await applyWorkspace(dir, {
      agents: ['claude'],
      mode: 'plugin-reference',
      mergeStrategy: 'managed-block',
    });

    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    const routedSkills = loadSkills(join(TEMPLATES_DIR, 'skills'))
      .filter(skill => skill.category !== 'reference')
      .map(skill => skill.id);

    for (const skillId of routedSkills) {
      expect(content).toContain(`- ${skillId}:`);
    }
    expect(content).not.toContain('- azure-functions-common:');
    expect(content).not.toContain('{{skills}}');
  });

  it('plugin-reference mode writes activation files without copying skill bodies', async () => {
    const dir = makeTempDir();

    const result = await applyWorkspace(dir, {
      agents: ['ghcp', 'claude', 'codex'],
      mode: 'plugin-reference',
      mergeStrategy: 'managed-block',
    });

    expect(existsSync(join(dir, '.github', 'copilot-instructions.md'))).toBe(false);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, '.github', 'copilot', 'settings.json'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(dir, '.agents', 'plugins', 'marketplace.json'))).toBe(true);

    expect(existsSync(join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(dir, '.claude', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(dir, '.agents', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(false);
    expect(result.filesWritten).toBeGreaterThan(0);
  });

  it('can include the GHCP workspace agent definition without copying skill bodies', async () => {
    const dir = makeTempDir();

    const result = await applyWorkspace(dir, {
      agents: ['ghcp'],
      mode: 'plugin-reference',
      mergeStrategy: 'managed-block',
      includeAgent: true,
    });

    const agentPath = join(dir, '.github', 'agents', 'functions-copilot.agent.md');
    expect(existsSync(agentPath)).toBe(true);
    expect(readFileSync(agentPath, 'utf-8')).toContain('name: functions-copilot');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toContain('Azure Functions Development Standards');
    expect(existsSync(join(dir, '.github', 'copilot-instructions.md'))).toBe(false);
    expect(existsSync(join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(false);
    expect(result.plannedFiles).toContain('.github/agents/functions-copilot.agent.md');
    expect(result.plannedFiles).toContain('AGENTS.md');
    expect(result.plannedFiles).not.toContain('.github/copilot-instructions.md');
  });

  it('dry-run reports planned changes without writing files', async () => {
    const dir = makeTempDir();

    const result = await applyWorkspace(dir, {
      agents: ['codex'],
      mode: 'plugin-reference',
      mergeStrategy: 'managed-block',
      dryRun: true,
    });

    expect(result.filesWritten).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.plannedFiles).toContain('AGENTS.md');
    expect(result.plannedFiles).toContain('.agents/plugins/marketplace.json');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(dir, '.agents', 'plugins', 'marketplace.json'))).toBe(false);
  });

  it('adds MCP and host hooks only when explicitly requested', async () => {
    const dir = makeTempDir();

    await applyWorkspace(dir, {
      agents: ['ghcp', 'claude', 'codex'],
      mode: 'plugin-reference',
      includeMcp: true,
      includeHooks: true,
    });

    expect(existsSync(join(dir, '.mcp.json'))).toBe(true);
    expect(existsSync(join(dir, '.vscode', 'mcp.json'))).toBe(false);
    expect(existsSync(join(dir, '.github', 'hooks', 'welcome-setup.json'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(dir, '.codex', 'config.toml'))).toBe(true);
    expect(existsSync(join(dir, '.codex', 'hooks.json'))).toBe(true);

    const codexHooks = readFileSync(join(dir, '.codex', 'hooks.json'), 'utf-8');
    expect(codexHooks).toContain('node -e');
    expect(codexHooks).not.toContain('bash -c');
  });

  it('deep-merges JSON settings so plugin activation stays live', async () => {
    const dir = makeTempDir();
    const settingsPath = join(dir, '.github', 'copilot', 'settings.json');
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ existingSetting: true }, null, 2));

    const result = await applyWorkspace(dir, {
      agents: ['ghcp'],
      mode: 'plugin-reference',
      includeMcp: true,
      includeHooks: true,
      includeAgent: true,
    });

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      existingSetting?: boolean;
      enabledPlugins?: Record<string, boolean>;
      extraKnownMarketplaces?: Record<string, unknown>;
    };
    expect(settings.existingSetting).toBe(true);
    expect(settings.enabledPlugins?.['azure-functions-skills@azure-functions-skills']).toBe(true);
    expect(settings.extraKnownMarketplaces?.['azure-functions-skills']).toBeTruthy();
    expect(result.savedAside).toHaveLength(0);
  });

  it('coalesces Claude plugin and MCP settings before applying conflict policy', async () => {
    const dir = makeTempDir();
    const settingsPath = join(dir, '.claude', 'settings.json');
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ existingSetting: true }, null, 2));

    await applyWorkspace(dir, {
      agents: ['claude'],
      mode: 'plugin-reference',
      includeMcp: true,
    });

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      existingSetting?: boolean;
      enabledPlugins?: Record<string, boolean>;
      mcpServers?: Record<string, unknown>;
    };
    expect(settings.existingSetting).toBe(true);
    expect(settings.enabledPlugins?.['azure-functions-skills@azure-functions-skills']).toBe(true);
    expect(Object.keys(settings.mcpServers || {}).length).toBeGreaterThan(0);
  });

  it('saves aside non-JSON settings unless force is set', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, '.codex', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, 'custom = true\n');

    const result = await applyWorkspace(dir, {
      agents: ['codex'],
      mode: 'plugin-reference',
      includeMcp: true,
      yes: true,
    });

    expect(readFileSync(configPath, 'utf-8')).toBe('custom = true\n');
    const asidePath = join(dir, '.codex', 'config.azure-functions-skills-new.toml');
    expect(existsSync(asidePath)).toBe(true);
    expect(readFileSync(asidePath, 'utf-8')).toContain('Azure Functions MCP Servers');
    expect(result.savedAside).toEqual([{ original: '.codex/config.toml', aside: join('.codex', 'config.azure-functions-skills-new.toml') }]);
  });

  it('force overwrites customer-owned routing and non-JSON settings', async () => {
    const dir = makeTempDir();
    const agentsPath = join(dir, 'AGENTS.md');
    const configPath = join(dir, '.codex', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(agentsPath, 'CUSTOM AGENTS\n');
    writeFileSync(configPath, 'custom = true\n');

    const result = await applyWorkspace(dir, {
      agents: ['codex'],
      mode: 'plugin-reference',
      includeMcp: true,
      force: true,
      yes: true,
    });

    expect(readFileSync(agentsPath, 'utf-8')).not.toContain('CUSTOM AGENTS');
    expect(readFileSync(agentsPath, 'utf-8')).toContain('For Azure Functions work');
    expect(readFileSync(configPath, 'utf-8')).not.toContain('custom = true');
    expect(readFileSync(configPath, 'utf-8')).toContain('Azure Functions MCP Servers');
    expect(result.savedAside).toHaveLength(0);
    expect(result.overwritten).toContain('AGENTS.md');
    expect(result.overwritten).toContain('.codex/config.toml');
  });

  it('include-file strategy creates an include target and avoids duplicate include lines', async () => {
    const dir = makeTempDir();
    const agentsPath = join(dir, 'AGENTS.md');
    writeFileSync(agentsPath, ['# Project Agents', '', 'Keep this file compact.'].join('\n'));

    await applyWorkspace(dir, {
      agents: ['codex'],
      mode: 'plugin-reference',
      mergeStrategy: 'include-file',
      yes: true,
    });
    await applyWorkspace(dir, {
      agents: ['codex'],
      mode: 'plugin-reference',
      mergeStrategy: 'include-file',
      yes: true,
    });

    const content = readFileSync(agentsPath, 'utf-8');
    const includeLine = 'See .azure-functions-skills/AGENTS.azure-functions.md for Azure Functions routing.';
    expect(content.split(includeLine)).toHaveLength(2);

    const includeTarget = join(dir, '.azure-functions-skills', 'AGENTS.azure-functions.md');
    expect(existsSync(includeTarget)).toBe(true);
    expect(readFileSync(includeTarget, 'utf-8')).toContain('Azure Functions Skills');
  });
});

function createGeneratedWorkspaceSource(marker: string): string {
  const repoDir = makeTempDir();
  const workspaceDir = join(repoDir, '.github', 'generated', 'workspace');
  for (const agent of ['ghcp', 'claude', 'codex']) {
    mkdirSync(join(workspaceDir, agent), { recursive: true });
  }

  const skillDir = join(workspaceDir, 'ghcp', '.github', 'skills', 'azure-functions-setup');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: azure-functions-setup',
      'description: Test setup skill',
      '---',
      '',
      marker,
    ].join('\n'),
  );
  writeFileSync(join(workspaceDir, 'manifest.json'), JSON.stringify({ targets: ['ghcp', 'claude', 'codex'] }));
  return repoDir;
}
