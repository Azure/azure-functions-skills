import { copyFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const metricNames = ['totalTokens', 'turnCount', 'toolCallCount', 'wallTimeMs', 'errorCount', 'skillActivationCount'] as const;
const repository = fileURLToPath(new URL('../../', import.meta.url));
type Metrics = Record<typeof metricNames[number], number | null>;
type ObjectValue = Record<string, unknown>;

interface TrialView {
  id: string;
  status: string;
  passed: boolean | null;
  score: number | null;
  graders: { name: string; passed: boolean | null; score: number | null }[];
  metrics: Metrics;
}

interface Arm {
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
}

interface Comparison {
  id: string;
  skill: string;
  scenario: string;
  model: string;
  prompt: string | null;
  on: Arm | null;
  off: Arm | null;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native report: ${message}`);
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

// Only display identifiers, never native free text, paths, prompts or evidence.
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
  try { value = JSON.parse(source); }
  catch { throw new Error(`Native report: invalid JSON in ${label}.`); }
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
  // An incomplete arm is not comparable: never silently change its denominator.
  return values.length === 0 || values.some(value => value === null)
    ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length;
}

export function relativeChange(on: number | null, off: number | null): number | null {
  return on === null || off === null || off === 0 ? null : (on - off) / off * 100;
}

function summarize(planned: number, trials: TrialView[]): Arm {
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
    // A grader absent from one trial makes its arm mean incomparable, so mean()
    // reports null rather than silently shrinking the denominator.
    graderScores: Object.fromEntries(graderNames.map(name => [name, mean(executed.map(trial =>
      trial.graders.find(grader => grader.name === name)?.score ?? null))])),
    metrics: Object.fromEntries(metricNames.map(key => [key, mean(executed.map(trial => trial.metrics[key]))])) as Metrics,
    trials,
  };
}

function skillFromFile(file: string): { skill: string; directory: string } {
  const parts = file.replaceAll('\\', '/').split('/');
  check(parts.at(-1) === 'eval.yaml' && parts.at(-4) === 'evals', 'expected evals/<skill>/<scenario>/eval.yaml.');
  return { skill: identifier(parts.at(-3)), directory: identifier(parts.at(-2)) };
}

const prompts = new Map<string, string | null>();

// Deliberate, bounded exception to the identifiers-only policy above: this text
// comes from the reviewed eval specification in this checkout, never from
// native output, so it carries no agent-authored content. It is display-only.
function scenarioPrompt(skill: string, directory: string, scenario: string): string | null {
  const key = `${skill}/${directory}/${scenario}`;
  const cached = prompts.get(key);
  if (cached !== undefined) return cached;
  let value: string | null = null;
  try {
    const lines = readFileSync(join(repository, 'evals', skill, directory, 'eval.yaml'), 'utf8').split(/\r?\n/);
    const start = lines.findIndex(line => new RegExp(`^(\\s*)- name: ${scenario}\\s*$`).test(line));
    const item = start < 0 ? -1 : (/^\s*/.exec(lines[start]) ?? [''])[0].length;
    // Stimulus keys sit two columns right of their list marker, which excludes
    // the deeper `config.prompt` of the quality judge from this match.
    const indent = ' '.repeat(item + 2);
    const header = start < 0 ? -1
      : lines.findIndex((line, index) => index > start && new RegExp(`^${indent}prompt: \\|[-+]?\\s*$`).test(line));
    if (header > start) {
      const body: string[] = [];
      for (const line of lines.slice(header + 1)) {
        if (line.trim() !== '' && !line.startsWith(`${indent} `)) break;
        body.push(line.slice(indent.length + 2));
      }
      const text = body.join('\n').trimEnd().replace(/[\p{Cc}\p{Cf}]/gu, character => character === '\n' ? '\n' : ' ');
      if (text.length > 0) value = text.slice(0, 8000);
    }
  } catch { value = null; }
  prompts.set(key, value);
  return value;
}

function checkSkills(environment: unknown, enabled: boolean, skill: string): void {
  const skills = list(object(environment).skills);
  check(enabled ? skills.length === 1 && text(skills[0]).replaceAll('\\', '/').split('/').at(-1) === skill
    : skills.length === 0, 'expected only the target skill ON, and no skills OFF.');
}

export function readBenchmark(input: string) {
  const manifest = json(readFileSync(join(input, 'experiment-manifest.json'), 'utf8'), 'experiment-manifest.json');
  const snapshot = json(readFileSync(join(input, 'plan-snapshot.json'), 'utf8'), 'plan-snapshot.json');
  check(manifest.type === 'experiment-manifest' && snapshot.type === 'experiment-plan-snapshot'
    && manifest.version === 1 && snapshot.version === 1, 'use one native experiment output, not raw shards.');
  const experiment = object(manifest.experiment);
  check(experiment.vallyVersion === '0.16.0' && snapshot.vallyVersion === experiment.vallyVersion,
    'supported native output version is Vally 0.16.0.');
  check(snapshot.planDigest === experiment.planDigest, 'plan digest differs from manifest.');
  const provenance = {
    runId: identifier(experiment.runId), experiment: identifier(experiment.name),
    experimentHash: identifier(experiment.experimentHash), planDigest: identifier(experiment.planDigest),
    vallyVersion: '0.16.0',
  };
  const variants = list(experiment.variantNames).map(text);
  check(variants.length > 0 && new Set(variants).size === variants.length, 'empty or duplicate variant list.');
  const plans = list(snapshot.evals).map(object);
  check(plans.length > 0 && plans.every(plan => variants.includes(text(plan.variant))), 'snapshot variants differ from manifest.');
  const comparisons = new Map<string, Comparison>();
  const evalHashes = new Map<string, string>();
  const seen = new Set<string>();
  for (const variant of variants) {
    const match = /^skill=(on|off),model=([a-zA-Z0-9][a-zA-Z0-9._-]{0,159})$/.exec(variant);
    check(match, 'expected native matrix axes skill=off/on,model=<model>.');
    const arm = match[1] === 'on' ? 'on' : 'off';
    const model = match[2];
    const variantPlans = plans.filter(plan => plan.variant === variant);
    check(variantPlans.length > 0, 'variant has no plan.');
    const summaries = jsonLines(join(input, variant, 'run-summary.jsonl'));
    const records = jsonLines(join(input, variant, 'results.jsonl'));
    check(summaries.length === variantPlans.length, 'missing or duplicate provenance summary.');
    const consumed = new Set<ObjectValue>();
    for (const plan of variantPlans) {
      const evalFile = text(plan.evalFile);
      const { skill, directory } = skillFromFile(evalFile);
      const evalName = identifier(plan.evalName);
      check(plan.model === model, 'plan model differs from matrix axis.');
      checkSkills(plan.environment, arm === 'on', skill);
      const matching = summaries.filter(summary => summary.evalFile === evalFile);
      check(matching.length === 1, 'missing or duplicate eval provenance.');
      const summary = matching[0];
      const evalHash = identifier(summary.evalHash);
      identifier(summary.configHash);
      check(!evalHashes.has(evalFile) || evalHashes.get(evalFile) === evalHash, 'eval hash differs between arms.');
      evalHashes.set(evalFile, evalHash);
      check(summary.type === 'experiment-run-summary' && summary.runId === provenance.runId
        && summary.experiment === provenance.experiment && summary.variant === variant
        && summary.experimentHash === provenance.experimentHash && summary.vallyVersion === provenance.vallyVersion,
      'summary does not match run/variant provenance.');
      const defaults = object(summary.resolvedDefaults);
      check(defaults.model === model && defaults.runs === plan.runs, 'summary defaults differ from plan.');
      checkSkills(summary.resolvedEnvironment, arm === 'on', skill);
      const runs = number(plan.runs);
      check(runs !== null && Number.isInteger(runs) && runs > 0 && runs <= 10000, 'invalid planned runs.');
      const scenarios = list(plan.plannedStimulusNames).map(identifier);
      check(scenarios.length === plan.plannedStimulusCount && new Set(scenarios).size === scenarios.length,
        'invalid planned stimuli.');
      for (const scenario of scenarios) {
        const stimulus = list(plan.stimuli).map(object).filter(item => item.name === scenario);
        check(stimulus.length === 1, 'missing or duplicate planned stimulus.');
        checkSkills(stimulus[0].environment, arm === 'on', skill);
        const key = `${skill}::${evalName}::${scenario}::${model}`;
        const comparison = comparisons.get(key) ?? {
          id: hash(`${skill}::${evalName}::${scenario}`), skill, scenario, model,
          prompt: scenarioPrompt(skill, directory, scenario), on: null, off: null,
        };
        check(comparison[arm] === null, 'duplicate model/scenario arm.');
        const expected = new Set(Array.from({ length: runs }, (_, index) =>
          `${evalFile}::${variant}::${model}::${scenario}::trial-${index}`));
        const trials = records.filter(record => object(record.experiment).evalFile === evalFile && record.stimulus === scenario)
          .map(record => {
            consumed.add(record);
            const context = object(record.experiment);
            const shardKey = text(record.shardKey);
            check(record.type === 'trial-result' && expected.has(shardKey) && !seen.has(shardKey),
              'invalid or duplicate native trial identity.');
            seen.add(shardKey);
            check(record.variant === variant && record.model === model && record.evalName === evalName
              && context.name === provenance.experiment && context.runId === provenance.runId
              && context.variant === variant && context.evalHash === summary.evalHash && context.configHash === summary.configHash,
            'trial does not match model/run/eval/config provenance.');
            const status = text(record.status);
            check(['success', 'error', 'skipped'].includes(status), 'unknown native execution status.');
            check('gradeResult' in record, 'missing native gradeResult (use null when ungraded).');
            const grade = record.gradeResult === null ? {} : object(record.gradeResult);
            const trajectory = record.trajectory == null ? {} : object(record.trajectory);
            const metrics = trajectory.metrics == null ? {} : object(trajectory.metrics);
            const tokens = metrics.tokenUsage == null ? {} : object(metrics.tokenUsage);
            return {
              id: hash(shardKey), status, passed: verdict(grade.passed), score: number(grade.score),
              graders: list(grade.details ?? []).map(object).map(g => ({
                name: identifier(g.name), passed: verdict(g.passed), score: number(g.score),
              })),
              metrics: Object.fromEntries(metricNames.map(name => [
                name, number(name === 'totalTokens' ? tokens.totalTokens : metrics[name]),
              ])) as Metrics,
            };
          });
        comparison[arm] = summarize(runs, trials);
        comparisons.set(key, comparison);
      }
    }
    check(consumed.size === records.length, 'unplanned trial records; use one canonical native output directory.');
  }
  check(seen.size > 0, 'no trial records found; run the experiment before generating a report.');
  return { provenance, comparisons: [...comparisons.values()].sort((a, b) =>
    `${a.id}:${a.model}`.localeCompare(`${b.id}:${b.model}`)) };
}

function overlaps(a: string, b: string): boolean {
  const inside = (parent: string, child: string) => {
    const path = relative(parent, child);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
  };
  return inside(a, b) || inside(b, a);
}

export function generateReport(input: string, output: string): string {
  const source = realpathSync(input);
  check(!overlaps(source, resolve(output)), 'output must not overlap native input.');
  const data = readBenchmark(source);
  mkdirSync(output, { recursive: true });
  const destination = realpathSync(output);
  check(!overlaps(source, destination), 'output must not overlap native input (including links).');
  check(readdirSync(destination).length === 0, 'output directory must be empty; choose a new directory.');
  const assets = fileURLToPath(new URL('../../dashboard/', import.meta.url));
  const template = readFileSync(join(assets, 'index.html'), 'utf8');
  check(template.split('/* BENCHMARK_DATA */ null').length === 2, 'dashboard data marker is missing or duplicated.');
  const safeJson = JSON.stringify(data).replace(/[<>&\u2028\u2029]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const html = template.replace('/* BENCHMARK_DATA */ null', () => safeJson);
  copyFileSync(join(assets, 'azure-functions-skills-logo.png'), join(destination, 'azure-functions-skills-logo.png'));
  const htmlPath = join(destination, 'index.html');
  writeFileSync(htmlPath, html);
  return htmlPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } }, strict: true });
    check(values.input && values.output, 'usage: npm run eval:report -- --input <native-output> --output <empty-site-dir>');
    console.log(generateReport(values.input, values.output));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
