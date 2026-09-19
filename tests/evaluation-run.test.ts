import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import { generateReport } from '../src/evaluation/report.js';
import { benchmarkEnvironment, experimentDefinition, runBenchmark, selectBenchmark } from '../src/evaluation/run.js';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('../src/evaluation/report.js', () => ({ generateReport: vi.fn() }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, lstatSync: vi.fn(fs.lstatSync), rmSync: vi.fn(fs.rmSync) };
});

let root: string;
const secret = 'private-token-canary';
const env = { PATH: process.env.PATH, GH_TOKEN: secret };
const result = (status = 0) => ({ status, signal: null, error: undefined, pid: 1, output: [], stdout: '', stderr: '' });
const options = () => ({ runRoot: root, output: join(root, 'private'), trusted: true, all: true });
const legacyOptions = () => ({ ...options(), all: false, skill: 'azure-functions-create' });
const registry = JSON.parse(readFileSync(resolve('experiments', 'local-benchmark.json'), 'utf8'));
const config = {
  models: ['claude-sonnet-5', 'gpt-6-astra'],
  tiers: { powerful: ['gpt-6-astra'], medium: ['claude-sonnet-5'] },
  skills: {
    'azure-functions-create': {
      evals: ['evals/azure-functions-create/typescript-http/eval.yaml'],
      files: ['templates/skills/azure-functions-create/SKILL.md'],
    },
    'another-skill': {
      evals: ['evals/another-skill/typescript-http/eval.yaml'],
      files: ['templates/skills/another-skill/SKILL.md'],
    },
  },
};

beforeEach(async () => {
  vi.clearAllMocks();
  root = createTempDir('af-local-eval-');
  // Unit tests may live below the developer home; only their own discovery fixtures apply.
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(lstatSync).mockImplementation((path, opts) =>
    resolve(String(path)).startsWith(root) ? fs.lstatSync(path, opts) : undefined);
  vi.mocked(spawnSync).mockImplementation((_command, argv) => {
    if (_command === 'dotnet') return result();
    const args = [...(argv ?? [])];
    if (String(args[0]).endsWith('plugin-matrix.js')) {
      const control = JSON.parse(readFileSync(String(args[2]), 'utf8'));
      if (!control.dryRun) {
        mkdirSync(control.output, { recursive: true });
        writeFileSync(join(control.output, 'matrix-manifest.json'), '{}');
      }
      return result();
    }
    const output = args[args.indexOf('--output-dir') + 1];
    if (args.includes('--dry-run')) return result();
    if (args[1] === 'experiment' && args[2] === 'run') {
      const runId = args[args.indexOf('--run-id') + 1];
      mkdirSync(join(output, runId, 'shard-1-of-1'), { recursive: true });
      writeFileSync(join(output, runId, 'shard-1-of-1', 'shard-manifest.json'), '{}');
    } else {
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, 'experiment-manifest.json'), '{}');
    }
    return result();
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  removeDir(root);
});

describe('benchmarkEnvironment', () => {
  it('allowlists OS/executables and one supported token, replacing every discovery profile', () => {
    const isolated = benchmarkEnvironment(root, {
      Path: 'executables', SystemRoot: 'system', GH_TOKEN: secret,
      HOME: 'developer', USERPROFILE: 'developer', APPDATA: 'developer',
      SSH_AUTH_SOCK: 'signing-agent', AZURE_CLIENT_SECRET: 'azure-secret',
      COPILOT_CLI_BINARY_VERSION: 'ambient', COPILOT_SKILLS_DIRS: 'unwanted',
      COPILOT_CLI_PATH: 'unwanted', NODE_OPTIONS: 'unwanted', NODE_PATH: 'unwanted',
      EVALUATE_USE_HOST_COPILOT_HOME: 'true', npm_config_userconfig: 'credentials',
    }, false);
    expect(isolated.PATH).toBe('executables');
    expect(isolated.COPILOT_GITHUB_TOKEN).toBe(secret);
    for (const key of ['GH_TOKEN', 'SSH_AUTH_SOCK', 'AZURE_CLIENT_SECRET', 'NODE_OPTIONS',
      'NODE_PATH', 'COPILOT_CLI_PATH', 'COPILOT_CLI_BINARY_VERSION', 'COPILOT_SKILLS_DIRS',
      'EVALUATE_USE_HOST_COPILOT_HOME']) expect(isolated[key]).toBeUndefined();
    for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP',
      'COPILOT_HOME', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
      'npm_config_userconfig', 'npm_config_globalconfig']) {
      expect(relative(root, isolated[key] ?? '').startsWith('..')).toBe(false);
    }
    expect(JSON.parse(isolated.COPILOT_HOME_SETTINGS_JSON ?? '')).toEqual({
      disabledSkills: ['customize-cloud-agent', 'github-pr-media'],
    });
    expect(isolated.npm_config_registry).toBe('https://registry.npmjs.org/');
  });

  it('does not pass authentication to a free dry-run or silently use a credential store', () => {
    expect(benchmarkEnvironment(root, env, true).COPILOT_GITHUB_TOKEN).toBeUndefined();
    expect(() => benchmarkEnvironment(root, {}, false)).toThrow(/COPILOT_GITHUB_TOKEN.*GH_TOKEN/);
    expect(benchmarkEnvironment(root, { COPILOT_GITHUB_TOKEN: secret, GH_TOKEN: 'other' }, false)
      .COPILOT_GITHUB_TOKEN).toBe(secret);
    expect(benchmarkEnvironment(root, { GITHUB_TOKEN: secret }, false).COPILOT_GITHUB_TOKEN).toBe(secret);
  });
});

