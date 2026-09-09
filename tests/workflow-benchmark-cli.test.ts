import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(removeDir));
function configuration(dir: string) {
  return {
    version: 1, model: 'model', repetitions: 1, cacheAccounting: 'unknown',
    mcpVersion: '1.0.0', azureSkillsRoot: join(dir, 'azure-skills'),
    azureSkillsSha: 'a'.repeat(40), reviewedSha: 'b'.repeat(40),
    subscriptionId: '00000000-0000-0000-0000-000000000001',
    location: 'eastus2', budgetUsd: 10, minimumTokenReduction: 0.1,
  };
}

it('prepares isolated manual eval specs without starting agents or provisioning Azure', () => {
  const dir = createTempDir('workflow-benchmark-cli-');
  dirs.push(dir);
  const config = join(dir, 'config.json');
  const output = join(dir, 'prepared');
  writeFileSync(config, JSON.stringify(configuration(dir)));
  const result = spawnSync(process.execPath, [resolve('lib', 'workflow-evaluation', 'cli.js'),
    'prepare', '--config', config, '--scenario', 'create', '--outdir', output], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ prepared: 3, execution: 'not-started' });
  expect(existsSync(join(output, 'create-1-a', 'eval.yaml'))).toBe(true);
  expect(readFileSync(join(output, 'create-1-b', 'benchmark-policy.md'), 'utf8')).toContain('Explicit opt-in');
  expect(existsSync(join(output, 'trial-results.json'))).toBe(false);
  const preflight = join(dir, 'preflight');
  const prepared = spawnSync(process.execPath, [resolve('lib', 'workflow-evaluation', 'cli.js'),
    'prepare-preflight', '--config', config, '--outdir', preflight], { encoding: 'utf8' });
  expect(prepared.status, prepared.stderr).toBe(0);
  for (const path of [output, preflight]) {
    const lint = spawnSync(process.execPath, [resolve('node_modules', '@microsoft', 'vally-cli', 'dist', 'index.js'),
      'lint', '--eval-spec', path], { encoding: 'utf8' });
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);
  }
});

it('accepts captured preflight usage and rejects missing counters before live trials', () => {
  const dir = createTempDir('workflow-preflight-');
  dirs.push(dir);
  const config = join(dir, 'config.json');
  const logs = join(dir, 'vally', 'timestamp');
  const usage = join(dir, 'usage');
  mkdirSync(logs, { recursive: true });
  mkdirSync(usage);
  writeFileSync(config, JSON.stringify({ ...configuration(dir),
    cacheAccounting: 'included-in-input', cacheAccountingEvidence: 'Synthetic fixture only.' }));
  writeFileSync(join(logs, 'results.jsonl'), JSON.stringify({ type: 'trial-result', status: 'success',
    gradeResult: { passed: true }, trajectory: { metadata: { sessionID: 'fixture', model: 'model-resolved' } } }));
  const events = [
    { type: 'workflow.capture.start', data: { sessionId: 'fixture', model: 'model' } },
    { type: 'assistant.usage', data: { model: 'model-resolved', inputTokens: 12, outputTokens: 3 } },
    { type: 'assistant.turn_end', data: {} },
    { type: 'workflow.capture.end', data: { sessionId: 'fixture', status: 'success',
      startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z' } },
  ];
  const capture = join(usage, 'fixture.jsonl');
  writeFileSync(capture, events.map(event => JSON.stringify(event)).join('\n'));
  const run = () => spawnSync(process.execPath, [resolve('lib', 'workflow-evaluation', 'cli.js'), 'check-preflight',
    '--config', config, '--input', join(dir, 'vally'), '--outdir', dir], { encoding: 'utf8' });
  const passed = run();
  expect(passed.status, passed.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(dir, 'preflight.json'), 'utf8'))).toMatchObject({
    ready: true, requestedModel: 'model', observedModel: 'model-resolved',
    usage: { totalTokens: 15, cacheReadTokens: null, source: 'assistant-usage' },
  });
  unlinkSync(join(dir, 'preflight.json'));
  writeFileSync(capture, events.filter(event => event.type !== 'assistant.turn_end').map(event => JSON.stringify(event)).join('\n'));
  const missing = run();
  expect(missing.status).toBe(2);
  expect(missing.stderr).toContain('no Azure trial may start');
});

