import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside, loadConfig } from './config.ts';
import type { BenchConfig } from './config.ts';
import { cellEnvironment, createCellDirectories, modelToken, saveWorkspaceSnapshot } from './env.ts';
import type { Environment } from './env.ts';
import { selectCells } from './plan.ts';
import type { Selection } from './plan.ts';
import { loadPreflights, validateSpecs, withRegistries } from './plugins.ts';
import type { LoadedPreflight, PreflightTeardownContext } from './plugins.ts';
import { assertCleanAncestors, hash, stageRun, verifyStagedRun } from './stage.ts';
import type { StagedCell, StagedRun } from './stage.ts';

export const vallyVersion = '0.16.0';

export type SpawnFunction = (command: string, args: string[], options: SpawnSyncOptions) => SpawnSyncReturns<Buffer>;

export interface RunOptions {
  config: string;
  selection: Selection;
  /** False runs models (paid). True stages and validates only. */
  dryRun: boolean;
  runRoot?: string;
  output?: string;
  trusted?: boolean;
  registry?: string;
}

export interface RunDependencies {
  spawn: SpawnFunction;
  vallyCli: string;
  ancestorCheck: (directory: string) => void;
  log: (message: string) => void;
  /** Removes the staged run root. Tests replace it. */
  remove?: (path: string) => void;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface CleanupRecord {
  removed: false;
  path: string;
  error: string;
}

export interface ManifestCell {
  index: number;
  id: string;
  variant: string;
  skill: string;
  scenario: string;
  evalFile: string;
  evalName: string;
  model: string;
  enabled: boolean;
  runs: number;
  stimuli: string[];
  prompts: Record<string, string>;
  skills: string[];
  sharedSkills: string[];
  evalHash: string;
  configHash: string;
  results: string | null;
  workspace: string | null;
  workspaceError: string | null;
  exitCode: number | null;
}

export interface Manifest {
  type: 'skill-bench-matrix';
  version: 1;
  vallyVersion: string;
  runId: string;
  planHash: string;
  title: string;
  display: BenchConfig['display'];
  cells: ManifestCell[];
  /** Present only when skill-bench cannot remove the staged run root. */
  cleanup?: CleanupRecord;
}

export interface RunResult {
  exitCode: number;
  dryRun: boolean;
  cells: ManifestCell[];
  output?: string;
  cleanup?: CleanupRecord;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`skill-bench run: ${message}`);
}

export function defaultVallyCli(): string {
  return fileURLToPath(new URL('../node_modules/@microsoft/vally-cli/dist/index.js', import.meta.url));
}

export const defaultDependencies: RunDependencies = {
  spawn: (command, args, options) => spawnSync(command, args, options) as SpawnSyncReturns<Buffer>,
  vallyCli: defaultVallyCli(),
  ancestorCheck: assertCleanAncestors,
  log: message => console.log(message),
};

const lockCodes = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES', 'EMFILE']);
const cleanupAttempts = 6;

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

const wait = (milliseconds: number) => new Promise<void>(done => { setTimeout(done, milliseconds); });

/**
 * Remove the staged run root. On Windows, a process that a trial started
 * (for example a build server) can keep a file open for some seconds. Retry
 * lock errors with backoff. Return the last error message, or null.
 */