describe('selectBenchmark', () => {
  it('requires an explicit all or single-skill selection, even for dry-runs', () => {
    expect(() => selectBenchmark(config, {})).toThrow(/--all.*--skill/);
    expect(() => selectBenchmark(config, { all: true, skill: 'azure-functions-create' })).toThrow(/--all.*--skill/);
    expect(() => selectBenchmark(config, { skill: '' })).toThrow(/skill/);
    expect(() => selectBenchmark(config, { skill: 'unregistered' })).toThrow(/skill/);
  });

  it('selects registered evals/files and model subsets in central configuration order', () => {
    expect(selectBenchmark(config, { skill: 'another-skill', models: ['gpt-6-astra'] })).toEqual({
      models: ['gpt-6-astra'],
      evals: config.skills['another-skill'].evals,
      files: config.skills['another-skill'].files,
      sharedSkills: [],
      graderPlugins: [], executorPlugins: [],
    });
    const all = selectBenchmark(config, { all: true, models: ['gpt-6-astra', 'claude-sonnet-5'] });
    expect(all.models).toEqual(config.models);
    expect(all.evals).toHaveLength(2);
    expect(all.files).toHaveLength(2);
    for (const models of [[], [''], ['unknown'], ['gpt-6-astra', 'gpt-6-astra']])
      expect(() => selectBenchmark(config, { all: true, models })).toThrow(/model/);
  });

  it('rejects malformed configuration, path escapes and discovery/other-skill inputs', () => {
    for (const invalid of [null, {}, { ...config, models: [] }, { ...config, models: ['bad/id'] }])
      expect(() => selectBenchmark(invalid, { all: true })).toThrow(/config/i);
    for (const file of ['../secret', '/absolute', 'templates/skills/another-skill/SKILL.md',
      'templates/skills/azure-functions-create/../../.github/copilot-instructions.md',
      'evals/azure-functions-create/typescript-http/AGENTS.md']) {
      const invalid = structuredClone(config);
      invalid.skills['azure-functions-create'].files.push(file);
      expect(() => selectBenchmark(invalid, { all: true })).toThrow(/config/i);
    }
  });

  it('resolves a registered tier to its models and keeps central configuration order', () => {
    expect(selectBenchmark(config, { all: true, tier: 'powerful' }).models).toEqual(['gpt-6-astra']);
    expect(selectBenchmark(config, { all: true, tier: 'medium' }).models).toEqual(['claude-sonnet-5']);
    // A tier is a named model subset, so it must never widen an explicit --models subset.
    expect(() => selectBenchmark(config, { all: true, tier: 'powerful', models: ['claude-sonnet-5'] }))
      .toThrow(/tier.*models|models.*tier/i);
    for (const tier of ['', 'unregistered']) expect(() => selectBenchmark(config, { all: true, tier })).toThrow(/tier/i);
  });

  it('rejects a tier map that does not describe registered models', () => {    for (const tiers of [{ powerful: [] }, { powerful: ['unknown'] }, { powerful: ['gpt-6-astra', 'gpt-6-astra'] },
      { 'bad/id': ['gpt-6-astra'] }, { powerful: 'gpt-6-astra' }, []]) {
      expect(() => selectBenchmark({ ...config, tiers }, { all: true })).toThrow(/config/i);
    }
  });

  it('rejects a tier map that is not a partition of the registered models', () => {
    // A tier map must place every registered model in exactly one tier, so a
    // model that no tier names, or that two tiers name, is a configuration error.
    for (const tiers of [{ powerful: ['gpt-6-astra'] },
      { powerful: ['gpt-6-astra'], medium: ['claude-sonnet-5'], low: ['gpt-6-astra'] }]) {
      expect(() => selectBenchmark({ ...config, tiers }, { all: true })).toThrow(/config/i);
    }
  });

  it('classifies every shipped model into exactly one tier without moving the baseline', () => {
    const tiered = Object.values(registry.tiers as Record<string, string[]>).flat();
    expect(tiered.slice().sort()).toEqual((registry.models as string[]).slice().sort());
    // The baseline is the first selected model, so registry order is behaviour, not formatting.
    expect(selectBenchmark(registry, { all: true }).models[0]).toBe('claude-sonnet-5');
    for (const tier of Object.keys(registry.tiers))
      expect(selectBenchmark(registry, { all: true, tier }).models).toEqual(registry.tiers[tier]);
  });

  it('returns a declared NuGet preflight probe only for the selected scenario', () => {
    const preflight = { targetFramework: 'net8.0', sdk: 'Azure.Functions.Sdk/1.0.0',
      packages: { 'Microsoft.Azure.Functions.Worker': '2.50.0' } };
    const withPreflight = structuredClone(config);
    const registered = withPreflight.skills as unknown as Record<string, unknown>;
    registered['another-skill'] = { ...config.skills['another-skill'], nugetPreflight: preflight };
    expect(selectBenchmark(withPreflight, { skill: 'another-skill' }).nugetPreflight).toEqual(preflight);
    expect(selectBenchmark(withPreflight, { skill: 'azure-functions-create' }).nugetPreflight).toBeUndefined();
    for (const invalid of [{}, { ...preflight, targetFramework: 'net' }, { ...preflight, sdk: 'Azure.Functions.Sdk' },
      { ...preflight, sdk: '../evil/1.0.0' }, { ...preflight, packages: {} },
      { ...preflight, packages: { 'Microsoft.Azure.Functions.Worker': 'latest' } }, true]) {
      registered['another-skill'] = { ...config.skills['another-skill'], nugetPreflight: invalid };
      expect(() => selectBenchmark(withPreflight, { skill: 'another-skill' })).toThrow(/preflight/i);
    }
  });

  it('stages declared dependency skills for both arms and rejects unusable combinations', () => {
    const shared = structuredClone(config);
    const registered = shared.skills as unknown as Record<string, unknown>;
    registered['another-skill'] = { ...config.skills['another-skill'], sharedSkills: ['azure-functions-create'] };
    const selection = selectBenchmark(shared, { skill: 'another-skill' });
    expect(selection.sharedSkills).toEqual(['azure-functions-create']);
    expect(selection.files).toEqual([...config.skills['another-skill'].files,
      ...config.skills['azure-functions-create'].files]);
    // Shared dependencies are per-scenario, so a whole-registry run cannot keep the arms equal.
    expect(() => selectBenchmark(shared, { all: true })).toThrow(/sharedSkills/i);
    for (const invalid of [['another-skill'], ['unregistered'], [], 'azure-functions-create']) {
      registered['another-skill'] = { ...config.skills['another-skill'], sharedSkills: invalid };
      expect(() => selectBenchmark(shared, { skill: 'another-skill' })).toThrow(/sharedSkills|config/i);
    }
  });
});

