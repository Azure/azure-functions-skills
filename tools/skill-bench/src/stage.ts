import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { loadEvalSpec } from '@microsoft/vally';
import type { EnvironmentConfig, RawEvalSchema } from '@microsoft/vally';
import { isInside } from './config.ts';
import type { BenchConfig } from './config.ts';
import { createCellDirectories } from './env.ts';
import type { Cell } from './plan.ts';

export interface StagedCell extends Cell {
  root: string;
  workspace: string;
  specFile: string;
  /** Absolute staged skill directories given to the agent in this cell. */
  skills: string[];
  sharedSkills: string[];
  evalName: string;
  stimuli: string[];
  prompts: Record<string, string>;
  evalHash: string;
  configHash: string;
}

export interface StagedRun {
  root: string;
  inputs: string;
  settings: string;
  cells: StagedCell[];
}

export interface CopyLimits {
  fileBytes: number;
  totalBytes: number;
  entries: number;
}

export const defaultLimits: CopyLimits = { fileBytes: 2_000_000, totalBytes: 20_000_000, entries: 2_000 };
const discoveryMarkers = ['.git', 'AGENTS.md', 'CLAUDE.md', '.github', '.agents', '.claude', '.copilot', '.vally.yaml', '.vally.yml'];
const homeSkillDirectories = [['home', '.copilot', 'skills'], ['home', '.claude', 'skills'], ['home', '.agents', 'skills'],
  ['home', '.config', 'copilot', 'skills'], ['config', 'skills']];

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`skill-bench stage: ${message}`);
}

export function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** A content hash of a staged tree. It uses relative paths, so the run root does not change it. */
export function treeHash(directory: string): string {
  const digest = createHash('sha256');
  const visit = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        digest.update(`dir ${path}\0`);
        visit(join(current, entry.name), path);
      } else {
        digest.update(`file ${path}\0`).update(readFileSync(join(current, entry.name))).update('\0');
      }
    }
  };
  visit(directory, '');
  return digest.digest('hex').slice(0, 16);
}

function pluginHash(config: BenchConfig, skill: string): string {
  const definition = config.skills[skill];
  const file = (path: string) => ({ module: relative(config.baseDir, path).replaceAll('\\', '/'), content: hash(readFileSync(path, 'utf8')) });
  return hash(JSON.stringify({
    graders: definition.graders.map(file), executors: definition.executors.map(file),
    preflight: definition.preflight.map(item => ({ ...file(item.module), options: item.options })),
  }));
}

/** Agents discover instructions and skills from ancestors, so a run root must have none. */
export function assertCleanAncestors(directory: string): void {
  for (let current = directory; ; current = dirname(current)) {
    for (const marker of discoveryMarkers) {
      check(!lstatSync(join(current, marker), { throwIfNoEntry: false }),
        `discovery file at ${join(current, marker)}; choose a clean --run-root outside any repository.`);
    }
    if (dirname(current) === current) break;
  }
}

/** Copy a trusted tree. Links are refused, never followed; size limits stop runaway inputs. */
export function copyTree(source: string, destination: string, files?: string[], limits = defaultLimits): void {
  let entries = 0;
  let total = 0;
  const copyFile = (from: string, to: string, label: string) => {
    const stat = lstatSync(from);
    check(!stat.isSymbolicLink(), `refusing a symbolic link in the inputs: ${label}.`);
    check(stat.isFile(), `unsupported input entry: ${label}.`);
    check(stat.size <= limits.fileBytes, `input file exceeds ${limits.fileBytes} bytes: ${label}.`);
    total += stat.size;
    check(total <= limits.totalBytes, `inputs exceed ${limits.totalBytes} bytes below ${source}.`);
    check(++entries <= limits.entries, `inputs exceed ${limits.entries} entries below ${source}.`);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  };
  if (files) {
    for (const file of files) {
      let current = source;
      for (const part of file.split('/')) {
        current = join(current, part);
        check(!lstatSync(current).isSymbolicLink(), `refusing a symbolic link in the inputs: ${file}.`);
      }
      copyFile(current, join(destination, ...file.split('/')), file);
    }
    return;
  }
  const visit = (from: string, to: string, prefix: string) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const label = prefix ? `${prefix}/${entry.name}` : entry.name;
      check(!entry.isSymbolicLink(), `refusing a symbolic link in the inputs: ${label}.`);
      if (entry.isDirectory()) {
        check(++entries <= limits.entries, `inputs exceed ${limits.entries} entries below ${source}.`);
        visit(join(from, entry.name), join(to, entry.name), label);
      } else {
        copyFile(join(from, entry.name), join(to, entry.name), label);
      }
    }
  };
  visit(source, destination, '');
}

