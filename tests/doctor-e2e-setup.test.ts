import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];
const SETUP_SCRIPT = join(import.meta.dirname, '..', 'scripts', 'doctor-e2e-setup.ps1');

function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of TEMP_DIRS) removeDir(dir);
});

describe('doctor E2E fixture setup', () => {
  it('defines destination protection and model forwarding in the generated helper', () => {
    const source = readFileSync(SETUP_SCRIPT, 'utf-8');
    expect(source).toContain('Fixture destination already exists');
    expect(source).toContain("[string]$Model = 'auto'");
    expect(source).toContain("$doctorArgs += '--model'");
    expect(source).toContain('$doctorArgs += $Model');
    expect(source).toContain('--list-expectations');
    expect(source).toContain('$deepFixtureNames');
    expect(source).not.toContain("Name -ne 'node-supply-chain-unpinned-deps'");
  });

  it.runIf(process.platform === 'win32')('rejects an existing fixture destination instead of nesting a copy', () => {
    const target = makeTmp('doctor-e2e-setup-');
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-File', SETUP_SCRIPT,
      '-Target', target,
      '-Filter', 'node-deep-client-reuse',
    ], { encoding: 'utf-8' });

    expect(() => execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-File', SETUP_SCRIPT,
      '-Target', target,
      '-Filter', 'node-deep-client-reuse',
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }))
      .toThrow(/already exists|cleanup/i);
    expect(existsSync(join(
      target,
      'node-deep-client-reuse',
      'node-deep-client-reuse',
    ))).toBe(false);
  });

  it.runIf(process.platform === 'win32')('generates a run-all helper that forwards an explicit model', () => {
    const target = makeTmp('doctor-e2e-model-');
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-File', SETUP_SCRIPT,
      '-Target', target,
      '-Filter', 'node-deep-client-reuse',
    ], { encoding: 'utf-8' });

    const command = [
      `$content = Get-Content '${join(target, 'run-all.ps1').replaceAll("'", "''")}' -Raw`,
      `if ($content -notmatch '\\[string\\]\\$Model' -or $content -notmatch "'--model'") { exit 1 }`,
    ].join('; ');
    expect(() => execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command', command,
    ], { encoding: 'utf-8' })).not.toThrow();
  });
});
