import { z } from 'zod';

const count = z.number().int().nonnegative().safe();
const eventSchema = z.object({
  type: z.string(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  data: z.unknown(),
});
const shutdownSchema = z.object({
  modelMetrics: z.record(z.object({
    requests: z.object({ count: count.optional() }).optional(),
    usage: z.object({
      inputTokens: count, outputTokens: count,
      cacheReadTokens: count.optional(), cacheWriteTokens: count.optional(), reasoningTokens: count.optional(),
    }),
  })),
});

export type CacheAccounting = 'included-in-input' | 'separate-input' | 'unknown';
export type Scenario = 'create' | 'deploy';
export type Arm = 'A' | 'B' | 'C';
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  observedInputTokens: number | null;
  observedOutputTokens: number | null;
  partialCalls: number;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  modelCalls: number | null;
  turns: number | null;
  taskLatencyMs: number | null;
  models: string[];
  cacheAccounting: CacheAccounting;
  source: 'shutdown' | 'assistant-usage';
  hostToolResultBytes: number | null;
}
export interface Trial {
  scenario: Scenario;
  arm: Arm;
  pair: number;
  success: boolean;
  usage: Usage | null;
  measurementIssue?: string | null;
  trialLatencyMs?: number | null;
}

/** Read native SDK accounting: normalized Vally events can substitute missing tokens with zero. */
export function collectUsage(raw: unknown[], cacheAccounting: CacheAccounting): Usage {
  const events = raw.map(event => eventSchema.parse(event));
  const shutdowns = events.filter(event => event.type === 'session.shutdown');
  if (shutdowns.length > 1) throw new Error('Duplicate SDK shutdown accounting.');
  const calls = z.object({ model: z.string().min(1), inputTokens: count.optional(), outputTokens: count.optional(),
    cacheReadTokens: count.optional(), cacheWriteTokens: count.optional(), reasoningTokens: count.optional() });
  const entries = shutdowns.length
    ? Object.entries(shutdownSchema.parse(shutdowns[0].data).modelMetrics).map(([model, metric]) => ({ model, ...metric }))
    : events.filter(event => event.type === 'assistant.usage').map(event => {
      const data = calls.parse(event.data);
      return { model: data.model, usage: data, requests: { count: 1 } };
    });
  if (!entries.length) throw new Error('No complete SDK shutdown or assistant.usage accounting.');
  const models = [...new Set(entries.map(entry => entry.model))].sort();
  const values = entries;
  type TokenField = 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens';
  const observed = (key: TokenField): number | null => {
    const reported = values.flatMap(metric => metric.usage[key] === undefined ? [] : [metric.usage[key]]);
    return reported.length ? count.parse(reported.reduce((a, b) => a + b, 0)) : null;
  };
  const complete = (key: TokenField): number | null =>
    values.every(metric => metric.usage[key] !== undefined) ? observed(key) : null;
  const inputTokens = complete('inputTokens');
  const outputTokens = complete('outputTokens');
  const cacheReadTokens = complete('cacheReadTokens');
  const cacheWriteTokens = complete('cacheWriteTokens');
  const firstUser = events.find(event => event.type === 'user.message')?.timestamp;
  const lastAssistant = events.filter(event => event.type === 'assistant.message').at(-1)?.timestamp;
  const ends = events.filter(event => event.type === 'workflow.capture.end');
  if (ends.length > 1) throw new Error('Duplicate usage capture completion.');
  const end = ends.length ? z.object({
    status: z.enum(['success', 'error']), startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
  }).parse(ends[0].data) : undefined;
  const latency = end ? Date.parse(end.completedAt) - Date.parse(end.startedAt)
    : firstUser && lastAssistant ? Date.parse(lastAssistant) - Date.parse(firstUser) : null;
  if (latency !== null && latency < 0) throw new Error('SDK event timestamps are out of order.');
  const toolResults = events.filter(event => event.type === 'tool.execution_complete')
    .map(event => z.object({ resultBytes: count.nullable() }).parse(event.data).resultBytes);
  return {
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheAccounting,
    observedInputTokens: observed('inputTokens'), observedOutputTokens: observed('outputTokens'),
    partialCalls: shutdowns.length ? 0 : values.filter(metric => metric.usage.inputTokens === undefined || metric.usage.outputTokens === undefined).length,
    reasoningTokens: complete('reasoningTokens'),
    totalTokens: inputTokens === null || outputTokens === null || end?.status === 'error' || cacheAccounting === 'unknown' ||
      (cacheAccounting === 'separate-input' && (cacheReadTokens === null || cacheWriteTokens === null))
      ? null : count.parse(inputTokens + outputTokens +
        (cacheAccounting === 'separate-input' ? (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) : 0)),
    modelCalls: values.every(metric => metric.requests?.count !== undefined)
      ? count.parse(values.reduce((total, metric) => total + (metric.requests?.count ?? 0), 0)) : null,
    turns: events.filter(event => event.type === 'assistant.turn_end').length || null,
    taskLatencyMs: latency,
    models,
    source: shutdowns.length ? 'shutdown' : 'assistant-usage',
    hostToolResultBytes: toolResults.every(value => value !== null)
      ? count.parse(toolResults.reduce<number>((total, value) => total + (value ?? 0), 0)) : null,
  };
}

