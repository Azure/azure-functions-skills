import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { azureSkillsProvider } from '../src/setup/prerequisites/azure-skills.js';
import { ensurePrerequisites } from '../src/setup/prerequisites/index.js';
import type { CommandRunner } from '../src/setup/prerequisites/types.js';
import { createTempDir, removeDir } from './helpers/fs.js';

type TestRunner = CommandRunner & { calls: Array<{ command: string; args: string[] }> };

function runnerFrom(responses: Array<{ command: string; args: string[]; stdout?: string; exitCode?: number }>): TestRunner {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner = (async (command, args) => {
    calls.push({ command, args });
    const response = responses.find(item => item.command === command && JSON.stringify(item.args) === JSON.stringify(args));
    if (!response) {
      return { exitCode: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
    }
    return { exitCode: response.exitCode ?? 0, stdout: response.stdout ?? '', stderr: '' };
  }) as TestRunner;
  runner.calls = calls;
  return runner;
}

describe('azureSkillsProvider', () => {
  it('supports GitHub Copilot first and leaves Claude/Codex for future providers', () => {
    expect(azureSkillsProvider.supports('ghcp')).toBe(true);
    expect(azureSkillsProvider.supports('claude')).toBe(false);
    expect(azureSkillsProvider.supports('codex')).toBe(false);
  });

  it('detects Azure Skills from copilot plugin list', async () => {
    const runner = runnerFrom([
      { command: 'copilot', args: ['plugin', 'list'], stdout: 'azure 1.1.29 enabled\n' },
    ]);

    const result = await azureSkillsProvider.check({
      target: 'ghcp',
      projectDir: createTempDir('af-skills-prereq-'),
      mode: 'check-only',
      runner,
    });

    expect(result.status).toBe('present');
    expect(result.message).toContain('Azure Skills plugin is installed');
  });

  it('detects workspace Azure Skills files only as a fallback', async () => {
    const dir = createTempDir('af-skills-prereq-workspace-');
    try {
      for (const skill of ['azure-deploy', 'azure-prepare', 'azure-validate']) {
        const skillDir = join(dir, '.github', 'skills', skill);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, 'SKILL.md'), `# ${skill}\n`);
      }
      const runner = runnerFrom([
        { command: 'copilot', args: ['plugin', 'list'], exitCode: 1, stdout: '' },
      ]);

      const result = await azureSkillsProvider.check({ target: 'ghcp', projectDir: dir, mode: 'check-only', runner });

      expect(result.status).toBe('present');
      expect(result.message).toContain('workspace fallback');
    } finally {
      removeDir(dir);
    }
  });

  it('installs Azure Skills through GitHub Copilot plugin commands in auto mode', async () => {
    const runner = runnerFrom([
      { command: 'copilot', args: ['plugin', 'marketplace', 'add', 'microsoft/azure-skills'], stdout: 'added\n' },
      { command: 'copilot', args: ['plugin', 'install', 'azure@azure-skills'], stdout: 'installed\n' },
    ]);

    const result = await azureSkillsProvider.install({
      target: 'ghcp',
      projectDir: createTempDir('af-skills-prereq-install-'),
      mode: 'auto',
      runner,
    });

    expect(result.status).toBe('installed');
    expect(runner.calls).toEqual([
      { command: 'copilot', args: ['plugin', 'marketplace', 'add', 'microsoft/azure-skills'] },
      { command: 'copilot', args: ['plugin', 'install', 'azure@azure-skills'] },
    ]);
  });

  it('returns manual guidance when GitHub Copilot plugin install fails', async () => {
    const runner = runnerFrom([
      { command: 'copilot', args: ['plugin', 'marketplace', 'add', 'microsoft/azure-skills'], exitCode: 1 },
    ]);

    const result = await azureSkillsProvider.install({
      target: 'ghcp',
      projectDir: createTempDir('af-skills-prereq-manual-'),
      mode: 'auto',
      runner,
    });

    expect(result.status).toBe('manual-action-required');
    expect(result.commands).toContain('/plugin marketplace add microsoft/azure-skills');
    expect(result.commands).toContain('/plugin install azure@azure-skills');
  });
});

describe('ensurePrerequisites', () => {
  it('skips prerequisite checks when mode is skip', async () => {
    const runner = runnerFrom([]);

    const results = await ensurePrerequisites({
      targets: ['ghcp'],
      projectDir: createTempDir('af-skills-prereq-skip-'),
      mode: 'skip',
      runner,
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(runner.calls).toEqual([]);
  });

  it('checks then installs missing Azure Skills for GitHub Copilot in auto mode', async () => {
    const runner = runnerFrom([
      { command: 'copilot', args: ['plugin', 'list'], exitCode: 0, stdout: 'other-plugin\n' },
      { command: 'copilot', args: ['plugin', 'marketplace', 'add', 'microsoft/azure-skills'], stdout: 'added\n' },
      { command: 'copilot', args: ['plugin', 'install', 'azure@azure-skills'], stdout: 'installed\n' },
    ]);

    const results = await ensurePrerequisites({
      targets: ['ghcp'],
      projectDir: createTempDir('af-skills-prereq-auto-'),
      mode: 'auto',
      runner,
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('installed');
  });
});
