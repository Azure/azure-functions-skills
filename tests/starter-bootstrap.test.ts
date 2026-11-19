import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { sha256 } from '../src/starter/build.js';
import { hookSnippet } from '../src/starter/hooks.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import {
  assertReportSchema,
  buildFixture,
  FAKE_RUNTIME,
  minimalPath,
  runBootstrap,
  SHELLS,
  writeFixture,
  type Shell,
} from './helpers/starter.js';

const TIMEOUT = 240_000;
let temp: string;
let starterX: string;
let starterY: string;
let counter = 0;

beforeAll(() => {
  temp = createTempDir('af-starter-bootstrap ');
  starterX = writeFixture(buildFixture(), join(temp, 'payload x'));
  // Commit Y changes one skill file and the runtime bytes.
  const y = buildFixture({ runtime: { ...FAKE_RUNTIME, code: 'export async function runHook() { /* y */ }\n' } });
  const skillPath = 'functions/skills/azure-functions-help/SKILL.md';
  const changed = Buffer.concat([y.get(skillPath) as Buffer, Buffer.from('\nChanged at commit Y.\n')]);
  y.set(skillPath, changed);
  const manifest = (y.get('functions/files.tsv') as Buffer).toString('utf-8')
    .replace(/^(agents|claude)\t[0-9a-f]{64}\t(skills\/azure-functions-help\/SKILL\.md)\t/gm, `$1\t${sha256(changed)}\t$2\t`);
  y.set('functions/files.tsv', Buffer.from(manifest));
  starterY = writeFixture(y, join(temp, 'payload y'));
});

afterAll(() => removeDir(temp));