export function trialOrder(scenario: Scenario, repetitions: number): Array<{
  id: string; scenario: Scenario; arm: Arm; pair: number;
}> {
  z.number().int().min(1).max(3).parse(repetitions);
  const arms: Arm[] = scenario === 'create' ? ['A', 'B', 'C'] : ['A', 'B'];
  return Array.from({ length: repetitions }, (_, index) =>
    arms.map((_, offset) => {
      const arm = arms[(index + offset) % arms.length];
      return { id: `${scenario}-${index + 1}-${arm.toLowerCase()}`, scenario, arm, pair: index + 1 };
    })).flat();
}

function statistics(values: number[]): { median: number; min: number; max: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0], max: sorted[sorted.length - 1] };
}

export function compareTrials(trials: Trial[]) {
  const identities = new Set<string>();
  for (const trial of trials) {
    const key = `${trial.scenario}/${trial.arm}/${trial.pair}`;
    if (identities.has(key)) throw new Error(`Duplicate trial: ${key}`);
    identities.add(key);
  }
  const arms = [...new Set(trials.map(trial => `${trial.scenario}/${trial.arm}`))].map(key => {
    const group = trials.filter(trial => `${trial.scenario}/${trial.arm}` === key);
    const tokenValues = group.flatMap(trial => trial.usage?.totalTokens == null ? [] : [trial.usage.totalTokens]);
    return {
      scenario: group[0].scenario, arm: group[0].arm,
      count: group.length, successes: group.filter(trial => trial.success).length,
      missingUsage: group.length - tokenValues.length,
      totalTokens: tokenValues.length === group.length ? tokenValues.reduce((a, b) => a + b, 0) : null,
      observedTokens: tokenValues.length ? tokenValues.reduce((a, b) => a + b, 0) : null,
      observedInputTokens: group.some(trial => trial.usage?.observedInputTokens != null)
        ? group.reduce((total, trial) => total + (trial.usage?.observedInputTokens ?? 0), 0) : null,
      observedOutputTokens: group.some(trial => trial.usage?.observedOutputTokens != null)
        ? group.reduce((total, trial) => total + (trial.usage?.observedOutputTokens ?? 0), 0) : null,
      tokens: statistics(tokenValues),
      turns: statistics(group.flatMap(trial => trial.usage?.turns == null ? [] : [trial.usage.turns])),
      latencyMs: statistics(group.flatMap(trial => trial.usage?.taskLatencyMs == null ? [] : [trial.usage.taskLatencyMs])),
      trialLatencyMs: statistics(group.flatMap(trial => trial.trialLatencyMs == null ? [] : [trial.trialLatencyMs])),
    };
  });
  const pairs = trials.filter(trial => trial.arm !== 'A' && trial.success && !trial.measurementIssue).flatMap(treatment => {
    const baseline = trials.find(trial => trial.scenario === treatment.scenario &&
      trial.pair === treatment.pair && trial.arm === 'A' && trial.success && !trial.measurementIssue);
    if (!baseline?.usage || !treatment.usage || baseline.usage.totalTokens === null ||
      treatment.usage.totalTokens === null || baseline.usage.totalTokens === 0 ||
      baseline.usage.cacheAccounting !== treatment.usage.cacheAccounting ||
      baseline.usage.source !== treatment.usage.source ||
      JSON.stringify(baseline.usage.models) !== JSON.stringify(treatment.usage.models)) return [];
    return [{
      scenario: treatment.scenario, pair: treatment.pair, treatment: treatment.arm,
      tokenReduction: (baseline.usage.totalTokens - treatment.usage.totalTokens) / baseline.usage.totalTokens,
      turnDelta: treatment.usage.turns !== null && baseline.usage.turns !== null ? treatment.usage.turns - baseline.usage.turns : null,
      latencyDeltaMs: baseline.usage.taskLatencyMs !== null && treatment.usage.taskLatencyMs !== null
        ? treatment.usage.taskLatencyMs - baseline.usage.taskLatencyMs : null,
    }];
  });
  return { arms, pairs };
}
