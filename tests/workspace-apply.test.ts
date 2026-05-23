import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  it('refuses to append to existing Claude instructions without approval', async () => {
    const dir = makeTempDir();
    const claudePath = join(dir, 'CLAUDE.md');
    writeFileSync(claudePath, ['# Project Rules', '', 'Keep this file careful.'].join('\n'));

    await expect(applyWorkspace(dir, {
      agents: ['claude'],
      mode: 'plugin-reference',
      mergeStrategy: 'managed-block',
    })).rejects.toThrow(/Refusing to modify existing customer-owned file/);

    expect(readFileSync(claudePath, 'utf-8')).not.toContain('azure-functions-skills:start');
  });

  it('appends a managed block to existing Claude instructions when approved', async () => {
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
    expect(content).toContain('<!-- azure-functions-skills:start');
    expect(result.filesWritten).toBeGreaterThan(0);
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

    expect(existsSync(join(dir, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(dir, '.github', 'copilot', 'settings.json'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, '.agents', 'plugins', 'marketplace.json'))).toBe(true);

    expect(existsSync(join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(dir, '.claude', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(dir, '.agents', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(false);
    expect(result.filesWritten).toBeGreaterThan(0);
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

    expect(existsSync(join(dir, '.vscode', 'mcp.json'))).toBe(true);
    expect(existsSync(join(dir, '.github', 'hooks', 'welcome-setup.json'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(dir, '.codex', 'config.toml'))).toBe(true);
    expect(existsSync(join(dir, '.codex', 'hooks.json'))).toBe(true);

    const codexHooks = readFileSync(join(dir, '.codex', 'hooks.json'), 'utf-8');
    expect(codexHooks).toContain('node -e');
    expect(codexHooks).not.toContain('bash -c');
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
