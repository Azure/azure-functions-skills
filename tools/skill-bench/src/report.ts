import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, posix, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const metricNames = ['totalTokens', 'turnCount', 'toolCallCount', 'wallTimeMs', 'errorCount', 'skillActivationCount'] as const;
type Metrics = Record<typeof metricNames[number], number | null>;
type ObjectValue = Record<string, unknown>;

export interface TrialView {
  id: string;
  status: string;
  passed: boolean | null;
  score: number | null;
  graders: { name: string; passed: boolean | null; score: number | null }[];
  metrics: Metrics;
}

export interface ArmSummary {
  planned: number;
  samples: number;
  unexecuted: number;
  skipped: number;
  executionErrors: number;
  failed: number;
  passed: number;
  successRate: number | null;
  score: number | null;
  graderScores: Record<string, number | null>;
  metrics: Metrics;
  trials: TrialView[];
  workspace: string | null;
}

export interface Comparison {
  id: string;
  skill: string;
  scenario: string;
  model: string;
  prompt: string | null;
  on: ArmSummary | null;
  off: ArmSummary | null;
}

export interface Benchmark {
  title: string;
  display: { models: Record<string, string>; skills: Record<string, string>; scenarios: Record<string, string> };
  provenance: { runId: string; planHash: string; vallyVersion: string; transport: 'vally-eval' };
  comparisons: Comparison[];
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`skill-bench report: ${message}`);
}

function object(value: unknown): ObjectValue {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected an object.');
  return value as ObjectValue;
}

function list(value: unknown): unknown[] {
  check(Array.isArray(value), 'expected an array.');
  return value;
}

function text(value: unknown): string {
  check(typeof value === 'string' && value.length > 0, 'expected a nonempty string.');
  return value;
}

// Only display identifiers, never free text, paths or evidence from results.
function identifier(value: unknown): string {
  const name = text(value);
  check(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(name), 'unsafe display identifier.');
  return name;
}

function number(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  check(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'invalid metric or score.');
  return value;
}

function verdict(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  check(typeof value === 'boolean', 'invalid grader verdict.');
  return value;
}

function json(source: string, label: string): ObjectValue {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error(`skill-bench report: invalid JSON in ${label}.`); }
  return object(value);
}

function jsonLines(file: string): ObjectValue[] {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim())
    .map((line, index) => json(line, `${file}:${index + 1}`));
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function mean(values: (number | null)[]): number | null {
  // An incomplete arm is not comparable: never change its denominator silently.
  return values.length === 0 || values.some(value => value === null)
    ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length;
}

export function relativeChange(on: number | null, off: number | null): number | null {
  return on === null || off === null || off === 0 ? null : (on - off) / off * 100;
}

function summarize(planned: number, trials: TrialView[], workspace: string | null): ArmSummary {
  const executed = trials.filter(trial => trial.status !== 'skipped');
  const passed = executed.filter(trial => trial.status === 'success' && trial.passed === true).length;
  const graderNames = [...new Set(executed.flatMap(trial => trial.graders.map(grader => grader.name)))];
  return {
    planned, samples: executed.length, unexecuted: planned - trials.length,
    skipped: trials.length - executed.length,
    executionErrors: executed.filter(trial => trial.status === 'error').length,
    failed: executed.filter(trial => trial.status === 'success' && trial.passed === false).length,
    passed,
    successRate: executed.length === 0 || executed.some(trial => trial.status === 'success' && trial.passed === null)
      ? null : passed / executed.length * 100,
    score: mean(executed.map(trial => trial.score)),
    graderScores: Object.fromEntries(graderNames.map(name => [name, mean(executed.map(trial =>
      trial.graders.find(grader => grader.name === name)?.score ?? null))])),
    metrics: Object.fromEntries(metricNames.map(key => [key, mean(executed.map(trial => trial.metrics[key]))])) as Metrics,
    trials, workspace,
  };
}

function trialView(record: ObjectValue, id: string): TrialView {
  const status = text(record.status);
  check(['success', 'error', 'skipped'].includes(status), 'unknown execution status.');
  check('gradeResult' in record, 'missing gradeResult (use null when ungraded).');
  const grade = record.gradeResult === null ? {} : object(record.gradeResult);
  const details = list(grade.details ?? []).map(object);
  const gradeError = grade.status === 'error' || details.some(item => item.status === 'error');
  const trajectory = record.trajectory == null ? {} : object(record.trajectory);
  const metrics = trajectory.metrics == null ? {} : object(trajectory.metrics);
  const tokens = metrics.tokenUsage == null ? {} : object(metrics.tokenUsage);
  return {
    id: hash(id), status, passed: gradeError ? false : verdict(grade.passed),
    score: gradeError ? (grade.score === 0 ? 0 : null) : number(grade.score),
    graders: details.map(item => ({
      name: identifier(item.name), passed: item.status === 'error' ? false : verdict(item.passed),
      score: item.status === 'error' ? (item.score === 0 ? 0 : null) : number(item.score),
    })),
    metrics: Object.fromEntries(metricNames.map(name => [
      name, number(name === 'totalTokens' ? tokens.totalTokens : metrics[name]),
    ])) as Metrics,
  };
}

