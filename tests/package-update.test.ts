import { describe, expect, it } from 'vitest';
import { checkPackageUpdate } from '../src/setup/package-update.js';
import type { CommandRunner } from '../src/setup/prerequisites/types.js';

function runnerWith(stdout: string, exitCode = 0, stderr = ''): CommandRunner {
  return async () => ({ exitCode, stdout, stderr });
}

describe('checkPackageUpdate', () => {
  it('returns current when the installed package is up to date', async () => {
    const result = await checkPackageUpdate({
      currentVersion: '1.2.3',
      runner: runnerWith('"1.2.3"\n'),
    });

    expect(result.status).toBe('current');
    expect(result.currentVersion).toBe('1.2.3');
    expect(result.latestVersion).toBe('1.2.3');
  });

  it('returns actionable npm guidance when a newer package exists', async () => {
    const result = await checkPackageUpdate({
      currentVersion: '1.2.3',
      runner: runnerWith('1.3.0\n'),
    });

    expect(result.status).toBe('update-available');
    expect(result.latestVersion).toBe('1.3.0');
    expect(result.message).toContain('@azure/functions-skills 1.3.0 is available');
    expect(result.command).toBe('npm install -g @azure/functions-skills@latest');
  });

  it('treats preview versions as comparable package versions', async () => {
    const result = await checkPackageUpdate({
      currentVersion: '0.0.5-preview',
      runner: runnerWith('"0.0.6-preview"\n'),
    });

    expect(result.status).toBe('update-available');
    expect(result.latestVersion).toBe('0.0.6-preview');
  });

  it('returns a non-blocking check-failed result when npm metadata lookup fails', async () => {
    const result = await checkPackageUpdate({
      currentVersion: '1.2.3',
      runner: runnerWith('', 1, 'registry unavailable'),
    });

    expect(result.status).toBe('check-failed');
    expect(result.message).toContain('Could not check npm for @azure/functions-skills updates');
  });
});
