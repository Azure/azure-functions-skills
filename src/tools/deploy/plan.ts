import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { UsageError } from '../shared/args.js';
import type { Runner } from '../shared/exec.js';
import { EXIT, fail, succeed, type Finding, type Gap, type NextStep, type ToolResult } from '../shared/output.js';
import { planFilePath, stepArgs, writePlan, type PlanStep, type StepId } from './plan-file.js';
import { inspectProject, readEnvironmentValues, type DeployProject } from './project.js';

export interface PlanOptions {
  readonly dir: string;
  readonly env?: string;
  readonly location?: string;
  readonly subscription?: string;
  /** `KEY=VALUE` pairs for infrastructure inputs. */
  readonly set: readonly string[];
  readonly codeOnly: boolean;
}

export interface PlanDependencies {
  readonly run: Runner;
  readonly now: () => Date;
}

export interface InputNeeded {
  readonly name: string;
  readonly option: string;
  readonly reason: string;
  readonly suggested?: string;
  readonly allowed?: readonly string[];
}

export interface PlannedValue {
  readonly name: string;
  readonly value: string;
  readonly source: 'option' | 'default';
}

export interface PlanData {
  readonly planId?: string;
  readonly planFile?: string;
  readonly environment?: string;
  readonly environmentExists?: boolean;
  readonly subscription?: { readonly id: string; readonly name: string | null };
  readonly location?: string;
  readonly mode?: 'provision-and-deploy' | 'code-only';
  readonly template?: string;
  readonly services?: readonly string[];
  readonly values?: readonly PlannedValue[];
  readonly steps?: ReadonlyArray<{ readonly id: string; readonly command: string; readonly changes: string }>;
  readonly inputsNeeded?: readonly InputNeeded[];
}

const COMMAND = 'deploy plan';
const MANUAL_STEPS = 'references/manual-deploy.md';
/** Variables that azd fills in by itself. */
const AZD_MANAGED = new Set([
  'AZURE_ENV_NAME', 'AZURE_LOCATION', 'AZURE_SUBSCRIPTION_ID', 'AZURE_PRINCIPAL_ID', 'AZURE_PRINCIPAL_TYPE',
  'AZURE_TENANT_ID', 'AZURE_RESOURCE_GROUP',
]);
/** Defaults for inputs of the official quickstart templates. The plan shows each one for approval. */
const KNOWN_DEFAULTS: Readonly<Record<string, string>> = { VNET_ENABLED: 'false' };
const ENVIRONMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const VALUE_NAME = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_NAME = /SECRET|PASSWORD|TOKEN|KEY|CONNECTION/i;
const PROVISION_TIMEOUT_SECONDS = 1800;
const DEPLOY_TIMEOUT_SECONDS = 1800;