describe('experimentDefinition', () => {
  it('keeps native experiments plugin-free and selects the separate plugin transport', () => {
    const definition = experimentDefinition(
      ['evals/azure-functions-update/dotnet-isolated/eval.yaml'], ['gpt-6-astra', 'claude-opus-5'], []);
    expect(definition.matrix.model.values).toEqual(['gpt-6-astra', 'claude-opus-5']);
    expect(definition.matrix.skill.values).toHaveLength(2);
    expect(definition.overrides.runs).toBe(1);
    expect(definition).not.toHaveProperty('grader_plugins');
    const selected = selectBenchmark(registry, { skill: 'azure-functions-update' });
    expect(selected.graderPlugins).toEqual(['code-only-grader.js']);
    expect(selected.executorPlugins).toEqual(['interactive-executor.js']);
  });
  it('differs between arms only by the measured skill', () => {
    const definition = experimentDefinition(['evals/a/b/eval.yaml'], ['gpt-6-astra'], []);
    expect(definition.matrix.skill.values).toEqual([{ off: [] }, { on: ['../templates/skills/${eval.grandparent}'] }]);
    expect(definition.baseline).toEqual({ skill: 'off', model: 'gpt-6-astra' });
    expect(definition.evals).toEqual(['../evals/a/b/eval.yaml']);
  });

  it('keeps declared dependency skills present in the off and on arms', () => {
    const definition = experimentDefinition(['evals/a/b/eval.yaml'], ['gpt-6-astra'], ['azure-functions-doctor']);
    expect(definition.matrix.skill.values).toEqual([
      { off: ['../templates/skills/azure-functions-doctor'] },
      { on: ['../templates/skills/azure-functions-doctor', '../templates/skills/${eval.grandparent}'] },
    ]);
  });
});