export async function removeRunRoot(path: string,
  dependencies: Pick<RunDependencies, 'remove' | 'sleep'> = {}): Promise<string | null> {
  const remove = dependencies.remove ?? removeTree;
  const sleep = dependencies.sleep ?? wait;
  for (let attempt = 1; ; attempt++) {
    try {
      remove(path);
      return null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!lockCodes.has(code) || attempt >= cleanupAttempts) return error instanceof Error ? error.message : String(error);
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
}

async function teardown(preflights: LoadedPreflight[], label: string, context: Omit<PreflightTeardownContext, 'options'>,
  log: (message: string) => void): Promise<void> {
  for (const item of preflights) {
    if (!item.plugin.teardownCell) continue;
    try {
      await item.plugin.teardownCell({ ...context, options: item.options });
    } catch (error) {
      log(`Warning: teardown ${item.plugin.name} for ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function checkVallyCli(file: string): void {
  check(existsSync(file), `cannot find the Vally CLI at ${file}; run npm ci in tools/skill-bench.`);
  const manifest = JSON.parse(readFileSync(join(dirname(file), '..', 'package.json'), 'utf8')) as { version?: unknown };
  check(manifest.version === vallyVersion, `use @microsoft/vally-cli ${vallyVersion}; found ${String(manifest.version)}.`);
}

function manifestCell(cell: StagedCell): ManifestCell {
  return {
    index: cell.index, id: cell.id, variant: cell.variant, skill: cell.skill, scenario: cell.scenario,
    evalFile: cell.evalId, evalName: cell.evalName, model: cell.model, enabled: cell.arm === 'on', runs: 1,
    stimuli: cell.stimuli, prompts: cell.prompts, skills: cell.skills, sharedSkills: cell.sharedSkills,
    evalHash: cell.evalHash, configHash: cell.configHash,
    results: null, workspace: null, workspaceError: null, exitCode: null,
  };
}

function findResults(directory: string): string | null {
  if (!existsSync(directory)) return null;
  // Standalone Vally adds one timestamp directory below the output directory.
  const found = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name, 'results.jsonl'))
    .filter(file => existsSync(file));
  check(found.length <= 1, 'more than one result set exists for a cell; use a new output directory.');
  return found[0] ?? null;
}

function checkOutput(config: BenchConfig, output: string, runRoot: string): string {
  const target = resolve(output);
  check(!existsSync(target), '--output must be a new directory; existing results are never used again.');
  check(existsSync(dirname(target)), `the parent directory of --output must exist (${dirname(target)}).`);
  const parent = realpathSync(dirname(target));
  const destination = join(parent, relative(dirname(target), target));
  for (const protectedRoot of [config.baseDir, runRoot, ...Object.values(config.skills).map(skill => skill.skillDir),
    ...config.sharedSkills.map(skill => skill.skillDir)]) {
    check(!isInside(protectedRoot, destination) && !isInside(destination, protectedRoot),
      `--output must not overlap the configuration, the run root or a skill directory (${protectedRoot}).`);
  }
  return destination;
}

function prepareCells(run: StagedRun, config: BenchConfig, preflights: Map<string, LoadedPreflight[]>): void {
  for (const cell of run.cells) {
    for (const loaded of preflights.get(cell.skill) ?? []) {
      loaded.plugin.prepareCell?.({
        options: loaded.options, cellRoot: cell.root, home: join(cell.root, 'home'), appData: join(cell.root, 'appdata'),
      });
    }
  }
  verifyStagedRun(run, config);
}

async function validateCells(run: StagedRun, config: BenchConfig): Promise<void> {
  const skills = [...new Set(run.cells.map(cell => cell.skill))];
  for (const skill of skills) {
    const definition = config.skills[skill];
    const files = run.cells.filter(cell => cell.skill === skill).map(cell => cell.specFile);
    const results = await withRegistries(run.inputs, definition.graders, definition.executors,
      registries => validateSpecs(files, registries));
    const errors = results.filter(result => !result.valid)
      .map(result => `${relative(run.inputs, result.file)}: ${result.errors.join('; ')}`);
    check(errors.length === 0, `eval specification validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Stage, verify and validate the selected cells. A dry-run stops here and
 * makes no model call. A paid run then drives Vally once per cell: one trial,
 * one worker, a timeout and no retry.
 */
export async function runBench(options: RunOptions, source: NodeJS.ProcessEnv = process.env,
  dependencies: RunDependencies = defaultDependencies): Promise<RunResult> {
  const config = loadConfig(options.config);
  const cells = selectCells(config, options.selection);
  check(options.trusted === true || source.SKILL_BENCH_TRUSTED === '1',
    'this command runs eval and plugin code; use --trusted (or SKILL_BENCH_TRUSTED=1) only for reviewed code.');
  const paid = !options.dryRun;
  check(!(paid && (source.GITHUB_EVENT_NAME ?? '').startsWith('pull_request')),
    'paid runs are not permitted for pull request events.');
  const runRootOption = options.runRoot ?? source.SKILL_BENCH_RUN_ROOT;
  check(runRootOption, 'use --run-root <existing directory outside any repository or agent configuration>.');
  check(existsSync(runRootOption), `--run-root ${runRootOption} does not exist.`);
  const runRoot = realpathSync(runRootOption);
  let output: string | undefined;
  if (paid) {
    check(options.output, 'a paid run needs --output <new directory>.');
    output = checkOutput(config, options.output, runRoot);
    check(modelToken(source), 'set COPILOT_GITHUB_TOKEN (or GH_TOKEN / GITHUB_TOKEN) for a paid run.');
    checkVallyCli(dependencies.vallyCli);
  }
  const registry = options.registry ?? source.SKILL_BENCH_NPM_REGISTRY;
  const preflights = new Map<string, LoadedPreflight[]>();
  for (const skill of new Set(cells.map(cell => cell.skill))) {
    preflights.set(skill, await loadPreflights(config.skills[skill].preflight));
  }
  const run = await stageRun(config, cells, runRoot, dependencies.ancestorCheck);
  let manifest: Manifest | undefined;
  let save: (() => void) | undefined;
  const execute = async (): Promise<RunResult> => {
    prepareCells(run, config, preflights);
    const environments = new Map<number, Environment>(run.cells.map(cell => [cell.index, cellEnvironment(cell.root, source, {
      paid, settings: run.settings, registry, fixed: config.env,
    })]));
    await validateCells(run, config);
    const manifestCells = run.cells.map(manifestCell);
    manifest = {
      type: 'skill-bench-matrix', version: 1, vallyVersion, runId: randomUUID(),
      planHash: hash(JSON.stringify(manifestCells.map(cell => ({ ...cell, skills: [], sharedSkills: [] })))),
      title: config.title, display: config.display, cells: manifestCells,
    };
    if (!paid || output === undefined) {
      dependencies.log(`Staged, verified and validated ${run.cells.length} cells. No model was called.`);
      for (const cell of run.cells) dependencies.log(`  ${cell.id}: skills=${cell.skills.length} shared=${cell.sharedSkills.length}`);
      return { exitCode: 0, dryRun: true, cells: manifestCells };
    }
    const destination = output;
    for (const [skill, loaded] of preflights) {
      for (const item of loaded) {
        if (!item.plugin.run) continue;
        const root = join(run.root, 'preflight', skill, item.plugin.name);
        createCellDirectories(root, run.settings);
        item.plugin.prepareCell?.({ options: item.options, cellRoot: root, home: join(root, 'home'), appData: join(root, 'appdata') });
        mkdirSync(join(root, 'work'));
        dependencies.log(`Preflight ${item.plugin.name} for ${skill}.`);
        const env = cellEnvironment(root, source, { paid: false, settings: run.settings, registry, fixed: config.env });
        try {
          await item.plugin.run({ options: item.options, workDir: join(root, 'work'), env });
        } finally {
          await teardown([item], `preflight ${skill}`, { cellRoot: root, workspace: null, env }, dependencies.log);
        }
      }
    }
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    const written = manifest;
    save = () => {
      const temporary = join(destination, 'matrix-manifest.json.tmp');
      writeFileSync(temporary, JSON.stringify(written, null, 2) + '\n');
      renameSync(temporary, join(destination, 'matrix-manifest.json'));
    };
    save();
    let exitCode = 0;
    for (const [position, cell] of run.cells.entries()) {
      const record = manifestCells[position];
      const definition = config.skills[cell.skill];
      const cellOutput = join(destination, cell.variant, cell.skill, cell.scenario);
      const args = [dependencies.vallyCli, 'eval', '--eval-spec', cell.specFile, '--model', cell.model,
        '--runs', '1', '--timeout', config.timeout, '--workers', '1', '--max-retries', '0', '--require-pass',
        '--workspace', cell.workspace, '--output-dir', cellOutput];
      for (const plugin of definition.executors) args.push('--executor-plugin', plugin);
      for (const plugin of definition.graders) args.push('--grader-plugin', plugin);
      dependencies.log(`Cell ${position + 1}/${run.cells.length}: ${cell.id}`);
      const child = dependencies.spawn(process.execPath, args, {
        cwd: run.inputs, env: environments.get(cell.index), shell: false, stdio: ['ignore', 'inherit', 'inherit'],
      });
      const results = findResults(cellOutput);
      record.results = results ? relative(destination, results).replaceAll('\\', '/') : null;
      record.exitCode = child.status;
      save();
      if (existsSync(cell.workspace)) {
        const snapshot = results ? join(dirname(results), 'workspace') : join(cellOutput, 'workspace');
        try {
          saveWorkspaceSnapshot(cell.workspace, snapshot, { keepValues: config.keepValues });
          record.workspace = relative(destination, snapshot).replaceAll('\\', '/');
        } catch (error) {
          record.workspaceError = error instanceof Error ? error.message : String(error);
          exitCode ||= 2;
        }
        save();
      }
      await teardown(preflights.get(cell.skill) ?? [], cell.id,
        { cellRoot: cell.root, workspace: cell.workspace, env: environments.get(cell.index) ?? {} }, dependencies.log);
      check(!child.error && child.signal === null && child.status !== null,
        `cell ${cell.id} did not complete; partial results are in ${destination}.`);
      // A zero exit without results is a harness failure.
      exitCode ||= child.status || (results === null ? 2 : 0);
    }
    return { exitCode, dryRun: false, cells: manifestCells, output: destination };
  };
  let result: RunResult | undefined;
  try {
    result = await execute();
  } finally {
    // A cleanup failure never hides the results or changes the exit code.
    const error = await removeRunRoot(run.root, dependencies);
    if (error !== null) {
      dependencies.log(`Warning: cannot remove the staged run root ${run.root}: ${error}. The results are kept. `
        + 'Remove the directory manually after the processes that use it stop.');
      const cleanup: CleanupRecord = { removed: false, path: run.root, error };
      if (manifest && save) {
        manifest.cleanup = cleanup;
        try {
          save();
        } catch (saveError) {
          dependencies.log(`Warning: cannot record the cleanup failure in the manifest: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
        }
      }
      if (result) result = { ...result, cleanup };
    }
  }
  return result;
}
