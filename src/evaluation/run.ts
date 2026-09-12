import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { generateReport } from './report.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const experiment = join('experiments', 'local.experiment.yaml');
const settings = '{"disabledSkills":["customize-cloud-agent","github-pr-media"]}';
const osVariables = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'OS']);

interface Selection {
  all?: boolean;
  skill?: string;
  models?: string[];
  tier?: string;
}

interface RunOptions extends Selection {
  runRoot?: string;
  output?: string;
  trusted?: boolean;
  dryRun?: boolean;
  report?: boolean;
  registry?: string;
}

interface RunResult {
  exitCode: number;
  dryRun: boolean;
  native?: string;
  site?: string;
  runExit?: number;
  mergeExit?: number;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Local benchmark: ${message}`);
}

function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid benchmark configuration object.');
  return value as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  check(Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string' && v.length > 0)
    && new Set(value).size === value.length, 'configuration lists must contain unique nonempty strings.');
  return value as string[];
}

export function selectBenchmark(value: unknown, selection: Selection) {
  const config = object(value);
  const models = strings(config.models);
  const skills = object(config.skills);
  const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
  check(models.every(model => identifier.test(model)) && Object.keys(skills).length > 0,
    'invalid models/skills in benchmark configuration.');
  const tiers = config.tiers === undefined ? {} : object(config.tiers);
  for (const [name, tier] of Object.entries(tiers)) {
    check(identifier.test(name) && strings(tier).every(model => models.includes(model)),
      'configuration tiers must name registered models.');
  }
  check(Boolean(selection.all) !== (selection.skill !== undefined), 'specify exactly one of --all or --skill <registered-id>.');
  check(selection.skill === undefined || Object.hasOwn(skills, selection.skill), 'unknown --skill; use a registered skill.');
  check(selection.tier === undefined || selection.models === undefined,
    'specify at most one of --tier or --models; a tier is already a named model subset.');
  check(selection.tier === undefined || Object.hasOwn(tiers, selection.tier), 'unknown --tier; use a registered tier.');
  const selectedModels = (selection.tier === undefined ? selection.models : strings(tiers[selection.tier])) ?? models;
  check(selectedModels.length > 0 && new Set(selectedModels).size === selectedModels.length
    && selectedModels.every(model => models.includes(model)), '--models must be a nonempty, unique subset of registered models.');
  const evals: string[] = [];
  const files: string[] = [];
  for (const [id, entry] of Object.entries(skills)) {
    check(identifier.test(id), 'invalid skill identifier in configuration.');
    const definition = object(entry);
    const declaredEvals = strings(definition.evals);
    const declaredFiles = strings(definition.files);
    const safePath = (file: string) => file.split('/').every(part => identifier.test(part) && part !== '.' && part !== '..');
    const target = `templates/skills/${id}`;
    check(declaredEvals.every(file => {
      const parts = file.split('/');
      return safePath(file) && parts.length === 4 && parts[0] === 'evals' && parts[1] === id && parts[3] === 'eval.yaml';
    }), 'configuration evals must use evals/<skill>/<scenario>/eval.yaml.');
    check(declaredFiles.includes(`${target}/SKILL.md`) && declaredFiles.every(file =>
      safePath(file) && (file === `${target}/SKILL.md` || file.startsWith(`${target}/references/`)
        || declaredEvals.some(evalFile => file.startsWith(`${evalFile.slice(0, -'eval.yaml'.length)}fixtures/`)))),
    'configuration files must be target SKILL.md, own references or declared scenario fixtures.');
    if (selection.all || id === selection.skill) {
      evals.push(...declaredEvals);
      files.push(...declaredFiles);
    }
  }
  return { models: models.filter(model => selectedModels.includes(model)), evals, files: [...new Set(files)] };
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function cleanAncestors(directory: string): void {
  for (let current = directory; ; current = dirname(current)) {
    for (const marker of ['.git', 'AGENTS.md', 'CLAUDE.md', '.github', '.agents', '.claude', '.copilot', '.vally.yaml', '.vally.yml']) {
      check(!lstatSync(join(current, marker), { throwIfNoEntry: false }),
        `discovery configuration at ${join(current, marker)}; choose a clean external --run-root.`);
    }
    if (dirname(current) === current) break;
  }
}

export function benchmarkEnvironment(root: string, source: NodeJS.ProcessEnv, dryRun: boolean,
  registry = 'https://registry.npmjs.org/'): NodeJS.ProcessEnv {
  const url = new URL(registry);
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    '--registry must be an HTTPS registry URL without credentials, query or fragment.');
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (osVariables.has(name.toUpperCase())) env[name.toUpperCase()] = value;
  }
  const home = join(root, 'home');
  Object.assign(env, {
    HOME: home, USERPROFILE: home, HOMEDRIVE: parse(home).root.replace(/[\\/]$/, ''),
    HOMEPATH: home.slice(parse(home).root.replace(/[\\/]$/, '').length),
    TEMP: join(root, 'temp'), TMP: join(root, 'temp'), TMPDIR: join(root, 'temp'),
    APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
    XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
    XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'),
    COPILOT_HOME: join(root, 'config'), GH_CONFIG_DIR: join(root, 'config', 'gh'),
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    npm_config_userconfig: join(home, '.npmrc'), npm_config_globalconfig: join(home, 'global.npmrc'),
    npm_config_cache: join(root, 'cache', 'npm'), npm_config_registry: url.href,
    FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT: '1', VALLY_TELEMETRY_OPTOUT: '1',
    COPILOT_AUTO_UPDATE: 'false', COPILOT_HOME_SETTINGS_JSON: settings,
  });
  if (!dryRun) {
    const token = source.COPILOT_GITHUB_TOKEN || source.GH_TOKEN || source.GITHUB_TOKEN;
    check(token, 'set COPILOT_GITHUB_TOKEN (or GH_TOKEN / GITHUB_TOKEN); normal credential stores are not copied.');
    env.COPILOT_GITHUB_TOKEN = token;
  }
  return env;
}

export function runBenchmark(options: RunOptions, sourceEnv = process.env) {
  const selection = selectBenchmark(JSON.parse(readFileSync(join(repository, 'experiments', 'local-benchmark.json'), 'utf8')), options);
  check(options.trusted ?? sourceEnv.VALLY_TRUSTED === '1',
    'review the code and acknowledge --trusted (or VALLY_TRUSTED=1); this is not a sandbox or spending approval.');
  check(options.dryRun || !sourceEnv.GITHUB_EVENT_NAME?.startsWith('pull_request'),
    'paid evaluations must not run in PR-triggered CI.');
  const runRoot = options.runRoot ?? sourceEnv.VALLY_RUN_ROOT;
  check(runRoot, 'set --run-root or VALLY_RUN_ROOT to an existing clean external parent.');
  check(options.output || sourceEnv.VALLY_OUTPUT_ROOT, 'set --output or VALLY_OUTPUT_ROOT to an existing private output parent.');
  const parent = realpathSync(runRoot);
  const requestedOutput = options.output ?? join(realpathSync(sourceEnv.VALLY_OUTPUT_ROOT ?? ''), `benchmark-${randomUUID()}`);
  const output = join(realpathSync(dirname(resolve(requestedOutput))), parse(resolve(requestedOutput)).base);
  const registry = options.registry ?? sourceEnv.VALLY_NPM_REGISTRY;
  const repo = realpathSync(repository);
  check(!inside(repo, parent) && !inside(repo, output), '--run-root and --output must be outside the repository.');
  cleanAncestors(parent);
  check(!lstatSync(output, { throwIfNoEntry: false }), 'choose a new --output private bundle; existing paths are never reused.');
  // Validate authentication and registry before creating any owned files.
  benchmarkEnvironment(parent, sourceEnv, options.dryRun === true, registry);
  const root = mkdtempSync(join(parent, 'vally-local-'));
  let outcome: RunResult | undefined;
  try {
    const env = benchmarkEnvironment(root, sourceEnv, options.dryRun === true, registry);
    for (const directory of ['home', 'temp', 'appdata', 'localappdata', 'config', 'cache', 'data', 'state', 'empty']) {
      mkdirSync(join(root, directory));
    }
    writeFileSync(join(root, 'config', 'settings.json'), settings);
    for (const file of [...selection.evals, ...selection.files]) {
      const source = realpathSync(join(repo, ...file.split('/')));
      check(inside(repo, source), 'input links must not leave the trusted repository.');
      const target = join(root, 'inputs', file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    const definition = {
      name: 'local-skill-benchmark',
      evals: selection.evals.map(file => `../${file}`),
      overrides: { runs: 1, timeout: '10m' }, execution: { workers: 1 },
      baseline: { skill: 'off', model: selection.models[0] },
      matrix: {
        skill: { path: '/environment/skills', values: [{ off: [] }, { on: ['../templates/skills/${eval.grandparent}'] }] },
        model: { path: '/defaults/model', values: selection.models },
      },
    };
    mkdirSync(join(root, 'inputs', 'experiments'));
    // JSON is valid YAML; Vally validates and expands this native matrix.
    writeFileSync(join(root, 'inputs', experiment), JSON.stringify(definition, null, 2));
    const vally = join(repo, 'node_modules', '@microsoft', 'vally-cli', 'dist', 'index.js');
    const invoke = (args: string[]) => {
      const child = spawnSync(process.execPath, [vally, ...args], {
        cwd: join(root, 'empty'), env, shell: false, stdio: ['ignore', 'inherit', 'inherit'],
      });
      check(!child.error, 'could not launch native Vally; restore the pinned dependencies and check Node.js.');
      check(child.signal === null, `native Vally terminated by ${child.signal}; private output: ${output}`);
      check(child.status !== null, `native Vally has no exit status; private output: ${output}`);
      return child.status;
    };
    const runId = randomUUID();
    const raw = join(output, 'raw');
    const shard = join(raw, runId, 'shard-1-of-1');
    const native = join(output, 'native');
    const args = ['experiment', 'run', join(root, 'inputs', experiment),
      '--shard', '1/1', '--run-id', runId, '--workspace', join(root, 'trials'),
      '--output-dir', raw, '--workers', '1', '--require-pass'];
    if (options.dryRun) {
      const exitCode = invoke([...args, '--dry-run']);
      check(exitCode === 0, `native dry-run failed (exit ${exitCode}); no measurements or dashboard were generated.`);
      outcome = { exitCode, dryRun: true };
      return outcome;
    }
    mkdirSync(output, { mode: 0o700 });
    const runExit = invoke(args);
    check(lstatSync(join(shard, 'shard-manifest.json'), { throwIfNoEntry: false }),
      `native run exit ${runExit}, missing shard manifest; partial results retained privately at ${output}.`);
    // Even an unsharded native run writes a shard manifest. Native merge alone
    // produces the canonical experiment manifest consumed by the existing report.
    const mergeExit = invoke(['experiment', 'merge', shard, '--output-dir', native, '--require-pass']);
    check(lstatSync(join(native, 'experiment-manifest.json'), { throwIfNoEntry: false }),
      `native run exit ${runExit}, merge exit ${mergeExit}, missing experiment manifest; private results: ${output}.`);
    const site = options.report ? generateReport(native, join(output, 'site')) : undefined;
    outcome = { exitCode: runExit || mergeExit, dryRun: false, native, site, runExit, mergeExit };
    return outcome;
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
      console.error(`Local benchmark: cleanup failed (${code}) for ${root}; inspect owned processes before removal. Private output: ${output}`);
      if (outcome) outcome.exitCode ||= 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      'run-root': { type: 'string' }, output: { type: 'string' }, registry: { type: 'string' },
      trusted: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, report: { type: 'boolean' },
      all: { type: 'boolean' }, skill: { type: 'string' }, models: { type: 'string', multiple: true },
      tier: { type: 'string' },
    }, strict: true });
    const result = runBenchmark({
      runRoot: values['run-root'], output: values.output, trusted: values.trusted,
      dryRun: values['dry-run'], report: values.report, registry: values.registry,
      all: values.all, skill: values.skill, models: values.models, tier: values.tier,
    });
    console.log(result.dryRun ? 'Dry-run only: no measured trials or dashboard generated.'
      : `Native results: ${result.native}${result.site ? `\nStatic site: ${result.site}` : ''}\nNative run/merge exits: ${result.runExit}/${result.mergeExit}\nWorkflow exit: ${result.exitCode}`);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