function workspace(name: string): string {
  counter += 1;
  const directory = join(temp, `ws ${counter} ${name}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

const X = 'a'.repeat(40);
const Y = 'b'.repeat(40);

describe.each(SHELLS)('starter bootstrap (%s)', (shell: Shell) => {
  it('applies a bundle with no developer tools on PATH and reports the fixed schema (ST-002, ST-003, ST-004)', async () => {
    const destination = workspace('fresh');
    const result = await runBootstrap(shell, starterX, { destination, agent: 'claude', commit: X, path: minimalPath(shell) });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(assertReportSchema(result.json)).toEqual([]);
    expect(result.json).toMatchObject({
      mode: 'apply', ready: true, bundle: 'functions', template: null, agent: 'claude', sourceCommit: X,
      installed: { bundleCommit: X, runtimeCommit: X },
      skills: ['azure-functions-help', 'azure-functions-setup'],
      telemetry: { preferenceEnabled: true, hooks: 'installed', hookSnippet: null },
      coexistence: 'none',
    });
    const tools = result.json.missingTools as Array<{ tool: string; command: string | null }>;
    expect(tools.map(tool => tool.tool)).toEqual(['node', 'func', 'az', 'azd']);
    const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
    if (os === 'windows') {
      expect(tools.find(tool => tool.tool === 'node')?.command).toBe('winget install --exact --id OpenJS.NodeJS.LTS');
      expect(tools.find(tool => tool.tool === 'func')?.command).toBeNull();
    }
    if (os === 'linux') expect(tools.every(tool => tool.command === null)).toBe(true);
    expect(readFileSync(join(destination, '.claude', 'skills', 'azure-functions-help', 'SKILL.md'), 'utf-8')).toContain('azure-functions-help');
    expect(JSON.parse(readFileSync(join(destination, '.claude', 'settings.json'), 'utf-8'))).toEqual(hookSnippet('claude'));
    expect(readFileSync(join(destination, '.azure-functions-skills', 'telemetry.config.json'), 'utf-8')).toContain('"enabled": true');
    expect(existsSync(join(destination, '.azure-functions-skills', 'runtime', 'telemetry.mjs'))).toBe(true);
    expect(existsSync(join(destination, '.agents'))).toBe(false);
  }, TIMEOUT);

  it.each([
    ['copilot', '.agents/skills', '.github/hooks/azure-functions-skills.json'],
    ['codex', '.agents/skills', '.codex/hooks.json'],
  ])('installs the %s layout (ST-007)', async (agent, skills, hook) => {
    const destination = workspace(agent);
    const result = await runBootstrap(shell, starterX, { destination, agent });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(existsSync(join(destination, ...skills.split('/'), 'azure-functions-help', 'SKILL.md'))).toBe(true);
    expect(JSON.parse(readFileSync(join(destination, ...hook.split('/')), 'utf-8'))).toEqual(hookSnippet(agent as 'copilot' | 'codex'));
    expect(existsSync(join(destination, '.claude'))).toBe(false);
    expect(result.json.telemetry).toMatchObject({ hooks: 'installed' });
  }, TIMEOUT);

  it('reruns safely after the payload moved, and keeps user edits (ST-016)', async () => {
    const destination = workspace('rerun');
    expect((await runBootstrap(shell, starterX, { destination, commit: X })).status).toBe(0);
    const again = await runBootstrap(shell, starterX, { destination, commit: X });
    expect(again.status).toBe(0);
    expect(again.json.files).toMatchObject({ created: 0, outdated: 0, modified: 0 });

    const edited = join(destination, '.claude', 'skills', 'azure-functions-setup', 'SKILL.md');
    writeFileSync(edited, 'my edit\n');
    const help = join(destination, '.claude', 'skills', 'azure-functions-help', 'SKILL.md');
    const helpBefore = readFileSync(help);
    const moved = await runBootstrap(shell, starterY, { destination, commit: Y });
    expect(moved.status, moved.stdout + moved.stderr).toBe(0);
    // The help skill and the runtime changed at Y; the user edited the setup skill.
    expect(moved.json.files).toMatchObject({ created: 0, outdated: 2, modified: 1 });
    expect(readFileSync(help).equals(helpBefore)).toBe(true);
    expect(readFileSync(edited, 'utf-8')).toBe('my edit\n');
    expect(moved.json.installed).toEqual({ bundleCommit: X, runtimeCommit: X });
  }, TIMEOUT);

  it('installs two bundles from different commits in either order (ST-005)', async () => {
    for (const [first, second] of [['functions', 'extras'], ['extras', 'functions']]) {
      const destination = workspace(`two ${first}`);
      const a = await runBootstrap(shell, starterX, { destination, bundle: first, commit: X });
      expect(a.status, a.stdout + a.stderr).toBe(0);
      const b = await runBootstrap(shell, starterY, { destination, bundle: second, commit: Y });
      expect(b.status, b.stdout + b.stderr).toBe(0);
      expect((b.json.files as { outdated: number }).outdated).toBe(1);
      expect(b.json.installed).toEqual({ bundleCommit: Y, runtimeCommit: X });
      expect(existsSync(join(destination, '.azure-functions-skills', 'functions.json'))).toBe(true);
      expect(existsSync(join(destination, '.azure-functions-skills', 'extras.json'))).toBe(true);
    }
  }, TIMEOUT);

  it('stops on an unrecorded differing file and writes nothing (ST-012, ST-019)', async () => {
    const destination = workspace('conflict');
    mkdirSync(join(destination, '.claude', 'skills', 'azure-functions-help'), { recursive: true });
    writeFileSync(join(destination, '.claude', 'skills', 'azure-functions-help', 'SKILL.md'), 'mine\n');
    const result = await runBootstrap(shell, starterX, { destination });
    expect(result.status).toBe(2);
    expect(result.json).toMatchObject({
      ready: false,
      error: { code: 'conflict', files: ['.claude/skills/azure-functions-help/SKILL.md'] },
    });
    expect(existsSync(join(destination, '.azure-functions-skills'))).toBe(false);
    expect(existsSync(join(destination, '.claude', 'skills', 'azure-functions-setup'))).toBe(false);
  }, TIMEOUT);

  it('rejects a corrupted payload and an unsafe manifest path before writing (ST-012)', async () => {
    const corrupted = writeFixture(buildFixture(), join(temp, `corrupted ${shell}`));
    writeFileSync(join(corrupted, 'functions', 'skills', 'azure-functions-help', 'SKILL.md'), 'tampered\n');
    const destination = workspace('corrupted');
    const result = await runBootstrap(shell, corrupted, { destination });
    expect(result.status).toBe(2);
    expect(result.json).toMatchObject({ error: { code: 'integrity-failed' } });
    expect(existsSync(join(destination, '.claude'))).toBe(false);

    const traversal = writeFixture(buildFixture(), join(temp, `traversal ${shell}`));
    const manifest = join(traversal, 'functions', 'files.tsv');
    writeFileSync(manifest, `${readFileSync(manifest, 'utf-8')}common\t${'0'.repeat(64)}\tskills/x\t../escape.txt\n`);
    const second = await runBootstrap(shell, traversal, { destination });
    expect(second.status).toBe(2);
    expect(second.json).toMatchObject({ error: { code: 'integrity-failed' } });
    expect(existsSync(join(destination, '.claude'))).toBe(false);
    expect(existsSync(join(destination, '..', 'escape.txt'))).toBe(false);
  }, TIMEOUT);

  it.skipIf(process.platform === 'win32')('refuses a symbolic link in an apply path (ST-012)', async () => {
    const destination = workspace('symlink');
    const outside = workspace('outside');
    symlinkSync(outside, join(destination, '.claude'));
    const result = await runBootstrap(shell, starterX, { destination });
    expect(result.status).toBe(2);
    expect(result.json).toMatchObject({ error: { code: 'conflict' } });
    expect(existsSync(join(outside, 'skills'))).toBe(false);
  }, TIMEOUT);

  it('leaves a user-owned settings file unchanged and reports needs-merge, then merged (ST-013)', async () => {
    for (const [agent, file] of [['claude', '.claude/settings.json'], ['codex', '.codex/hooks.json']]) {
      const destination = workspace(`merge ${agent}`);
      const settings = join(destination, ...file.split('/'));
      mkdirSync(join(settings, '..'), { recursive: true });
      writeFileSync(settings, '{ "model": "mine" }\n');
      const result = await runBootstrap(shell, starterX, { destination, agent });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(readFileSync(settings, 'utf-8')).toBe('{ "model": "mine" }\n');
      expect(result.json.telemetry).toEqual({
        preferenceEnabled: true, hooks: 'needs-merge', hookSnippet: `.azure-functions-skills/hooks/${agent}.json`,
      });
      expect(existsSync(join(destination, '.azure-functions-skills', 'hooks', `${agent}.json`))).toBe(true);
      writeFileSync(settings, readFileSync(join(destination, '.azure-functions-skills', 'hooks', `${agent}.json`)));
      writeFileSync(settings, `${readFileSync(settings, 'utf-8').replace('{', '{ "model": "mine",')}`);
      const check = await runBootstrap(shell, starterX, { destination, agent, check: true });
      expect(check.status).toBe(0);
      expect((check.json.telemetry as { hooks: string }).hooks).toBe('merged');
    }
  }, TIMEOUT);

  it('reports plugin-style workspace assets (ST-018)', async () => {
    const destination = workspace('coexist');
    mkdirSync(join(destination, '.github', 'skills', 'azure-functions-help'), { recursive: true });
    const result = await runBootstrap(shell, starterX, { destination });
    expect(result.status).toBe(0);
    expect(result.json.coexistence).toBe('workspace');
  }, TIMEOUT);

  it('keeps existing preferences and never fails setup over telemetry (ST-010)', async () => {
    const enabled = workspace('pref enabled');
    mkdirSync(join(enabled, '.azure-functions-skills'));
    writeFileSync(join(enabled, '.azure-functions-skills', 'telemetry.config.json'), '{"enabled": true}');
    const flagged = await runBootstrap(shell, starterX, { destination: enabled, noTelemetry: true });
    expect(flagged.status).toBe(0);
    expect(flagged.json.telemetry).toMatchObject({ preferenceEnabled: true });
    expect(readFileSync(join(enabled, '.azure-functions-skills', 'telemetry.config.json'), 'utf-8')).toBe('{"enabled": true}');

    const invalid = workspace('pref invalid');
    mkdirSync(join(invalid, '.azure-functions-skills'));
    writeFileSync(join(invalid, '.azure-functions-skills', 'telemetry.config.json'), '{broken');
    const result = await runBootstrap(shell, starterX, { destination: invalid });
    expect(result.status).toBe(0);
    expect(result.json.telemetry).toEqual({ preferenceEnabled: false, hooks: 'absent', hookSnippet: null });
    expect(existsSync(join(invalid, '.claude', 'settings.json'))).toBe(false);

    const off = workspace('pref off');
    const disabled = await runBootstrap(shell, starterX, { destination: off, noTelemetry: true });
    expect(disabled.status).toBe(0);
    expect(disabled.json.telemetry).toEqual({ preferenceEnabled: false, hooks: 'absent', hookSnippet: null });
    expect(readFileSync(join(off, '.azure-functions-skills', 'telemetry.config.json'), 'utf-8')).toContain('"enabled": false');
  }, TIMEOUT);

  it('decides the setup event only after every opt-out (ST-010)', async () => {
    const decide = async (name: string, options: { env?: NodeJS.ProcessEnv; noTelemetry?: boolean; parentOptOut?: string } = {}): Promise<string> => {
      const parent = workspace(name);
      if (options.parentOptOut) {
        mkdirSync(join(parent, '.claude', 'hooks'), { recursive: true });
        writeFileSync(join(parent, '.claude', 'hooks', 'telemetry.config.json'), options.parentOptOut);
      }
      const resultFile = join(parent, 'result.txt');
      const result = await runBootstrap(shell, starterX, {
        destination: join(parent, 'app'), resultFile, env: options.env, noTelemetry: options.noTelemetry,
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      return readFileSync(resultFile, 'utf-8');
    };
    expect(await decide('send')).toMatch(/^send=1$/m);
    expect(await decide('flag', { noTelemetry: true })).toMatch(/^send=0$/m);
    expect(await decide('env1', { env: { AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY: 'FaLsE' } })).toMatch(/^send=0$/m);
    expect(await decide('env2', { env: { AZURE_MCP_COLLECT_TELEMETRY: 'false' } })).toMatch(/^send=0$/m);
    expect(await decide('ancestor', { parentOptOut: '{"enabled": false}' })).toMatch(/^send=0$/m);
    expect(await decide('ancestor invalid', { parentOptOut: '{broken' })).toMatch(/^send=0$/m);
  }, TIMEOUT);

  // Windows CI showed send=0 now and then: re-reading the preference file this run had just
  // written failed (a transient read failure, for example while a scanner holds the new file).
  it.runIf(shell === 'sh')('does not re-read the preference file it just wrote to decide the setup event (ST-010)', async () => {
    const parent = workspace('fresh preference');
    const shim = join(parent, 'shim');
    mkdirSync(shim);
    writeFileSync(join(shim, 'awk'), [
      '#!/bin/sh',
      'for argument in "$@"; do',
      '  case "$argument" in */app/.azure-functions-skills/telemetry.config.json) exit 2 ;; esac',
      'done',
      'exec /usr/bin/awk "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    const resultFile = join(parent, 'result.txt');
    const result = await runBootstrap(shell, starterX, {
      destination: join(parent, 'app'), resultFile, path: [shim, process.env.PATH ?? process.env.Path ?? ''].join(delimiter),
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(resultFile, 'utf-8')).toMatch(/^send=1$/m);
  }, TIMEOUT);

  it('checks without writing and fails on unknown arguments (ST-003, ST-019)', async () => {
    const destination = workspace('check');
    const check = await runBootstrap(shell, starterX, { destination, check: true });
    expect(check.status).toBe(1);
    expect(check.json).toMatchObject({ mode: 'check', ready: false, telemetry: { hooks: 'absent' } });
    expect(existsSync(join(destination, '.claude'))).toBe(false);
    const unknown = await runBootstrap(shell, starterX, { destination, bundle: 'missing' });
    expect(unknown.status).toBe(2);
    expect(unknown.json).toMatchObject({ error: { code: 'invalid-argument' } });
  }, TIMEOUT);
});