export async function planDeploy(options: PlanOptions, dependencies: PlanDependencies): Promise<ToolResult<PlanData>> {
  const dir = resolve(options.dir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`--dir is not a folder: ${options.dir}`);
  const requested = parseValues(options.set);
  if (options.env !== undefined && !ENVIRONMENT_NAME.test(options.env)) {
    throw new UsageError('--env may contain only letters, digits, and hyphens (64 characters at most)');
  }

  const project = inspectProject(dir);
  const projectBlock = checkProject(project);
  if (projectBlock) return projectBlock;

  const [version, login, account, defaultSubscription, defaultLocation] = await Promise.all([
    dependencies.run('azd', ['version'], { cwd: dir }),
    dependencies.run('azd', ['auth', 'login', '--check-status'], { cwd: dir }),
    dependencies.run('az', ['account', 'show', '--output', 'json'], { cwd: dir }),
    dependencies.run('azd', ['config', 'get', 'defaults.subscription'], { cwd: dir }),
    dependencies.run('azd', ['config', 'get', 'defaults.location'], { cwd: dir }),
  ]);
  if (version.notFound) {
    return blocked('Azure Developer CLI is not installed', [{
      id: 'DEPLOY-AZD-MISSING', severity: 'error', title: 'The azd command was not found',
      fix: 'Install the Azure Developer CLI, or run azure-functions-setup.',
    }]);
  }
  if (login.code !== 0) {
    return blocked('Not signed in to Azure Developer CLI', [{
      id: 'DEPLOY-AZD-LOGIN', severity: 'error', title: 'azd is not signed in', fix: 'azd auth login',
    }]);
  }

  const gaps: Gap[] = [];
  const azAccount = parseAccount(account.code === 0 ? account.stdout : '');
  if (!azAccount) gaps.push({ check: 'azure-cli-account', reason: 'az is missing or signed out; deploy verify needs it' });

  const findings: Finding[] = [];
  const inputsNeeded: InputNeeded[] = [];
  const environment = options.env ?? project.environments.defaultName ?? undefined;
  const existing = environment ? readEnvironmentValues(dir, environment) : null;
  if (!environment) {
    inputsNeeded.push({
      name: 'environment', option: '--env', reason: 'No azd environment exists yet',
      suggested: suggestEnvironmentName(project),
    });
  }

  const subscriptionId = resolveSetting({
    name: 'subscription', option: '--subscription', findingId: 'DEPLOY-ENV-SUBSCRIPTION-MISMATCH',
    requested: options.subscription, existing: existing?.AZURE_SUBSCRIPTION_ID,
    fallbacks: [configValue(defaultSubscription.code === 0 ? defaultSubscription.stdout : ''), azAccount?.id],
    reason: 'No subscription is selected in the environment, the azd defaults, or az',
  }, findings, inputsNeeded);
  const location = resolveSetting({
    name: 'location', option: '--location', findingId: 'DEPLOY-ENV-LOCATION-MISMATCH',
    requested: options.location, existing: existing?.AZURE_LOCATION,
    fallbacks: [configValue(defaultLocation.code === 0 ? defaultLocation.stdout : '')],
    reason: 'No location is selected in the environment or the azd defaults',
    allowed: project.infra.allowedLocations ?? undefined,
  }, findings, inputsNeeded);
  if (location && project.infra.allowedLocations && !project.infra.allowedLocations.includes(location)) {
    findings.push({
      id: 'DEPLOY-LOCATION-NOT-ALLOWED', severity: 'error',
      title: `The template does not allow the location ${location}`,
      detail: `Allowed: ${project.infra.allowedLocations.join(', ')}`,
      fix: 'Run deploy plan again with --location set to an allowed value.',
    });
  }

  const values = planValues(project, requested, existing ?? {}, options.codeOnly, findings, inputsNeeded);

  if (findings.some(finding => finding.severity === 'error')) {
    return blocked('The deployment inputs conflict with the project', findings, { gaps });
  }
  if (inputsNeeded.length > 0 || !environment || !subscriptionId || !location) {
    return blocked(`Missing ${inputsNeeded.length} deployment input(s)`, findings, {
      gaps,
      data: { inputsNeeded },
      next: { action: 'ask-user', reason: 'Ask for each missing input, then run deploy plan again with the listed options.' },
    });
  }

  const mode = options.codeOnly ? 'code-only' : 'provision-and-deploy';
  const plan = writePlan(dir, {
    schemaVersion: 1,
    kind: 'azure-functions-deploy-plan',
    createdAt: dependencies.now().toISOString(),
    environment,
    subscriptionId,
    location,
    mode,
    fingerprint: project.fingerprint,
    steps: buildSteps(environment, subscriptionId, location, existing !== null, values, options.codeOnly),
  });
  const next: NextStep = {
    action: 'approve',
    reason: 'Show the subscription, location, values, and steps to the user. Run the command only after they approve.',
    command: `deploy apply --dir "${dir}" --approve ${plan.planId}`,
  };
  return succeed<PlanData>(COMMAND, `Plan ${plan.planId} has ${plan.steps.length} step(s) for environment ${environment}`, {
    planId: plan.planId,
    planFile: planFilePath(dir),
    environment,
    environmentExists: existing !== null,
    subscription: { id: subscriptionId, name: azAccount?.id === subscriptionId ? azAccount.name : null },
    location,
    mode,
    template: project.azureYaml?.template ?? '',
    services: (project.azureYaml?.services ?? []).filter(service => service.host === 'function').map(service => service.name),
    values: values.map(value => (SECRET_NAME.test(value.name) ? { ...value, value: '***' } : value)),
    steps: plan.steps.map(step => ({ id: step.id, command: display(step), changes: step.changes })),
  }, { findings, gaps, next });
}

