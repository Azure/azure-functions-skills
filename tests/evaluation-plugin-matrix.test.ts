import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import { runPluginMatrix, saveWorkspaceSnapshot } from '../src/evaluation/plugin-matrix.js';
import { validatePluginEvals } from '../src/evaluation/validate.js';
import { generateReport, readBenchmark } from '../src/evaluation/report.js';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
let root: string;
const success = { status: 0, signal: null, error: undefined, pid: 1, output: [], stdout: '', stderr: '' };
function options(dryRun = true) {
  return {
    inputsRoot: join(root, 'inputs'), workspaceRoot: join(root, 'workspaces'), output: join(root, 'results'),
    runId: 'test-run', evals: ['evals/example/simple/eval.yaml'],
    models: ['gpt-6-astra', 'claude-opus-5'], sharedSkills: [],
    graderPlugins: [], executorPlugins: [join(root, 'executor.mjs')],
    cli: resolve('node_modules/@microsoft/vally-cli/dist/index.js'), dryRun,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  root = createTempDir('plugin-matrix-');
  const input = join(root, 'inputs', 'evals', 'example', 'simple');
  mkdirSync(input, { recursive: true });
  const skill = join(root, 'inputs', 'templates', 'skills', 'example');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: example\ndescription: Example task.\n---\nDo the task.\n');
  writeFileSync(join(input, 'eval.yaml'), JSON.stringify({
    name: 'example-simple', defaults: { executor: { name: 'test-user-policy', config: { answer: 'private-answer' } } },
    agent_environment: { skills: ['../../../templates/skills/example'] },
    stimuli: [{ name: 'simple', prompt: 'Do the task.', graders: [{ type: 'completed' }] }],
  }));
  writeFileSync(join(root, 'executor.mjs'), `
    export function registerExecutors(registry) {
      registry.register({
        name: 'test-user-policy', supportsEnvVars: true,
        validateConfig(config) { if (config.answer !== 'private-answer') throw new Error('Invalid answer policy'); },
        async execute() { throw new Error('A free preflight must not execute'); }, async shutdown() {}
      });
    }
  `);
  vi.mocked(spawnSync).mockImplementation((_command, args) => {
    const output = String(args?.[(args?.indexOf('--output-dir') ?? -1) + 1]);
    mkdirSync(join(output, 'timestamp'), { recursive: true });
    writeFileSync(join(output, 'timestamp', 'results.jsonl'), '');
    return success;
  });
});
afterEach(() => removeDir(root));

