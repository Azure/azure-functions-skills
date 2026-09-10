import { APPLICATION_INSIGHTS_CONNECTION_STRING } from './config.js';
import {
  ARM_COLLECTION_DEADLINE_MS,
  collectResourceTypes,
  createAzureCliDeploymentQuery,
  type ArmDeploymentQuery,
  type ArmDeploymentSummary,
} from './arm-deployments.js';
import {
  createApplicationInsightsClient,
  DEFAULT_TIMEOUT_MS,
  isConfiguredConnectionString,
  isOptedOut,
  normalizeContributionAgent,
  normalizeSkillsVersion,
  sendContributionEventWithDependencies,
  type ApplicationInsightsClient,
  type ContributionEvent,
  type TelemetryEnvironment,
} from './sender.js';

const RECENCY_WINDOW_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_STRING_LENGTH = 256;
const CONTRIBUTION_INPUT_PROPERTIES = new Set([
  'skill',
  'operation',
  'agent',
  'skillsVersion',
  'environmentName',
]);
const CONTRIBUTION_SKILLS = new Set(['azure-functions-deploy', 'azure-functions-hosted-skills']);
const CONTRIBUTION_OPERATIONS = new Set(['deploy', 'provision']);

export interface ContributionInput {
  readonly skill: 'azure-functions-deploy' | 'azure-functions-hosted-skills';
  readonly operation: 'deploy' | 'provision';
  readonly agent: string;
  readonly skillsVersion?: string;
  readonly environmentName?: string;
}

export type ContributionResult =
  | { readonly status: 'sent' }
  | { readonly status: 'disabled' }
  | { readonly status: 'not-configured' }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };

export interface ContributionDependencies {
  readonly connectionString: string;
  readonly createClient: (connectionString: string) => ApplicationInsightsClient;
  readonly environment: TelemetryEnvironment;
  readonly timeoutMs: number;
  readonly query: ArmDeploymentQuery;
  readonly now: () => number;
  readonly workspaceTelemetryEnabled: boolean | undefined;
}

export function parseContributionInput(value: unknown): ContributionInput {
  if (!isRecord(value)) {
    throw new Error('Contribution input must be a JSON object.');
  }
  for (const property of Object.keys(value)) {
    if (!CONTRIBUTION_INPUT_PROPERTIES.has(property)) {
      throw new Error(`Unsupported contribution property: ${property}`);
    }
  }

  const skill = requiredString(value, 'skill');
  if (!CONTRIBUTION_SKILLS.has(skill)) {
    throw new Error(`Unsupported contribution skill: ${skill}`);
  }
  const operation = requiredString(value, 'operation');
  if (!CONTRIBUTION_OPERATIONS.has(operation)) {
    throw new Error(`Unsupported contribution operation: ${operation}`);
  }
  const agent = requiredString(value, 'agent');
  const skillsVersion = optionalString(value, 'skillsVersion');
  const environmentName = optionalString(value, 'environmentName');

  return {
    skill: skill as ContributionInput['skill'],
    operation: operation as ContributionInput['operation'],
    agent,
    ...(skillsVersion === undefined ? {} : { skillsVersion }),
    ...(environmentName === undefined ? {} : { environmentName }),
  };
}

export function selectDeployment(
  deployments: readonly ArmDeploymentSummary[],
  environmentName: string | undefined,
  now: number,
  windowMs: number = RECENCY_WINDOW_MS,
): ArmDeploymentSummary | undefined {
  const recent = deployments.filter(deployment => {
    if (deployment.provisioningState !== 'Succeeded') return false;
    const completed = Date.parse(deployment.timestamp);
    if (Number.isNaN(completed)) return false;
    const age = now - completed;
    return age <= windowMs && age >= -CLOCK_SKEW_MS;
  });
  if (recent.length === 0) return undefined;

  const preferred = environmentName === undefined
    ? recent
    : preferByEnvironment(recent, environmentName);

  return preferred.reduce((latest, candidate) =>
    Date.parse(candidate.timestamp) > Date.parse(latest.timestamp) ? candidate : latest);
}

