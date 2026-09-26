import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.ts';
import { removeDirectory, temporaryDirectory, writeProject } from './helpers.ts';

let root: string;
let runRoot: string;
beforeEach(() => {
  root = temporaryDirectory('skill-bench-cli-');
  runRoot = temporaryDirectory('skill-bench-cli-run-');
});
afterEach(() => {
  removeDirectory(root);
  removeDirectory(runRoot);
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) }, out, err };
}

const dependencies = {
  spawn: () => { throw new Error('no model call is permitted in this test'); },
  vallyCli: 'unused', ancestorCheck: () => {}, log: () => {},
};

describe('skill-bench CLI', () => {
  it('prints the plan for a tier', async () => {
    const c = capture();
    expect(await main(['plan', '--config', writeProject(root), '--all', '--tier', 'fast'], c.io)).toBe(0);
    expect(c.out).toEqual(['alpha/basic/off/model-a', 'alpha/basic/on/model-a', '2 cells.']);
  });

  it('prints the plan as JSON', async () => {
    const c = capture();
    expect(await main(['plan', '--config', writeProject(root), '--skill', 'alpha', '--model', 'model-b', '--json'], c.io)).toBe(0);
    expect(JSON.parse(c.out[0])).toEqual([
      { id: 'alpha/basic/off/model-b', skill: 'alpha', scenario: 'basic', model: 'model-b', arm: 'off', evalId: 'evals/alpha/basic/eval.yaml' },
      { id: 'alpha/basic/on/model-b', skill: 'alpha', scenario: 'basic', model: 'model-b', arm: 'on', evalId: 'evals/alpha/basic/eval.yaml' },
    ]);
  });

  it('runs a dry-run with no model call', async () => {
    const c = capture();
    const code = await main(['dry-run', '--config', writeProject(root), '--all', '--model', 'model-a', '--trusted', '--run-root', runRoot],
      c.io, {}, dependencies);
    expect(c.err).toEqual([]);
    expect(code).toBe(0);
    expect(c.out[0]).toMatch(/No model was called/);
  });

  it.each([
    [['frobnicate'], /unknown command/],
    [['plan'], /--config/],
    [['plan', '--config', 'x.json', '--bad'], /Unknown option/],
    [['report', '--input', 'x'], /--output/],
    [['dry-run', '--config', 'CONFIG', '--all', '--trusted', '--run-root', 'RUN', '--site', 'x'], /--site is only for run/],
  ])('gives an actionable error for %j', async (args, message) => {
    const c = capture();
    const argv = args.map(arg => arg === 'CONFIG' ? writeProject(root) : arg === 'RUN' ? runRoot : arg);
    expect(await main(argv, c.io, {}, dependencies)).toBe(1);
    expect(c.err.join('\n')).toMatch(message);
  });

  it('shows help', async () => {
    const c = capture();
    expect(await main(['--help'], c.io)).toBe(0);
    expect(c.out[0]).toContain('Usage: skill-bench');
    expect(await main([], capture().io)).toBe(1);
  });

  it('runs from the bin file with Node type stripping', () => {
    const bin = fileURLToPath(new URL('../bin/skill-bench.js', import.meta.url));
    const result = spawnSync(process.execPath, [bin, 'plan', '--config', writeProject(root), '--all', '--tier', 'fast'], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 cells.');
  });
});