describe('plugin-aware matrix transport', () => {
  it('validates a directory with both plugin registries and rejects missing registration', async () => {
    const configured = await validatePluginEvals(options().inputsRoot, [], options().executorPlugins);
    expect(configured).toHaveLength(1);
    expect(configured[0].valid).toBe(true);
    const missing = await validatePluginEvals(options().inputsRoot, [], []);
    expect(missing[0].valid).toBe(false);
    expect(spawnSync).not.toHaveBeenCalled();
  });
  it('validates real plugin registration and plans four arms without any executor or model calls', async () => {
    const result = await runPluginMatrix(options());
    expect(result.cells).toHaveLength(4);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(existsSync(options().output)).toBe(false);
    expect(result.cells.filter(cell => cell.enabled).map(cell => cell.model)).toEqual(['gpt-6-astra', 'claude-opus-5']);
    for (const cell of result.cells) {
      expect(cell.skills).toHaveLength(cell.enabled ? 1 : 0);
      expect(cell.results).toBeNull();
    }
    expect(new Set(result.cells.map(cell => cell.evalHash)).size).toBe(1);
  });

  it('rejects an unregistered executor before any paid launch', async () => {
    await expect(runPluginMatrix({ ...options(false), executorPlugins: [] })).rejects.toThrow(/executor/i);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('passes both plugin flags to each standalone eval and preserves native output files', async () => {
    const graderPlugin = join(root, 'grader.mjs');
    writeFileSync(graderPlugin, 'export function registerGraders() {}');
    const result = await runPluginMatrix({ ...options(false), graderPlugins: [graderPlugin] });
    expect(spawnSync).toHaveBeenCalledTimes(4);
    for (const [index, [_command, args, settings]] of vi.mocked(spawnSync).mock.calls.entries()) {
      expect(args?.[1]).toBe('eval');
      expect(args).toContain('--executor-plugin');
      expect(args).toContain('--grader-plugin');
      expect(args).not.toContain('--output');
      expect(args).toContain('--max-retries');
      expect(settings?.cwd).toBe(options().inputsRoot);
      expect(settings?.shell).toBe(false);
      const spec = JSON.parse(readFileSync(String(args?.[(args?.indexOf('--eval-spec') ?? -1) + 1]), 'utf8'));
      expect(spec.stimuli[0].prompt).toBe('Do the task.');
      expect(spec.stimuli[0].constraints.max_duration).toBe('10m');
      expect(spec.agent_environment.skills).toHaveLength(result.cells[index].enabled ? 1 : 0);
      expect(dirname(String(args?.[(args?.indexOf('--workspace') ?? -1) + 1]))).toBe(options().workspaceRoot);
    }
    const manifest = JSON.parse(readFileSync(join(options().output, 'matrix-manifest.json'), 'utf8'));
    expect(manifest.type).toBe('vally-eval-matrix');
    expect(manifest.cells.every((cell: { results: string | null }) => cell.results?.endsWith('results.jsonl'))).toBe(true);
    expect(existsSync(join(options().output, 'experiment-manifest.json'))).toBe(false);
  });

  it('keeps failures and missing results explicit, without dropping later arms', async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ ...success, status: 2 });
    const result = await runPluginMatrix(options(false));
    expect(result.exitCode).toBe(2);
    expect(result.cells[0]).toMatchObject({ exitCode: 2, results: null });
    expect(result.cells[1].results).not.toBeNull();
    expect(spawnSync).toHaveBeenCalledTimes(4);
  });

  it('executes installed Vally with local fake plugins and exports files without any model client', async () => {
    writeFileSync(join(root, 'executor.mjs'), `
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      export function registerExecutors(registry) {
        registry.register({
          name: 'test-user-policy', supportsEnvVars: true, validateConfig() {},
          async execute(stimulus, options) {
            writeFileSync(join(options.workDir, 'result.txt'), 'static executor output');
            writeFileSync(join(options.workDir, 'local.settings.json'), JSON.stringify({
              IsEncrypted: false,
              Values: {
                FUNCTIONS_WORKER_RUNTIME: 'dotnet-isolated',
                AzureWebJobsStorage: 'UseDevelopmentStorage=true',
                SecretSetting: 'private-value'
              }
            }));
            mkdirSync(join(options.workDir, 'bin'), { recursive: true });
            writeFileSync(join(options.workDir, 'bin', 'generated.dll'), 'generated');
            return {
              id: 'static-trial', stimulus, workDir: options.workDir, events: [], output: 'done',
              metadata: {model: options.model, skillsLoaded: [], executor:'test-user-policy', sessionID:'test'},
              metrics: {
                tokenUsage: {inputTokens:0,outputTokens:0,totalTokens:0,cacheReadTokens:0,cacheWriteTokens:0,callCount:0,byModel:{}},
                toolCallCount:0,toolCallBreakdown:{},simulatedToolCallCount:0,skillActivationCount:0,
                skillActivationBreakdown:{},turnCount:1,wallTimeMs:1,errorCount:0
              }
            };
          }, async shutdown() {}
        });
      }
    `);
    const plugin = join(root, 'grader.mjs');
    writeFileSync(plugin, `
      import { readFileSync } from 'node:fs';
      import { join } from 'node:path';
      export function registerGraders(registry) {
        registry.register({
          metadata: {name:'test-source',description:'Static check',behavior:{requiresWorkspace:true},
            determinism:'static',reference:'reference-free',temporalScope:'point-in-time',costProfile:'free'},
          async grade(input) {
            const passed = readFileSync(join(input.trajectory.workDir, 'result.txt'),'utf8') === 'static executor output';
            return {name:'test-source',kind:'code',passed,score:passed?1:0,evidence:'Static file check'};
          }
        });
      }
    `);
    const source = join(options().inputsRoot, 'evals', 'example', 'simple', 'eval.yaml');
    const spec = JSON.parse(readFileSync(source, 'utf8'));
    spec.stimuli[0].graders = [{ type: 'test-source' }];
    spec.stimuli[0].artifacts = { include: ['result.txt'] };
    writeFileSync(source, JSON.stringify(spec));
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    vi.mocked(spawnSync).mockImplementation((command, args, settings) =>
      actual.spawnSync(command, args, { ...settings, stdio: 'pipe', encoding: 'utf8' }));
    const outcome = await runPluginMatrix({ ...options(false), models: ['gpt-6-astra'], graderPlugins: [plugin] });
    const errors = vi.mocked(spawnSync).mock.results.map(result => result.value?.stderr).join('\n');
    expect(outcome.exitCode, errors).toBe(0);
    for (const cell of outcome.cells) {
      const path = join(options().output, cell.results ?? '');
      const rows = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(rows).toContainEqual(expect.objectContaining({
        type: 'trial-result', gradeResult: expect.objectContaining({ passed: true }),
      }));
      const exported = readdirSync(dirname(path), { recursive: true }).map(String);
      expect(exported.some(file => /artifacts[\\/]result\.txt$/.test(file))).toBe(true);
      const workspace = join(dirname(path), 'workspace');
      const snapshot = readdirSync(workspace, { recursive: true }).map(String);
      expect(snapshot.some(file => /result\.txt$/.test(file))).toBe(true);
      expect(snapshot.some(file => /local\.settings\.redacted\.json$/.test(file))).toBe(true);
      expect(snapshot.some(file => /local\.settings\.json$/.test(file))).toBe(false);
      expect(snapshot.some(file => /generated\.dll$/.test(file))).toBe(false);
      const redactedPath = join(workspace, snapshot.find(file => /local\.settings\.redacted\.json$/.test(file)) ?? '');
      expect(JSON.parse(readFileSync(redactedPath, 'utf8'))).toEqual({
        IsEncrypted: false,
        Values: {
          FUNCTIONS_WORKER_RUNTIME: 'dotnet-isolated',
          AzureWebJobsStorage: 'UseDevelopmentStorage=true',
          SecretSetting: '[REDACTED]',
        },
      });
      expect(JSON.parse(readFileSync(join(workspace, 'snapshot-manifest.json'), 'utf8')))
        .toMatchObject({ version: 1, redacted: expect.arrayContaining([expect.stringContaining('local.settings.json')]) });
    }
    const report = readBenchmark(options().output);
    expect(report.comparisons[0].on?.passed).toBe(1);
    expect(report.comparisons[0].off?.passed).toBe(1);
    expect(existsSync(generateReport(options().output, join(root, 'site')))).toBe(true);
  }, 60_000);

  it('refuses to reuse output and unsafe model identifiers before launch', async () => {
    mkdirSync(options().output);
    await expect(runPluginMatrix(options(false))).rejects.toThrow(/new|empty|exist/i);
    await expect(runPluginMatrix({ ...options(), models: ['../outside'] })).rejects.toThrow(/model/i);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(readdirSync(options().output)).toEqual([]);
  });

  it('preserves a safe snapshot when local settings contain invalid JSON', () => {
    const source = join(root, 'snapshot-source');
    const destination = join(root, 'snapshot-output');
    mkdirSync(source);
    writeFileSync(join(source, 'local.settings.json'), '\uFEFF{ invalid');
    writeFileSync(join(source, '.npmrc'), 'registry=https://example.invalid/\n_authToken=secret');
    saveWorkspaceSnapshot(source, destination);
    expect(existsSync(join(destination, 'local.settings.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(destination, 'local.settings.redacted.json'), 'utf8')))
      .toEqual({ redaction: 'Invalid JSON in local.settings.json; original content omitted.' });
    expect(JSON.parse(readFileSync(join(destination, 'snapshot-manifest.json'), 'utf8')))
      .toMatchObject({
        redacted: ['local.settings.json'],
        excluded: ['.npmrc:sensitive-name'],
      });
  });
});