function environment(value: string | EnvironmentConfig | undefined, skills: string[], settings: string): EnvironmentConfig {
  check(typeof value !== 'string', 'use an inline agent environment in the eval, not a named environment.');
  return { ...value, skills, env: { ...value?.env, COPILOT_HOME_SETTINGS_JSON: settings } };
}

// Vally reads `agent_environment`; the loader exposes it as `environment`.
function serializedSpec(spec: RawEvalSchema): string {
  const { environment: env, agent_environment: _alias, stimuli, ...rest } = spec;
  return JSON.stringify({
    ...rest, agent_environment: env,
    stimuli: stimuli.map(({ environment: stimulusEnv, agent_environment: _nested, ...stimulus }) =>
      ({ ...stimulus, agent_environment: stimulusEnv })),
  }, null, 2);
}

export function settingsJson(config: BenchConfig): string {
  return JSON.stringify({ disabledSkills: config.disabledSkills });
}

// Tests replace the ancestor check because system temporary folders sit below a user profile.
export async function stageRun(config: BenchConfig, cells: Cell[], runParent: string,
  ancestorCheck: (directory: string) => void = assertCleanAncestors): Promise<StagedRun> {
  check(cells.length > 0, 'no cells are selected.');
  const parent = realpathSync(runParent);
  for (const protectedRoot of [config.baseDir, ...Object.values(config.skills).map(skill => skill.skillDir),
    ...config.sharedSkills.map(skill => skill.skillDir)]) {
    check(!isInside(protectedRoot, parent) && !isInside(parent, protectedRoot),
      `--run-root must not overlap the configuration or a skill directory (${protectedRoot}).`);
  }
  ancestorCheck(parent);
  const root = mkdtempSync(join(parent, 'skill-bench-'));
  const inputs = join(root, 'inputs');
  const settings = settingsJson(config);
  const shared = config.sharedSkills.map(skill => {
    const target = join(inputs, 'shared', skill.name);
    copyTree(skill.skillDir, target, skill.files);
    return target;
  });
  const targets = new Map<string, string>();
  const evals = new Map<string, string>();
  const contentHashes = new Map<string, string>(shared.map(target => [target, treeHash(target)]));
  for (const cell of cells) {
    const definition = config.skills[cell.skill];
    if (!targets.has(cell.skill)) {
      const target = join(inputs, 'skills', cell.skill);
      copyTree(definition.skillDir, target, definition.files);
      targets.set(cell.skill, target);
      contentHashes.set(target, treeHash(target));
    }
    if (!evals.has(cell.evalId)) {
      const evaluation = definition.evals.find(item => item.id === cell.evalId);
      check(evaluation, `unknown eval ${cell.evalId}.`);
      const target = join(inputs, 'evals', cell.skill, cell.scenario);
      copyTree(evaluation.directory, target);
      for (const copy of evaluation.copies) {
        // Copy from the staged tree: it has no links and the size limits already apply to it.
        const destination = join(target, ...copy.to.split('/'));
        check(!existsSync(destination), `a staged copy would replace ${copy.to} in ${cell.evalId}.`);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(join(target, ...copy.from.split('/')), destination);
      }
      evals.set(cell.evalId, target);
      contentHashes.set(target, treeHash(target));
    }
  }
  // Staged paths contain a random directory name. Replace it, so equal inputs give equal hashes.
  const inputsText = JSON.stringify(inputs).slice(1, -1);
  const plugins = new Map([...targets.keys()].map(skill => [skill, pluginHash(config, skill)]));
  const staged: StagedCell[] = [];
  for (const cell of cells) {
    const directory = evals.get(cell.evalId) as string;
    const source = join(directory, 'eval.yaml');
    const original = await loadEvalSpec(source);
    const skills = cell.arm === 'on' ? [...shared, targets.get(cell.skill) as string] : [...shared];
    const spec = structuredClone(original);
    spec.defaults = { ...spec.defaults, model: cell.model, runs: 1, timeout: config.timeout };
    spec.environment = environment(spec.environment, skills, settings);
    spec.stimuli = spec.stimuli.map(stimulus => ({
      ...stimulus, constraints: { ...stimulus.constraints, max_duration: config.timeout },
      environment: environment(stimulus.environment, skills, settings),
    }));
    const serialized = serializedSpec(spec);
    const specFile = join(directory, `.cell-${cell.index}.json`);
    check(!existsSync(specFile), 'a cell specification already exists; use a new run root.');
    writeFileSync(specFile, serialized);
    const configHash = hash(JSON.stringify({
      spec: serialized.split(inputsText).join('<inputs>'),
      skills: skills.map(path => contentHashes.get(path)),
      eval: contentHashes.get(directory), plugins: plugins.get(cell.skill), env: config.env,
    }));
    const cellRoot = join(root, 'cells', String(cell.index));
    createCellDirectories(cellRoot, settings);
    staged.push({
      ...cell, evalFile: source, root: cellRoot, workspace: join(cellRoot, 'workspace'), specFile, skills,
      sharedSkills: shared, evalName: spec.name, stimuli: spec.stimuli.map(stimulus => stimulus.name),
      prompts: Object.fromEntries(spec.stimuli.map(stimulus => [stimulus.name, typeof stimulus.prompt === 'string' ? stimulus.prompt : ''])),
      evalHash: hash(readFileSync(source, 'utf8')), configHash,
    });
  }
  return { root, inputs, settings, cells: staged };
}

