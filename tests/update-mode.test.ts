import { afterEach, describe, expect, it } from 'vitest';
import {
  getInstalledTargets,
  readState,
  recordInstallState,
  resolveInstallMode,
} from '../src/setup/state.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];

function makeTempDir(): string {
  const dir = createTempDir('af-skills-update-mode-');
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('resolveInstallMode', () => {
  it('returns "local" when state records mode as local', () => {
    const dir = makeTempDir();
    recordInstallState(dir, {
      action: 'install',
      agents: ['ghcp'],
      mode: 'local',
      source: 'local',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: true,
      includeAgent: true,
    });

    const state = readState(dir)!;
    expect(resolveInstallMode(state, ['ghcp'])).toBe('local');
  });

  it('returns "plugin" when state records mode as plugin', () => {
    const dir = makeTempDir();
    recordInstallState(dir, {
      action: 'install',
      agents: ['ghcp'],
      mode: 'plugin',
      source: 'marketplace',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: true,
      includeAgent: true,
    });

    const state = readState(dir)!;
    expect(resolveInstallMode(state, ['ghcp'])).toBe('plugin');
  });

  it('prefers per-agent installMode over top-level install.mode', () => {
    const dir = makeTempDir();
    // Install ghcp as local
    recordInstallState(dir, {
      action: 'install',
      agents: ['ghcp'],
      mode: 'local',
      source: 'local',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: true,
      includeAgent: true,
    });
    // Then install claude as plugin — top-level mode becomes 'plugin'
    recordInstallState(dir, {
      action: 'install',
      agents: ['claude'],
      mode: 'plugin',
      source: 'marketplace',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: false,
      includeAgent: false,
    });

    const state = readState(dir)!;
    // When updating ghcp only, should use ghcp's per-agent mode ('local')
    expect(resolveInstallMode(state, ['ghcp'])).toBe('local');
    // When updating claude only, should use claude's per-agent mode ('plugin')
    expect(resolveInstallMode(state, ['claude'])).toBe('plugin');
  });

  it('returns "mixed" when selected agents have different install modes', () => {
    const dir = makeTempDir();
    recordInstallState(dir, {
      action: 'install',
      agents: ['ghcp'],
      mode: 'local',
      source: 'local',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: true,
      includeAgent: true,
    });
    recordInstallState(dir, {
      action: 'install',
      agents: ['claude'],
      mode: 'plugin',
      source: 'marketplace',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: false,
      includeAgent: false,
    });

    const state = readState(dir)!;
    expect(resolveInstallMode(state, ['ghcp', 'claude'])).toBe('mixed');
  });

  it('falls back to top-level mode when per-agent installMode is absent', () => {
    const dir = makeTempDir();
    recordInstallState(dir, {
      action: 'install',
      agents: ['ghcp'],
      mode: 'local',
      source: 'local',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: true,
      includeAgent: true,
    });

    const state = readState(dir)!;
    // Manually remove per-agent installMode to simulate old state format
    delete state.agents.ghcp.installMode;

    expect(resolveInstallMode(state, ['ghcp'])).toBe('local');
  });
});

describe('update CLI integration: mode auto-detection', () => {
  // These tests verify the CLI behavior through integration-commands patterns.
  // Actual CLI invocation tests are in integration-commands.test.ts.
  // Here we test the state utility functions that drive auto-detection.

  it('getInstalledTargets returns agents from state', () => {
    const dir = makeTempDir();
    recordInstallState(dir, {
      action: 'install',
      agents: ['ghcp', 'codex'],
      mode: 'local',
      source: 'local',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: true,
      includeAgent: true,
    });

    const state = readState(dir)!;
    expect(getInstalledTargets(state)).toEqual(['ghcp', 'codex']);
  });
});
