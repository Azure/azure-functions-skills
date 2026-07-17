import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';

const ROOT_DIR = join(import.meta.dirname, '..');
const CLI_PATH = join(ROOT_DIR, 'bin', 'azure-functions-skills.js');
const TEMP_DIRS: string[] = [];

function makeTempDir(): string {
  const dir = createTempDir('af-skills-cli-');
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('simplified CLI', () => {
  it('requires --local instead of installing a plugin', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, 'install', '--agent', 'ghcp'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no longer installs plugins');
  });

  it('installs and updates package-bundled local assets', () => {
    const dir = makeTempDir();
    const environment = { ...process.env, AZURE_FUNCTIONS_SKILLS_SKIP_UPDATE_CHECK: '1' };

    execFileSync(process.execPath, [CLI_PATH, 'install', '--local', '--agent', 'ghcp', '--dir', dir], {
      cwd: ROOT_DIR,
      env: environment,
    });
    execFileSync(process.execPath, [CLI_PATH, 'update', '--local', '--agent', 'ghcp', '--dir', dir], {
      cwd: ROOT_DIR,
      env: environment,
    });

    expect(existsSync(join(dir, '.github', 'skills', 'azure-functions-help', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.github', 'hooks', 'azure-functions-telemetry.json'))).toBe(true);
    expect(existsSync(join(dir, '.azure-functions-skills'))).toBe(false);
  });

  it('supports workspace-local telemetry opt-out without legacy state', () => {
    const dir = makeTempDir();
    const environment = { ...process.env, AZURE_FUNCTIONS_SKILLS_SKIP_UPDATE_CHECK: '1' };

    execFileSync(process.execPath, [
      CLI_PATH,
      'install',
      '--local',
      '--agent',
      'ghcp',
      '--dir',
      dir,
      '--no-telemetry',
    ], {
      cwd: ROOT_DIR,
      env: environment,
    });

    const config = JSON.parse(
      readFileSync(join(dir, '.github', 'hooks', 'telemetry.config.json'), 'utf-8'),
    ) as { enabled?: boolean };
    expect(config.enabled).toBe(false);
    expect(existsSync(join(dir, '.azure-functions-skills'))).toBe(false);
  });

  it('keeps the internal telemetry command out of general help', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, '--help'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/^\s+telemetry(?:\s|$)/m);
  });

  it('accepts one sanitized telemetry event over stdin', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, 'telemetry'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      input: JSON.stringify({
        timestamp: '2026-07-17T20:00:00Z',
        eventType: 'skill_invocation',
        clientName: 'copilot-cli',
        pluginName: 'azure-functions-skills',
        skillName: 'azure-functions-help',
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('rejects unsanitized telemetry input', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, 'telemetry'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      input: JSON.stringify({
        timestamp: '2026-07-17T20:00:00Z',
        eventType: 'skill_invocation',
        clientName: 'copilot-cli',
        pluginName: 'azure-functions-skills',
        skillName: 'azure-functions-help',
        toolInput: { path: 'customer-secret.txt' },
      }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Telemetry failed: Unsupported telemetry property: toolInput');
  });

  it.each(['chat', 'setup', 'plugin', 'workspace', 'state'])('removes the %s command', removedCommand => {
    const result = spawnSync(process.execPath, [CLI_PATH, removedCommand], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Unknown command: ${removedCommand}`);
  });
});