function checkProject(project: DeployProject): ToolResult<PlanData> | null {
  if (project.isHostedSkills) {
    return blocked('This is an Azure Functions Hosted Skills app', [{
      id: 'DEPLOY-HOSTED-SKILLS', severity: 'info', title: 'Hosted Skills apps deploy through their own skill',
    }], { next: { action: 'azure-functions-hosted-skills', reason: 'It owns model, connector, and runtime setup.' } });
  }
  const manual: NextStep = { action: 'manual-steps', reason: `Follow ${MANUAL_STEPS}.` };
  if (!project.azureYaml || project.infra.kind !== 'bicep') {
    const detail = project.infra.kind === 'terraform'
      ? 'Terraform infrastructure is not supported by the script yet.'
      : 'The script needs azure.yaml and infra/main.bicep.';
    return blocked('This project is not an azd project with Bicep infrastructure', [{
      id: 'DEPLOY-NO-AZD-PROJECT', severity: 'error', title: 'No supported azd project was found', detail,
      fix: 'Create the project from an azd template with azure-functions-create, or deploy by hand.',
    }], { next: manual });
  }
  if (!project.azureYaml.services.some(service => service.host === 'function')) {
    return blocked('azure.yaml has no function app service', [{
      id: 'DEPLOY-NO-FUNCTION-SERVICE', severity: 'error', title: 'No service in azure.yaml uses host: function',
    }], { next: manual });
  }
  if (!project.hasHostJson) {
    return blocked('No host.json was found', [{
      id: 'DEPLOY-NOT-FUNCTIONS-PROJECT', severity: 'error', title: 'The function service has no host.json',
      fix: 'Run the command with --dir set to the folder that contains azure.yaml.',
    }]);
  }
  return null;
}

function blocked(
  summary: string,
  findings: readonly Finding[],
  extras: { gaps?: readonly Gap[]; data?: PlanData; next?: NextStep } = {},
): ToolResult<PlanData> {
  return fail<PlanData>(COMMAND, EXIT.blocked, summary, { findings, ...extras });
}

interface SettingRequest {
  readonly name: string;
  readonly option: string;
  readonly findingId: string;
  readonly requested: string | undefined;
  readonly existing: string | undefined;
  readonly fallbacks: ReadonlyArray<string | undefined>;
  readonly reason: string;
  readonly allowed?: readonly string[];
}

/** An existing environment keeps its subscription and location. Options may only confirm them. */
function resolveSetting(request: SettingRequest, findings: Finding[], inputsNeeded: InputNeeded[]): string | undefined {
  if (request.existing) {
    if (request.requested && request.requested !== request.existing) {
      findings.push({
        id: request.findingId, severity: 'error',
        title: `The environment already uses another ${request.name}`,
        detail: `Environment: ${request.existing}. Requested: ${request.requested}.`,
        fix: `Omit ${request.option}, or choose a new environment name with --env.`,
      });
    }
    return request.existing;
  }
  const value = request.requested ?? request.fallbacks.find(candidate => candidate);
  if (!value) {
    inputsNeeded.push({
      name: request.name, option: request.option, reason: request.reason,
      ...(request.allowed ? { allowed: request.allowed } : {}),
    });
  }
  return value;
}