describe('runBenchmark', () => {
  it('stages fixed inputs and validates the plugin transport without model calls in a dry-run', () => {
    let temporary = '';
    vi.mocked(spawnSync).mockImplementation((_command, argv, opts) => {
      const args = [...(argv ?? [])];
      const cwd = String(opts?.cwd);
      temporary = dirname(cwd);
      expect(cwd).toBe(join(temporary, 'inputs'));
      expect(args[0]).toBe(resolve('lib', 'evaluation', 'plugin-matrix.js'));
      expect(args[1]).toBe('--config');
      const definition = JSON.parse(readFileSync(String(args[2]), 'utf8'));
      expect(definition.sharedSkills).toEqual([]);
      expect(definition.models).toEqual(registry.models);
      expect(definition.dryRun).toBe(true);
      expect(definition.graderPlugins).toEqual([resolve('lib', 'evaluation', 'code-only-grader.js')]);
      expect(definition.executorPlugins).toEqual([resolve('lib', 'evaluation', 'interactive-executor.js')]);
      const skills = join(temporary, 'inputs', 'templates', 'skills');
      expect(readdirSync(skills).sort()).toEqual(['azure-functions-create', 'azure-functions-update']);
      expect(readdirSync(join(skills, 'azure-functions-create')).sort()).toEqual(['SKILL.md', 'references']);
      expect(readdirSync(join(skills, 'azure-functions-create', 'references')).sort())
        .toEqual(['go-project.md', 'language-snippets.md']);
      expect(existsSync(join(temporary, 'inputs', '.vally.yaml'))).toBe(false);
      expect(opts?.env?.HOME).toBe(join(temporary, 'home'));
      expect(readFileSync(join(temporary, 'appdata', 'NuGet', 'NuGet.Config'), 'utf8'))
        .toContain('https://api.nuget.org/v3/index.json');
      expect(opts?.env?.COPILOT_GITHUB_TOKEN).toBeUndefined();
      expect(opts?.shell).toBe(false);
      return result();
    });
    expect(runBenchmark({ ...options(), dryRun: true, report: true }, env).dryRun).toBe(true);
    expect(existsSync(temporary)).toBe(false);
    expect(existsSync(options().output)).toBe(false);
    expect(generateReport).not.toHaveBeenCalled();
  });

  it('uses a selected model as the baseline without running extra model-specific commands', () => {
    const normal = vi.mocked(spawnSync).getMockImplementation();
    vi.mocked(spawnSync).mockImplementation((...args) => {
      if (args[1]?.[2] === 'run') {
        const definition = JSON.parse(readFileSync(args[1][3], 'utf8'));
        expect(definition.baseline).toEqual({ skill: 'off', model: 'gpt-6-astra' });
        expect(definition.matrix.model.values).toEqual(['gpt-6-astra']);
        expect(definition.evals).toEqual(['../evals/azure-functions-create/typescript-http/eval.yaml']);
      }
      return normal?.(...args) ?? result();
    });
    runBenchmark({ ...options(), all: false, skill: 'azure-functions-create', models: ['gpt-6-astra'] }, env);
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it('stages the reused update fixture, checklist and deterministic grader for the scenario', () => {
    vi.mocked(spawnSync).mockImplementation((command, argv, opts) => {
      if (command === 'dotnet') return result();
      const inputs = join(dirname(String(opts?.cwd)), 'inputs');
      const definition = JSON.parse(readFileSync(String(argv?.[2]), 'utf8'));
      expect(definition.evals).toEqual(['evals/azure-functions-update/dotnet-isolated/eval.yaml']);
      expect(readdirSync(join(inputs, 'templates', 'skills'))).toEqual(['azure-functions-update']);
      const scenario = join(inputs, 'evals', 'azure-functions-update', 'dotnet-isolated');
      expect(readdirSync(join(scenario, 'fixtures')).sort()).toEqual(['GreetingService.cs', 'Hello.cs', 'QueueGreeting.cs', 'Startup.cs', 'UpgradeApp.csproj',
        'baseline', 'checks', 'definition-of-done.json', 'eval-boundaries.md', 'host.json', 'review-basis.md', 'trial.gitignore', 'user-answers.json']);
      expect(readdirSync(join(scenario, 'fixtures', 'baseline')).sort())
        .toEqual(['GreetingService.cs.txt', 'Hello.cs.txt', 'QueueGreeting.cs.txt', 'Startup.cs.txt', 'UpgradeApp.csproj.txt', 'host.json.txt']);
      expect(readdirSync(join(scenario, 'fixtures', 'checks')).sort()).toEqual(['AzuriteContract.ps1', 'Invoke-DefinitionOfDone.ps1']);
      expect(readFileSync(join(scenario, 'eval.yaml'), 'utf8')).toContain('grading-evidence/checklist.json');
      return result();
    });
    expect(runBenchmark({ ...options(), all: false, skill: 'azure-functions-update',
      models: ['gpt-6-astra'], dryRun: true }, env).dryRun).toBe(true);
  });

  it('preflights the declared Functions packages from an isolated credential-free NuGet source', () => {
    const normal = vi.mocked(spawnSync).getMockImplementation();
    const nugetSource = 'https://packages.example.test/nuget/v3/index.json';
    vi.mocked(spawnSync).mockImplementation((command, argv, opts) => {
      if (command === 'dotnet') {
        expect(argv?.slice(0, 2)).toEqual(['restore', expect.stringMatching(/nuget-preflight\.csproj$/)]);
        const probe = readFileSync(String(argv?.[1]), 'utf8');
        expect(probe).toContain('Sdk="Azure.Functions.Sdk/');
        expect(probe).toContain('<TargetFramework>net8.0</TargetFramework>');
        expect(probe).toContain('Microsoft.Azure.Functions.Worker');
        expect(readFileSync(join(String(opts?.env?.APPDATA), 'NuGet', 'NuGet.Config'), 'utf8')).toContain(nugetSource);
        return result();
      }
      return normal?.(command, argv, opts) ?? result();
    });
    runBenchmark({ ...options(), all: false, skill: 'azure-functions-update', nugetSource }, env);
    expect(vi.mocked(spawnSync).mock.calls[0][0]).toBe('dotnet');
  });

  it('skips the paid run and leaves no output when the offline NuGet preflight fails', () => {
    vi.mocked(spawnSync).mockImplementation(command =>
      command === 'dotnet' ? { ...result(1), stderr: 'NU1101: package not found' } : result());
    expect(() => runBenchmark({ ...options(), all: false, skill: 'azure-functions-update' }, env))
      .toThrow(/NuGet preflight.*--nuget-source.*NU1101/is);
    expect(spawnSync).toHaveBeenCalledOnce();
    expect(existsSync(options().output)).toBe(false);
  });

  it('does not spend the preflight on a free dry-run and prefers the option over the environment source', () => {
    const sources: string[] = [];
    const normal = vi.mocked(spawnSync).getMockImplementation();
    vi.mocked(spawnSync).mockImplementation((command, argv, opts) => {
      sources.push(`${String(command)} ${readFileSync(join(String(opts?.env?.APPDATA), 'NuGet', 'NuGet.Config'), 'utf8')}`);
      return normal?.(command, argv, opts) ?? result();
    });
    const sourceEnv = { ...env, VALLY_NUGET_SOURCE: 'https://environment.example.test/v3/index.json' };
    runBenchmark({ ...options(), all: false, skill: 'azure-functions-update', dryRun: true }, sourceEnv);
    runBenchmark({ ...options(), all: false, skill: 'azure-functions-update', dryRun: true,
      output: join(root, 'second'), nugetSource: 'https://option.example.test/v3/index.json' }, sourceEnv);
    expect(sources.every(source => !source.startsWith('dotnet'))).toBe(true);
    expect(sources[0]).toContain('https://environment.example.test/v3/index.json');
    expect(sources[1]).toContain('https://option.example.test/v3/index.json');
    for (const invalid of ['http://insecure.example.test/v3/index.json', 'https://user:token@example.test/v3/index.json',
      'https://example.test/v3/index.json?key=secret', 'not-a-url']) {
      expect(() => runBenchmark({ ...options(), all: false, skill: 'azure-functions-update',
        dryRun: true, nugetSource: invalid }, env)).toThrow(/nuget source/i);
    }
  });

  it('supports explicit environment defaults and creates a fresh private bundle on every invocation', () => {
    const source = { ...env, VALLY_RUN_ROOT: root, VALLY_OUTPUT_ROOT: root, VALLY_TRUSTED: '1',
      VALLY_NPM_REGISTRY: 'https://registry.example.test/' };
    const first = runBenchmark({ all: true }, source);
    const second = runBenchmark({ skill: 'azure-functions-create' }, source);
    expect(first.native).not.toBe(second.native);
    expect(readdirSync(root)).toHaveLength(2);
    expect(vi.mocked(spawnSync).mock.calls[0][2]?.env?.npm_config_registry).toBe(source.VALLY_NPM_REGISTRY);
    expect(vi.mocked(spawnSync).mock.calls[0][2]?.env?.VALLY_TRUSTED).toBeUndefined();
    expect(() => runBenchmark({ ...options(), trusted: false }, source)).toThrow(/--trusted/);
    expect(() => runBenchmark({ all: true, trusted: true }, env)).toThrow(/run-root/i);
  });

  it('rejects omitted selectors before native launch and never creates a bundle', () => {
    expect(() => runBenchmark({ ...options(), all: false }, env)).toThrow(/--all.*--skill/);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual([]);
  });

  it('keeps the native experiment path for evaluations that need no plugins', () => {
    const outcome = runBenchmark({ ...legacyOptions(), report: true }, env);
    const calls = vi.mocked(spawnSync).mock.calls;
    expect(calls).toHaveLength(2);
    const args = calls[0][1] ?? [];
    expect(args).toContain('--shard');
    expect(args[args.indexOf('--shard') + 1]).toBe('1/1');
    expect(args[args.indexOf('--workers') + 1]).toBe('1');
    expect(args).toContain('--require-pass');
    for (const flag of ['--compare', '--work-dir', '--max-retries', '--model', '--variant', '--verbose'])
      expect(args).not.toContain(flag);
    expect(JSON.stringify(args)).not.toContain(secret);
    expect(calls[1][1]?.slice(1, 3)).toEqual(['experiment', 'merge']);
    expect(generateReport).toHaveBeenCalledWith(join(options().output, 'native'), join(options().output, 'site'));
    expect(outcome.exitCode).toBe(0);
    expect(readdirSync(root)).toEqual(['private']);
  });

  it('keeps measured failures nonzero while reporting valid native results', () => {
    const normal = vi.mocked(spawnSync).getMockImplementation();
    vi.mocked(spawnSync).mockImplementation((...args) => {
      normal?.(...args);
      return args[0] === 'dotnet' ? result() : result(1);
    });
    expect(runBenchmark({ ...options(), report: true }, env).exitCode).toBe(1);
    expect(generateReport).toHaveBeenCalledOnce();
    expect(existsSync(join(options().output, 'native', 'matrix-manifest.json'))).toBe(true);
    expect(readdirSync(root)).toEqual(['private']);
  });

  it('preserves partial outputs without inventing a report when native fails before its manifest', () => {
    vi.mocked(spawnSync).mockImplementation(command => command === 'dotnet' ? result() : result(2));
    expect(() => runBenchmark({ ...options(), report: true }, env)).toThrow(/exit 2.*private/i);
    expect(generateReport).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual(['private']);
  });

  it('surfaces launch, signal and missing-result errors and still cleans owned staging', () => {
    vi.mocked(spawnSync).mockImplementation(() => ({ ...result(), error: new Error('spawn failed') }));
    expect(() => runBenchmark({ ...options(), dryRun: true }, env)).toThrow(/launch/i);
    vi.mocked(spawnSync).mockImplementation(() => ({ ...result(), status: null, signal: 'SIGTERM' }));
    expect(() => runBenchmark({ ...options(), dryRun: true }, env)).toThrow(/SIGTERM/);
    vi.mocked(spawnSync).mockImplementation(() => result());
    expect(() => runBenchmark(options(), env)).toThrow(/manifest/i);
    expect(readdirSync(root)).toEqual(['private']);
  });

  it('surfaces report errors without discarding real native artifacts', () => {
    vi.mocked(generateReport).mockImplementationOnce(() => { throw new Error('report invalid'); });
    expect(() => runBenchmark({ ...options(), report: true }, env)).toThrow('report invalid');
    expect(existsSync(join(options().output, 'native', 'matrix-manifest.json'))).toBe(true);
    expect(readdirSync(root)).toEqual(['private']);
  });

  it.each([0, 2])('preserves native exit %s and artifact paths while making cleanup failures nonzero', nativeExit => {
    const normal = vi.mocked(spawnSync).getMockImplementation();
    vi.mocked(spawnSync).mockImplementation((...args) => {
      normal?.(...args);
      return args[0] === 'dotnet' ? result() : result(nativeExit);
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(rmSync).mockImplementationOnce(() => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); });
    const outcome = runBenchmark({ ...options(), report: true }, env);
    expect(outcome.exitCode).toBe(nativeExit || 1);
    expect(outcome.runExit).toBe(nativeExit);
    expect(outcome.mergeExit).toBeUndefined();
    expect(outcome.native).toBe(join(options().output, 'native'));
    expect(generateReport).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/cleanup.*EBUSY.*vally-local-.*private/i));
  });

  it('does not replace the primary native failure with a filesystem cleanup error', () => {
    vi.mocked(spawnSync).mockImplementation(command => command === 'dotnet' ? result() : result(2));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(rmSync).mockImplementationOnce(() => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); });
    expect(() => runBenchmark(legacyOptions(), env)).toThrow(/native run exit 2.*missing shard manifest/);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/cleanup.*EPERM/));
    expect(generateReport).not.toHaveBeenCalled();
  });

  it('does not turn a native merge failure into successful completion', () => {
    const normal = vi.mocked(spawnSync).getMockImplementation();
    vi.mocked(spawnSync).mockImplementation((...args) => {
      if (args[1]?.includes('merge')) return result(2);
      return normal?.(...args) ?? result();
    });
    expect(() => runBenchmark({ ...legacyOptions(), report: true }, env)).toThrow(/merge exit 2/);
    expect(generateReport).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual(['private']);
  });

  it('rejects unacknowledged trust, reused output, unsafe registry and discovery ancestors before native launch', () => {
    expect(() => runBenchmark({ ...options(), trusted: false }, env)).toThrow(/--trusted/);
    expect(() => runBenchmark({ ...options(), registry: `https://user:${secret}@example.com` }, env))
      .toThrow(/registry/i);
    mkdirSync(options().output);
    expect(() => runBenchmark(options(), env)).toThrow(/new.*output/i);
    removeDir(options().output);
    mkdirSync(join(root, '.copilot'));
    expect(() => runBenchmark(options(), env)).toThrow(/discovery/i);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('refuses paid PR-triggered execution even when trust is acknowledged', () => {
    expect(() => runBenchmark(options(), { ...env, GITHUB_EVENT_NAME: 'pull_request_target' })).toThrow(/PR-triggered/);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('refuses the repository as the staging/output location', () => {
    expect(() => runBenchmark({ ...options(), runRoot: process.cwd() }, env)).toThrow(/repository/i);
    expect(() => runBenchmark({ ...options(), output: join(process.cwd(), 'never-created') }, env))
      .toThrow(/repository/i);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('rejects repository paths reached through an external directory link', () => {
    const link = join(root, 'repo-link');
    symlinkSync(process.cwd(), link, 'junction');
    expect(() => runBenchmark({ ...options(), runRoot: link }, env)).toThrow(/repository/i);
    expect(() => runBenchmark({ ...options(), output: join(link, 'never-created') }, env)).toThrow(/repository/i);
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
