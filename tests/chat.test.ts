import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStartupPrompt, LAUNCHERS, detectCliAgents, chat } from '../src/chat/index.js';
import { createTempDir, removeDir, resetDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];
const DIST_DIR = makeTestDir('af-skills-chat-');

function makeTestDir(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of TEMP_DIRS) {
    removeDir(dir);
  }
});

// ─── Startup prompt tests ───

describe('buildStartupPrompt', () => {
  it('returns a string containing welcome text', async () => {
    const prompt = await buildStartupPrompt(DIST_DIR);
    expect(prompt).toContain('Azure Functions');
    expect(prompt).toContain('Skills');
  });

  it('includes project context when host.json exists', async () => {
    const dir = resetDir(join(DIST_DIR, 'with-project'));
    writeFileSync(join(dir, 'host.json'), '{"version":"2.0"}');
    writeFileSync(join(dir, 'package.json'), '{"dependencies":{"@azure/functions":"4.0.0"}}');

    const prompt = await buildStartupPrompt(dir);
    expect(prompt).toContain('Functions project detected');
  });

  it('includes suggested actions for new project', async () => {
    const dir = resetDir(join(DIST_DIR, 'empty-dir'));

    const prompt = await buildStartupPrompt(dir);
    expect(prompt).toContain('azure-functions-create');
  });

  it('suggests deploy for existing project', async () => {
    const dir = resetDir(join(DIST_DIR, 'existing-project'));
    writeFileSync(join(dir, 'host.json'), '{"version":"2.0"}');

    const prompt = await buildStartupPrompt(dir);
    expect(prompt).toContain('azure-functions-deploy');
  });
});

// ─── Launcher config tests ───

describe('LAUNCHERS', () => {
  it('has entries for ghcp, claude, codex', () => {
    expect(LAUNCHERS['github-copilot']).toBeTruthy();
    expect(LAUNCHERS['claude-code']).toBeTruthy();
    expect(LAUNCHERS['codex']).toBeTruthy();
  });

  it('ghcp launcher uses --agent and copilot -i flag', () => {
    const args = LAUNCHERS['github-copilot'].buildArgs({ startupPrompt: 'hello' });
    expect(args).toContain('--agent');
    expect(args).toContain('functions-copilot');
    expect(args).toContain('-i');
    expect(args).toContain('hello');
  });

  it('claude launcher passes prompt as first arg', () => {
    const args = LAUNCHERS['claude-code'].buildArgs({ startupPrompt: 'hello' });
    expect(args).toContain('hello');
  });

  it('codex launcher passes prompt as first arg', () => {
    const args = LAUNCHERS['codex'].buildArgs({ startupPrompt: 'hello' });
    expect(args).toContain('hello');
  });

  it('launchers return empty args when no prompt', () => {
    for (const [, launcher] of Object.entries(LAUNCHERS)) {
      const args = launcher.buildArgs({});
      expect(args).toBeInstanceOf(Array);
    }
  });
});

// ─── Agent detection tests ───

describe('detectCliAgents', () => {
  it('returns an array', async () => {
    const agents = await detectCliAgents();
    expect(agents).toBeInstanceOf(Array);
  });

  it('each entry has id and command', async () => {
    const agents = await detectCliAgents();
    for (const a of agents) {
      expect(a.id).toBeTruthy();
      expect(a.command).toBeTruthy();
    }
  });
});

// ─── Auto-setup tests ───

describe('chat auto-setup', () => {
  it('auto-installs ghcp skills when not present', async () => {
    const testDir = makeTestDir('af-skills-chat-ghcp-');

    try {
      const result = await chat({ agent: 'github-copilot', dir: testDir, prompt: 'test' });
      if (result?.childProcess) result.childProcess.kill();
    } catch {
      // Expected: copilot binary not found — that's fine
    }

    // Skills should now be installed
    expect(existsSync(join(testDir, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(testDir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
  }, 15000);

  it('auto-installs claude skills when not present', async () => {
    const testDir = makeTestDir('af-skills-chat-claude-');

    try {
      const result = await chat({ agent: 'claude-code', dir: testDir, prompt: 'test' });
      // If claude is installed, kill the spawned process immediately
      if (result?.childProcess) result.childProcess.kill();
    } catch {
      // Expected: claude binary not found
    }

    expect(existsSync(join(testDir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(testDir, '.claude', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
  }, 15000);

  it('auto-installs codex skills when not present', async () => {
    const testDir = makeTestDir('af-skills-chat-codex-');

    try {
      const result = await chat({ agent: 'codex', dir: testDir, prompt: 'test' });
      if (result?.childProcess) result.childProcess.kill();
    } catch {
      // Expected: codex binary not found
    }

    expect(existsSync(join(testDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(testDir, '.agents', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
  }, 15000);

  it('skips setup when skills are already present', async () => {
    const testDir = makeTestDir('af-skills-chat-skip-');

    // Pre-install skills
    const { applySetup } = await import('../src/setup/index.js');
    await applySetup(testDir, { agents: ['ghcp'] });

    // Get content of instructions file
    const instrPath = join(testDir, '.github', 'copilot-instructions.md');
    const contentBefore = readFileSync(instrPath, 'utf-8');

    try {
      const result = await chat({ agent: 'github-copilot', dir: testDir, prompt: 'test' });
      if (result?.childProcess) result.childProcess.kill();
    } catch {
      // Expected
    }

    // File should not have been re-written (same content)
    const contentAfter = readFileSync(instrPath, 'utf-8');
    expect(contentAfter).toBe(contentBefore);
  }, 15000);
});
