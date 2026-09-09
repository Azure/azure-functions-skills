import { describe, expect, it } from 'vitest';
import { collectUsage, compareTrials, trialOrder } from '../src/workflow-evaluation/metrics.js';
import { buildEvalSpec, parseBenchmarkConfig } from '../src/workflow-evaluation/spec.js';

const config = {
  version: 1, model: 'model', repetitions: 1, cacheAccounting: 'unknown',
  mcpVersion: '1.0.0', azureSkillsRoot: 'Q:\\reviewed\\azure-skills',
  azureSkillsSha: 'a'.repeat(40), reviewedSha: 'b'.repeat(40),
  subscriptionId: '00000000-0000-0000-0000-000000000001',
  location: 'eastus2', budgetUsd: 10, minimumTokenReduction: 0.1,
};

function session(inputTokens: number, outputTokens = 20): unknown[] {
  return [
    { type: 'session.start', timestamp: '2026-01-01T00:00:00Z', data: {} },
    { type: 'user.message', timestamp: '2026-01-01T00:00:01Z', data: {} },
    { type: 'assistant.turn_end', timestamp: '2026-01-01T00:00:02Z', data: {} },
    { type: 'assistant.message', timestamp: '2026-01-01T00:00:03Z', data: {} },
    { type: 'session.shutdown', timestamp: '2026-01-01T00:00:04Z', data: {
      modelMetrics: { model: { requests: { count: 2 }, usage: {
        inputTokens, outputTokens, cacheReadTokens: 10, cacheWriteTokens: 5,
      } } },
    } },
  ];
}