function insidePath(input: string, value: unknown, kind: 'file' | 'directory'): string {
  const path = text(value).replaceAll('\\', '/');
  check(!posix.isAbsolute(path) && !win32.isAbsolute(path) && !path.includes(':')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
  'result paths must be relative and stay inside the input directory.');
  const target = realpathSync(join(input, ...path.split('/')));
  const child = relative(input, target);
  const stat = statSync(target);
  check(child !== '' && child !== '..' && !child.startsWith('..\\') && !child.startsWith('../') && !isAbsolute(child)
    && (kind === 'file' ? stat.isFile() : stat.isDirectory()),
  'result paths must stay inside the input directory, including links.');
  return target;
}

function planHash(value: unknown): string {
  const result = text(value);
  check(/^[a-f0-9]{16}$/.test(result), 'expected a 16-character hash.');
  return result;
}

function skillNames(value: unknown): string[] {
  const names = list(value).map(item => {
    const path = text(item);
    check(posix.isAbsolute(path) || win32.isAbsolute(path), 'skills must use absolute paths.');
    // The staged directories are gone after a run. Use only the name.
    return identifier(path.replaceAll('\\', '/').replace(/\/+$/, '').split('/').at(-1));
  });
  check(new Set(names).size === names.length, 'duplicate skill names in a cell.');
  return names.sort();
}

function labels(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(object(value)).map(([key, label]) => {
    identifier(key);
    check(typeof label === 'string' && label.length <= 200 && !/[\p{Cc}]/u.test(label), 'invalid display label.');
    return [key, label];
  }));
}

// The prompt comes from the reviewed eval specification the tool staged, not
// from agent output. Control characters are replaced and the length is capped.
function prompt(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.replace(/[\p{Cc}\p{Cf}]/gu, character => character === '\n' ? '\n' : ' ').trimEnd().slice(0, 8000);
}

