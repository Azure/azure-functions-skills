import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { BuildTargetName, LauncherId } from '../src/types.js';
import { LAUNCHERS } from '../src/chat/index.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const ROOT_DIR = join(import.meta.dirname, '..');
const TEMPLATES_DIR = join(ROOT_DIR, 'templates');
const CLI_PATH = join(ROOT_DIR, 'bin', 'azure-functions-skills.js');
const TARGETS: BuildTargetName[] = ['ghcp', 'claude', 'codex'];
const CHAT_AGENTS: Array<{ launcherId: LauncherId; setupTarget: BuildTargetName }> = [
  { launcherId: 'github-copilot', setupTarget: 'ghcp' },
  { launcherId: 'claude-code', setupTarget: 'claude' },
  { launcherId: 'codex', setupTarget: 'codex' },
];
const TEMP_DIRS: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

beforeAll(() => {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run compile'] : ['run', 'compile'];
  execFileSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'pipe',
  });
});

afterAll(() => {
  for (const dir of TEMP_DIRS) {
    removeDir(dir);
  }
});

function templateSkillIds(): string[] {
  return readdirSync(join(TEMPLATES_DIR, 'skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function templateAgentFiles(): string[] {
  return readdirSync(join(TEMPLATES_DIR, 'agents'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.agent.md'))
    .map(entry => entry.name)
    .sort();
}

function assertSkillDirectories(root: string, expectedSkillIds: string[]): void {
  expect(existsSync(root)).toBe(true);
  const actualSkillIds = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  expect(actualSkillIds).toEqual(expectedSkillIds);

  for (const skillId of expectedSkillIds) {
    const skillPath = join(root, skillId, 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, 'utf-8')).toContain(`name: ${skillId}`);
  }
}

function assertAgentFiles(root: string, expectedAgentFiles: string[]): void {
  expect(existsSync(root)).toBe(true);
  const actualAgentFiles = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.agent.md'))
    .map(entry => entry.name)
    .sort();
  expect(actualAgentFiles).toEqual(expectedAgentFiles);
}

function assertWorkspaceLayout(root: string, target: BuildTargetName, expectedSkillIds: string[], expectedAgentFiles: string[]): void {
  if (target === 'ghcp') {
    expect(existsSync(join(root, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(root, '.vscode', 'mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.github', 'hooks', 'welcome-setup.json'))).toBe(true);
    assertAgentFiles(join(root, '.github', 'agents'), expectedAgentFiles);
    assertSkillDirectories(join(root, '.github', 'skills'), expectedSkillIds);
    return;
  }

  if (target === 'claude') {
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true);
    assertSkillDirectories(join(root, '.claude', 'skills'), expectedSkillIds);
    return;
  }

  expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
  expect(existsSync(join(root, '.codex', 'config.toml'))).toBe(true);
  expect(existsSync(join(root, '.codex', 'hooks.json'))).toBe(true);
  assertSkillDirectories(join(root, '.agents', 'skills'), expectedSkillIds);
}

function assertPluginLayout(root: string, target: BuildTargetName, expectedSkillIds: string[], expectedAgentFiles: string[]): void {
  expect(target).toBeTruthy();
  expect(existsSync(join(root, '.plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.claude-plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.mcp.json'))).toBe(true);
  expect(existsSync(join(root, 'hooks.json'))).toBe(true);
  assertAgentFiles(join(root, 'agents'), expectedAgentFiles);
  assertSkillDirectories(join(root, 'skills'), expectedSkillIds);
}

function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  runCliOutput(args, options);
}

function runCliOutput(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const env = { ...process.env, ...options.env };
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd || ROOT_DIR,
    env,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
}

function createFakeAgentCliDirectory(): string {
  const fakeBinDir = makeTempDir('af-skills-e2e-bin-');
  for (const launcher of Object.values(LAUNCHERS)) {
    const commandPath = join(fakeBinDir, process.platform === 'win32' ? `${launcher.command}.cmd` : launcher.command);
    writeFileSync(
      commandPath,
      process.platform === 'win32'
        ? '@echo off\r\nif not "%AF_SKILLS_FAKE_ARGS_FILE%"=="" echo %*>>"%AF_SKILLS_FAKE_ARGS_FILE%"\r\nexit /b 0\r\n'
        : '#!/usr/bin/env sh\nif [ -n "$AF_SKILLS_FAKE_ARGS_FILE" ]; then printf "%s\\n" "$*" >> "$AF_SKILLS_FAKE_ARGS_FILE"; fi\nexit 0\n',
      { mode: 0o755 },
    );

    if (process.platform === 'win32') {
      writeFileSync(join(fakeBinDir, `${launcher.command}.ps1`), 'exit 0\r\n', { mode: 0o755 });
    }
  }
  return fakeBinDir;
}

describe('CLI command integration', () => {
  it('build writes GHCP, Claude, and Codex layouts from current templates into a temp dist directory', () => {
    const distDir = makeTempDir('af-skills-e2e-build-');
    const expectedSkillIds = templateSkillIds();
    const expectedAgentFiles = templateAgentFiles();

    runCli(['build', '--dist-dir', distDir]);

    for (const target of TARGETS) {
      const targetRoot = join(distDir, 'workspace', target);
      assertWorkspaceLayout(targetRoot, target, expectedSkillIds, expectedAgentFiles);
    }

    assertPluginLayout(join(distDir, 'plugin', 'azure-functions-skills'), 'ghcp', expectedSkillIds, expectedAgentFiles);
  });

  it('setup installs each target workspace layout into a temp project directory', () => {
    const expectedSkillIds = templateSkillIds();
    const expectedAgentFiles = templateAgentFiles();

    for (const target of TARGETS) {
      const projectDir = makeTempDir(`af-skills-e2e-setup-${target}-`);

      runCli(['setup', '--agent', target, '--dir', projectDir, '--skip-prerequisites']);

      assertWorkspaceLayout(projectDir, target, expectedSkillIds, expectedAgentFiles);
    }
  });

  it('workspace apply --dry-run prints planned plugin-reference changes without writing files', () => {
    const projectDir = makeTempDir('af-skills-e2e-workspace-dry-run-');

    const output = runCliOutput([
      'workspace',
      'apply',
      '--agent', 'codex',
      '--dir', projectDir,
      '--mode', 'plugin-reference',
      '--dry-run',
    ]);

    expect(output).toContain('Planned workspace changes');
    expect(output).toContain('AGENTS.md');
    expect(output).toContain('.agents/plugins/marketplace.json');
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectDir, '.agents', 'plugins', 'marketplace.json'))).toBe(false);
  });

  it('chat auto-installs each target workspace layout before launching the selected agent', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const expectedSkillIds = templateSkillIds();
    const expectedAgentFiles = templateAgentFiles();
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;

    for (const { launcherId, setupTarget } of CHAT_AGENTS) {
      const projectDir = makeTempDir(`af-skills-e2e-chat-${setupTarget}-`);

      runCli(['chat', '--agent', launcherId, '--dir', projectDir, '--prompt', 'e2e', '--skip-prerequisites'], {
        env: {
          PATH: pathValue,
          Path: pathValue,
          ...(pathext ? { PATHEXT: pathext } : {}),
        },
      });

      assertWorkspaceLayout(projectDir, setupTarget, expectedSkillIds, expectedAgentFiles);
    }
  });

  it('chat forwards unknown arguments to the selected agent CLI', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-chat-forward-codex-');
    const argsFile = join(projectDir, 'agent-args.txt');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;

    runCli([
      'chat',
      '--agent', 'codex',
      '--dir', projectDir,
      '--prompt', 'hello',
      '--skip-prerequisites',
      'exec',
      '--sandbox', 'read-only',
      '--json',
    ], {
      env: {
        PATH: pathValue,
        Path: pathValue,
        AF_SKILLS_FAKE_ARGS_FILE: argsFile,
        ...(pathext ? { PATHEXT: pathext } : {}),
      },
    });

    expect(readFileSync(argsFile, 'utf-8').trim()).toBe('exec --sandbox read-only --json hello');
  });

  it('chat --help prints command help without launching an agent', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-chat-help-');
    const argsFile = join(projectDir, 'agent-args.txt');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;

    const output = runCliOutput(['chat', '--help'], {
      env: {
        PATH: pathValue,
        Path: pathValue,
        AF_SKILLS_FAKE_ARGS_FILE: argsFile,
        ...(pathext ? { PATHEXT: pathext } : {}),
      },
    });

    expect(output).toContain('Options (chat):');
    expect(output).toContain('-- <args...>');
    expect(existsSync(argsFile)).toBe(false);
  });

  it('chat forwards --help after the pass-through separator', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-chat-forward-help-');
    const argsFile = join(projectDir, 'agent-args.txt');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;

    runCli([
      'chat',
      '--agent', 'codex',
      '--dir', projectDir,
      '--prompt', 'hello',
      '--skip-prerequisites',
      '--',
      '--help',
    ], {
      env: {
        PATH: pathValue,
        Path: pathValue,
        AF_SKILLS_FAKE_ARGS_FILE: argsFile,
        ...(pathext ? { PATHEXT: pathext } : {}),
      },
    });

    expect(readFileSync(argsFile, 'utf-8').trim()).toBe('--help hello');
  });
});
