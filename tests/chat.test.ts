import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStartupPrompt, LAUNCHERS, detectCliAgents, chat, resolveLauncherCommand } from '../src/chat/index.js';
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
    expect(prompt).toContain('Azure Skills plugin');
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

// ─── Launcher resolution tests ───

describe('resolveLauncherCommand', () => {
  it('leaves non-Windows launchers unchanged', () => {
    const resolved = resolveLauncherCommand('codex', {
      platform: 'linux',
    });

    expect(resolved).toEqual({ command: 'codex', argsPrefix: [], shell: false });
  });

  it('wraps cmd shims with cmd.exe on Windows to avoid shell quoting', () => {
    const binDir = resetDir(join(DIST_DIR, 'launcher-cmd-ps1'));
    writeFileSync(join(binDir, 'codex.ps1'), 'exit 0');
    writeFileSync(join(binDir, 'codex.cmd'), '@echo off\r\nexit /b 0\r\n');
    const resolved = resolveLauncherCommand('codex', {
      platform: 'win32',
      env: { Path: binDir, PATHEXT: '.CMD;.PS1' },
    });

    expect(resolved).toEqual({
      command: 'cmd.exe',
      argsPrefix: ['/d', '/s', '/c', join(binDir, 'codex.cmd')],
      shell: false,
    });
  });

  it('runs PowerShell shims through powershell.exe when no better shim is available', () => {
    const binDir = resetDir(join(DIST_DIR, 'launcher-ps1'));
    writeFileSync(join(binDir, 'copilot.ps1'), 'exit 0');
    const resolved = resolveLauncherCommand('copilot', {
      platform: 'win32',
      env: { Path: binDir, PATHEXT: '.PS1' },
    });

    expect(resolved).toEqual({
      command: 'powershell.exe',
      argsPrefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(binDir, 'copilot.ps1')],
      shell: false,
    });
  });

  it('runs exe and extensionless Windows shims directly', () => {
    const exeDir = resetDir(join(DIST_DIR, 'launcher-exe'));
    const extensionlessDir = resetDir(join(DIST_DIR, 'launcher-extensionless'));
    writeFileSync(join(exeDir, 'tool.exe'), 'fake');
    writeFileSync(join(extensionlessDir, 'tool'), 'fake');
    const exe = resolveLauncherCommand('tool', {
      platform: 'win32',
      env: { Path: exeDir, PATHEXT: '.EXE' },
    });
    const extensionless = resolveLauncherCommand('tool', {
      platform: 'win32',
      env: { Path: extensionlessDir, PATHEXT: '' },
    });

    expect(exe).toEqual({ command: join(exeDir, 'tool.exe'), argsPrefix: [], shell: false });
    expect(extensionless).toEqual({ command: join(extensionlessDir, 'tool'), argsPrefix: [], shell: false });
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
      const result = await chat({ agent: 'github-copilot', dir: testDir, prompt: 'test', prerequisites: 'skip' });
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
      const result = await chat({ agent: 'claude-code', dir: testDir, prompt: 'test', prerequisites: 'skip' });
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
      const result = await chat({ agent: 'codex', dir: testDir, prompt: 'test', prerequisites: 'skip' });
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
    await applySetup(testDir, { agents: ['ghcp'], prerequisites: 'skip' });

    // Get content of instructions file
    const instrPath = join(testDir, '.github', 'copilot-instructions.md');
    const contentBefore = readFileSync(instrPath, 'utf-8');

    try {
      const result = await chat({ agent: 'github-copilot', dir: testDir, prompt: 'test', prerequisites: 'skip' });
      if (result?.childProcess) result.childProcess.kill();
    } catch {
      // Expected
    }

    // File should not have been re-written (same content)
    const contentAfter = readFileSync(instrPath, 'utf-8');
    expect(contentAfter).toBe(contentBefore);
  }, 15000);

  it('checks Azure Skills prerequisites before launching GitHub Copilot', async () => {
    const testDir = makeTestDir('af-skills-chat-prereq-');
    const calls: string[] = [];

    try {
      const result = await chat({
        agent: 'github-copilot',
        dir: testDir,
        prompt: 'test',
        prerequisiteRunner: async (command, args) => {
          calls.push([command, ...args].join(' '));
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      });
      if (result?.childProcess) result.childProcess.kill();
    } catch {
      // Expected if the launcher is unavailable.
    }

    expect(calls).toEqual([
      'copilot plugin list',
      'copilot plugin marketplace add microsoft/azure-skills',
      'copilot plugin install azure@azure-skills',
    ]);
  }, 15000);
});
