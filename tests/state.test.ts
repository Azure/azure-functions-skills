import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STATE_FILE_NAME,
  STATE_IGNORE_ENTRY,
  ensureStateIgnored,
  getInstalledLaunchers,
  markSetupComplete,
  readState,
  recordInstallState,
  resolveStateLauncher,
  stateFilePath,
} from '../src/setup/state.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];

function makeTempDir(): string {
  const dir = createTempDir('af-skills-state-');
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('state file', () => {
  it('records plugin install state without storing secrets', () => {
    const dir = makeTempDir();

    const state = recordInstallState(dir, {
      action: 'install',
      agents: ['ghcp'],
      mode: 'plugin',
      source: 'marketplace',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: true,
      includeAgent: true,
    });

    expect(existsSync(stateFilePath(dir))).toBe(true);
    expect(state.schemaVersion).toBe(1);
    expect(state.install.lastAction).toBe('install');
    expect(state.agents.ghcp.installed).toBe(true);
    expect(state.agents.ghcp.launcherId).toBe('github-copilot');
    expect(state.chat.defaultAgent).toBe('github-copilot');
    expect(state.setupSkill.status).toBe('not-run');

    const raw = readFileSync(stateFilePath(dir), 'utf-8');
    expect(raw).toContain(STATE_FILE_NAME);
    expect(raw).not.toMatch(/token|secret|key/i);
  });

  it('updates existing install state while preserving setup completion', () => {
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
    markSetupComplete(dir, 'github-copilot');

    const updated = recordInstallState(dir, {
      action: 'update',
      agents: ['claude'],
      mode: 'plugin',
      source: 'local',
      scope: 'workspace',
      includeMcp: false,
      includeHooks: false,
      includeAgent: false,
    });

    expect(updated.agents.ghcp.installed).toBe(true);
    expect(updated.agents.claude.installed).toBe(true);
    expect(updated.chat.defaultAgent).toBe('github-copilot');
    expect(updated.setupSkill.status).toBe('completed');
  });

  it('resolves launcher from default agent or a single installed agent', () => {
    const dir = makeTempDir();

    const state = recordInstallState(dir, {
      action: 'install',
      agents: ['claude'],
      mode: 'plugin',
      source: 'local',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: false,
      includeAgent: false,
    });

    expect(getInstalledLaunchers(state)).toEqual(['claude-code']);
    expect(resolveStateLauncher(state)).toEqual({ kind: 'resolved', agent: 'claude-code' });
  });

  it('reports ambiguous launcher state when multiple agents are installed without a default', () => {
    const dir = makeTempDir();
    const state = recordInstallState(dir, {
      action: 'install',
      agents: ['ghcp', 'codex'],
      mode: 'plugin',
      source: 'marketplace',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: true,
      includeAgent: true,
    });
    state.chat.defaultAgent = null;

    expect(resolveStateLauncher(state)).toEqual({ kind: 'ambiguous', agents: ['github-copilot', 'codex'] });
  });

  it('marks setup skill complete in state', () => {
    const dir = makeTempDir();
    recordInstallState(dir, {
      action: 'install',
      agents: ['codex'],
      mode: 'plugin',
      source: 'marketplace',
      scope: 'workspace',
      includeMcp: true,
      includeHooks: true,
      includeAgent: false,
    });

    const state = markSetupComplete(dir, 'codex');

    expect(state.setupSkill.status).toBe('completed');
    expect(state.setupSkill.completedBy).toBe('codex');
    expect(readState(dir)?.setupSkill.status).toBe('completed');
  });
});

describe('state gitignore policy', () => {
  it('creates .gitignore with the state file entry when approved', () => {
    const dir = makeTempDir();

    const result = ensureStateIgnored(dir, { yes: true, interactive: false });
    const lines = readFileSync(join(dir, '.gitignore'), 'utf-8').split(/\r?\n/).map(line => line.trim());

    expect(result.status).toBe('updated');
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toContain(STATE_IGNORE_ENTRY);
    expect(lines).not.toContain('.azure-functions-skills/');
  });

  it('appends only the state file entry to an existing .gitignore when approved', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');

    const result = ensureStateIgnored(dir, { yes: true, interactive: false });

    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    const lines = content.split(/\r?\n/).map(line => line.trim());
    expect(result.status).toBe('updated');
    expect(content).toContain('node_modules/');
    expect(content).toContain(STATE_IGNORE_ENTRY);
    expect(lines).not.toContain('.azure-functions-skills/');
  });

  it('skips .gitignore changes when the state entry is already ignored', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.gitignore'), `${STATE_IGNORE_ENTRY}\n`);

    const result = ensureStateIgnored(dir, { yes: true, interactive: false });

    expect(result.status).toBe('already-ignored');
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8').trim()).toBe(STATE_IGNORE_ENTRY);
  });

  it('skips .gitignore changes when the full state directory is already ignored by the user', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.gitignore'), '.azure-functions-skills/\n');

    const result = ensureStateIgnored(dir, { yes: true, interactive: false });

    expect(result.status).toBe('already-ignored');
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8').trim()).toBe('.azure-functions-skills/');
  });

  it('does not change .gitignore without approval in noninteractive mode', () => {
    const dir = makeTempDir();

    const result = ensureStateIgnored(dir, { yes: false, interactive: false });

    expect(result.status).toBe('needs-approval');
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });
});