describe('workflow benchmark actual usage accounting (WE-003, WE-006)', () => {
  it('uses raw SDK shutdown accounting, not Vally synthetic zero metrics', () => {
    expect(collectUsage(session(100), 'included-in-input')).toMatchObject({
      inputTokens: 100, outputTokens: 20, totalTokens: 120,
      cacheReadTokens: 10, cacheWriteTokens: 5, modelCalls: 2,
      turns: 1, taskLatencyMs: 2000, models: ['model'],
    });

    expect(collectUsage(session(100), 'separate-input').totalTokens).toBe(135);
  });

  it('does not turn unknown cache semantics or absent usage into zero', () => {
    expect(collectUsage(session(100), 'unknown').totalTokens).toBeNull();
    expect(() => collectUsage(session(100).slice(0, -1), 'included-in-input')).toThrow(/shutdown/);
    expect(() => collectUsage([], 'included-in-input')).toThrow(/shutdown/);
  });

  it('uses raw per-call events when shutdown is absent and preserves unknown cache counts', () => {
    const events = [
      ...session(100).slice(0, -1),
      { type: 'assistant.usage', data: { model: 'model', inputTokens: 10, outputTokens: 5 } },
    ];
    expect(collectUsage(events, 'included-in-input')).toMatchObject({
      source: 'assistant-usage', totalTokens: 15, modelCalls: 1, cacheReadTokens: null, cacheWriteTokens: null,
    });
    expect(collectUsage(events, 'separate-input').totalTokens).toBeNull();
    expect(collectUsage([...events, { type: 'assistant.usage', data: { model: 'model', outputTokens: 1 } }], 'included-in-input'))
      .toMatchObject({ totalTokens: null, partialCalls: 1, inputTokens: null, observedInputTokens: 10, outputTokens: 6 });
  });

  it('uses executor boundaries for total agent time and does not fabricate absent turns', () => {
    const events = session(100).filter(value => (value as { type: string }).type !== 'assistant.turn_end');
    events.push({ type: 'workflow.capture.end', data: {
      status: 'success', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:09Z',
    } });
    expect(collectUsage(events, 'included-in-input')).toMatchObject({ taskLatencyMs: 9000, turns: null });
  });

  it('retains observed failed-call costs without claiming a complete total and measures output bytes separately', () => {
    const events = [...session(100), { type: 'tool.execution_complete', data: { resultBytes: 123 } },
      { type: 'workflow.capture.end', data: { status: 'error',
        startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:09Z' } }];
    expect(collectUsage(events, 'included-in-input')).toMatchObject({ inputTokens: 100, totalTokens: null, hostToolResultBytes: 123 });
  });

  it('rejects malformed, negative and duplicate shutdown accounting', () => {
    expect(() => collectUsage(session(-1), 'included-in-input')).toThrow();
    expect(() => collectUsage([...session(100), session(100).at(-1)], 'included-in-input')).toThrow(/shutdown/);
    expect(() => collectUsage([{ type: 'session.shutdown', data: {
      modelMetrics: { model: { usage: { inputTokens: 100 } } },
    } }], 'included-in-input')).toThrow();
  });

  it('excludes failed cheap runs from savings without dropping their spend', () => {
    const trials = [
      { scenario: 'create' as const, arm: 'A' as const, pair: 1, success: true, usage: collectUsage(session(100), 'included-in-input') },
      { scenario: 'create' as const, arm: 'B' as const, pair: 1, success: true, usage: collectUsage(session(40), 'included-in-input') },
      { scenario: 'create' as const, arm: 'A' as const, pair: 2, success: true, usage: collectUsage(session(100), 'included-in-input') },
      { scenario: 'create' as const, arm: 'B' as const, pair: 2, success: false, usage: collectUsage(session(1), 'included-in-input') },
    ];
    const result = compareTrials(trials);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].tokenReduction).toBe(0.5);
    expect(result.arms.find(row => row.arm === 'B')).toMatchObject({
      count: 2, successes: 1, totalTokens: 81,
    });
  });

  it('rejects duplicate trial identities and never compares different scenarios', () => {
    const trial = { scenario: 'create' as const, arm: 'A' as const, pair: 1, success: true, usage: collectUsage(session(100), 'included-in-input') };
    expect(() => compareTrials([trial, trial])).toThrow(/Duplicate/);
    expect(compareTrials([trial, { ...trial, scenario: 'deploy', arm: 'B' }]).pairs).toEqual([]);
  });

  it('rotates order and isolates each scenario/arm/pair', () => {
    const order = trialOrder('create', 3);
    expect(order.map(trial => trial.arm).join('')).toBe('ABCBCACAB');
    expect(new Set(order.map(trial => trial.id)).size).toBe(9);
    expect(trialOrder('deploy', 2).map(trial => trial.arm).join('')).toBe('ABBA');
    expect(() => trialOrder('create', 0)).toThrow();
  });
});

describe('manual benchmark specifications (WE-001, WE-002, WE-005)', () => {
  it('requires pinned inputs and an explicit cost envelope', () => {
    expect(parseBenchmarkConfig(config).repetitions).toBe(1);
    expect(() => parseBenchmarkConfig({ ...config, mcpVersion: 'latest' })).toThrow();
    expect(() => parseBenchmarkConfig({ ...config, reviewedSha: 'main' })).toThrow();
    expect(() => parseBenchmarkConfig({ ...config, budgetUsd: 0 })).toThrow();
    expect(() => parseBenchmarkConfig({ ...config, repetitions: 20 })).toThrow();
  });

  it('keeps the user task, model, timeout and Azure Skills identical across arms', () => {
    const build = (arm: 'A' | 'B' | 'C') =>
      buildEvalSpec(parseBenchmarkConfig(config), 'create', arm, 'repo', 'policy.md');
    const baseline = build('A');
    const treatment = build('B');
    expect(baseline.stimuli[0].prompt).toBe(treatment.stimuli[0].prompt);
    expect(baseline.defaults).toEqual(treatment.defaults);
    expect(treatment.environment.skills.filter(skill => !skill.endsWith('azure-functions-workflow')))
      .toEqual(baseline.environment.skills);
    expect(build('C').environment.skills).toEqual(baseline.environment.skills);
    expect(baseline.stimuli[0].tags.tier).toBe('workflow-benchmark');
    expect(baseline.stimuli[0].constraints.max_duration).toBe('25m');
  });

  it('uses separate deploy-ready fixtures and requires the deployment skill chain', () => {
    const spec = buildEvalSpec(parseBenchmarkConfig(config), 'deploy', 'B', 'repo', 'policy.md');
    expect(spec.environment.commands.join(' ')).toContain('cba392291ff7b6c994548aabaa8c06eb4055be54');
    expect(spec.stimuli[0].graders[0].config.required).toEqual([
      'azure-functions-deploy', 'azure-prepare', 'azure-validate', 'azure-deploy',
    ]);
    expect(() => buildEvalSpec(parseBenchmarkConfig(config), 'deploy', 'C', 'repo', 'policy.md')).toThrow();
  });
});
