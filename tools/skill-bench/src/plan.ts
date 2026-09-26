import type { BenchConfig } from './config.ts';

export type Arm = 'off' | 'on';

export interface Selection {
  all?: boolean;
  skills?: string[];
  tier?: string;
  models?: string[];
}

export interface Cell {
  index: number;
  id: string;
  skill: string;
  scenario: string;
  evalId: string;
  evalFile: string;
  model: string;
  arm: Arm;
  variant: string;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`skill-bench plan: ${message}`);
}

export function selectModels(config: BenchConfig, selection: Selection): string[] {
  check(selection.tier === undefined || selection.models === undefined,
    'use at most one of --tier or --model; a tier is already a named model subset.');
  if (selection.tier !== undefined) {
    check(Object.hasOwn(config.tiers, selection.tier),
      `unknown --tier "${selection.tier}"; registered tiers: ${Object.keys(config.tiers).join(', ') || '(none)'}.`);
    return config.models.filter(model => config.tiers[selection.tier as string].includes(model));
  }
  if (selection.models !== undefined) {
    check(selection.models.length > 0 && new Set(selection.models).size === selection.models.length,
      '--model values must be unique.');
    for (const model of selection.models) {
      check(config.models.includes(model), `unknown --model "${model}"; registered models: ${config.models.join(', ')}.`);
    }
    return config.models.filter(model => selection.models?.includes(model));
  }
  return [...config.models];
}

export function selectSkills(config: BenchConfig, selection: Selection): string[] {
  const registered = Object.keys(config.skills);
  const named = selection.skills ?? [];
  check(Boolean(selection.all) !== (named.length > 0), 'use exactly one of --all or --skill <name>.');
  if (selection.all) return registered;
  check(new Set(named).size === named.length, '--skill values must be unique.');
  for (const skill of named) {
    check(registered.includes(skill), `unknown --skill "${skill}"; registered skills: ${registered.join(', ')}.`);
  }
  return registered.filter(skill => named.includes(skill));
}

export function selectCells(config: BenchConfig, selection: Selection): Cell[] {
  const skills = selectSkills(config, selection);
  const models = selectModels(config, selection);
  const cells: Cell[] = [];
  for (const skill of skills) {
    for (const evaluation of config.skills[skill].evals) {
      // OFF and ON for one model run next to each other to limit service drift between arms.
      for (const model of models) {
        for (const arm of ['off', 'on'] as const) {
          const variant = `skill=${arm},model=${model}`;
          cells.push({
            index: cells.length, id: `${skill}/${evaluation.scenario}/${arm}/${model}`, skill,
            scenario: evaluation.scenario, evalId: evaluation.id, evalFile: evaluation.file, model, arm, variant,
          });
        }
      }
    }
  }
  return cells;
}
