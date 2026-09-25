import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { selectCells } from '../src/plan.ts';
import { assertCleanAncestors, copyTree, stageRun, verifyStagedRun } from '../src/stage.ts';
import { put, removeDirectory, temporaryDirectory, writeProject } from './helpers.ts';

let root: string;
let runRoot: string;
const noAncestorCheck = () => {};
beforeEach(() => {
  root = temporaryDirectory('skill-bench-stage-');
  runRoot = temporaryDirectory('skill-bench-run-');
});
afterEach(() => {
  removeDirectory(root);
  removeDirectory(runRoot);
});

const config = () => loadConfig(writeProject(root, { sharedSkills: { helper: { skillDir: '../skills/helper' } } }));

describe('stageRun', () => {
  it('gives OFF only shared skills and ON only shared plus the target, then verifies it', async () => {
    const bench = config();
    const cells = selectCells(bench, { all: true, models: ['model-a'] });
    const run = await stageRun(bench, cells, runRoot, noAncestorCheck);
    const [off, on] = run.cells;
    expect(off.skills.map(path => basename(path))).toEqual(['helper']);
    expect(on.skills.map(path => basename(path))).toEqual(['helper', 'alpha']);
    const spec = JSON.parse(readFileSync(on.specFile, 'utf8'));
    expect(spec.defaults).toMatchObject({ model: 'model-a', runs: 1, timeout: '10m' });
    expect(spec.agent_environment.skills).toEqual(on.skills);
    expect(spec.agent_environment.env.COPILOT_HOME_SETTINGS_JSON).toBe('{"disabledSkills":["unrelated-skill"]}');
    expect(spec.stimuli[0].agent_environment.skills).toEqual(on.skills);
    expect(spec.stimuli[0].constraints.max_duration).toBe('10m');
    expect(existsSync(join(run.inputs, 'skills', 'alpha', 'references', 'notes.md'))).toBe(true);
    expect(existsSync(join(run.inputs, 'evals', 'alpha', 'basic', 'fixtures', 'app.txt'))).toBe(true);
    expect(off.root).not.toBe(on.root);
    expect(existsSync(join(off.root, 'home'))).toBe(true);
    expect(off.evalHash).toBe(on.evalHash);
    expect(off.prompts).toEqual({ 'alpha-basic-stimulus': 'Say hello.\n' });
    expect(() => verifyStagedRun(run, bench)).not.toThrow();
  });

  it('detects a measured skill in the OFF arm', async () => {
    const bench = config();
    const run = await stageRun(bench, selectCells(bench, { all: true, models: ['model-a'] }), runRoot, noAncestorCheck);
    const off = run.cells[0];
    const spec = JSON.parse(readFileSync(off.specFile, 'utf8'));
    spec.stimuli[0].agent_environment.skills = [...off.skills, join(run.inputs, 'skills', 'alpha')].sort();
    writeFileSync(off.specFile, JSON.stringify(spec));
    expect(() => verifyStagedRun(run, bench)).toThrow(/OFF contract/);
  });

  it('detects a skill directory in an isolated home', async () => {
    const bench = config();
    const run = await stageRun(bench, selectCells(bench, { all: true, models: ['model-a'] }), runRoot, noAncestorCheck);
    mkdirSync(join(run.cells[1].root, 'home', '.copilot', 'skills'), { recursive: true });
    expect(() => verifyStagedRun(run, bench)).toThrow(/discoverable skill directory/);
  });

  it('refuses a run root inside the configuration directory', async () => {
    const bench = config();
    await expect(stageRun(bench, selectCells(bench, { all: true }), join(root, 'bench'), noAncestorCheck))
      .rejects.toThrow(/overlap/);
  });
});

describe('copyTree', () => {
  it('refuses symbolic links and oversized inputs', () => {
    const source = join(root, 'source');
    put(source, 'a.txt', 'a');
    symlinkSync(join(root, 'skills'), join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => copyTree(source, join(root, 'out1'))).toThrow(/symbolic link/);
    removeDirectory(join(source, 'linked'));
    put(source, 'big.txt', 'x'.repeat(20));
    expect(() => copyTree(source, join(root, 'out2'), undefined, { fileBytes: 10, totalBytes: 100, entries: 10 })).toThrow(/exceeds/);
  });
});

describe('assertCleanAncestors', () => {
  it('rejects a run root below a repository or agent configuration', () => {
    put(root, 'repo/.git/HEAD', 'ref');
    mkdirSync(join(root, 'repo', 'nested'));
    expect(() => assertCleanAncestors(join(root, 'repo', 'nested'))).toThrow(/discovery file/);
  });
});
