import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import { removeRunRoot, runBench } from '../src/run.ts';
import { main } from '../src/cli.ts';
import type { RunDependencies } from '../src/run.ts';
import { put, removeDirectory, temporaryDirectory, writeProject } from './helpers.ts';

let root: string;
let runRoot: string;
let outParent: string;
beforeEach(() => {
  root = temporaryDirectory('skill-bench-run-src-');
  runRoot = temporaryDirectory('skill-bench-run-root-');
  outParent = temporaryDirectory('skill-bench-run-out-');
});
afterEach(() => {
  for (const directory of [root, runRoot, outParent]) removeDirectory(directory);
});

interface Call { args: string[]; options: SpawnSyncOptions }

type Behavior = 'results' | 'none' | 'crash';

function fakeVally(calls: Call[], behavior: (call: Call) => Behavior = () => 'results'): RunDependencies {
  const cli = put(root, 'fake-vally/dist/index.js', '');
  put(root, 'fake-vally/package.json', JSON.stringify({ version: '0.16.0' }));
  return {
    vallyCli: cli,
    ancestorCheck: () => {},
    log: () => {},
    spawn: (_command, args, options) => {
      const call = { args, options };
      calls.push(call);
      const value = (flag: string) => args[args.indexOf(flag) + 1];
      const kind = behavior(call);
      const status = kind === 'crash' ? null : 0;
      if (kind === 'results') {
        put(value('--output-dir'), '20250101T000000/results.jsonl', JSON.stringify({ type: 'trial-result' }) + '\n');
        put(value('--workspace'), 'local.settings.json', JSON.stringify({ Values: { Secret: 'hidden' } }));
      }
      return { status, signal: null, pid: 1, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } as SpawnSyncReturns<Buffer>;
    },
  };
}

const paidEnv = { COPILOT_GITHUB_TOKEN: 'token-value', PATH: process.env.PATH ?? '' };

describe('runBench dry-run', () => {
  it('stages, verifies and validates without a model call, then removes the staged root', async () => {
    const calls: Call[] = [];
    const result = await runBench({
      config: writeProject(root), selection: { all: true }, dryRun: true, runRoot, trusted: true,
    }, {}, fakeVally(calls));
    expect(result).toMatchObject({ exitCode: 0, dryRun: true });
    expect(result.cells.map(cell => cell.id)).toEqual([
      'alpha/basic/off/model-a', 'alpha/basic/on/model-a', 'alpha/basic/off/model-b',
      'alpha/basic/on/model-b', 'alpha/basic/off/model-c', 'alpha/basic/on/model-c',
    ]);
    expect(calls).toHaveLength(0);
    expect(readdirSync(runRoot)).toEqual([]);
  });

  it('requires --trusted and --run-root', async () => {
    const config = writeProject(root);
    await expect(runBench({ config, selection: { all: true }, dryRun: true, runRoot }, {}, fakeVally([])))
      .rejects.toThrow(/--trusted/);
    await expect(runBench({ config, selection: { all: true }, dryRun: true, trusted: true }, {}, fakeVally([])))
      .rejects.toThrow(/--run-root/);
  });

  it('reports an invalid eval specification before any model call', async () => {
    const config = writeProject(root);
    put(root, 'bench/evals/basic/eval.yaml', readFileSync(join(root, 'bench/evals/basic/eval.yaml'), 'utf8')
      .replace('type: completed', 'type: not-a-grader'));
    await expect(runBench({ config, selection: { all: true }, dryRun: true, runRoot, trusted: true }, {}, fakeVally([])))
      .rejects.toThrow(/validation failed/);
    expect(readdirSync(runRoot)).toEqual([]);
  });

  it('calls preflight validate and prepareCell, but not run', async () => {
    put(root, 'bench/plugins/probe.ts', `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const preflight = {
  name: 'probe',
  validate(options) { if (options.value !== 1) throw new Error('bad options'); },
  prepareCell(context) { writeFileSync(join(context.appData, 'probe.txt'), 'x'); },
  run() { throw new Error('run must not be called in a dry-run'); },
};
`);
    const config = writeProject(root, {
      skills: { alpha: { skillDir: '../skills/alpha', evals: ['evals/basic/eval.yaml'],
        plugins: { preflight: [{ module: 'plugins/probe.ts', options: { value: 1 } }] } } },
    });
    const result = await runBench({ config, selection: { all: true }, dryRun: true, runRoot, trusted: true }, {}, fakeVally([]));
    expect(result.exitCode).toBe(0);
    const bad = writeProject(root, {
      skills: { alpha: { skillDir: '../skills/alpha', evals: ['evals/basic/eval.yaml'],
        plugins: { preflight: [{ module: 'plugins/probe.ts', options: { value: 2 } }] } } },
    });
    await expect(runBench({ config: bad, selection: { all: true }, dryRun: true, runRoot, trusted: true }, {}, fakeVally([])))
      .rejects.toThrow(/bad options/);
  });
});

