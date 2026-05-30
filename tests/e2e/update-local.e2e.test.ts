/**
 * E2E tests for the update command with real agent CLI tools.
 *
 * These tests require actual agent CLIs to be installed (gh, claude, codex)
 * and are NOT run in regular CI. They run in nightly CI or manually.
 *
 * Run manually: npx vitest run tests/e2e/update-local.e2e.test.ts --config vitest.e2e.config.ts
 */

import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from '../helpers/fs.js';

const ROOT_DIR = join(import.meta.dirname, '..');
const CLI_PATH = join(ROOT_DIR, '..', 'bin', 'azure-functions-skills.js');
const TEMP_DIRS: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of TEMP_DIRS) removeDir(dir);
});

function runCli(args: string[], options: { cwd?: string } = {}): string {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd || ROOT_DIR,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
}

describe('E2E: local update flow', () => {
  describe.each([
    { agent: 'ghcp', routingFile: '.github/copilot-instructions.md', skillsDir: '.github/skills' },
    { agent: 'claude', routingFile: 'CLAUDE.md', skillsDir: '.claude/skills' },
    { agent: 'codex', routingFile: 'AGENTS.md', skillsDir: '.agents/skills' },
  ] as const)('$agent', ({ agent, routingFile, skillsDir }) => {
    it('install --local → update preserves user customizations', () => {
      const dir = makeTempDir(`af-e2e-update-${agent}-`);

      // Install locally
      runCli(['install', '--local', '--agent', agent, '--dir', dir, '--yes']);

      // Verify workspace was created
      expect(existsSync(join(dir, routingFile))).toBe(true);
      expect(existsSync(join(dir, skillsDir))).toBe(true);

      // User customizes routing file
      const original = readFileSync(join(dir, routingFile), 'utf-8');
      writeFileSync(join(dir, routingFile), `# My Custom Rules\n\n${original}`);

      // Update (auto-detects local mode)
      runCli(['update', '--agent', agent, '--dir', dir, '--yes']);

      // Routing file: original is preserved (save-aside strategy since no managed block)
      const afterUpdate = readFileSync(join(dir, routingFile), 'utf-8');
      expect(afterUpdate).toContain('# My Custom Rules');

      // Skills refreshed
      const skills = readdirSync(join(dir, skillsDir), { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      expect(skills.length).toBeGreaterThan(0);
    });

    it('install --local → update --force overwrites everything', () => {
      const dir = makeTempDir(`af-e2e-update-force-${agent}-`);

      runCli(['install', '--local', '--agent', agent, '--dir', dir, '--yes']);
      writeFileSync(join(dir, routingFile), '# Custom content only\n');

      runCli(['update', '--agent', agent, '--dir', dir, '--yes', '--force']);

      const content = readFileSync(join(dir, routingFile), 'utf-8');
      expect(content).not.toContain('# Custom content only');
      expect(content).toContain('Azure Functions');
    });

    it('install --local → update --dry-run does not modify files', () => {
      const dir = makeTempDir(`af-e2e-update-dryrun-${agent}-`);

      runCli(['install', '--local', '--agent', agent, '--dir', dir, '--yes']);
      const original = readFileSync(join(dir, routingFile), 'utf-8');

      const output = runCli(['update', '--agent', agent, '--dir', dir, '--dry-run']);

      expect(readFileSync(join(dir, routingFile), 'utf-8')).toBe(original);
      expect(output).toContain('Planned local update');
    });
  });

  it('install --local --all → update auto-detects all agents', () => {
    const dir = makeTempDir('af-e2e-update-all-');

    runCli(['install', '--local', '--all', '--dir', dir, '--yes']);

    // All routing files exist
    expect(existsSync(join(dir, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);

    // Update without specifying agents (auto-detect from state)
    runCli(['update', '--dir', dir, '--yes']);

    // All skill directories refreshed
    for (const skillsDir of ['.github/skills', '.claude/skills', '.agents/skills']) {
      const skills = readdirSync(join(dir, skillsDir), { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      expect(skills.length).toBeGreaterThan(0);
    }
  });
});
