import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT_PATH = join(import.meta.dirname, '..', 'scripts', 'release-local.mjs');

describe('release-local script', () => {
  it('prints help without side effects', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--help'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Local release helper');
    expect(result.stdout).toContain('npm run release:local');
  });

  it('rejects invalid versions before release checks', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, 'not-a-version', '--yes'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid version');
  });
});
