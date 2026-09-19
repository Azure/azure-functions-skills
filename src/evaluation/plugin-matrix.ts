import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadEvalSpec, resolveExecutorName, validateEvalSpec } from '@microsoft/vally';
import type { EnvironmentConfig, RawEvalSchema } from '@microsoft/vally';
import { withPluginRegistries } from './validate.js';

export interface PluginMatrixOptions {
  inputsRoot: string;
  workspaceRoot: string;
  output: string;
  runId: string;
  evals: string[];
  models: string[];
  sharedSkills: string[];
  graderPlugins: string[];
  executorPlugins: string[];
  cli: string;
  dryRun: boolean;
}

export interface PluginMatrixCell {
  variant: string;
  evalFile: string;
  evalName: string;
  model: string;
  enabled: boolean;
  runs: number;
  stimuli: string[];
  skills: string[];
  sharedSkills: string[];
  evalHash: string;
  configHash: string;
  results: string | null;
  exitCode: number | null;
}

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Plugin matrix: ${message}`);
}

function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..\\`) && !path.startsWith('../') && !isAbsolute(path);
}

function skillsEnvironment(environment: string | EnvironmentConfig | undefined, skills: string[]): EnvironmentConfig {
  check(typeof environment !== 'string', 'use an inline agent environment, not a named environment.');
  return { ...environment, skills };
}

function serializedSpec(spec: RawEvalSchema): string {
  const { environment, agent_environment: _alias, stimuli, ...rest } = spec;
  return JSON.stringify({
    ...rest, agent_environment: environment,
    stimuli: stimuli.map(({ environment: env, agent_environment: _nestedAlias, ...stimulus }) =>
      ({ ...stimulus, agent_environment: env })),
  }, null, 2);
}

function findResults(directory: string): string | null {
  if (!existsSync(directory)) return null;
  // Standalone Vally adds one timestamp directory below the supplied output root.
  const found = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name, 'results.jsonl'))
    .filter(file => existsSync(file));
  check(found.length <= 1, 'multiple result sets exist for one cell; use a new output directory.');
  return found[0] ?? null;
}

