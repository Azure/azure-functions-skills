import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installLocalSkills } from '../src/setup/index.js';
import type { CommandRunner } from '../src/setup/prerequisites/types.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];

function makeTempDir(): string {
  const dir = createTempDir('af-skills-local-install-');
  TEMP_DIRS.push(dir);
  return dir;
}

function stalePackageRunner(): CommandRunner {
  return async command => {
    if (command === 'npm') {
      return { exitCode: 0, stdout: '9.9.9\n', stderr: '' };
    }
    return { exitCode: 0, stdout: 'ok\n', stderr: '' };
  };
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('installLocalSkills', () => {
  it('installs bundled local assets and records local state like CLI install --local', async () => {
    const dir = makeTempDir();

    const result = await installLocalSkills({
      targetDir: dir,
      agents: ['ghcp'],
      yes: true,
      prerequisites: 'skip',
      checkForUpdates: false,
    });

    expect(result.filesWritten).toBeGreaterThan(0);
    expect(existsSync(join(dir, '.github', 'skills'))).toBe(true);
    expect(existsSync(join(dir, '.github', 'agents', 'functions-copilot.agent.md'))).toBe(true);
    expect(result.state?.install.mode).toBe('local');
    expect(result.state?.install.source).toBe('local');
    expect(result.gitignoreResult.status).toBe('updated');
  });

  it('supports dry-run without writing workspace files or state', async () => {
    const dir = makeTempDir();

    const result = await installLocalSkills({
      targetDir: dir,
      agents: ['claude'],
      dryRun: true,
      checkForUpdates: false,
    });

    expect(result.dryRun).toBe(true);
    expect(result.plannedFiles).toContain('claude: workspace setup files from bundled npm package assets');
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(dir, '.azure-functions-skills', 'state.local.json'))).toBe(false);
  });

  it('returns structured npm update guidance for VS Code integrations', async () => {
    const dir = makeTempDir();

    const result = await installLocalSkills({
      targetDir: dir,
      agents: ['codex'],
      yes: true,
      prerequisites: 'skip',
      runner: stalePackageRunner(),
    });

    expect(result.packageUpdate.status).toBe('update-available');
    expect(result.packageUpdate.command).toBe('npm install -g @azure/functions-skills@latest');
    const state = JSON.parse(readFileSync(join(dir, '.azure-functions-skills', 'state.local.json'), 'utf-8')) as {
      install: { mode: string; source: string };
    };
    expect(state.install).toEqual(expect.objectContaining({ mode: 'local', source: 'local' }));
  });
});
