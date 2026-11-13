import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildPluginPayload, buildTarget } from '../src/build/build-target.js';
import { loadFunctionsTools, loadHooks, loadMcpServers, loadSkills } from '../src/build/loader.js';
import { buildTelemetryRuntime } from '../src/build/telemetry-runtime.js';
import { buildFunctionsTools } from '../src/build/tools-runtime.js';
import { runCli, type CliDependencies } from '../src/tools/cli.js';
import { EXIT } from '../src/tools/shared/output.js';
import type { BuildData } from '../src/types.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import { fakeRunner, signedIn, writeProject } from './helpers/deploy-fixture.js';

const TEMPLATES_DIR = join(import.meta.dirname, '..', 'templates');
const TOOL_PATH = join('azure-functions-common', 'scripts', 'functions-tools.mjs');
const TEMP_DIRS: string[] = [];

function tempDir(): string {
  const dir = createTempDir('af-tools-cli ');
  TEMP_DIRS.push(dir);
  return dir;
}

function dependencies(run = fakeRunner().run): CliDependencies {
  return { run, now: () => new Date(0), fetchStatus: async () => 200, sleep: async () => undefined };
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('functions-tools command line', () => {
  it.each([
    [[]],
    [['deploy']],
    [['deploy', 'destroy']],
    [['deploy', 'plan']],
    [['deploy', 'apply', '--dir', '.']],
    [['deploy', 'plan', '--dir', '.', '--force']],
    [['deploy', 'plan', '--dir', join('does', 'not', 'exist')]],
  ])('reports %j as a usage error', async argv => {
    const outcome = await runCli(argv, dependencies());
    expect(outcome.exitCode).toBe(EXIT.usage);
    expect(outcome.body.findings[0].id).toBe('USAGE');
  });

  it('turns an unexpected error into exit code 1 without leaking secrets', async () => {
    const dir = tempDir();
    writeProject(dir);
    const outcome = await runCli(['deploy', 'plan', '--dir', dir, '--env', 'dev'], dependencies(async () => {
      throw new Error('spawn failed: AccountKey=abc123==');
    }));
    expect(outcome.exitCode).toBe(EXIT.unexpected);
    expect(JSON.stringify(outcome.body)).not.toContain('abc123');
  });

  it('routes deploy plan to the planner', async () => {
    const dir = tempDir();
    writeProject(dir);
    const outcome = await runCli(
      ['deploy', 'plan', '--dir', dir, '--env', 'dev', '--location', 'eastus', '--set', 'VNET_ENABLED=true'],
      dependencies(signedIn().run),
    );
    expect(outcome.exitCode).toBe(EXIT.ok);
    expect(outcome.body.command).toBe('deploy plan');
  });
});

describe('functions-tools bundle', () => {
  it('runs as a single file without node_modules', () => {
    const dir = tempDir();
    const file = join(dir, 'functions-tools.mjs');
    const { code } = buildFunctionsTools();
    writeFileSync(file, code);
    // Every import must be a Node built-in.
    expect(code).not.toMatch(/^\s*import\b[^\n]*\bfrom\s*["'](?!node:)/m);
    expect(code).not.toMatch(/\brequire\(\s*["'](?!node:)/);

    const help = spawnSync(process.execPath, [file, '--help'], { cwd: dir, encoding: 'utf-8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('deploy plan');

    const usage = spawnSync(process.execPath, [file, 'deploy', 'apply', '--dir', dir], { cwd: dir, encoding: 'utf-8' });
    expect(usage.status).toBe(EXIT.usage);
    expect((JSON.parse(usage.stdout) as { ok: boolean }).ok).toBe(false);

    const missingPlan = spawnSync(process.execPath, [file, 'deploy', 'apply', '--dir', dir, '--approve', 'x'],
      { cwd: dir, encoding: 'utf-8' });
    expect(missingPlan.status).toBe(EXIT.blocked);
  });

  it('ships in the common skill of every payload', () => {
    const data: BuildData = {
      skills: loadSkills(join(TEMPLATES_DIR, 'skills')),
      mcpServers: loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml')),
      hooks: loadHooks(join(TEMPLATES_DIR, 'hooks'), buildTelemetryRuntime(join(TEMPLATES_DIR, 'skills'))),
      tools: buildFunctionsTools(),
      packageVersion: '1.2.3',
    };
    const root = tempDir();
    buildPluginPayload(data, join(root, 'plugin'));
    expect(readFileSync(join(root, 'plugin', 'skills', TOOL_PATH), 'utf-8')).toBe(data.tools!.code);
    expect(loadFunctionsTools(join(root, 'plugin')).code).toBe(data.tools!.code);
    for (const [target, skills] of [
      ['ghcp', join('.github', 'skills')], ['claude', join('.claude', 'skills')], ['codex', join('.agents', 'skills')],
    ] as const) {
      buildTarget(target, data, root);
      expect(existsSync(join(root, target, skills, TOOL_PATH))).toBe(true);
    }
  });

  it('fails clearly when a published package has no tool', () => {
    expect(() => loadFunctionsTools(tempDir())).toThrow(/tools payload is missing/);
  });
});
