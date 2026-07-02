import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const CURRENT_NODE_MAJOR = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);

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
    // No copilot-instructions.md (routing handled by agent definition)
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.vscode', 'mcp.json'))).toBe(false);
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

function assertPluginLayout(root: string, target: BuildTargetName, expectedSkillIds: string[], _expectedAgentFiles: string[]): void {
  expect(target).toBeTruthy();
  expect(existsSync(join(root, '.plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.claude-plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.mcp.json'))).toBe(false);
  expect(existsSync(join(root, 'hooks.json'))).toBe(false);
  expect(existsSync(join(root, 'agents'))).toBe(false);
  expect(existsSync(join(root, 'hooks', 'copilot-hooks.json'))).toBe(true);
  expect(existsSync(join(root, 'hooks', 'scripts', 'track-telemetry.sh'))).toBe(true);
  assertSkillDirectories(join(root, 'skills'), expectedSkillIds);
}

function assertFullPluginLayout(root: string, expectedSkillIds: string[], expectedAgentFiles: string[]): void {
  expect(existsSync(join(root, '.plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.claude-plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.mcp.json'))).toBe(true);
  expect(existsSync(join(root, 'hooks', 'copilot-hooks.json'))).toBe(true);
  expect(existsSync(join(root, 'hooks', 'scripts', 'track-telemetry.sh'))).toBe(true);
  assertAgentFiles(join(root, 'agents'), expectedAgentFiles);
  assertSkillDirectories(join(root, 'skills'), expectedSkillIds);
}

function assertHooksPluginLayout(root: string, expectedSkillIds: string[]): void {
  expect(existsSync(join(root, '.plugin', 'plugin.json'))).toBe(true);
  expect(existsSync(join(root, '.mcp.json'))).toBe(false);
  expect(existsSync(join(root, 'agents'))).toBe(false);
  expect(existsSync(join(root, 'hooks', 'copilot-hooks.json'))).toBe(true);
  expect(existsSync(join(root, 'hooks', 'telemetry.config.json'))).toBe(true);
  assertSkillDirectories(join(root, 'skills'), expectedSkillIds);
}

function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  runCliOutput(args, options);
}