it('refuses benchmark authorization outside the reviewed CI environment', () => {
  const result = spawnSync(process.execPath, [resolve('lib', 'workflow-evaluation', 'cli.js'), 'authorize'],
    { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', WORKFLOW_BENCHMARK_APPROVED_SHA: '' } });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('reviewed');
});

it('collects native fixture accounting and publishes only allowlisted comparison data', () => {
  const dir = createTempDir('workflow-benchmark-report-');
  dirs.push(dir);
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ ...configuration(dir),
    cacheAccounting: 'included-in-input', cacheAccountingEvidence: 'Synthetic unit-test fixture; not measured agent results.' }));
  const run = (...args: string[]) => spawnSync(process.execPath,
    [resolve('lib', 'workflow-evaluation', 'cli.js'), ...args], { encoding: 'utf8' });
  for (const [arm, inputTokens] of [['A', 100], ['B', 40], ['C', 70]] as const) {
    const output = join(dir, `create-1-${arm.toLowerCase()}`);
    const logs = join(output, 'vally', 'timestamp');
    mkdirSync(logs, { recursive: true });
    const session = join(output, 'usage');
    mkdirSync(session, { recursive: true });
    const native = join(logs, 'executor-session-logs', 'fixture');
    mkdirSync(native, { recursive: true });
    writeFileSync(join(native, 'events.jsonl'), [
      { type: 'session.start', data: { sessionId: arm } },
      { type: 'session.shutdown', data: { modelMetrics: { model: { requests: { count: 1 },
        usage: { inputTokens, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } } } } },
    ].map(event => JSON.stringify(event)).join('\n'));
    writeFileSync(join(output, 'versions.json'), JSON.stringify({
      node: process.version, workerNode: 'v22.20.0', npm: 'fixture', az: 'fixture', azd: 'fixture', func: 'fixture', vally: 'fixture', copilotSdk: 'fixture',
    }));
    writeFileSync(join(logs, 'results.jsonl'), JSON.stringify({
      type: 'trial-result', stimulus: 'create-typescript-http-fc1', status: 'success', durationMs: 4000,
      gradeResult: { passed: true, details: ['skill-invocation', 'independent-probe', 'completed'].map(name => ({ name, passed: true })) },
      trajectory: { metadata: { sessionID: arm, model: 'model' }, stimulus: { tags: { arm } } },
    }) + '\n');
    writeFileSync(join(session, 'events.jsonl'), [
      { type: 'workflow.capture.start', data: { sessionId: arm, model: 'model' } },
      { type: 'session.start', data: { sessionId: arm } },
      { type: 'user.message', timestamp: '2026-01-01T00:00:01Z', data: {} },
      { type: 'assistant.turn_end', data: {} },
      { type: 'assistant.message', timestamp: '2026-01-01T00:00:03Z', data: { content: 'fixture-key-do-not-publish' } },
      { type: 'assistant.usage', data: { model: 'model', inputTokens: 10, outputTokens: 20 } },
      { type: 'workflow.capture.end', data: { sessionId: arm, status: 'success',
        startedAt: '2026-01-01T00:00:01Z', completedAt: '2026-01-01T00:00:03Z' } },
      { type: 'workflow.execution.evidence', data: { runs: arm === 'B' ? 1 : 0, executedAttempts: arm === 'B' ? 2 : 0,
        runsWithReuse: 0, retries: 0, fallbacks: 0, reusedNodes: 0, unknownNodes: 0, artifactBytes: 0 } },
    ].map(value => JSON.stringify(value)).join('\n'));
    const collected = run('collect', '--config', config, '--scenario', 'create', '--arm', arm,
      '--pair', '1', '--input', join(output, 'vally'), '--outdir', output);
    expect(collected.status, collected.stderr).toBe(0);
  }
  const output = join(dir, 'report');
  const report = run('report', '--config', config, '--scenario', 'create', '--input', dir, '--outdir', output);
  expect(report.status, report.stderr).toBe(0);
  const json = readFileSync(join(output, 'comparison.json'), 'utf8');
  expect(json).not.toContain('fixture-key-do-not-publish');
  expect(JSON.parse(json)).toMatchObject({ incomplete: false, pairs: [
    { treatment: 'B', tokenReduction: 0.5 }, { treatment: 'C', tokenReduction: 0.25 },
  ] });
  expect(readFileSync(join(output, 'report.html'), 'utf8')).toContain('50.00%');
});