function planValues(
  project: DeployProject,
  requested: ReadonlyMap<string, string>,
  existing: Readonly<Record<string, string>>,
  codeOnly: boolean,
  findings: Finding[],
  inputsNeeded: InputNeeded[],
): PlannedValue[] {
  const values: PlannedValue[] = [];
  const inputs = project.infra.inputs.filter(input => !AZD_MANAGED.has(input.variable));
  for (const input of inputs) {
    const option = requested.get(input.variable);
    if (option !== undefined) {
      if (existing[input.variable] !== option) values.push({ name: input.variable, value: option, source: 'option' });
    } else if (codeOnly || input.variable in existing || input.hasDefault) {
      continue;
    } else if (input.variable in KNOWN_DEFAULTS) {
      values.push({ name: input.variable, value: KNOWN_DEFAULTS[input.variable], source: 'default' });
    } else {
      inputsNeeded.push({
        name: input.variable, option: `--set ${input.variable}=<value>`,
        reason: `infra/main.parameters.json needs it for the parameter ${input.parameter}`,
      });
    }
  }
  const known = new Set(inputs.map(input => input.variable));
  for (const [name, value] of requested) {
    if (known.has(name)) continue;
    findings.push({
      id: 'DEPLOY-VALUE-NOT-USED', severity: 'warn',
      title: `${name} is not referenced by infra/main.parameters.json`,
      detail: 'The value is still stored in the azd environment.',
    });
    if (existing[name] !== value) values.push({ name, value, source: 'option' });
  }
  return values;
}

function buildSteps(
  environment: string,
  subscriptionId: string,
  location: string,
  environmentExists: boolean,
  values: readonly PlannedValue[],
  codeOnly: boolean,
): PlanStep[] {
  const target = { environment, subscriptionId, location };
  const steps: PlanStep[] = [];
  if (!environmentExists) {
    steps.push({ id: 'env-new', changes: 'local-environment', timeoutSeconds: 60, args: stepArgs('env-new', target) });
  }
  for (const value of values) {
    const id: StepId = `env-set:${value.name}`;
    steps.push({ id, changes: 'local-environment', timeoutSeconds: 60, args: stepArgs(id, target, value.value) });
  }
  if (!codeOnly) {
    steps.push({
      id: 'provision', changes: 'azure-resources', timeoutSeconds: PROVISION_TIMEOUT_SECONDS,
      args: stepArgs('provision', target),
    });
  }
  steps.push({
    id: 'deploy', changes: 'application-code', timeoutSeconds: DEPLOY_TIMEOUT_SECONDS, args: stepArgs('deploy', target),
  });
  return steps;
}

function display(step: PlanStep): string {
  const args = step.id.startsWith('env-set:') && SECRET_NAME.test(step.args[2])
    ? step.args.map((argument, index) => (index === 3 ? '***' : argument))
    : step.args;
  return ['azd', ...args].join(' ');
}

function parseValues(pairs: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    const name = separator > 0 ? pair.slice(0, separator) : '';
    if (!VALUE_NAME.test(name)) throw new UsageError(`--set expects NAME=VALUE with an upper-case name: ${pair}`);
    values.set(name, pair.slice(separator + 1));
  }
  return values;
}

function parseAccount(stdout: string): { id: string; name: string } | null {
  try {
    const account = JSON.parse(stdout) as { id?: unknown; name?: unknown };
    return typeof account.id === 'string' ? { id: account.id, name: String(account.name ?? '') } : null;
  } catch {
    return null;
  }
}

/** `azd config get` prints a JSON string. */
function configValue(stdout: string): string | undefined {
  const text = stdout.trim();
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'string' && parsed ? parsed : undefined;
  } catch {
    return /^[\w-]+$/.test(text) ? text : undefined;
  }
}

function suggestEnvironmentName(project: DeployProject): string {
  const base = (project.azureYaml?.name || basename(project.dir)).toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${base || 'functions'}-dev`;
}
