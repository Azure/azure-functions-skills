import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { collectUsage, compareTrials, trialOrder, type Trial, type Usage } from './metrics.js';
import { benchmarkPolicy, buildEvalSpec, DEPLOY_FIXTURE_SHA, parseBenchmarkConfig } from './spec.js';
import { cleanupOwnedGroup, probeAzure, probeLocal, runCommand } from './probes.js';
import { MEASURED_EXECUTOR } from './executor.js';
import { workflowEvidenceSchema } from './evidence.js';

const repo = resolve(import.meta.dirname, '..', '..');
const scenarioSchema = z.enum(['create', 'deploy']);
const armSchema = z.enum(['A', 'B', 'C']);
const targetSchema = z.object({ subscription: z.string().uuid(), group: z.string(), owner: z.string().uuid() }).strict();
const versionSchema = z.object({
  node: z.string().min(1).max(512), workerNode: z.string().regex(/^v22\./), npm: z.string().min(1).max(512), az: z.string().min(1).max(512),
  azd: z.string().min(1).max(512), func: z.string().min(1).max(512), vally: z.string().min(1).max(512),
  copilotSdk: z.string().min(1).max(512),
}).strict();
const recordSchema = z.object({
  id: z.string(), scenario: scenarioSchema, arm: armSchema, pair: z.number().int().positive(),
  success: z.boolean(), goalAchieved: z.boolean(), cleanupConfirmed: z.boolean(),
  fingerprint: z.string(), measurementIssue: z.string().nullable(), usage: z.object({
    inputTokens: z.number().nonnegative().nullable(), outputTokens: z.number().nonnegative().nullable(),
    observedInputTokens: z.number().nonnegative().nullable(), observedOutputTokens: z.number().nonnegative().nullable(),
    partialCalls: z.number().nonnegative(), reasoningTokens: z.number().nonnegative().nullable(),
    cacheReadTokens: z.number().nonnegative().nullable(), cacheWriteTokens: z.number().nonnegative().nullable(),
    totalTokens: z.number().nonnegative().nullable(), modelCalls: z.number().nonnegative().nullable(),
    turns: z.number().nonnegative().nullable(), taskLatencyMs: z.number().nonnegative().nullable(),
    models: z.array(z.string()), cacheAccounting: z.enum(['included-in-input', 'separate-input', 'unknown']),
    source: z.enum(['shutdown', 'assistant-usage']),
    hostToolResultBytes: z.number().nonnegative().nullable(),
  }).nullable(),
  versions: versionSchema,
  workflow: workflowEvidenceSchema.nullable(),
  trialLatencyMs: z.number().nonnegative().nullable(),
}).strict();