function runCliOutput(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const env = { ...process.env, AZURE_FUNCTIONS_SKILLS_SKIP_UPDATE_CHECK: '1', ...options.env };
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

function createFakeNpmDirectory(latestVersion: string): string {
  const fakeBinDir = makeTempDir('af-skills-e2e-npm-');
  const commandPath = join(fakeBinDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  writeFileSync(
    commandPath,
    process.platform === 'win32'
      ? `@echo off\r\nif "%1"=="view" echo ${latestVersion}\r\nexit /b 0\r\n`
      : `#!/usr/bin/env sh\nif [ "$1" = "view" ]; then printf "%s\\n" "${latestVersion}"; fi\nexit 0\n`,
    { mode: 0o755 },
  );
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

  it('build can explicitly emit the plugin hooks profile without adding agents or MCP', () => {
    const distDir = makeTempDir('af-skills-e2e-build-hooks-plugin-');
    const expectedSkillIds = templateSkillIds();

    runCli(['build', '--dist-dir', distDir, '--plugin-profile', 'hooks']);

    assertHooksPluginLayout(join(distDir, 'plugin', 'azure-functions-skills'), expectedSkillIds);
  });

  it('build can opt into the full plugin payload profile', () => {
    const distDir = makeTempDir('af-skills-e2e-build-full-plugin-');
    const expectedSkillIds = templateSkillIds();
    const expectedAgentFiles = templateAgentFiles();

    runCli(['build', '--dist-dir', distDir, '--plugin-profile', 'full']);

    assertFullPluginLayout(join(distDir, 'plugin', 'azure-functions-skills'), expectedSkillIds, expectedAgentFiles);
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

  it('workspace apply --dry-run prints planned plugin-reference changes without writing files for each target', () => {
    const expectations: Array<{ target: BuildTargetName; files: string[] }> = [
      { target: 'ghcp', files: ['AGENTS.md', '.github/copilot/settings.json'] },
      { target: 'claude', files: ['CLAUDE.md', '.claude/settings.json'] },
      { target: 'codex', files: ['AGENTS.md', '.agents/plugins/marketplace.json'] },
    ];

    for (const { target, files } of expectations) {
      const projectDir = makeTempDir(`af-skills-e2e-workspace-dry-run-${target}-`);

      const output = runCliOutput([
        'workspace',
        'apply',
        '--agent', target,
        '--dir', projectDir,
        '--mode', 'plugin-reference',
        '--dry-run',
      ]);

      expect(output).toContain('Planned workspace changes');
      for (const file of files) {
        expect(output).toContain(file);
        expect(existsSync(join(projectDir, file))).toBe(false);
      }
    }
  });

  it('workspace apply --yes saves aside routing for an existing Claude instructions file', () => {
    const projectDir = makeTempDir('af-skills-e2e-workspace-yes-');
    writeFileSync(join(projectDir, 'CLAUDE.md'), '# Existing Claude rules\n');

    runCli([
      'workspace',
      'apply',
      '--agent', 'claude',
      '--dir', projectDir,
      '--mode', 'plugin-reference',
      '--yes',
    ]);

    const content = readFileSync(join(projectDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# Existing Claude rules');
    expect(content).not.toContain('<!-- azure-functions-skills:start');
    expect(existsSync(join(projectDir, 'CLAUDE.azure-functions-skills-new.md'))).toBe(true);
  });

  it('workspace apply can opt into MCP and hooks from the CLI', () => {
    const projectDir = makeTempDir('af-skills-e2e-workspace-opt-in-');

    runCli([
      'workspace',
      'apply',
      '--agent', 'ghcp',
      '--agent', 'claude',
      '--agent', 'codex',
      '--dir', projectDir,
      '--mode', 'plugin-reference',
      '--include-mcp',
      '--include-hooks',
      '--yes',
    ]);

    expect(existsSync(join(projectDir, '.mcp.json'))).toBe(true);
    expect(existsSync(join(projectDir, '.vscode', 'mcp.json'))).toBe(false);
    expect(existsSync(join(projectDir, '.github', 'hooks', 'welcome-setup.json'))).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(projectDir, '.codex', 'config.toml'))).toBe(true);
    expect(existsSync(join(projectDir, '.codex', 'hooks.json'))).toBe(true);

    const codexHooks = readFileSync(join(projectDir, '.codex', 'hooks.json'), 'utf-8');
    expect(codexHooks).toContain('node -e');
    expect(codexHooks).not.toContain('bash -c');
  });

  it('install --dry-run plans plugin install plus workspace activation with MCP and hooks', () => {
    const projectDir = makeTempDir('af-skills-e2e-install-dry-run-');

    const output = runCliOutput([
      'install',
      '--agent', 'ghcp',
      '--dir', projectDir,
      '--dry-run',
    ]);

    expect(output).toContain('Planned install');
    expect(output).toContain('Plugin:');
    expect(output).toContain('copilot plugin marketplace add Azure/azure-functions-skills');
    expect(output).toContain('Workspace:');
    expect(output).toContain('AGENTS.md');
    expect(output).toContain('.github/agents/functions-copilot.agent.md');
    expect(output).toContain('.mcp.json');
    expect(output).not.toContain('.github/copilot-instructions.md');
    expect(output).toContain('.github/hooks/welcome-setup.json');
    expect(existsSync(join(projectDir, '.github', 'copilot-instructions.md'))).toBe(false);
  });

  it('--version prints package version', () => {
    const expectedVersion = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8')).version;
    const output = runCliOutput(['--version']);
    expect(output).toMatch(/^\d+\.\d+\.\d+/);
    expect(output).toContain(expectedVersion);
  });

  it('prints focused help for top-level help and command help forms', () => {
    const installHelp = runCliOutput(['help', 'install']);
    const installFlagHelp = runCliOutput(['install', '--help']);
    const chatHelp = runCliOutput(['help', 'chat']);
    const updateHelp = runCliOutput(['update', '--help']);

    expect(installHelp).toContain('Usage: azure-functions-skills install');
    expect(installHelp).toContain('--all');
    expect(installHelp).toContain('--agent <name>');
    expect(installFlagHelp).toBe(installHelp);
    expect(chatHelp).toContain('Usage: azure-functions-skills chat');
    expect(chatHelp).toContain('uses .azure-functions-skills state');
    expect(updateHelp).toContain('Usage: azure-functions-skills update');
    expect(updateHelp).toContain('uses existing state by default');
  });

  it('prints focused help for nested plugin and workspace commands', () => {
    const pluginHelp = runCliOutput(['plugin', 'install', '--help']);
    const workspaceHelp = runCliOutput(['workspace', 'apply', '--help']);
    const stateHelp = runCliOutput(['state', 'setup-complete', '--help']);

    expect(pluginHelp).toContain('Usage: azure-functions-skills plugin install');
    expect(pluginHelp).toContain('--no-workspace');
    expect(workspaceHelp).toContain('Usage: azure-functions-skills workspace apply');
    expect(workspaceHelp).toContain('--include-agent');
    expect(stateHelp).toContain('Usage: azure-functions-skills state setup-complete');
    expect(stateHelp).toContain('--agent <name>');
  });

  it('install --local performs the full workspace setup compatibility flow', () => {
    const projectDir = makeTempDir('af-skills-e2e-install-local-');
    const expectedSkillIds = templateSkillIds();
    const expectedAgentFiles = templateAgentFiles();

    runCli(['install', '--local', '--agent', 'ghcp', '--dir', projectDir, '--skip-prerequisites']);

    assertWorkspaceLayout(projectDir, 'ghcp', expectedSkillIds, expectedAgentFiles);
  });

  it('install --local --no-telemetry records opt-out state and still installs telemetry hooks', () => {
    const projectDir = makeTempDir('af-skills-e2e-install-local-no-telemetry-');

    runCli([
      'install',
      '--local',
      '--agent', 'ghcp',
      '--dir', projectDir,
      '--yes',
      '--skip-prerequisites',
      '--no-telemetry',
    ]);

    const state = JSON.parse(readFileSync(join(projectDir, '.azure-functions-skills', 'state.local.json'), 'utf-8')) as {
      telemetry: { enabled: boolean; source: string };
    };
    expect(state.telemetry).toEqual({ enabled: false, source: 'install-flag' });
    expect(existsSync(join(projectDir, '.github', 'hooks', 'azure-functions-telemetry.json'))).toBe(true);
    expect(existsSync(join(projectDir, '.azure-functions-skills', 'hooks', 'scripts', 'track-telemetry.ps1'))).toBe(true);
  });

  it('install --local reports bundled assets and npm update guidance when the package is stale', () => {
    const fakeNpmDir = createFakeNpmDirectory('9.9.9');
    const projectDir = makeTempDir('af-skills-e2e-install-local-update-guidance-');
    const pathValue = `${fakeNpmDir}${delimiter}${process.env.PATH || ''}`;

    const output = runCliOutput([
      'install',
      '--local',
      '--agent', 'claude',
      '--dir', projectDir,
      '--yes',
      '--skip-prerequisites',
    ], {
      env: {
        PATH: pathValue,
        Path: pathValue,
        AZURE_FUNCTIONS_SKILLS_SKIP_UPDATE_CHECK: '0',
      },
    });

    expect(output).toContain('Local assets: bundled with @azure/functions-skills');
    expect(output).toContain('@azure/functions-skills 9.9.9 is available');
    expect(output).toContain('npm install -g @azure/functions-skills@latest');
    expect(output).not.toContain('source-ref');
    expect(output).not.toContain('Fetching templates from GitHub');
  });

  it('install passes host CLI arguments through for a single agent dry-run', () => {
    const projectDir = makeTempDir('af-skills-e2e-install-passthrough-');

    const output = runCliOutput([
      'install',
      '--agent', 'ghcp',
      '--dir', projectDir,
      '--dry-run',
      '--',
      '--verbose',
    ]);

    expect(output).toContain('copilot plugin install azure-functions-skills@azure-functions-skills --verbose');
  });

  it('install rejects passthrough arguments with multiple agents', () => {
    const projectDir = makeTempDir('af-skills-e2e-install-passthrough-multi-');

    expect(() => runCliOutput([
      'install',
      '--agent', 'ghcp',
      '--agent', 'codex',
      '--dir', projectDir,
      '--dry-run',
      '--',
      '--verbose',
    ])).toThrow(/Cannot use passthrough arguments with multiple agents/);
  });

  it('install without --agent or --all fails clearly in noninteractive mode', () => {
    const projectDir = makeTempDir('af-skills-e2e-install-no-agent-');

    expect(() => runCliOutput([
      'install',
      '--dir', projectDir,
      '--dry-run',
    ])).toThrow(/Choose an agent with --agent <name> or use --all/);
  });

  it('install --all writes state, state-only gitignore entry, and next-step summary', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-install-all-state-');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;

    const output = runCliOutput([
      'install',
      '--all',
      '--dir', projectDir,
      '--yes',
    ], {
      env: {
        PATH: pathValue,
        Path: pathValue,
        ...(pathext ? { PATHEXT: pathext } : {}),
      },
    });

    const state = JSON.parse(readFileSync(join(projectDir, '.azure-functions-skills', 'state.local.json'), 'utf-8')) as {
      agents: Record<string, { installed: boolean }>;
      chat: { defaultAgent: string | null };
    };
    const gitignoreLines = readFileSync(join(projectDir, '.gitignore'), 'utf-8').split(/\r?\n/).map(line => line.trim());
    expect(output).toContain('Azure Functions Skills installed');
    expect(output).toContain('Installed agents: ghcp, claude, codex');
    expect(output).toContain('Next: azure-functions-skills chat --dir');
    expect(state.agents.ghcp.installed).toBe(true);
    expect(state.agents.claude.installed).toBe(true);
    expect(state.agents.codex.installed).toBe(true);
    expect(state.chat.defaultAgent).toBe(null);
    expect(gitignoreLines).toContain('.azure-functions-skills/state.local.json');
    expect(gitignoreLines).not.toContain('.azure-functions-skills/');
  });

  it('update without --agent uses installed agents from state', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-update-state-agent-');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    runCli(['install', '--agent', 'ghcp', '--dir', projectDir, '--yes'], { env });
    const output = runCliOutput(['update', '--dir', projectDir, '--dry-run'], { env });

    expect(output).toContain('Planned update');
    expect(output).toContain('- ghcp:');
    expect(output).not.toContain('- claude:');
    expect(output).not.toContain('- codex:');
  });

  it('plugin install --dry-run prints plugin and workspace activation plans without writing files', () => {
    const projectDir = makeTempDir('af-skills-e2e-plugin-install-dry-run-');

    const output = runCliOutput([
      'plugin',
      'install',
      '--agent', 'ghcp',
      '--dir', projectDir,
      '--scope', 'workspace',
      '--source', 'marketplace',
      '--version', '0.12.1',
      '--dry-run',
    ]);

    expect(output).toContain('Planned plugin install');
    expect(output).toContain('ghcp');
    expect(output).toContain('copilot plugin marketplace add Azure/azure-functions-skills');
    expect(output).toContain('copilot plugin install azure-functions-skills@azure-functions-skills');
    expect(output).toContain('workspace activation');
    expect(output).toContain('0.12.1');
    expect(existsSync(join(projectDir, '.github', 'copilot-instructions.md'))).toBe(false);
    expect(existsSync(join(projectDir, '.github', 'copilot', 'settings.json'))).toBe(false);
  });

  it('plugin install --dry-run shows Claude marketplace install commands', () => {
    const projectDir = makeTempDir('af-skills-e2e-plugin-install-claude-dry-run-');

    const output = runCliOutput([
      'plugin',
      'install',
      '--agent', 'claude',
      '--dir', projectDir,
      '--dry-run',
    ]);

    expect(output).toContain('Planned plugin install');
    expect(output).toContain('claude plugin marketplace add Azure/azure-functions-skills --scope local');
    expect(output).toContain('claude plugin install azure-functions-skills@azure-functions-skills --scope local');
    expect(output).toContain('workspace activation');
    expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(false);
  });

  it('plugin update --dry-run can skip workspace activation', () => {
    const projectDir = makeTempDir('af-skills-e2e-plugin-update-dry-run-');

    const output = runCliOutput([
      'plugin',
      'update',
      '--agent', 'codex',
      '--dir', projectDir,
      '--source', 'local',
      '--no-workspace',
      '--dry-run',
    ]);

    expect(output).toContain('Planned plugin update');
    expect(output).toContain('codex');
    expect(output).not.toContain('workspace activation');
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectDir, '.agents', 'plugins', 'marketplace.json'))).toBe(false);
  });

  it('chat launches the selected agent without installing workspace files', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
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

      if (setupTarget === 'ghcp') expect(existsSync(join(projectDir, '.github', 'skills'))).toBe(false);
      if (setupTarget === 'claude') expect(existsSync(join(projectDir, '.claude', 'skills'))).toBe(false);
      if (setupTarget === 'codex') expect(existsSync(join(projectDir, '.agents', 'skills'))).toBe(false);
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

  it('chat --dry-run prints the launch plan without launching or marking setup prompted', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-chat-dry-run-');
    const argsFile = join(projectDir, 'agent-args.txt');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      AF_SKILLS_FAKE_ARGS_FILE: argsFile,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    runCli(['install', '--agent', 'ghcp', '--dir', projectDir, '--yes'], { env });
    writeFileSync(argsFile, '');

    const output = runCliOutput(['chat', '--dir', projectDir, '--skip-prerequisites', '--dry-run', '--', '--yolo'], { env });

    expect(output).toContain('Planned chat launch:');
    expect(output).toContain('Agent: github-copilot');
    expect(output).toContain('Command: copilot');
    expect(output).toContain('--agent functions-copilot');
    expect(output).toContain('--yolo');
    expect(output).toContain('Startup prompt: included');
    expect(output).toContain('Setup instruction: included');
    expect(readFileSync(argsFile, 'utf-8')).toBe('');

    const state = JSON.parse(readFileSync(join(projectDir, '.azure-functions-skills', 'state.local.json'), 'utf-8')) as {
      setupSkill: { status: string };
    };
    expect(state.setupSkill.status).toBe('not-run');
  });

  it('chat --dry-run reports generated setup context as not included when an explicit agent prompt prevents it', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-chat-dry-run-explicit-prompt-');
    const argsFile = join(projectDir, 'agent-args.txt');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      AF_SKILLS_FAKE_ARGS_FILE: argsFile,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    runCli(['install', '--agent', 'ghcp', '--dir', projectDir, '--yes'], { env });
    writeFileSync(argsFile, '');

    const output = runCliOutput([
      'chat',
      '--dir', projectDir,
      '--skip-prerequisites',
      '--dry-run',
      '--',
      '-p', 'headless prompt',
    ], { env });

    expect(output).toContain('Planned chat launch:');
    expect(output).toContain('-p "headless prompt"');
    expect(output).toContain('Startup prompt: not included');
    expect(output).toContain('Setup instruction: not included');
    expect(output).not.toContain('<startup prompt>');
    expect(readFileSync(argsFile, 'utf-8')).toBe('');

    const state = JSON.parse(readFileSync(join(projectDir, '.azure-functions-skills', 'state.local.json'), 'utf-8')) as {
      setupSkill: { status: string };
    };
    expect(state.setupSkill.status).toBe('not-run');
  });

  it('chat does not mark setup prompted when an explicit agent prompt prevents generated setup context', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-chat-explicit-agent-prompt-');
    const argsFile = join(projectDir, 'agent-args.txt');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      AF_SKILLS_FAKE_ARGS_FILE: argsFile,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    runCli(['install', '--agent', 'ghcp', '--dir', projectDir, '--yes'], { env });
    writeFileSync(argsFile, '');

    runCli(['chat', '--dir', projectDir, '--skip-prerequisites', '--', '-p', 'headless prompt'], { env });

    const firstArgs = readFileSync(argsFile, 'utf-8');
    expect(firstArgs).toContain('-p');
    expect(firstArgs).toContain('headless prompt');
    expect(firstArgs).not.toContain('First run azure-functions-setup');

    const state = JSON.parse(readFileSync(join(projectDir, '.azure-functions-skills', 'state.local.json'), 'utf-8')) as {
      setupSkill: { status: string };
    };
    expect(state.setupSkill.status).toBe('not-run');
  });

  it('chat uses state to select the installed agent and prompts setup only until setup-complete', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-chat-state-');
    const argsFile = join(projectDir, 'agent-args.txt');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      AF_SKILLS_FAKE_ARGS_FILE: argsFile,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    runCli(['install', '--agent', 'ghcp', '--dir', projectDir, '--yes'], { env });
  writeFileSync(argsFile, '');
    runCli(['chat', '--dir', projectDir, '--prompt', 'hello', '--skip-prerequisites'], { env });

    const firstArgs = readFileSync(argsFile, 'utf-8');
    expect(firstArgs).toContain('--agent functions-copilot');
    expect(firstArgs).toContain('First run azure-functions-setup');

    const completeOutput = runCliOutput(['state', 'setup-complete', '--dir', projectDir, '--agent', 'github-copilot']);
    expect(completeOutput).toContain('Setup skill marked complete');
    writeFileSync(argsFile, '');

    runCli(['chat', '--dir', projectDir, '--prompt', 'hello', '--skip-prerequisites'], { env });
    const secondArgs = readFileSync(argsFile, 'utf-8');
    expect(secondArgs).toContain('--agent functions-copilot');
    expect(secondArgs).not.toContain('First run azure-functions-setup');
  });

  it('chat without --agent fails in noninteractive mode when state is ambiguous', () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-chat-ambiguous-state-');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    runCli(['install', '--all', '--dir', projectDir, '--yes'], { env });

    expect(() => runCliOutput(['chat', '--dir', projectDir, '--skip-prerequisites'], { env }))
      .toThrow(/Multiple agents are installed/);
  });

  it('update after install --local auto-detects local mode and preserves user customizations', { timeout: 30_000 }, () => {
    const projectDir = makeTempDir('af-skills-e2e-local-update-');

    // Step 1: Install locally for ghcp
    runCli(['install', '--local', '--agent', 'ghcp', '--dir', projectDir, '--yes']);

    // Verify initial install laid down workspace files (no copilot-instructions.md for GHCP)
    const agentDefPath = join(projectDir, '.github', 'agents', 'functions-copilot.agent.md');
    expect(existsSync(agentDefPath)).toBe(true);
    const mcpPath = join(projectDir, '.mcp.json');
    expect(existsSync(mcpPath)).toBe(true);

    // Step 2: User customizes the MCP file
    const mcpContent = readFileSync(mcpPath, 'utf-8');
    const customMcp = mcpContent.replace('{', '{\n  "// my custom note": true,');
    writeFileSync(mcpPath, customMcp);

    // Step 3: Run update (should auto-detect local mode from state)
    runCli(['update', '--agent', 'ghcp', '--dir', projectDir, '--yes']);

    // Verify: MCP file preserved and live settings deep-merged
    const afterUpdate = readFileSync(mcpPath, 'utf-8');
    expect(afterUpdate).toContain('my custom note');
    const asidePath = join(projectDir, '.mcp.azure-functions-skills-new.json');
    expect(existsSync(asidePath)).toBe(false);
    // Skills should be refreshed (overwrite strategy)
    const skillsDir = join(projectDir, '.github', 'skills');
    expect(existsSync(skillsDir)).toBe(true);
    const skillIds = readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    expect(skillIds.length).toBeGreaterThan(0);
  });

  it('update --force after install --local overwrites all files', { timeout: 15_000 }, () => {
    const projectDir = makeTempDir('af-skills-e2e-local-update-force-');

    // Install locally for claude
    runCli(['install', '--local', '--agent', 'claude', '--dir', projectDir, '--yes']);

    const claudePath = join(projectDir, 'CLAUDE.md');

    // User customizes CLAUDE.md by removing managed block
    writeFileSync(claudePath, '# My Custom Claude Rules\nNo managed block here.\n');

    // Run update with --force
    runCli(['update', '--agent', 'claude', '--dir', projectDir, '--yes', '--force']);

    // Verify: file overwritten (no save-aside, custom content gone)
    const updatedContent = readFileSync(claudePath, 'utf-8');
    expect(updatedContent).not.toContain('No managed block here.');
    expect(updatedContent).toContain('azure-functions-setup');
    // No save-aside file
    expect(existsSync(join(projectDir, 'CLAUDE.azure-functions-skills-new.md'))).toBe(false);
  });

  it('update --dry-run after install --local reports planned actions', { timeout: 15_000 }, () => {
    const projectDir = makeTempDir('af-skills-e2e-local-update-dryrun-');

    // Install locally
    runCli(['install', '--local', '--agent', 'ghcp', '--dir', projectDir, '--yes']);

    // Run update with --dry-run
    const output = runCliOutput(['update', '--agent', 'ghcp', '--dir', projectDir, '--dry-run']);

    // Output describes planned actions
    expect(output).toContain('Planned local update');
  });

  it('local update reports bundled assets and npm update guidance when the package is stale', { timeout: 15_000 }, () => {
    const fakeNpmDir = createFakeNpmDirectory('9.9.9');
    const projectDir = makeTempDir('af-skills-e2e-local-update-guidance-');
    const pathValue = `${fakeNpmDir}${delimiter}${process.env.PATH || ''}`;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      AZURE_FUNCTIONS_SKILLS_SKIP_UPDATE_CHECK: '0',
    };

    runCli(['install', '--local', '--agent', 'codex', '--dir', projectDir, '--yes', '--skip-prerequisites'], { env });
    const output = runCliOutput(['update', '--agent', 'codex', '--dir', projectDir, '--yes'], { env });

    expect(output).toContain('Local assets: bundled with @azure/functions-skills');
    expect(output).toContain('@azure/functions-skills 9.9.9 is available');
    expect(output).toContain('npm install -g @azure/functions-skills@latest');
    expect(output).not.toContain('source-ref');
    expect(output).not.toContain('Fetching templates from GitHub');
  });

  it('update after plugin install saves aside customer-owned routing files', { timeout: 15_000 }, () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-plugin-update-save-aside-');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    runCli(['install', '--agent', 'claude', '--dir', projectDir, '--yes'], { env });
    const claudePath = join(projectDir, 'CLAUDE.md');
    writeFileSync(claudePath, '# My Custom Claude Rules\nNo managed block here.\n');

    const output = runCliOutput(['update', '--agent', 'claude', '--dir', projectDir, '--yes'], { env });

    const updatedContent = readFileSync(claudePath, 'utf-8');
    expect(updatedContent).toContain('No managed block here.');
    expect(updatedContent).not.toContain('azure-functions-skills:start');
    const asidePath = join(projectDir, 'CLAUDE.azure-functions-skills-new.md');
    expect(existsSync(asidePath)).toBe(true);
    expect(readFileSync(asidePath, 'utf-8')).toContain('Azure Functions Skills');
    expect(output).toContain('saved aside');
    expect(output).toContain('CLAUDE.azure-functions-skills-new.md');
  });

  it('update --force after plugin install overwrites customer-owned routing files', { timeout: 15_000 }, () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-plugin-update-force-');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    runCli(['install', '--agent', 'claude', '--dir', projectDir, '--yes'], { env });
    const claudePath = join(projectDir, 'CLAUDE.md');
    writeFileSync(claudePath, '# My Custom Claude Rules\nNo managed block here.\n');

    runCli(['update', '--agent', 'claude', '--dir', projectDir, '--yes', '--force'], { env });

    const updatedContent = readFileSync(claudePath, 'utf-8');
    expect(updatedContent).not.toContain('No managed block here.');
    expect(updatedContent).toContain('Azure Functions Skills');
    expect(existsSync(join(projectDir, 'CLAUDE.azure-functions-skills-new.md'))).toBe(false);
  });

  it('install rejects mixed mode: local then plugin', { timeout: 15_000 }, () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-mixed-mode-');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    // Install ghcp locally
    runCli(['install', '--local', '--agent', 'ghcp', '--dir', projectDir, '--yes']);

    // Try to install claude as plugin — should fail
    expect(() => runCliOutput(['install', '--agent', 'claude', '--dir', projectDir, '--yes'], { env }))
      .toThrow(/Cannot mix install modes/);
  });

  it('install rejects mixed mode: plugin then local', { timeout: 15_000 }, () => {
    const fakeBinDir = createFakeAgentCliDirectory();
    const projectDir = makeTempDir('af-skills-e2e-mixed-mode-rev-');
    const pathValue = `${fakeBinDir}${delimiter}${process.env.PATH || ''}`;
    const pathext = process.platform === 'win32'
      ? `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT || ''}`
      : process.env.PATHEXT;
    const env = {
      PATH: pathValue,
      Path: pathValue,
      ...(pathext ? { PATHEXT: pathext } : {}),
    };

    // Install claude as plugin
    runCli(['install', '--agent', 'claude', '--dir', projectDir, '--yes'], { env });

    // Try to install ghcp locally — should fail
    expect(() => runCliOutput(['install', '--local', '--agent', 'ghcp', '--dir', projectDir, '--yes']))
      .toThrow(/Cannot mix install modes/);
  });

  it.runIf(CURRENT_NODE_MAJOR >= 24)('install --local --agent ghcp --yes into non-git dir auto-inits git repo', { timeout: 15_000 }, () => {
    const projectDir = makeTempDir('af-skills-e2e-git-init-');

    const output = runCliOutput(['install', '--local', '--agent', 'ghcp', '--dir', projectDir, '--yes', '--skip-prerequisites']);

    // Git repo should be initialized
    expect(existsSync(join(projectDir, '.git'))).toBe(true);
    expect(output).toContain('Git repo: initialized');
  });

  it.runIf(CURRENT_NODE_MAJOR >= 24)('install --local --agent ghcp into non-git dir warns without --yes', { timeout: 15_000 }, () => {
    const projectDir = makeTempDir('af-skills-e2e-git-init-warn-');

    const output = runCliOutput(['install', '--local', '--agent', 'ghcp', '--dir', projectDir, '--skip-prerequisites']);

    // Git repo should NOT be initialized (non-interactive, no --yes)
    expect(existsSync(join(projectDir, '.git'))).toBe(false);
    // Should warn that git init is needed
    expect(output).toMatch(/[Gg]it repo.*not initialized|[Cc]opilot.*requires.*git/);
  });

  it.runIf(CURRENT_NODE_MAJOR >= 24)('install --local --agent ghcp into existing git repo does not re-init', { timeout: 15_000 }, () => {
    const projectDir = makeTempDir('af-skills-e2e-git-existing-');
    // Pre-init git repo
    execFileSync('git', ['init'], { cwd: projectDir, stdio: 'pipe' });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test.com', 'commit', '--allow-empty', '-m', 'initial'], { cwd: projectDir, stdio: 'pipe' });

    runCliOutput(['install', '--local', '--agent', 'ghcp', '--dir', projectDir, '--yes', '--skip-prerequisites']);

    // Existing commit should still be there; Git may report an initialization message on some
    // Windows agents even when the existing repository remains intact.
    const log = execFileSync('git', ['log', '--oneline'], { cwd: projectDir, encoding: 'utf-8' });
    expect(log).toContain('initial');
  });

  it.runIf(CURRENT_NODE_MAJOR >= 24)('install --local --agent ghcp --yes inside parent git repo inits own .git', { timeout: 15_000 }, () => {
    const parentDir = makeTempDir('af-skills-e2e-git-parent-');
    execFileSync('git', ['init'], { cwd: parentDir, stdio: 'pipe' });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test.com', 'commit', '--allow-empty', '-m', 'parent'], { cwd: parentDir, stdio: 'pipe' });

    // Create a subdirectory inside the parent git repo
    const childDir = join(parentDir, 'my-project');
    mkdirSync(childDir, { recursive: true });

    const output = runCliOutput(['install', '--local', '--agent', 'ghcp', '--dir', childDir, '--yes', '--skip-prerequisites']);

    // Should init its own .git because the child is not the git root
    expect(existsSync(join(childDir, '.git'))).toBe(true);
    expect(output).toContain('Git repo: initialized');
  });

  it('install --local --agent claude --yes into non-git dir does not init git', { timeout: 15_000 }, () => {
    const projectDir = makeTempDir('af-skills-e2e-git-claude-');

    const output = runCliOutput(['install', '--local', '--agent', 'claude', '--dir', projectDir, '--yes', '--skip-prerequisites']);

    // Git init is only for GHCP — Claude-only install should not init
    expect(existsSync(join(projectDir, '.git'))).toBe(false);
    expect(output).not.toContain('Git repo: initialized');
  });

  it.runIf(CURRENT_NODE_MAJOR >= 24)('install --agent ghcp --yes (plugin mode) into non-git dir auto-inits git repo', { timeout: 15_000 }, () => {
    const projectDir = makeTempDir('af-skills-e2e-git-plugin-');

    const output = runCliOutput(['install', '--agent', 'ghcp', '--dir', projectDir, '--yes', '--skip-prerequisites']);

    // Plugin mode GHCP also needs git for agent discovery
    expect(existsSync(join(projectDir, '.git'))).toBe(true);
    expect(output).toContain('Git repo: initialized');
  });
});
