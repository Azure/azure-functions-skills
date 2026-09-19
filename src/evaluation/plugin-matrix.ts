import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, renameSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
  workspace: string | null;
  workspaceError: string | null;
  exitCode: number | null;
}

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const snapshotExcludedDirectories = new Set([
  '.git', '.azure', '.claude', '.copilot', '.github', 'bin', 'dist',
  'grading-evidence', 'node_modules', 'obj', 'packages',
]);
const snapshotFileLimit = 1_000_000;
const snapshotTotalLimit = 50_000_000;
const snapshotSensitiveNames = [
  /^\.env(?:\.|$)/i, /^\.npmrc$/i, /^appsettings(?:\.[^.]+)?\.json$/i,
  /\.publishsettings$/i, /\.(?:key|pem|pfx)$/i,
];

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

function redactJson(path: string, content: string): string {
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return JSON.stringify({ redaction: `Invalid JSON in ${path}; original content omitted.` }, null, 2) + '\n';
  }
  check(value !== null && typeof value === 'object' && !Array.isArray(value),
    `cannot safely redact ${path}; expected a JSON object.`);
  const safeValues = new Set(['dotnet', 'dotnet-isolated', 'UseDevelopmentStorage=true']);
  const redact = (input: unknown): unknown => {
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') {
      return safeValues.has(input) ? input : '[REDACTED]';
    }
    if (Array.isArray(input)) return input.map(item => redact(item));
    return Object.fromEntries(Object.entries(input as Record<string, unknown>)
      .map(([name, item]) => [name, redact(item)]));
  };
  return JSON.stringify(redact(value), null, 2) + '\n';
}

function redactEnvironment(content: string): string {
  return content.split(/\r?\n/).map(line => {
    const match = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=)/.exec(line);
    return match ? `${match[1]}[REDACTED]` : line.startsWith('#') || !line.trim() ? line : '[REDACTED]';
  }).join('\n');
}

export function saveWorkspaceSnapshot(source: string, destination: string): void {
  check(existsSync(source) && lstatSync(source).isDirectory(), 'workspace snapshot source is missing.');
  check(!existsSync(destination), 'workspace snapshot destination already exists.');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const manifest = {
    version: 1,
    source: basename(source),
    copied: [] as string[],
    redacted: [] as string[],
    excluded: [] as string[],
    totalBytes: 0,
  };
  const visit = (directory: string, output: string, prefix = ''): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const inputPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        manifest.excluded.push(`${path}:symlink`);
        continue;
      }
      if (entry.isDirectory()) {
        if (snapshotExcludedDirectories.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) {
          manifest.excluded.push(`${path}/`);
          continue;
        }
        const outputPath = join(output, entry.name);
        mkdirSync(outputPath, { mode: 0o700 });
        visit(inputPath, outputPath, path);
        continue;
      }
      if (!entry.isFile()) {
        manifest.excluded.push(`${path}:unsupported`);
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.log')) {
        manifest.excluded.push(path);
        continue;
      }
      const size = lstatSync(inputPath).size;
      if (size > snapshotFileLimit || manifest.totalBytes + size > snapshotTotalLimit) {
        manifest.excluded.push(`${path}:size-limit`);
        continue;
      }
      if (lower === 'local.settings.json') {
        const target = join(output, 'local.settings.redacted.json');
        const redacted = redactJson(path, readFileSync(inputPath, 'utf8'));
        writeFileSync(target, redacted, { mode: 0o600 });
        manifest.totalBytes += Buffer.byteLength(redacted);
        manifest.redacted.push(path);
        continue;
      }
      if (lower !== '.gitignore' && (entry.name.startsWith('.')
        || snapshotSensitiveNames.some(pattern => pattern.test(entry.name)))) {
        if (lower === '.env' || lower.startsWith('.env.')) {
          const target = join(output, `${entry.name}.redacted`);
          const redacted = redactEnvironment(readFileSync(inputPath, 'utf8'));
          writeFileSync(target, redacted, { mode: 0o600 });
          manifest.totalBytes += Buffer.byteLength(redacted);
          manifest.redacted.push(path);
        } else {
          manifest.excluded.push(`${path}:sensitive-name`);
        }
        continue;
      }
      const content = size <= snapshotFileLimit ? readFileSync(inputPath) : undefined;
      if (content && /AccountKey=|SharedAccessSignature=|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i.test(content.toString('utf8'))) {
        manifest.excluded.push(`${path}:credential-like-content`);
        continue;
      }
      copyFileSync(inputPath, join(output, entry.name));
      manifest.totalBytes += size;
      manifest.copied.push(path);
    }
  };
  visit(source, destination);
  writeFileSync(join(destination, 'snapshot-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
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
              workspace: null, workspaceError: null,
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
    const workspaceSource = join(options.workspaceRoot, `cell-${index}`);
    if (existsSync(workspaceSource)) {
      const workspaceDestination = results ? join(dirname(results), 'workspace') : join(cellDirectory, 'workspace');
      try {
        saveWorkspaceSnapshot(workspaceSource, workspaceDestination);
        plan.cell.workspace = relative(options.output, workspaceDestination).replaceAll('\\', '/');
      } catch (error) {
        plan.cell.workspaceError = error instanceof Error ? error.message : String(error);
        exitCode ||= 2;
      }
    }
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