function read(path: string): unknown {
  if (statSync(path).size > 128 * 1024 * 1024) throw new Error('Evaluation artifact exceeds 128 MiB.');
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
function lines(path: string): unknown[] {
  if (statSync(path).size > 128 * 1024 * 1024) throw new Error('Evaluation log exceeds 128 MiB.');
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown);
}
function write(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Required: ${name}.`);
  return value;
}
function files(root: string, filename: string, depth = 8): string[] {
  if (depth < 0) throw new Error('Evaluation artifact nesting exceeds its limit.');
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Evaluation artifacts cannot be symbolic links.');
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path, filename, depth - 1) : entry.name === filename ? [path] : [];
  });
}
function single(paths: string[]): string {
  if (paths.length !== 1) throw new Error('Exactly one trial artifact is required; do not merge retries or sessions implicitly.');
  return paths[0];
}
function capture(directory: string, input: string): unknown[] {
  const raw = lines(single(readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl')).map(entry => join(directory, entry.name))));
  const start = z.object({ data: z.object({ sessionId: z.string() }) }).parse(singleRecord(raw, 'workflow.capture.start'));
  const native = existsSync(input) ? readdirSync(input, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const root = join(input, entry.name, 'executor-session-logs');
      return existsSync(root) ? files(root, 'events.jsonl').map(lines) : [];
    }).filter(events => events.some(event => z.object({ type: z.literal('session.start'),
      data: z.object({ sessionId: z.literal(start.data.sessionId) }) }).safeParse(event).success)) : [];
  if (native.length > 1) throw new Error('Multiple native sessions match this capture; automatic trial retries are not supported.');
  const isShutdown = (event: unknown): boolean => z.object({ type: z.literal('session.shutdown') }).safeParse(event).success;
  const shutdowns = native[0]?.filter(isShutdown) ?? [];
  if (shutdowns.length > 1) throw new Error('Duplicate native shutdown accounting.');
  return shutdowns.length ? [...raw.filter(event => !isShutdown(event)), ...shutdowns] : raw;
}
function assertReviewedCI(): void {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REF !== `refs/heads/${process.env.GITHUB_DEFAULT_BRANCH}` ||
    !process.env.WORKFLOW_BENCHMARK_APPROVED_SHA ||
    process.env.WORKFLOW_BENCHMARK_APPROVED_SHA !== process.env.GITHUB_SHA) {
    throw new Error('Execution requires the reviewed default-branch SHA and the existing reviewer-gated CI environment.');
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' }, scenario: { type: 'string' }, arm: { type: 'string' },
      pair: { type: 'string' }, outdir: { type: 'string' }, input: { type: 'string' },
      preflight: { type: 'string' },
    },
  });
  const verb = positionals[0];
  if (verb === 'authorize') {
    assertReviewedCI();
    const config = parseBenchmarkConfig(read(required(values.config, '--config')));
    if (config.cacheAccounting === 'unknown') throw new Error('Select evidence-backed cache accounting before approving comparative runs.');
    if (config.reviewedSha !== process.env.GITHUB_SHA ||
      runCommand('git', ['rev-parse', 'HEAD'], repo).trim() !== config.reviewedSha ||
      runCommand('git', ['rev-parse', 'HEAD'], config.azureSkillsRoot).trim() !== config.azureSkillsSha) {
      throw new Error('Reviewed code or Azure Skills SHA does not match the checkout.');
    }
    runCommand('git', ['diff', '--quiet', 'HEAD'], repo);
    runCommand('git', ['diff', '--quiet', 'HEAD'], config.azureSkillsRoot);
    for (const name of ['azure-prepare', 'azure-validate', 'azure-deploy']) {
      statSync(join(config.azureSkillsRoot, name, 'SKILL.md'));
    }
    console.log(JSON.stringify({ ready: true, budgetUsd: config.budgetUsd, hardCostCap: false }));
    return;
  }
  if (verb === 'probe') {
    const scenario = scenarioSchema.parse(positionals[1]);
    const cwd = required(process.env.EVALUATE_WORKSPACE, 'EVALUATE_WORKSPACE');
    const result = scenario === 'create' ? await probeLocal(runCommand, cwd)
      : await probeAzure(runCommand, {
        subscription: required(process.env.AZURE_SUBSCRIPTION_ID, 'AZURE_SUBSCRIPTION_ID'),
        group: required(process.env.AZURE_RESOURCE_GROUP, 'AZURE_RESOURCE_GROUP'),
        owner: required(process.env.EVAL_TRIAL_OWNER, 'EVAL_TRIAL_OWNER'),
      });
    console.log(JSON.stringify({ name: 'independent-probe', kind: 'code', passed: true,
      score: 1, evidence: result.checks.join(', '), metadata: result }));
    return;
  }
  const outdir = resolve(required(values.outdir, '--outdir'));
  mkdirSync(outdir, { recursive: true });
  if (verb === 'versions') {
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('The Copilot benchmark host requires Node 24 or newer, separate from the Node 22 Functions worker.');
    const versions = versionSchema.parse({
      node: process.version, npm: runCommand('npm', ['--version']).trim(),
      workerNode: runCommand(required(process.env.WORKFLOW_WORKER_NODE, 'WORKFLOW_WORKER_NODE'), ['--version']).trim(),
      az: runCommand('az', ['version', '--query', '"azure-cli"', '-o', 'tsv']).trim(),
      azd: runCommand('azd', ['version']).trim(), func: runCommand('func', ['--version']).trim(),
      vally: z.object({ version: z.string() }).parse(read(join(repo, 'node_modules', '@microsoft', 'vally', 'package.json'))).version,
      copilotSdk: z.object({ version: z.string() }).parse(read(join(repo, 'node_modules', '@github', 'copilot-sdk', 'package.json'))).version,
    });
    write(join(outdir, 'versions.json'), versions);
    console.log(JSON.stringify(versions));
    return;
  }
  if (verb === 'cleanup') {
    const target = targetSchema.parse(read(join(outdir, 'target.json')));
    const result = cleanupOwnedGroup(runCommand, target);
    write(join(outdir, 'cleanup.json'), result);
    console.log(JSON.stringify(result));
    return;
  }
  const config = parseBenchmarkConfig(read(required(values.config, '--config')));
  if (verb === 'prepare-preflight') {
    write(join(outdir, 'eval.yaml'), {
      name: 'workflow-usage-preflight',
      defaults: { runs: 1, timeout: '2m', executor: MEASURED_EXECUTOR, model: config.model },
      environment: { skills: [] },
      stimuli: [{
        name: 'usage-readiness', prompt: 'Reply exactly workflow-usage-ready. Do not use tools or delegate.',
        constraints: { max_turns: 2, max_duration: '1m' },
        graders: [{ type: 'completed' }, { type: 'output-matches', config: { pattern: '^workflow-usage-ready\\s*$' } }],
      }],
    });
    return;
  }
  if (verb === 'check-preflight') {
    const input = resolve(required(values.input, '--input'));
    const result = z.object({
      status: z.literal('success'), gradeResult: z.object({ passed: z.literal(true) }),
      trajectory: z.object({ metadata: z.object({ sessionID: z.string(), model: z.string() }) }),
    }).parse(singleRecord(lines(single(files(input, 'results.jsonl'))), 'trial-result'));
    const raw = capture(join(outdir, 'usage'), input);
    z.object({ data: z.object({ model: z.literal(config.model), sessionId: z.literal(result.trajectory.metadata.sessionID) }) })
      .parse(singleRecord(raw, 'workflow.capture.start'));
    z.object({ data: z.object({ sessionId: z.literal(result.trajectory.metadata.sessionID) }) })
      .parse(singleRecord(raw, 'workflow.capture.end'));
    const usage = collectUsage(raw, config.cacheAccounting);
    const missing = (['totalTokens', 'turns', 'modelCalls', 'taskLatencyMs'] as const).filter(key => usage[key] === null);
    const modelMatches = usage.models.length === 1 && usage.models[0] === result.trajectory.metadata.model;
    const ready = missing.length === 0 && modelMatches;
    write(join(outdir, 'preflight.json'), { ready, requestedModel: config.model, observedModel: result.trajectory.metadata.model, usage });
    if (!ready) throw new Error(`Preflight incomplete (${JSON.stringify({ missing, observedModels: usage.models, modelMatches })}); no Azure trial may start.`);
    console.log(JSON.stringify({ ready: true, source: usage.source }));
    return;
  }
  if (verb === 'prepare') {
    const scenario = scenarioSchema.parse(values.scenario);
    const trials = trialOrder(scenario, config.repetitions);
    for (const trial of trials) {
      const dir = join(outdir, trial.id);
      mkdirSync(dir);
      const policy = join(dir, 'benchmark-policy.md');
      writeFileSync(policy, benchmarkPolicy(trial.arm, join(repo, 'bin', 'azure-functions-skills.js')), { flag: 'wx' });
      if (trial.arm === 'B') write(join(dir, 'workflow-mcp.json'), { servers: {
        azure: { command: 'npx', args: ['-y', `@azure/mcp@${config.mcpVersion}`, 'server', 'start', '--namespace', 'functions'] },
      } });
      write(join(dir, 'eval.yaml'), buildEvalSpec(config, scenario, trial.arm, repo, policy));
    }
    write(join(outdir, 'manifest.json'), { config, trials });
    console.log(JSON.stringify({ prepared: trials.length, execution: 'not-started' }));
    return;
  }
  if (verb === 'init') {
    assertReviewedCI();
    if (config.reviewedSha !== process.env.GITHUB_SHA) throw new Error('Reviewed SHA does not match.');
    const owner = randomUUID();
    const group = `rg-afswf-${owner}`;
    const target = { subscription: config.subscriptionId, group, owner };
    write(join(outdir, 'target.json'), target);
    const scope = ['--subscription', target.subscription, '--name', group];
    if (z.boolean().parse(JSON.parse(runCommand('az', ['group', 'exists', ...scope, '-o', 'json'])))) {
      throw new Error('Trial resource group already exists; refusing to reuse it.');
    }
    runCommand('az', ['group', 'create', ...scope, '--location', config.location, '--tags',
      'vally-eval=true', `trial-id=${owner}`, 'workflow=workflow-runner-benchmark',
      `run-id=${required(process.env.GITHUB_RUN_ID, 'GITHUB_RUN_ID')}`, `createdAt=${new Date().toISOString()}`, 'keep=false', '-o', 'none']);
    console.log(JSON.stringify({ group, owner, environment: `afswf-${owner}` }));
    return;
  }
  if (verb === 'collect') {
    const scenario = scenarioSchema.parse(values.scenario);
    const arm = armSchema.parse(values.arm);
    const pair = z.coerce.number().int().min(1).max(config.repetitions).parse(values.pair);
    const root = resolve(required(values.input, '--input'));
    const logs = existsSync(root) ? readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => join(root, entry.name)) : [];
    const resultFiles = logs.flatMap(dir => readdirSync(dir).includes('results.jsonl') ? [join(dir, 'results.jsonl')] : []);
    const resultSchema = z.object({
      stimulus: z.literal(`${scenario}-typescript-http-fc1`), status: z.enum(['success', 'error']),
      durationMs: z.number().nonnegative().optional(),
      gradeResult: z.object({ passed: z.boolean(), details: z.array(z.object({ name: z.string(), passed: z.boolean() })) }).nullable(),
      trajectory: z.object({
        metadata: z.object({ sessionID: z.string(), model: z.string() }),
        stimulus: z.object({ tags: z.object({ arm: z.literal(arm) }) }),
      }).nullable(),
    });
    const result = resultFiles.length ? resultSchema.parse(singleRecord(lines(single(resultFiles)), 'trial-result')) : null;
    let usage: Usage | null = null;
    let workflow: z.infer<typeof workflowEvidenceSchema> | null = null;
    let measurementIssue: string | null = result ? null : 'trial-result-missing';
    try {
      const raw = capture(join(outdir, 'usage'), root);
      const end = z.object({ data: z.object({ sessionId: z.string(), status: z.enum(['success', 'error']) }) }).parse(singleRecord(raw, 'workflow.capture.end'));
      const start = z.object({ data: z.object({ sessionId: z.string(), model: z.literal(config.model) }) })
        .parse(singleRecord(raw, 'workflow.capture.start'));
      if (start.data.sessionId !== end.data.sessionId || !result ||
        (result.trajectory && end.data.sessionId !== result.trajectory.metadata.sessionID) ||
        (!result.trajectory && (result.status !== 'error' || end.data.status !== 'error'))) {
        throw new Error('Session/model correlation failed.');
      }
      usage = collectUsage(raw, config.cacheAccounting);
      if (end.data.status === 'error') measurementIssue = 'execution-or-capture-incomplete';
      else if (usage.partialCalls) measurementIssue = 'partial-token-accounting';
      else if (usage.totalTokens === null) measurementIssue = 'cache-accounting-unverified';
      else if (usage.turns === null || usage.modelCalls === null || usage.taskLatencyMs === null) measurementIssue = 'quantitative-events-incomplete';
      else if (result.trajectory && (usage.models.length !== 1 || usage.models[0] !== result.trajectory.metadata.model)) measurementIssue = 'model-changed';
      if (values.preflight) {
        const expected = z.object({ ready: z.literal(true), requestedModel: z.literal(config.model),
          usage: z.object({ models: z.array(z.string()), source: z.string() }) }).parse(read(values.preflight));
        if (JSON.stringify(usage.models) !== JSON.stringify(expected.usage.models) || usage.source !== expected.usage.source) {
          measurementIssue ??= 'model-or-accounting-source-changed';
        }
      }
      const evidence = z.object({ data: z.union([workflowEvidenceSchema, z.object({ error: z.literal('unavailable') })]) })
        .parse(singleRecord(raw, 'workflow.execution.evidence')).data;
      if ('error' in evidence) measurementIssue ??= 'workflow-evidence-unavailable';
      else {
        workflow = evidence;
        if ((arm === 'B') !== (workflow.runs > 0)) measurementIssue ??= 'treatment-not-exercised-or-contaminated';
      }
    } catch { measurementIssue ??= 'capture-missing-invalid-or-uncorrelated'; }
    const goalAchieved = result?.status === 'success' && result.gradeResult?.passed === true &&
      ['independent-probe', 'skill-invocation', 'completed'].every(name =>
        result.gradeResult?.details.some(detail => detail.name === name && detail.passed));
    const cleanupConfirmed = scenario === 'create' ||
      (existsSync(join(outdir, 'cleanup.json')) &&
        z.object({ confirmedAbsent: z.literal(true) }).safeParse(read(join(outdir, 'cleanup.json'))).success);
    const versions = versionSchema.parse(read(join(outdir, 'versions.json')));
    const fingerprint = createHash('sha256').update(JSON.stringify({ config, versions, fixture: DEPLOY_FIXTURE_SHA })).digest('hex');
    write(join(outdir, 'trial.json'), {
      id: `${scenario}-${pair}-${arm.toLowerCase()}`, scenario, arm, pair,
      goalAchieved, success: goalAchieved && cleanupConfirmed, cleanupConfirmed, fingerprint, versions, usage, measurementIssue,
      workflow, trialLatencyMs: result?.durationMs ?? null,
    });
    console.log(JSON.stringify({ goalAchieved, cleanupConfirmed, measurementIssue }));
    return;
  }
  if (verb === 'report') {
    const input = resolve(required(values.input, '--input'));
    const records = readdirSync(input, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^(create|deploy)-[1-3]-[abc]$/.test(entry.name))
      .flatMap(entry => {
        const path = join(input, entry.name, 'trial.json');
        return existsSync(path) ? [recordSchema.parse(read(path))] : [];
      });
    if (!records.length) throw new Error('No actual trial records found; no measured report can be produced.');
    if (new Set(records.map(record => record.fingerprint)).size !== 1) throw new Error('Trial provenance differs; do not combine these measurements.');
    if (records.some(record => record.fingerprint !== createHash('sha256')
      .update(JSON.stringify({ config, versions: record.versions, fixture: DEPLOY_FIXTURE_SHA })).digest('hex'))) {
      throw new Error('Report configuration does not match recorded trial provenance.');
    }
    const report = compareTrials(records satisfies Trial[]);
    const scenarios = values.scenario ? [scenarioSchema.parse(values.scenario)] : [...new Set(records.map(record => record.scenario))];
    const expected = scenarios.flatMap(scenario => trialOrder(scenario, config.repetitions));
    if (records.some(record => !expected.some(trial => trial.id === record.id))) throw new Error('Unexpected trial outside the requested schedule.');
    const missingTrials = expected.filter(trial => !records.some(record => record.id === trial.id)).map(trial => trial.id);
    const unpairedSuccesses = records.filter(record => record.arm !== 'A' && record.success &&
      records.some(baseline => baseline.scenario === record.scenario && baseline.pair === record.pair && baseline.arm === 'A' && baseline.success) &&
      !report.pairs.some(pair => pair.scenario === record.scenario && pair.pair === record.pair && pair.treatment === record.arm)).map(record => record.id);
    const incomplete = missingTrials.length > 0 || unpairedSuccesses.length > 0 || records.some(record => record.measurementIssue || !record.cleanupConfirmed);
    const method = { reviewedSha: config.reviewedSha, azureSkillsSha: config.azureSkillsSha, mcpVersion: config.mcpVersion,
      model: config.model, versions: records[0].versions, fixture: DEPLOY_FIXTURE_SHA, repetitions: config.repetitions,
      observedModels: [...new Set(records.flatMap(record => record.usage?.models ?? []))],
      cacheAccounting: config.cacheAccounting, minimumTokenReduction: config.minimumTokenReduction };
    write(join(outdir, 'comparison.json'), { incomplete, missingTrials, unpairedSuccesses, method, trials: records, ...report });
    const rows = report.arms.map(arm => `| ${arm.scenario} | ${arm.arm} | ${arm.successes}/${arm.count} | ${arm.totalTokens ?? 'missing'} | ${arm.tokens?.median ?? 'missing'} | ${arm.turns?.median ?? 'missing'} | ${arm.latencyMs?.median ?? 'missing'} | ${arm.trialLatencyMs?.median ?? 'missing'} |`);
    const markdown = [
      '# Workflow runner evaluation', '',
      ...(incomplete ? ['**Incomplete evidence: do not use this report for an adoption decision.**', ''] : []),
      '| Scenario | Arm | Success | All-trial tokens | Median tokens | Median turns | Median agent ms | Median trial ms |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, '',
      'Agent latency uses executor start/completion, including discovery, planning and operations. Trial latency is Vally durationMs; cleanup is separate.',
      'Missing usage is not zero. Failed runs remain in totals but never qualify as token savings.',
      '', '| Scenario | Pair | Treatment | Token reduction | Turn delta | Task ms delta |',
      '| --- | --- | --- | --- | --- | --- |',
      ...report.pairs.map(pair => `| ${pair.scenario} | ${pair.pair} | ${pair.treatment} | ${(pair.tokenReduction * 100).toFixed(2)}% | ${pair.turnDelta} | ${pair.latencyDeltaMs ?? 'missing'} |`), '',
      `Predeclared minimum useful reduction: ${config.minimumTokenReduction}. Review complete paired records before an adoption decision.`,
      'This small experiment does not establish statistical significance. Raw logs and function keys are not published.',
    ].join('\n') + '\n';
    writeFileSync(join(outdir, 'report.md'), markdown, { flag: 'wx' });
    writeFileSync(join(outdir, 'report.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Workflow runner evaluation</title><body><pre>' +
      markdown.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '</pre></body></html>', { flag: 'wx' });
    console.log(JSON.stringify({ trials: records.length, comparablePairs: report.pairs.length }));
    return;
  }
  throw new Error('Use prepare, prepare-preflight, check-preflight, authorize, versions, init, probe, cleanup, collect, or report. See samples/workflow-runner/README.md.');
}

function singleRecord(records: unknown[], type: string): unknown {
  const matches = records.filter(record => z.object({ type: z.literal(type) }).safeParse(record).success);
  if (matches.length !== 1) throw new Error(`Expected one ${type} record.`);
  return matches[0];
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
