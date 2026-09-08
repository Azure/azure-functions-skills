import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Executor, Trajectory } from '@microsoft/vally';
import { createExecutorRegistry, loadExecutorPlugin } from '@microsoft/vally';
import { createTempDir, removeDir } from './helpers/fs.js';
import { registerExecutors, withUsageCapture } from '../src/workflow-evaluation/executor.js';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(removeDir); vi.unstubAllEnvs(); });
function output(): string {
  const dir = createTempDir('workflow-usage-');
  dirs.push(dir);
  return dir;
}
function trajectory(): Trajectory {
  return {
    id: 'trajectory', stimulus: { name: 'fixture', prompt: 'fixture' }, events: [],
    output: 'done', workDir: 'fixture',
    metadata: { model: 'model', skillsLoaded: [], executor: 'copilot-sdk', sessionID: 'session',
      startedAt: new Date('2026-01-01T00:00:00Z'), completedAt: new Date('2026-01-01T00:00:01Z') },
    metrics: { tokenUsage: { inputTokens: 10, outputTokens: 2, totalTokens: 12,
      cacheReadTokens: 0, cacheWriteTokens: 0, callCount: 1, byModel: {} },
    toolCallCount: 0, toolCallBreakdown: {}, skillActivationCount: 0, skillActivationBreakdown: {},
    turnCount: 1, wallTimeMs: 1000, errorCount: 0 },
  };
}

it('registers against the empty staging registry used by Vally without starting a model client', async () => {
  vi.stubEnv('WORKFLOW_USAGE_DIR', output());
  const registry = createExecutorRegistry();
  expect(registry.names()).toEqual([]);
  await registerExecutors(registry);
  expect(registry.names()).toEqual(['workflow-measured-copilot']);
  await registry.get('workflow-measured-copilot')?.shutdown();
});

it('loads the compiled plugin through the real Vally plugin loader without executing an agent', async () => {
  vi.stubEnv('WORKFLOW_USAGE_DIR', output());
  const registry = createExecutorRegistry();
  await loadExecutorPlugin(resolve('lib', 'workflow-evaluation', 'executor.js'), registry);
  expect(registry.names()).toEqual(['workflow-measured-copilot']);
  await registry.get('workflow-measured-copilot')?.shutdown();
});

it('observes the same executor without retaining prompts, tool results or synthetic cache zeros', async () => {
  const dir = output();
  const original = trajectory();
  let forwarded = 0;
  const delegate: Executor = {
    name: 'copilot-sdk',
    execute: async (_stimulus, options) => {
      options.onRawEvent?.({ type: 'assistant.usage', data: { model: 'model', inputTokens: 10, outputTokens: 2 } });
      options.onRawEvent?.({ type: 'assistant.message', data: { content: 'fixture-secret-not-for-report' } });
      options.onRawEvent?.({ type: 'tool.execution_complete', data: { result: { text: 'fixture-secret-not-for-report' } } });
      return original;
    },
    shutdown: async () => {},
  };
  const measured = withUsageCapture(delegate, dir);
  const result = await measured.execute(original.stimulus, { timeout: 1000, workDir: dir, model: 'model',
    sessionLog: { rootDir: dir, sessionID: 'session' }, onRawEvent: () => { forwarded++; } });
  expect(result).toBe(original);
  expect(forwarded).toBe(3);
  const text = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
  expect(text).not.toContain('fixture-secret-not-for-report');
  const events = text.trim().split('\n').map(line => JSON.parse(line));
  expect(events.find(event => event.type === 'assistant.usage').data).toEqual({ model: 'model', inputTokens: 10, outputTokens: 2 });
  expect(events.at(-1)).toMatchObject({ type: 'workflow.capture.end', data: { status: 'success', sessionId: 'session' } });
});

it('retains an explicit failed capture and propagates the original execution error', async () => {
  const dir = output();
  const failure = new Error('original error');
  const measured = withUsageCapture({
    name: 'copilot-sdk', execute: async () => { throw failure; }, shutdown: async () => {},
  }, dir);
  await expect(measured.execute({ name: 'fixture', prompt: 'fixture' }, {
    timeout: 1000, workDir: dir, sessionLog: { rootDir: dir, sessionID: 'session' },
  })).rejects.toBe(failure);
  const text = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
  expect(text).toContain('"status":"error"');
  expect(text).not.toContain('original error');
});

it('marks capture overflow as an error rather than writing a success footer', async () => {
  const dir = output();
  const original = trajectory();
  const measured = withUsageCapture({
    name: 'copilot-sdk', shutdown: async () => {},
    execute: async (_stimulus, options) => {
      options.onRawEvent?.({ type: 'assistant.usage', data: { model: 'x'.repeat(4 * 1024 * 1024) } });
      return original;
    },
  }, dir);
  await expect(measured.execute(original.stimulus, { timeout: 1000, workDir: dir })).rejects.toThrow(/capture failed/);
  const text = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
  expect(text).toContain('"status":"error"');
  expect(text.length).toBeLessThan(4096);
});