describe('runBench paid run', () => {
  it('refuses pull request events, a missing token and an existing output', async () => {
    const config = writeProject(root);
    const base = { config, selection: { all: true }, dryRun: false, runRoot, trusted: true, output: join(outParent, 'out') };
    await expect(runBench(base, { ...paidEnv, GITHUB_EVENT_NAME: 'pull_request_target' }, fakeVally([])))
      .rejects.toThrow(/pull request/);
    await expect(runBench(base, {}, fakeVally([]))).rejects.toThrow(/COPILOT_GITHUB_TOKEN/);
    mkdirSync(join(outParent, 'out'));
    await expect(runBench(base, paidEnv, fakeVally([]))).rejects.toThrow(/new directory/);
    await expect(runBench({ ...base, output: join(root, 'bench', 'out') }, paidEnv, fakeVally([]))).rejects.toThrow(/overlap/);
  });

  it('runs one isolated Vally process per cell and records results and redacted snapshots', async () => {
    const calls: Call[] = [];
    const output = join(outParent, 'out');
    const result = await runBench({
      config: writeProject(root), selection: { all: true, models: ['model-a'] }, dryRun: false, runRoot, trusted: true, output,
    }, { ...paidEnv, AZURE_CLIENT_SECRET: 'never' }, fakeVally(calls));
    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.args).toEqual(expect.arrayContaining(['eval', '--runs', '1', '--workers', '1', '--max-retries', '0', '--timeout', '10m']));
      const env = call.options.env as Record<string, string>;
      expect(env.COPILOT_GITHUB_TOKEN).toBe('token-value');
      expect(env.AZURE_CLIENT_SECRET).toBeUndefined();
      expect(call.options.shell).toBe(false);
    }
    const manifest = JSON.parse(readFileSync(join(output, 'matrix-manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ type: 'skill-bench-matrix', version: 1, vallyVersion: '0.16.0', title: 'Test bench' });
    expect(manifest.cells.map((cell: { enabled: boolean }) => cell.enabled)).toEqual([false, true]);
    expect(manifest.cells[0].results).toBe('skill=off,model=model-a/alpha/basic/20250101T000000/results.jsonl');
    expect(manifest.cells[0].prompts['alpha-basic-stimulus']).toContain('Say hello.');
    const snapshot = readFileSync(join(output, manifest.cells[1].workspace, 'local.settings.redacted.json'), 'utf8');
    expect(snapshot).not.toContain('hidden');
    expect(readdirSync(runRoot)).toEqual([]);
  });

  it('keeps a missing result missing and returns a harness failure', async () => {
    const output = join(outParent, 'out');
    let count = 0;
    const result = await runBench({
      config: writeProject(root), selection: { all: true, models: ['model-a'] }, dryRun: false, runRoot, trusted: true, output,
    }, paidEnv, fakeVally([], () => (count++ === 0 ? 'none' : 'results')));
    expect(result.exitCode).toBe(2);
    const manifest = JSON.parse(readFileSync(join(output, 'matrix-manifest.json'), 'utf8'));
    expect(manifest.cells[0].results).toBeNull();
    expect(manifest.cells[1].results).not.toBeNull();
  });

  it('stops after a crashed cell and keeps the partial manifest', async () => {
    const output = join(outParent, 'out');
    const calls: Call[] = [];
    await expect(runBench({
      config: writeProject(root), selection: { all: true, models: ['model-a'] }, dryRun: false, runRoot, trusted: true, output,
    }, paidEnv, fakeVally(calls, () => 'crash'))).rejects.toThrow(/did not complete/);
    expect(calls).toHaveLength(1);
    const manifest = JSON.parse(readFileSync(join(output, 'matrix-manifest.json'), 'utf8'));
    expect(manifest.cells.map((cell: { results: unknown }) => cell.results)).toEqual([null, null]);
    expect(existsSync(runRoot) && readdirSync(runRoot)).toEqual([]);
  });
});

const busy = (code: string) => Object.assign(new Error(`${code}: resource busy`), { code });

describe('removeRunRoot', () => {
  it('retries a transient Windows lock with backoff, then succeeds', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const failure = await removeRunRoot('R', {
      remove: () => { if (++attempts < 3) throw busy(attempts === 1 ? 'EPERM' : 'EBUSY'); },
      sleep: async ms => { delays.push(ms); },
    });
    expect(failure).toBeNull();
    expect(attempts).toBe(3);
    expect(delays).toEqual([250, 500]);
  });

  it('returns the error after the last attempt and does not retry other errors', async () => {
    let attempts = 0;
    const failure = await removeRunRoot('R', { remove: () => { attempts++; throw busy('ENOTEMPTY'); }, sleep: async () => {} });
    expect(failure).toMatch(/ENOTEMPTY/);
    expect(attempts).toBe(6);
    attempts = 0;
    expect(await removeRunRoot('R', { remove: () => { attempts++; throw busy('EINVAL'); }, sleep: async () => {} }))
      .toMatch(/EINVAL/);
    expect(attempts).toBe(1);
  });
});

