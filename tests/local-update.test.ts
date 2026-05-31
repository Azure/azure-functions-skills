import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyLocalUpdate, saveAsidePath } from '../src/setup/local-update.js';
import type { FilePrompter } from '../src/setup/local-update.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];

function makeTempDir(): string {
  const dir = createTempDir('af-skills-local-update-');
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

// ── Helpers ──

/** Create a local-installed workspace with custom user content. */
function setupLocalWorkspace(dir: string, agent: 'ghcp' | 'claude' | 'codex'): void {
  if (agent === 'ghcp') {
    mkdirSync(join(dir, '.github', 'skills', 'azure-functions-setup'), { recursive: true });
    writeFileSync(join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'), '---\nname: azure-functions-setup\n---\nOLD skill content');
    mkdirSync(join(dir, '.github', 'agents'), { recursive: true });
    writeFileSync(join(dir, '.github', 'agents', 'functions-copilot.agent.md'), 'OLD agent definition');
    writeFileSync(join(dir, '.github', 'copilot-instructions.md'), [
      '# My Project Rules',
      '',
      'Custom user content here.',
      '',
      '<!-- azure-functions-skills:start version=0.11.0 -->',
      'old routing content',
      '<!-- azure-functions-skills:end -->',
      '',
      'More custom user content.',
    ].join('\n'));
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    writeFileSync(join(dir, '.vscode', 'mcp.json'), JSON.stringify({
      servers: {
        'my-custom-server': { type: 'stdio', command: 'my-tool', args: [] },
        'azure-functions': { type: 'stdio', command: 'npx', args: ['@azure/mcp@old'] },
      },
    }, null, 2));
    mkdirSync(join(dir, '.github', 'hooks'), { recursive: true });
    writeFileSync(join(dir, '.github', 'hooks', 'welcome-setup.json'), '{"hooks": {}}');
  }

  if (agent === 'claude') {
    mkdirSync(join(dir, '.claude', 'skills', 'azure-functions-setup'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'azure-functions-setup', 'SKILL.md'), '---\nname: azure-functions-setup\n---\nOLD skill content');
    writeFileSync(join(dir, 'CLAUDE.md'), [
      '# My Claude Rules',
      '',
      'Custom Claude content.',
      '',
      '<!-- azure-functions-skills:start version=0.11.0 -->',
      'old routing content',
      '<!-- azure-functions-skills:end -->',
      '',
      'More custom Claude content.',
    ].join('\n'));
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: {
        'my-custom-server': { command: 'my-tool', args: [] },
        'azure-functions': { command: 'npx', args: ['@azure/mcp@old'] },
      },
    }, null, 2));
  }

  if (agent === 'codex') {
    mkdirSync(join(dir, '.agents', 'skills', 'azure-functions-setup'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'skills', 'azure-functions-setup', 'SKILL.md'), '---\nname: azure-functions-setup\n---\nOLD skill content');
    writeFileSync(join(dir, 'AGENTS.md'), [
      '# My Codex Rules',
      '',
      'Custom Codex content.',
      '',
      '<!-- azure-functions-skills:start version=0.11.0 -->',
      'old routing content',
      '<!-- azure-functions-skills:end -->',
      '',
      'More custom Codex content.',
    ].join('\n'));
    mkdirSync(join(dir, '.codex'), { recursive: true });
    writeFileSync(join(dir, '.codex', 'config.toml'), '# Custom Codex config\n[mcp_servers.azure-functions]\ncommand = "npx"\nargs = ["@azure/mcp@old"]\n');
    writeFileSync(join(dir, '.codex', 'hooks.json'), '{"hooks": {}}');
  }
}

// ── Tests ──