export async function collectContributionWithDependencies(
  input: ContributionInput,
  dependencies: ContributionDependencies,
): Promise<ContributionResult> {
  if (dependencies.workspaceTelemetryEnabled === false || isOptedOut(dependencies.environment)) {
    return { status: 'disabled' };
  }
  if (!isConfiguredConnectionString(dependencies.connectionString)) {
    return { status: 'not-configured' };
  }

  const start = dependencies.now();
  let deployments: readonly ArmDeploymentSummary[];
  try {
    deployments = await dependencies.query.listSubscriptionDeployments();
  } catch {
    return { status: 'skipped', reason: 'deployment-query-failed' };
  }

  const selected = selectDeployment(deployments, input.environmentName, dependencies.now());
  if (selected === undefined) {
    return { status: 'skipped', reason: 'no-recent-deployment' };
  }

  const remainingMs = ARM_COLLECTION_DEADLINE_MS - (dependencies.now() - start);
  if (remainingMs <= 0) {
    return { status: 'skipped', reason: 'deadline-exceeded' };
  }
  const types = await collectResourceTypes(selected.id, dependencies.query, {
    now: dependencies.now,
    deadlineMs: remainingMs,
  });
  if (types.status === 'skip') {
    return { status: 'skipped', reason: types.reason };
  }

  const event = buildContributionEvent(input, types.resourceTypes);
  try {
    const result = await sendContributionEventWithDependencies(event, {
      connectionString: dependencies.connectionString,
      createClient: dependencies.createClient,
      environment: dependencies.environment,
      timeoutMs: dependencies.timeoutMs,
    });
    if (result.status === 'sent') return { status: 'sent' };
    if (result.status === 'disabled') return { status: 'disabled' };
    return { status: 'not-configured' };
  } catch {
    return { status: 'failed', reason: 'delivery-failed' };
  }
}

export async function collectContribution(
  input: ContributionInput,
  options: { readonly workspaceTelemetryEnabled?: boolean | undefined } = {},
): Promise<ContributionResult> {
  return collectContributionWithDependencies(input, {
    connectionString: APPLICATION_INSIGHTS_CONNECTION_STRING,
    createClient: createApplicationInsightsClient,
    environment: process.env,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    query: createAzureCliDeploymentQuery(),
    now: () => Date.now(),
    workspaceTelemetryEnabled: options.workspaceTelemetryEnabled,
  });
}

function buildContributionEvent(
  input: ContributionInput,
  resourceTypes: readonly string[],
): ContributionEvent {
  return {
    skill: input.skill,
    operation: input.operation,
    result: 'success',
    resourceTypes,
    deploymentKind: input.skill === 'azure-functions-deploy' ? 'function-app' : 'hosted-agent',
    agent: normalizeContributionAgent(input.agent),
    skillsVersion: normalizeSkillsVersion(input.skillsVersion),
  };
}

function preferByEnvironment(
  deployments: readonly ArmDeploymentSummary[],
  environmentName: string,
): readonly ArmDeploymentSummary[] {
  const matches = deployments.filter(deployment => deployment.name.includes(environmentName));
  return matches.length > 0 ? matches : deployments;
}

function requiredString(value: Readonly<Record<string, unknown>>, property: string): string {
  const result = optionalString(value, property);
  if (result === undefined) {
    throw new Error(`Missing required contribution property: ${property}`);
  }
  return result;
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  property: string,
): string | undefined {
  const result = value[property];
  if (result === undefined) return undefined;
  if (typeof result !== 'string' || result.length === 0 || result.length > MAX_STRING_LENGTH
    || containsControlCharacter(result)) {
    throw new Error(`Invalid contribution property: ${property}`);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  return [...value].some(character => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}