/** Read a skill-bench output directory. Missing results stay missing; nothing is fabricated. */
export function readBenchmark(input: string): Benchmark {
  const root = realpathSync(input);
  const manifest = json(readFileSync(insidePath(root, 'matrix-manifest.json', 'file'), 'utf8'), 'matrix-manifest.json');
  check(manifest.type === 'skill-bench-matrix' && manifest.version === 1 && manifest.vallyVersion === '0.16.0',
    'use a skill-bench-matrix version 1 manifest from Vally 0.16.0.');
  const title = typeof manifest.title === 'string' && manifest.title.length <= 200 ? manifest.title : 'Skill benchmark';
  const display = manifest.display === undefined ? {} : object(manifest.display);
  const provenance = {
    runId: identifier(manifest.runId), planHash: planHash(manifest.planHash),
    vallyVersion: '0.16.0', transport: 'vally-eval' as const,
  };
  const cells = list(manifest.cells).map(object);
  check(cells.length > 0, 'the manifest has no planned cells.');
  const comparisons = new Map<string, Comparison>();
  const evalPlans = new Map<string, string>();
  const resultFiles = new Set<string>();
  const resultIdentities = new Set<string>();
  for (const cell of cells) {
    const skill = identifier(cell.skill);
    const directory = identifier(cell.scenario);
    const evalFile = text(cell.evalFile);
    check(evalFile === `evals/${skill}/${directory}/eval.yaml`, 'invalid eval identifier.');
    const evalName = identifier(cell.evalName);
    const model = identifier(cell.model);
    check(typeof cell.enabled === 'boolean', 'enabled must be a boolean.');
    const arm = cell.enabled ? 'on' : 'off';
    const variant = `skill=${arm},model=${model}`;
    check(cell.variant === variant, 'the model or enabled flag differs from the variant.');
    const runs = number(cell.runs);
    check(runs !== null && Number.isInteger(runs) && runs > 0 && runs <= 10000, 'invalid planned runs.');
    const scenarios = list(cell.stimuli).map(identifier);
    check(scenarios.length > 0 && new Set(scenarios).size === scenarios.length, 'invalid planned stimuli.');
    const shared = skillNames(cell.sharedSkills);
    const skills = skillNames(cell.skills);
    check(!shared.includes(skill), 'the target skill cannot be a shared skill.');
    const target = skills.filter(name => !shared.includes(name));
    check(shared.every(name => skills.includes(name))
      && (cell.enabled ? target.length === 1 && target[0] === skill : target.length === 0),
    'ON must contain the target and shared skills; OFF must contain only shared skills.');
    const evalHash = planHash(cell.evalHash);
    planHash(cell.configHash);
    check(cell.exitCode === null || (typeof cell.exitCode === 'number' && Number.isInteger(cell.exitCode)),
      'exitCode must be an integer or null.');
    const prompts = cell.prompts === undefined ? {} : object(cell.prompts);
    const plan = JSON.stringify({ evalName, evalHash, runs, scenarios: [...scenarios].sort(), shared });
    check(!evalPlans.has(evalFile) || evalPlans.get(evalFile) === plan,
      'the eval hash, stimuli or shared skills differ between cells.');
    evalPlans.set(evalFile, plan);

    let records: ObjectValue[] = [];
    if (cell.results !== null && cell.results !== undefined) {
      const file = insidePath(root, cell.results, 'file');
      const stat = statSync(file, { bigint: true });
      const identity = `${stat.dev}:${stat.ino}`;
      check(!resultFiles.has(file) && !resultIdentities.has(identity), 'cells must use distinct result files.');
      resultFiles.add(file);
      resultIdentities.add(identity);
      records = jsonLines(file);
    }
    const workspace = cell.workspace === null || cell.workspace === undefined
      ? null : relative(root, insidePath(root, cell.workspace, 'directory')).replaceAll('\\', '/');
    const trials = new Map(scenarios.map(scenario => [scenario, [] as TrialView[]]));
    const seen = new Set<string>();
    const itemIds = new Set<string>();
    let evalSource: string | undefined;
    let summarySeen = false;
    for (const record of records) {
      // Standalone results end with a summary. It is not a trial or a verdict.
      if (record.type === 'run-summary') {
        check(!summarySeen, 'duplicate run summary.');
        summarySeen = true;
        continue;
      }
      check(record.type === 'trial-result' && !summarySeen, 'unexpected result record.');
      check(record.evalName === evalName && (record.model === undefined || record.model === model),
        'the trial eval or model differs from the plan.');
      check(record.variant === undefined || record.variant === 'main' || record.variant === variant,
        'the trial variant differs from the plan.');
      const trajectory = record.trajectory == null ? {} : object(record.trajectory);
      const metadata = trajectory.metadata == null ? {} : object(trajectory.metadata);
      check(metadata.model === undefined || metadata.model === model, 'the trajectory model differs from the plan.');
      const source = text(record.evalFilePath);
      check(evalSource === undefined || evalSource === source, 'a cell contains more than one eval source.');
      evalSource = source;
      const scenario = identifier(record.stimulus);
      const planned = trials.get(scenario);
      check(planned, 'unplanned stimulus.');
      // Vally omits trialIndex and totalTrials for a single-trial run.
      const index = record.trialIndex === undefined && runs === 1 ? 0 : number(record.trialIndex);
      check(index !== null && Number.isInteger(index) && index < runs
        && (record.totalTrials === runs || (record.totalTrials === undefined && runs === 1)),
      'the trial index or total differs from the plan.');
      const key = `${scenario}::${index}`;
      const itemId = text(record.itemId);
      check(!seen.has(key) && !itemIds.has(itemId), 'duplicate trial identity.');
      seen.add(key);
      itemIds.add(itemId);
      planned.push(trialView(record, `${evalFile}::${variant}::${key}`));
    }
    for (const [scenario, found] of trials) {
      const key = `${skill}::${evalName}::${scenario}::${model}`;
      const comparison = comparisons.get(key) ?? {
        id: hash(`${skill}::${evalName}::${scenario}`), skill, scenario, model,
        prompt: prompt(prompts[scenario]), on: null, off: null,
      };
      check(comparison[arm] === null, 'duplicate model and scenario arm.');
      comparison[arm] = summarize(runs, found, workspace);
      comparisons.set(key, comparison);
    }
  }
  return {
    title,
    display: { models: labels(display.models), skills: labels(display.skills), scenarios: labels(display.scenarios) },
    provenance,
    comparisons: [...comparisons.values()].sort((a, b) => `${a.id}:${a.model}`.localeCompare(`${b.id}:${b.model}`)),
  };
}

function overlaps(a: string, b: string): boolean {
  const inside = (parent: string, child: string) => {
    const path = relative(parent, child);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
  };
  return inside(a, b) || inside(b, a);
}

export const dashboardTemplate = fileURLToPath(new URL('../dashboard/index.html', import.meta.url));

/** Write benchmark.json and a self-contained index.html into a new or empty directory. */
export function generateReport(input: string, output: string, template = dashboardTemplate): string {
  const source = realpathSync(input);
  check(!overlaps(source, resolve(output)), 'the output must not overlap the input.');
  const data = readBenchmark(source);
  mkdirSync(output, { recursive: true });
  const destination = realpathSync(output);
  check(!overlaps(source, destination), 'the output must not overlap the input, including links.');
  check(readdirSync(destination).length === 0, 'the output directory must be empty; choose a new directory.');
  const html = readFileSync(template, 'utf8');
  check(html.split('/* BENCHMARK_DATA */ null').length === 2, 'the dashboard data marker is missing or duplicated.');
  const safeJson = JSON.stringify(data).replace(/[<>&\u2028\u2029]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  writeFileSync(join(destination, 'benchmark.json'), JSON.stringify(data, null, 2) + '\n');
  const htmlPath = join(destination, 'index.html');
  writeFileSync(htmlPath, html.replace('/* BENCHMARK_DATA */ null', () => safeJson));
  return htmlPath;
}