describe('runBench cleanup and teardown', () => {
  const locked = (base: RunDependencies, logs: string[]): RunDependencies => ({
    ...base, log: message => logs.push(message), sleep: async () => {},
    remove: () => { throw busy('EPERM'); },
  });

  it('keeps results and the exit code when the staged root stays locked, and records it', async () => {
    const output = join(outParent, 'out');
    const logs: string[] = [];
    const result = await runBench({
      config: writeProject(root), selection: { all: true, models: ['model-a'] }, dryRun: false, runRoot, trusted: true, output,
    }, paidEnv, locked(fakeVally([]), logs));
    expect(result.exitCode).toBe(0);
    expect(result.cleanup).toMatchObject({ removed: false, error: expect.stringMatching(/EPERM/) });
    const left = result.cleanup?.path ?? '';
    expect(left.startsWith(runRoot)).toBe(true);
    expect(logs.join('\n')).toContain(`Warning: cannot remove the staged run root ${left}`);
    const manifest = JSON.parse(readFileSync(join(output, 'matrix-manifest.json'), 'utf8'));
    expect(manifest.cleanup).toEqual({ removed: false, path: left, error: result.cleanup?.error });
    expect(manifest.cells.every((cell: { results: unknown }) => cell.results !== null)).toBe(true);
  });

  it('still writes the dashboard with --site when cleanup fails', async () => {
    const out: string[] = [];
    const base = fakeVally([]);
    const dependencies: RunDependencies = { ...locked(base, out), spawn: (command, args, options) => {
      const result = base.spawn(command, args, options);
      const value = (flag: string) => args[args.indexOf(flag) + 1];
      const model = value('--model');
      put(value('--output-dir'), '20250101T000000/results.jsonl', JSON.stringify({
        type: 'trial-result', itemId: `item-${value('--output-dir')}`, evalName: 'alpha-basic',
        evalFilePath: value('--eval-spec'), variant: 'main', stimulus: 'alpha-basic-stimulus', model, trialIndex: 0, totalTrials: 1,
        status: 'success', durationMs: 1,
        gradeResult: { passed: true, score: 1, details: [] },
      }) + '\n');
      return result;
    } };
    const site = join(outParent, 'site');
    const code = await main(['run', '--config', writeProject(root), '--all', '--model', 'model-a', '--trusted',
      '--run-root', runRoot, '--output', join(outParent, 'out'), '--site', site],
    { out: text => out.push(text), err: text => out.push(text) }, paidEnv, dependencies);
    expect(code).toBe(0);
    expect(existsSync(join(site, 'index.html'))).toBe(true);
    expect(out.join('\n')).toMatch(/Warning: cannot remove the staged run root/);
  });

  it('calls each plugin teardownCell after every cell and after the preflight run', async () => {
    put(root, 'bench/plugins/probe.ts', `import { appendFileSync } from 'node:fs';
export const preflight = {
  name: 'probe',
  run() {},
  teardownCell(context) {
    appendFileSync(context.options.log, [context.workspace ? 'cell' : 'preflight', typeof context.env.PATH,
      context.env.COPILOT_GITHUB_TOKEN ?? 'no-token'].join(' ') + '\\n');
    if (context.workspace) throw new Error('teardown failure is only a warning');
  },
};
`);
    const log = join(outParent, 'teardown.log');
    const config = writeProject(root, {
      skills: { alpha: { skillDir: '../skills/alpha', evals: ['evals/basic/eval.yaml'],
        plugins: { preflight: [{ module: 'plugins/probe.ts', options: { log } }] } } },
    });
    const logs: string[] = [];
    const result = await runBench({ config, selection: { all: true, models: ['model-a'] }, dryRun: false, runRoot,
      trusted: true, output: join(outParent, 'out') }, paidEnv, { ...fakeVally([]), log: message => logs.push(message) });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(log, 'utf8').trim().split(/\r?\n/)).toEqual([
      'preflight string no-token', 'cell string token-value', 'cell string token-value']);
    expect(logs.join('\n')).toMatch(/Warning: teardown probe for alpha\/basic\/off\/model-a failed: teardown failure/);
  });

  it('does not call teardownCell in a dry-run', async () => {
    put(root, 'bench/plugins/probe.ts', `export const preflight = {
  name: 'probe', teardownCell() { throw new Error('no teardown in a dry-run'); },
};
`);
    const config = writeProject(root, {
      skills: { alpha: { skillDir: '../skills/alpha', evals: ['evals/basic/eval.yaml'],
        plugins: { preflight: [{ module: 'plugins/probe.ts', options: {} }] } } },
    });
    const logs: string[] = [];
    await runBench({ config, selection: { all: true }, dryRun: true, runRoot, trusted: true }, {},
      { ...fakeVally([]), log: message => logs.push(message) });
    expect(logs.join('\n')).not.toMatch(/teardown/);
  });
});