describe('applyLocalUpdate', () => {
  describe('skills are always overwritten', () => {
    it('overwrites GHCP skill files with new content', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      await applyLocalUpdate(dir, { agents: ['ghcp'] });

      const skillContent = readFileSync(join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8');
      expect(skillContent).not.toContain('OLD skill content');
      expect(skillContent).toContain('name: azure-functions-setup');
    });

    it('overwrites Claude skill files with new content', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'claude');

      await applyLocalUpdate(dir, { agents: ['claude'] });

      const skillContent = readFileSync(join(dir, '.claude', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8');
      expect(skillContent).not.toContain('OLD skill content');
      expect(skillContent).toContain('name: azure-functions-setup');
    });

    it('overwrites Codex skill files with new content', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'codex');

      await applyLocalUpdate(dir, { agents: ['codex'] });

      const skillContent = readFileSync(join(dir, '.agents', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8');
      expect(skillContent).not.toContain('OLD skill content');
      expect(skillContent).toContain('name: azure-functions-setup');
    });
  });

  describe('agent definitions and hooks are always overwritten', () => {
    it('overwrites GHCP agent definition', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      await applyLocalUpdate(dir, { agents: ['ghcp'] });

      const agentDef = readFileSync(join(dir, '.github', 'agents', 'functions-copilot.agent.md'), 'utf-8');
      expect(agentDef).not.toContain('OLD agent definition');
      expect(agentDef).toContain('functions-copilot');
    });

    it('overwrites GHCP hooks', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      await applyLocalUpdate(dir, { agents: ['ghcp'] });

      const hooks = readFileSync(join(dir, '.github', 'hooks', 'welcome-setup.json'), 'utf-8');
      expect(hooks).toContain('SessionStart');
    });
  });

  describe('routing files use managed-block replacement', () => {
    it('replaces managed block in copilot-instructions.md preserving user content', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      await applyLocalUpdate(dir, { agents: ['ghcp'] });

      const content = readFileSync(join(dir, '.github', 'copilot-instructions.md'), 'utf-8');
      expect(content).toContain('# My Project Rules');
      expect(content).toContain('Custom user content here.');
      expect(content).toContain('More custom user content.');
      expect(content).toContain('<!-- azure-functions-skills:start');
      expect(content).not.toContain('old routing content');
      expect(content).toContain('azure-functions-setup');
    });

    it('replaces managed block in CLAUDE.md preserving user content', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'claude');

      await applyLocalUpdate(dir, { agents: ['claude'] });

      const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
      expect(content).toContain('# My Claude Rules');
      expect(content).toContain('Custom Claude content.');
      expect(content).toContain('More custom Claude content.');
      expect(content).not.toContain('old routing content');
    });

    it('replaces managed block in AGENTS.md preserving user content', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'codex');

      await applyLocalUpdate(dir, { agents: ['codex'] });

      const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('# My Codex Rules');
      expect(content).toContain('Custom Codex content.');
      expect(content).not.toContain('old routing content');
    });
  });

  describe('routing files without managed block use save-aside', () => {
    it('saves aside when CLAUDE.md has no managed block', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, 'CLAUDE.md'), '# Custom Claude rules\n\nNo managed block here.\n');

      const result = await applyLocalUpdate(dir, { agents: ['claude'] });

      // Original file is untouched
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toContain('No managed block here.');
      // New file is saved aside
      const asidePath = join(dir, 'CLAUDE.azure-functions-skills-new.md');
      expect(existsSync(asidePath)).toBe(true);
      expect(readFileSync(asidePath, 'utf-8')).toContain('azure-functions-skills');
      expect(result.savedAside.length).toBeGreaterThan(0);
    });
  });

  describe('MCP settings use save-aside', () => {
    it('saves aside .vscode/mcp.json preserving existing file', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      await applyLocalUpdate(dir, { agents: ['ghcp'] });

      // Original file preserved with user's custom server
      const original = JSON.parse(readFileSync(join(dir, '.vscode', 'mcp.json'), 'utf-8'));
      expect(original.servers['my-custom-server']).toBeDefined();

      // New file saved aside
      const asidePath = join(dir, '.vscode', 'mcp.azure-functions-skills-new.json');
      expect(existsSync(asidePath)).toBe(true);
    });

    it('saves aside .claude/settings.json preserving existing file', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'claude');

      await applyLocalUpdate(dir, { agents: ['claude'] });

      // Original file preserved
      const original = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'));
      expect(original.mcpServers['my-custom-server']).toBeDefined();

      // New file saved aside
      const asidePath = join(dir, '.claude', 'settings.azure-functions-skills-new.json');
      expect(existsSync(asidePath)).toBe(true);
    });

    it('saves aside .codex/config.toml preserving existing file', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'codex');

      await applyLocalUpdate(dir, { agents: ['codex'] });

      // Original file preserved
      const original = readFileSync(join(dir, '.codex', 'config.toml'), 'utf-8');
      expect(original).toContain('# Custom Codex config');

      // New file saved aside
      const asidePath = join(dir, '.codex', 'config.azure-functions-skills-new.toml');
      expect(existsSync(asidePath)).toBe(true);
    });
  });

  describe('--force overwrites everything', () => {
    it('overwrites routing files without managed block when force is set', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, 'CLAUDE.md'), '# Custom Claude rules\n\nNo managed block here.\n');

      await applyLocalUpdate(dir, { agents: ['claude'], force: true });

      const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
      expect(content).not.toContain('No managed block here.');
      expect(content).toContain('azure-functions-skills');
      // No save-aside file created
      expect(existsSync(join(dir, 'CLAUDE.azure-functions-skills-new.md'))).toBe(false);
    });

    it('overwrites MCP settings when force is set', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      await applyLocalUpdate(dir, { agents: ['ghcp'], force: true });

      const mcp = JSON.parse(readFileSync(join(dir, '.vscode', 'mcp.json'), 'utf-8'));
      // User's custom server is gone (overwritten)
      expect(mcp.servers?.['my-custom-server']).toBeUndefined();
      // No save-aside file created
      expect(existsSync(join(dir, '.vscode', 'mcp.azure-functions-skills-new.json'))).toBe(false);
    });
  });

  describe('save-aside collision avoidance', () => {
    it('appends numeric suffix when save-aside file already exists', async () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, 'CLAUDE.md'), '# Custom rules\n');
      // Pre-create the save-aside file from a previous update
      writeFileSync(join(dir, 'CLAUDE.azure-functions-skills-new.md'), 'previous aside content');

      await applyLocalUpdate(dir, { agents: ['claude'] });

      // Original untouched
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toContain('# Custom rules');
      // Previous aside untouched
      expect(readFileSync(join(dir, 'CLAUDE.azure-functions-skills-new.md'), 'utf-8')).toBe('previous aside content');
      // New aside with numeric suffix
      expect(existsSync(join(dir, 'CLAUDE.azure-functions-skills-new.1.md'))).toBe(true);
    });
  });

  describe('result summary', () => {
    it('returns summary of actions taken per file', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      const result = await applyLocalUpdate(dir, { agents: ['ghcp'] });

      expect(result.overwritten.length).toBeGreaterThan(0);
      expect(result.managedBlockUpdated.length).toBeGreaterThan(0);
      expect(result.savedAside.length).toBeGreaterThan(0);
    });
  });

  describe('dry-run', () => {
    it('reports planned actions without writing files', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');
      const originalInstructions = readFileSync(join(dir, '.github', 'copilot-instructions.md'), 'utf-8');

      const result = await applyLocalUpdate(dir, { agents: ['ghcp'], dryRun: true });

      // No files should be modified
      expect(readFileSync(join(dir, '.github', 'copilot-instructions.md'), 'utf-8')).toBe(originalInstructions);
      expect(readFileSync(join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8')).toContain('OLD skill content');
      // But result should describe planned actions
      expect(result.overwritten.length).toBeGreaterThan(0);
      expect(result.managedBlockUpdated.length).toBeGreaterThan(0);
      expect(result.dryRun).toBe(true);
    });
  });

  describe('interactive prompts', () => {
    it('calls prompter for save-aside files when interactive', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      const prompter: FilePrompter = vi.fn().mockResolvedValue('skip');
      await applyLocalUpdate(dir, { agents: ['ghcp'], prompter });

      // prompter should be called for each save-aside candidate
      expect(prompter).toHaveBeenCalled();
      const calls = vi.mocked(prompter).mock.calls;
      // All calls should be for save-aside candidate files
      for (const call of calls) {
        expect(typeof call[0]).toBe('string'); // relativePath
      }
    });

    it('overwrites file when prompter returns overwrite', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      const prompter: FilePrompter = vi.fn().mockResolvedValue('overwrite');
      const result = await applyLocalUpdate(dir, { agents: ['ghcp'], prompter });

      // No save-aside files — all overwritten
      expect(result.savedAside).toHaveLength(0);
      // The files that would have been save-aside are now in overwritten
      expect(result.overwritten.length).toBeGreaterThan(0);
      // mcp.json should be overwritten (user's custom server gone)
      const mcp = JSON.parse(readFileSync(join(dir, '.vscode', 'mcp.json'), 'utf-8'));
      expect(mcp.servers?.['my-custom-server']).toBeUndefined();
      // No save-aside file
      expect(existsSync(join(dir, '.vscode', 'mcp.azure-functions-skills-new.json'))).toBe(false);
    });

    it('saves aside file when prompter returns skip', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      const prompter: FilePrompter = vi.fn().mockResolvedValue('skip');
      const result = await applyLocalUpdate(dir, { agents: ['ghcp'], prompter });

      // Save-aside files created
      expect(result.savedAside.length).toBeGreaterThan(0);
      // User's custom MCP server preserved
      const mcp = JSON.parse(readFileSync(join(dir, '.vscode', 'mcp.json'), 'utf-8'));
      expect(mcp.servers['my-custom-server']).toBeDefined();
    });

    it('does not call prompter when not provided (non-interactive)', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      // No prompter — should default to save-aside
      const result = await applyLocalUpdate(dir, { agents: ['ghcp'] });

      expect(result.savedAside.length).toBeGreaterThan(0);
    });

    it('does not call prompter when --force is set', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      const prompter: FilePrompter = vi.fn().mockResolvedValue('skip');
      await applyLocalUpdate(dir, { agents: ['ghcp'], force: true, prompter });

      expect(prompter).not.toHaveBeenCalled();
    });

    it('does not call prompter when --yes is set', async () => {
      const dir = makeTempDir();
      setupLocalWorkspace(dir, 'ghcp');

      const prompter: FilePrompter = vi.fn().mockResolvedValue('overwrite');
      const result = await applyLocalUpdate(dir, { agents: ['ghcp'], yes: true, prompter });

      expect(prompter).not.toHaveBeenCalled();
      // --yes defaults to save-aside for shared files
      expect(result.savedAside.length).toBeGreaterThan(0);
    });
  });
});

describe('saveAsidePath', () => {
  it('generates correct save-aside path with extension preserved', () => {
    expect(saveAsidePath('CLAUDE.md')).toBe('CLAUDE.azure-functions-skills-new.md');
    expect(saveAsidePath('settings.json')).toBe('settings.azure-functions-skills-new.json');
    expect(saveAsidePath('config.toml')).toBe('config.azure-functions-skills-new.toml');
    expect(saveAsidePath(join('.vscode', 'mcp.json'))).toBe(join('.vscode', 'mcp.azure-functions-skills-new.json'));
  });

  it('handles files without extension', () => {
    expect(saveAsidePath('Makefile')).toBe('Makefile.azure-functions-skills-new');
  });
});
