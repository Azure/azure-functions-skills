import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Executor, ExecutorRegistry } from '@microsoft/vally';
import { collectWorkflowEvidence } from './evidence.js';

export const MEASURED_EXECUTOR = 'workflow-measured-copilot';

function metricEvent(raw: unknown): unknown | undefined {
  const event = z.object({ type: z.string(), timestamp: z.string().optional(), data: z.record(z.unknown()).default({}) }).parse(raw);
  let data: Record<string, unknown>;
  if (event.type === 'assistant.usage') {
    data = Object.fromEntries(['model', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
      .filter(key => Object.hasOwn(event.data, key)).map(key => [key, event.data[key]]));
  } else if (event.type === 'session.shutdown') data = { modelMetrics: event.data.modelMetrics };
  else if (['assistant.turn_start', 'assistant.turn_end'].includes(event.type)) data = { turnId: event.data.turnId };
  else if (['user.message', 'assistant.message'].includes(event.type)) data = {};
  else if (event.type === 'tool.execution_complete') {
    const text = JSON.stringify(event.data.result);
    data = { resultBytes: text === undefined ? null : Buffer.byteLength(text), success: event.data.success };
  } else return undefined;
  return { type: event.type, timestamp: event.timestamp, data };
}

/** Observe the existing executor; do not create another client or change its trajectory. */
export function withUsageCapture(delegate: Executor, directory: string): Executor {
  return {
    name: MEASURED_EXECUTOR,
    supportsPreparedWorkspace: delegate.supportsPreparedWorkspace,
    supportsMultiTurn: delegate.supportsMultiTurn,
    shutdown: () => delegate.shutdown(),
    execute: async (stimulus, options) => {
      mkdirSync(directory, { recursive: true });
      const fd = openSync(join(directory, `${randomUUID()}.jsonl`), 'wx', 0o600);
      let bytes = 0;
      let captureError: unknown;
      const startedAt = new Date();
      const write = (event: unknown, reserve = true): void => {
        const line = JSON.stringify(event) + '\n';
        const size = Buffer.byteLength(line);
        if (bytes + size > 4 * 1024 * 1024 - (reserve ? 16 * 1024 : 0)) throw new Error('Usage capture exceeded 4 MiB.');
        writeFileSync(fd, line);
        bytes += size;
      };
      try {
        write({ type: 'workflow.capture.start', timestamp: startedAt.toISOString(),
          data: { sessionId: options.sessionLog?.sessionID, model: options.model } });
        const result = await delegate.execute(stimulus, {
          ...options,
          onRawEvent: event => {
            options.onRawEvent?.(event);
            if (captureError) return;
            try {
              const selected = metricEvent(event);
              if (selected) write(selected);
            } catch (error) { captureError = error; }
          },
        }).then(value => ({ ok: true, value } as const), error => ({ ok: false, error } as const));
        const metadata = result.ok ? result.value.metadata : undefined;
        try { write({ type: 'workflow.execution.evidence', data: collectWorkflowEvidence(options.workDir) }, false); }
        catch { write({ type: 'workflow.execution.evidence', data: { error: 'unavailable' } }, false); }
        write({ type: 'workflow.capture.end', timestamp: new Date().toISOString(), data: {
          status: result.ok && !captureError ? 'success' : 'error', sessionId: metadata?.sessionID ?? options.sessionLog?.sessionID,
          model: metadata?.model ?? options.model, startedAt: metadata?.startedAt ?? startedAt,
          completedAt: metadata?.completedAt ?? new Date(),
        } }, false);
        if (!result.ok) throw result.error;
        if (captureError) throw new Error('Raw SDK usage capture failed; no complete measurement is available.', { cause: captureError });
        return result.value;
      } finally { closeSync(fd); }
    },
  };
}

export async function registerExecutors(registry: ExecutorRegistry): Promise<void> {
  const directory = process.env.WORKFLOW_USAGE_DIR;
  if (!directory) throw new Error('Configure WORKFLOW_USAGE_DIR for this invocation.');
  const { CopilotSdkExecutor } = await import('@microsoft/vally/executor');
  registry.register(withUsageCapture(new CopilotSdkExecutor(), directory));
}