function specSkills(specFile: string): string[][] {
  const spec = JSON.parse(readFileSync(specFile, 'utf8')) as {
    agent_environment?: { skills?: unknown }; stimuli?: { agent_environment?: { skills?: unknown } }[];
  };
  const lists = [spec.agent_environment?.skills, ...(spec.stimuli ?? []).map(stimulus => stimulus.agent_environment?.skills)];
  return lists.map(list => {
    check(Array.isArray(list) && list.every(item => typeof item === 'string'), `${basename(specFile)} has no explicit skill list.`);
    return [...list as string[]].sort();
  });
}

/**
 * Prove the arm contract before any model call: OFF has zero measured
 * skills, ON has only the target, and both have the same shared skills.
 */
export function verifyStagedRun(run: StagedRun, config: BenchConfig): void {
  const measured = new Set(Object.keys(config.skills));
  for (const cell of run.cells) {
    const expected = [...cell.sharedSkills, ...(cell.arm === 'on' ? [join(run.inputs, 'skills', cell.skill)] : [])].sort();
    for (const list of specSkills(cell.specFile)) {
      check(JSON.stringify(list) === JSON.stringify(expected), `cell ${cell.id} skills differ from the ${cell.arm.toUpperCase()} contract.`);
      const measuredNames = list.map(path => basename(path)).filter(name => measured.has(name));
      check(cell.arm === 'off' ? measuredNames.length === 0 : measuredNames.length === 1 && measuredNames[0] === cell.skill,
        `cell ${cell.id} must have ${cell.arm === 'off' ? 'no measured skill' : `only the measured skill ${cell.skill}`}.`);
      for (const path of list) {
        check(isInside(run.inputs, path) && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink()
          && existsSync(join(path, 'SKILL.md')), `cell ${cell.id} has an invalid staged skill ${path}.`);
      }
    }
    for (const parts of homeSkillDirectories) {
      check(!existsSync(join(cell.root, ...parts)), `cell ${cell.id} home has a discoverable skill directory ${parts.join('/')}.`);
    }
    check(readFileSync(join(cell.root, 'config', 'settings.json'), 'utf8') === run.settings, `cell ${cell.id} has unexpected settings.`);
    check(!existsSync(cell.workspace), `cell ${cell.id} workspace already exists.`);
  }
}
