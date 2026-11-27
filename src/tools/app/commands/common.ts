import { boolFlag, requireFlag, stringFlag, type ParsedArgs } from '../args.js';
import { ARM_ENDPOINT, ARM_RESOURCE, AzureError, type AzureClient } from '../azure.js';
import { EXIT, ToolError, type Finding } from '../output.js';
import { resolveApp, type AppTarget } from '../target.js';
import type { ToolContext } from './types.js';

const LRO_WAIT_MS = 300_000;

export const APP_HINT = 'Pass the Function App name or resource ID, for example --app my-func.';

export function appTarget(client: AzureClient, args: ParsedArgs): Promise<AppTarget> {
  return resolveApp(client, {
    app: requireFlag(args, 'app', APP_HINT),
    resourceGroup: stringFlag(args, 'resource-group'),
    subscription: stringFlag(args, 'subscription'),
    slot: stringFlag(args, 'slot'),
  });
}

/** R1: reversible change. R2: can break callers, lose data, or is hard to undo. */
export type Risk = 'R1' | 'R2';

export interface PlanStep {
  action: string;
  method: string;
  url: string;
  body?: unknown;
}

export interface WritePlan {
  risk: Risk;
  impact: string;
  steps: PlanStep[];
  rollback?: string;
  /** Per-entry summary for collection edits; values are redacted. */
  changes?: unknown[];
}

/** Stops with exit 5 and the plan unless the user already approved it (`--approve`). */
export function requireApproval(args: ParsedArgs, command: string, plan: WritePlan, findings: Finding[] = []): void {
  if (boolFlag(args, 'approve')) return;
  throw new ToolError(EXIT.approval, `${plan.risk} change needs approval: ${plan.impact}`, {
    data: plan,
    findings,
    next: [`Show this plan to the user. After they approve, run the same command with --approve: \`${command} ... --approve\`.`],
  });
}

/** True when a write may or may not have been applied (no response, or a server error). */
export function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof AzureError && (error.httpStatus === 0 || error.httpStatus >= 500);
}

/** Converts an uncertain write failure into guidance that forbids resending it blindly. */
export function outcomeUnknown(error: AzureError, what: string, checkCommand: string): ToolError {
  return new ToolError(EXIT.azure, `${what}: the outcome is unknown (${error.azureCode}). Do not resend it.`, {
    data: error.options.data,
    findings: [
      ...(error.options.findings ?? []),
      { severity: 'error', code: 'OutcomeUnknown', message: `${what} may or may not have been applied.`, fix: `Check first with \`${checkCommand}\`; resend only if that shows the change is missing.` },
    ],
    next: [`Run \`${checkCommand}\` before deciding anything else.`],
  });
}

/** Polls a read until `done` returns true or `waitMs` passes. Returns the last value and whether it finished. */
export async function waitFor<T>(
  read: () => Promise<T | undefined>,
  done: (value: T, elapsedMs: number) => boolean,
  options: { sleep: (ms: number) => Promise<void>; waitMs: number; intervalMs: number },
): Promise<{ value?: T; done: boolean; elapsedMs: number }> {
  let elapsedMs = 0;
  let value: T | undefined;
  while (elapsedMs + options.intervalMs <= options.waitMs) {
    await options.sleep(options.intervalMs);
    elapsedMs += options.intervalMs;
    value = await read();
    if (value !== undefined && done(value, elapsedMs)) return { value, done: true, elapsedMs };
  }
  return { value, done: false, elapsedMs };
}

/** Sends one ARM write; waits for a long-running operation; never resends when the outcome is unknown. */
export async function writeArm(context: ToolContext, step: PlanStep, checkCommand: string, waitMs = LRO_WAIT_MS): Promise<void> {
  const url = `${ARM_ENDPOINT}${step.url}`;
  try {
    const response = await context.client.send(step.method, url, ARM_RESOURCE, { body: step.body });
    if (response.status === 201 || response.status === 202) {
      const result = await context.client.poll(response, ARM_RESOURCE, waitMs);
      if (!result.done) throw new ToolError(EXIT.failed, `${step.action} is still running after ${waitMs / 1000}s.`, { next: [`Run \`${checkCommand}\` later. Do not resend.`] });
      if (result.status !== 'Succeeded') throw new ToolError(EXIT.azure, `${step.action} finished with status ${result.status}.`, { data: result.body });
    }
  } catch (error) {
    if (isOutcomeUnknown(error)) throw outcomeUnknown(error as AzureError, step.action, checkCommand);
    throw error;
  }
}

export async function tryRead<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}