export async function runPluginMatrix(options: PluginMatrixOptions) {
  check(identifier.test(options.runId), 'invalid run identifier.');
  check(options.models.length > 0 && new Set(options.models).size === options.models.length
    && options.models.every(model => identifier.test(model)), 'invalid or duplicate model identifiers.');
  check(options.evals.length > 0 && new Set(options.evals).size === options.evals.length, 'invalid eval list.');
  check(!existsSync(options.output), 'choose a new output directory; existing results are never reused.');
  const root = realpathSync(options.inputsRoot);
  const sharedSkills = options.sharedSkills.map(skill => {
    check(identifier.test(skill), 'invalid shared skill identifier.');
    const directory = realpathSync(join(root, 'templates', 'skills', skill));
    check(inside(root, directory), 'shared skill paths must remain inside the staged inputs.');
    return directory;
  });
  const plans: { file: string; spec: RawEvalSchema; cell: PluginMatrixCell }[] = [];
  await withPluginRegistries(root, options.graderPlugins, options.executorPlugins, async ({ graders, executors }) => {
    for (const evalFile of options.evals) {
      const parts = evalFile.split('/');
      check(parts.length === 4 && parts[0] === 'evals' && parts[3] === 'eval.yaml'
        && parts.every(part => identifier.test(part) && part !== '.' && part !== '..'), 'invalid eval path.');
      const source = realpathSync(join(root, ...parts));
      check(inside(root, source), 'eval paths must remain inside the staged inputs.');
      const target = realpathSync(join(root, 'templates', 'skills', parts[1]));
      check(inside(root, target) && !sharedSkills.includes(target), 'invalid measured skill directory.');
      const original = await loadEvalSpec(source);
      const evalHash = hash(readFileSync(source, 'utf8'));
      for (const enabled of [false, true]) {
        for (const model of options.models) {
          const skills = enabled ? [...sharedSkills, target] : sharedSkills;
          const spec = structuredClone(original);
          spec.defaults = { ...spec.defaults, model, runs: 1, timeout: '10m' };
          spec.environment = skillsEnvironment(spec.environment, skills);
          spec.stimuli = spec.stimuli.map(stimulus => ({
            ...stimulus, constraints: { ...stimulus.constraints, max_duration: '10m' },
            environment: skillsEnvironment(stimulus.environment, skills),
          }));
          const executor = resolveExecutorName(spec.defaults.executor) ?? 'copilot-sdk';
          check(executors.get(executor), `executor '${executor}' is not registered.`);
          const file = join(dirname(source), `.matrix-${options.runId}-${plans.length}.json`);
          check(!existsSync(file), 'a prepared control file already exists; use new staged inputs.');
          const serialized = serializedSpec(spec);
          writeFileSync(file, serialized);
          const validation = validateEvalSpec(spec, { registry: graders, executorRegistry: executors, evalFilePath: file });
          check(validation.valid, validation.diagnostics.filter(item => item.severity === 'error')
            .map(item => `${item.code}: ${item.message}`).join('; '));
          plans.push({
            file, spec,
            cell: {
              variant: `skill=${enabled ? 'on' : 'off'},model=${model}`, evalFile, evalName: spec.name,
              model, enabled, runs: 1, stimuli: spec.stimuli.map(stimulus => stimulus.name),
              skills, sharedSkills, evalHash, configHash: hash(serialized), results: null, exitCode: null,
            },
          });
        }
      }
    }
  });
  const cells = plans.map(plan => plan.cell);
  const manifest = {
    type: 'vally-eval-matrix', version: 1, vallyVersion: '0.16.0',
    runId: options.runId, planHash: hash(JSON.stringify(cells)), cells,
  };
  if (options.dryRun) return { exitCode: 0, cells };
  mkdirSync(options.output, { recursive: true, mode: 0o700 });
  function save() {
    const temporary = join(options.output, 'matrix-manifest.json.tmp');
    writeFileSync(temporary, JSON.stringify(manifest, null, 2));
    renameSync(temporary, join(options.output, 'matrix-manifest.json'));
  }
  save();
  let exitCode = 0;
  for (const [index, plan] of plans.entries()) {
    const parts = plan.cell.evalFile.split('/');
    const cellDirectory = join(options.output, plan.cell.variant, parts[1], parts[2]);
    const args = [options.cli, 'eval', '--eval-spec', plan.file, '--model', plan.cell.model,
      '--runs', '1', '--timeout', '10m', '--workers', '1', '--max-retries', '0', '--require-pass',
      '--workspace', join(options.workspaceRoot, `cell-${index}`), '--output-dir', cellDirectory];
    for (const plugin of options.executorPlugins) args.push('--executor-plugin', plugin);
    for (const plugin of options.graderPlugins) args.push('--grader-plugin', plugin);
    const result = spawnSync(process.execPath, args, {
      cwd: root, env: process.env, shell: false, stdio: ['ignore', 'inherit', 'inherit'],
    });
    const results = findResults(cellDirectory);
    plan.cell.results = results ? relative(options.output, results).replaceAll('\\', '/') : null;
    plan.cell.exitCode = result.status;
    save();
    check(!result.error && result.signal === null && result.status !== null,
      `could not complete cell ${index}; partial results are in ${options.output}.`);
    // A zero CLI exit without the required results is a harness failure.
    exitCode ||= result.status || (results === null ? 2 : 0);
  }
  return { exitCode, cells };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { config: { type: 'string' } }, strict: true });
    check(values.config, 'use --config <controller configuration file>.');
    // This file is written by the trusted runner, never by the evaluated agent.
    const options: PluginMatrixOptions = JSON.parse(readFileSync(values.config, 'utf8'));
    const result = await runPluginMatrix(options);
    console.log(`${options.dryRun ? 'Validated' : 'Executed'} ${result.cells.length} plugin-aware matrix cells.`);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
