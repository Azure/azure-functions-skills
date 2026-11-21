import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureToolDir, toolDir } from '../shared/work-dir.js';

export type StepId = 'env-new' | `env-set:${string}` | 'provision' | 'deploy';

export interface PlanStep {
  readonly id: StepId;
  /** Arguments for `azd`. The plan never names another executable. */
  readonly args: readonly string[];
  readonly changes: 'local-environment' | 'azure-resources' | 'application-code';
  readonly timeoutSeconds: number;
}

export interface PlanContent {
  readonly schemaVersion: 1;
  readonly kind: 'azure-functions-deploy-plan';
  readonly createdAt: string;
  readonly environment: string;
  readonly subscriptionId: string;
  readonly location: string;
  readonly mode: 'provision-and-deploy' | 'code-only';
  readonly fingerprint: string;
  /**
   * The approved azd environment: a digest of each target and infrastructure input value that
   * provision and deploy will read, or `null` when the variable must be unset. `deploy apply`
   * refuses to run when the environment no longer matches.
   */
  readonly expectedEnvironment: Readonly<Record<string, string | null>>;
  readonly steps: readonly PlanStep[];
}

export interface DeployPlan extends PlanContent {
  /** First 16 hex characters of the SHA-256 of the plan content. The user approves this value. */
  readonly planId: string;
}

export interface DeployState {
  readonly planId: string;
  readonly completed: readonly StepId[];
  /** When the provision step finished. Used to judge whether a storage refusal can be role propagation. */
  readonly provisionedAt?: string;
}

/** Variables that select the deployment target. Only the plan's own target may be written to them. */
export const TARGET_VARIABLES: Readonly<Record<string, 'subscriptionId' | 'location'>> = {
  AZURE_SUBSCRIPTION_ID: 'subscriptionId',
  AZURE_LOCATION: 'location',
};

/** Variables that azd fills in by itself. A plan sets none of them except the target above. */
export const AZD_MANAGED = new Set([
  'AZURE_ENV_NAME', 'AZURE_LOCATION', 'AZURE_SUBSCRIPTION_ID', 'AZURE_PRINCIPAL_ID', 'AZURE_PRINCIPAL_TYPE',
  'AZURE_TENANT_ID', 'AZURE_RESOURCE_GROUP',
]);

/** A digest of an environment value, so the plan can check it without storing it. */
export function valueDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The only `azd` argument lists a plan may contain. `deploy apply` rejects anything else. */
export function stepArgs(
  id: StepId,
  plan: Pick<PlanContent, 'environment' | 'subscriptionId' | 'location'>,
  value = '',
): string[] {
  if (id === 'env-new') {
    return ['env', 'new', plan.environment, '--subscription', plan.subscriptionId, '--location', plan.location, '--no-prompt'];
  }
  if (id === 'provision' || id === 'deploy') return [id, '-e', plan.environment, '--no-prompt'];
  return ['env', 'set', id.slice('env-set:'.length), value, '-e', plan.environment, '--no-prompt'];
}

const ENV_SET_VALUE_INDEX = 3;

export function isValidStep(step: PlanStep, plan: Pick<PlanContent, 'environment' | 'subscriptionId' | 'location'>): boolean {
  if (!Array.isArray(step.args) || step.args.some(argument => typeof argument !== 'string')) return false;
  const known = step.id === 'env-new' || step.id === 'provision' || step.id === 'deploy'
    || /^env-set:[A-Z_][A-Z0-9_]*$/.test(step.id);
  if (!known) return false;
  if (step.id.startsWith('env-set:')) {
    const name = step.id.slice('env-set:'.length);
    const target = TARGET_VARIABLES[name];
    if (target ? step.args[ENV_SET_VALUE_INDEX] !== plan[target] : AZD_MANAGED.has(name)) return false;
  }
  const expected = stepArgs(step.id, plan, step.id.startsWith('env-set:') ? step.args[ENV_SET_VALUE_INDEX] : '');
  return expected.length === step.args.length && expected.every((argument, index) => argument === step.args[index]);
}

export function workDir(dir: string): string {
  return join(toolDir(dir), 'deploy');
}

export function planFilePath(dir: string): string {
  return join(workDir(dir), 'plan.json');
}

export function stateFilePath(dir: string): string {
  return join(workDir(dir), 'state.json');
}

export function logFilePath(dir: string): string {
  return join(workDir(dir), 'apply.log');
}

export function planId(content: PlanContent): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
}

export function writePlan(dir: string, content: PlanContent): DeployPlan {
  const plan: DeployPlan = { ...content, planId: planId(content) };
  writeWorkFile(dir, planFilePath(dir), plan);
  return plan;
}

/** Returns the plan, or `null` when the file is missing, malformed, or edited after it was written. */
export function readPlan(path: string): DeployPlan | null {
  const parsed = readJson<DeployPlan>(path);
  if (!parsed || parsed.kind !== 'azure-functions-deploy-plan' || !Array.isArray(parsed.steps)) return null;
  if (typeof parsed.expectedEnvironment !== 'object' || parsed.expectedEnvironment === null) return null;
  const { planId: recorded, ...content } = parsed;
  return recorded === planId(content) ? parsed : null;
}

export function readState(dir: string, plan: DeployPlan): DeployState {
  const state = readJson<DeployState>(stateFilePath(dir));
  return state && state.planId === plan.planId && Array.isArray(state.completed)
    ? state
    : { planId: plan.planId, completed: [] };
}

export function writeState(dir: string, state: DeployState): void {
  writeWorkFile(dir, stateFilePath(dir), state);
}

function writeWorkFile(dir: string, path: string, value: unknown): void {
  ensureWorkDir(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Creates the work folder and keeps it out of source control. */
export function ensureWorkDir(dir: string): void {
  ensureToolDir(dir, 'deploy');
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}
