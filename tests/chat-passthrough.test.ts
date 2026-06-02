import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { SpawnOptions } from 'node:child_process';
import { createTempDir, removeDir } from './helpers/fs.js';

type SpawnCall = {
  command: string;
  args: string[];
  options: SpawnOptions;
};

type FakeChildProcess = {
  on: (event: string, callback: () => void) => FakeChildProcess;
};

const TEMP_DIRS: string[] = [];

afterEach(() => {
  vi.doUnmock('node:child_process');
  vi.resetModules();
});

afterAll(() => {
  for (const dir of TEMP_DIRS) {
    removeDir(dir);
  }
});

describe('chat passthrough startup context', () => {
  it('keeps generated setup/startup prompt while forwarding passthrough args', async () => {
    const spawnCalls: SpawnCall[] = [];
    installChildProcessMock(spawnCalls);
    const dir = createTempDir('af-skills-chat-passthrough-');
    TEMP_DIRS.push(dir);

    const { chat } = await import('../src/chat/index.js');
    const originalPath = process.env.PATH;
    const originalWindowsPath = process.env.Path;
    process.env.PATH = '';
    process.env.Path = '';

    try {
      const result = await chat({
        agent: 'github-copilot',
        dir,
        passthroughArgs: ['--yolo'],
        setupSkillPending: true,
        setupCompleteCommand: 'azure-functions-skills state setup-complete --dir . --agent github-copilot',
      });

      expect(result.prompt).toContain('First run azure-functions-setup');
      expect(result.prompt).toContain('Azure Functions');
      expect(spawnCalls).toHaveLength(1);

      const call = spawnCalls[0];
      expect(call.command).toBe('copilot');
      expect(call.args).toContain('--experimental');
      expect(call.args).toContain('--agent');
      expect(call.args).toContain('functions-copilot');
      expect(call.args).toContain('--yolo');

      const promptIndex = call.args.indexOf('-i');
      expect(promptIndex).toBeGreaterThanOrEqual(0);
      expect(call.args[promptIndex + 1]).toContain('First run azure-functions-setup');
      expect(call.args[promptIndex + 1]).toContain('Azure Functions');
    } finally {
      restoreEnv('PATH', originalPath);
      restoreEnv('Path', originalWindowsPath);
    }
  });

  it('returns the generated launch plan without spawning when dry-run is set', async () => {
    const spawnCalls: SpawnCall[] = [];
    installChildProcessMock(spawnCalls);
    const dir = createTempDir('af-skills-chat-dry-run-');
    TEMP_DIRS.push(dir);

    const { chat } = await import('../src/chat/index.js');
    const result = await chat({
      agent: 'github-copilot',
      dir,
      passthroughArgs: ['--yolo'],
      setupSkillPending: true,
      setupCompleteCommand: 'azure-functions-skills state setup-complete --dir . --agent github-copilot',
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.childProcess).toBeNull();
    expect(result.command).toBe('copilot');
    expect(result.args).toContain('--yolo');
    expect(result.prompt).toContain('First run azure-functions-setup');
    expect(result.prompt).toContain('Azure Functions');
    expect(spawnCalls).toEqual([]);
  });

  it('reports generated prompt as not included when the launcher omits it for an explicit prompt arg', async () => {
    const spawnCalls: SpawnCall[] = [];
    installChildProcessMock(spawnCalls);
    const dir = createTempDir('af-skills-chat-dry-run-explicit-prompt-');
    TEMP_DIRS.push(dir);

    const { chat } = await import('../src/chat/index.js');
    const result = await chat({
      agent: 'github-copilot',
      dir,
      passthroughArgs: ['-p', 'headless prompt'],
      setupSkillPending: true,
      setupCompleteCommand: 'azure-functions-skills state setup-complete --dir . --agent github-copilot',
      dryRun: true,
    });

    expect(result.prompt).toContain('First run azure-functions-setup');
    expect(result.args).toContain('-p');
    expect(result.args).toContain('headless prompt');
    expect(result.args).not.toContain(result.prompt);
    expect(spawnCalls).toEqual([]);
  });
});

function installChildProcessMock(spawnCalls: SpawnCall[]): void {
  const child: FakeChildProcess = {
    on(event, callback) {
      if (event === 'spawn') queueMicrotask(callback);
      return child;
    },
  };

  vi.doMock('node:child_process', () => ({
    execSync: vi.fn(),
    spawn: vi.fn((command: string, args: string[], options: SpawnOptions) => {
      spawnCalls.push({ command, args: [...args], options });
      return child;
    }),
  }));
}

function restoreEnv(name: 'PATH' | 'Path', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
