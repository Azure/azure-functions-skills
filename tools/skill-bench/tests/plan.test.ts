import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { put, removeDirectory, skillFile, temporaryDirectory, writeProject, minimalEval } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { selectCells } from '../src/plan.ts';

let root: string;
beforeEach(() => {
  root = temporaryDirectory('skill-bench-plan-');
  put(root, 'skills/beta/SKILL.md', skillFile('beta'));
  put(root, 'bench/evals/beta-one/eval.yaml', minimalEval('beta-one'));
});
afterEach(() => removeDirectory(root));

const config = () => loadConfig(writeProject(root, { skills: {
  alpha: { skillDir: '../skills/alpha', evals: ['evals/basic/eval.yaml'] },
  beta: { skillDir: '../skills/beta', evals: ['evals/beta-one/eval.yaml'] },
} }));

describe('selectCells', () => {
  it('pairs OFF and ON for every model, eval and skill', () => {
    const cells = selectCells(config(), { all: true });
    expect(cells).toHaveLength(2 * 3 * 2);
    expect(cells.slice(0, 2).map(cell => cell.variant)).toEqual(['skill=off,model=model-a', 'skill=on,model=model-a']);
    expect(cells.map(cell => cell.index)).toEqual(cells.map((_, index) => index));
    expect(new Set(cells.map(cell => cell.id)).size).toBe(cells.length);
    expect(cells[0]).toMatchObject({ skill: 'alpha', scenario: 'basic', model: 'model-a', arm: 'off',
      evalId: 'evals/alpha/basic/eval.yaml' });
  });

  it('selects a skill and a tier or explicit models', () => {
    expect(selectCells(config(), { skills: ['beta'], tier: 'slow' }).map(cell => `${cell.skill}:${cell.model}:${cell.arm}`))
      .toEqual(['beta:model-b:off', 'beta:model-b:on', 'beta:model-c:off', 'beta:model-c:on']);
    expect(selectCells(config(), { all: true, models: ['model-c'] })).toHaveLength(4);
  });

  it('requires exactly one of --all or --skill and at most one of --tier or --model', () => {
    expect(() => selectCells(config(), {})).toThrow(/--all or --skill/);
    expect(() => selectCells(config(), { all: true, skills: ['alpha'] })).toThrow(/--all or --skill/);
    expect(() => selectCells(config(), { all: true, tier: 'fast', models: ['model-a'] })).toThrow(/--tier or --model/);
  });

  it('rejects unknown skills, tiers and models with the registered choices', () => {
    expect(() => selectCells(config(), { skills: ['gamma'] })).toThrow(/alpha, beta/);
    expect(() => selectCells(config(), { all: true, tier: 'medium' })).toThrow(/fast, slow/);
    expect(() => selectCells(config(), { all: true, models: ['model-z'] })).toThrow(/model-a/);
  });
});