it('runs the shipped recovery sample without repeating the successful node', () => {
  const dir = createTempDir('workflow-recovery-sample-');
  dirs.push(dir);
  const cli = resolve('bin', 'azure-functions-skills.js');
  const initial = spawnSync(process.execPath, [cli, 'workflow', 'run', '--plan',
    resolve('samples', 'workflow-runner', 'recovery', 'plan.json'), '--dir', dir], { encoding: 'utf8' });
  expect(initial.status, initial.stderr).toBe(1);
  const old = JSON.parse(initial.stdout) as { runId: string };
  const revised = spawnSync(process.execPath, [cli, 'workflow', 'run', '--plan',
    resolve('samples', 'workflow-runner', 'recovery', 'revised.json'), '--dir', dir,
    '--from', old.runId, '--reuse', 'prepare'], { encoding: 'utf8' });
  expect(revised.status, revised.stderr).toBe(0);
  expect(readFileSync(join(dir, 'execution-count.txt'), 'utf8')).toBe('x');
});

it('retains observed costs when the executor fails without a trajectory', () => {
  const dir = createTempDir('workflow-failed-accounting-');
  dirs.push(dir);
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ ...configuration(dir),
    cacheAccounting: 'included-in-input', cacheAccountingEvidence: 'Synthetic fixture only.' }));
  const logs = join(dir, 'vally', 'timestamp');
  mkdirSync(logs, { recursive: true });
  mkdirSync(join(dir, 'usage'));
  writeFileSync(join(dir, 'versions.json'), JSON.stringify({
    node: process.version, workerNode: 'v22.20.0', npm: 'fixture', az: 'fixture', azd: 'fixture', func: 'fixture', vally: 'fixture', copilotSdk: 'fixture',
  }));
  writeFileSync(join(logs, 'results.jsonl'), JSON.stringify({
    type: 'trial-result', stimulus: 'create-typescript-http-fc1', status: 'error', durationMs: 1000,
    gradeResult: null, trajectory: null,
  }));
  writeFileSync(join(dir, 'usage', 'fixture.jsonl'), [
    { type: 'workflow.capture.start', data: { sessionId: 'fixture', model: 'model' } },
    { type: 'assistant.usage', data: { model: 'model', inputTokens: 70, outputTokens: 5 } },
    { type: 'workflow.execution.evidence', data: { runs: 0, runsWithReuse: 0, executedAttempts: 0, retries: 0,
      fallbacks: 0, reusedNodes: 0, unknownNodes: 0, artifactBytes: 0 } },
    { type: 'workflow.capture.end', data: { sessionId: 'fixture', status: 'error',
      startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z' } },
  ].map(event => JSON.stringify(event)).join('\n'));
  const collected = spawnSync(process.execPath, [resolve('lib', 'workflow-evaluation', 'cli.js'), 'collect',
    '--config', config, '--scenario', 'create', '--arm', 'A', '--pair', '1',
    '--input', join(dir, 'vally'), '--outdir', dir], { encoding: 'utf8' });
  expect(collected.status, collected.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(dir, 'trial.json'), 'utf8'))).toMatchObject({
    goalAchieved: false, measurementIssue: 'execution-or-capture-incomplete',
    usage: { inputTokens: 70, outputTokens: 5, totalTokens: null }, trialLatencyMs: 1000,
  });
});
