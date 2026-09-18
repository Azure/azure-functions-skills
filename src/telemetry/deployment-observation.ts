import { APPLICATION_INSIGHTS_CONNECTION_STRING } from './config.js';
import {
  ARM_COLLECTION_DEADLINE_MS,
  collectResourceTypes,
  createArmRequestBudget,
  createAzureCliDeploymentQuery,
  isValidDeploymentName,
  type ArmDeploymentQuery,
  type ArmDeploymentSummary,
} from './arm-deployments.js';
import {
  createApplicationInsightsClient,
  DEFAULT_TIMEOUT_MS,
  isConfiguredConnectionString,
  isOptedOut,
  normalizeObservedAgent,
  normalizeSkillsVersion,
  sendDeploymentObservedEventWithDependencies,
  type ApplicationInsightsClient,
  type DeploymentObservedEvent,
  type TelemetryEnvironment,
} from './sender.js';

const RECENCY_WINDOW_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_STRING_LENGTH = 256;
const OBSERVATION_INPUT_PROPERTIES = new Set([
  'skill',
  'operation',
  'agent',
  'skillsVersion',
  'environmentName',
  'startedAt',
]);
const OBSERVATION_SKILLS = new Set(['azure-functions-deploy', 'azure-functions-hosted-skills']);
const OBSERVATION_OPERATIONS = new Set(['deploy', 'provision']);

export interface DeploymentObservationInput {
  readonly skill: 'azure-functions-deploy' | 'azure-functions-hosted-skills';
  readonly operation: 'deploy' | 'provision';
  readonly agent: string;
  readonly skillsVersion?: string;
  readonly environmentName?: string;
  // Local-only lower bound on deployment selection. Never transmitted.
  readonly startedAt?: string;
}

export type DeploymentObservationResult =
  | { readonly status: 'sent' }
  | { readonly status: 'disabled' }
  | { readonly status: 'not-configured' }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };

export interface DeploymentObservationDependencies {
  readonly connectionString: string;
  readonly createClient: (connectionString: string) => ApplicationInsightsClient;
  readonly environment: TelemetryEnvironment;
  readonly timeoutMs: number;
  readonly query: ArmDeploymentQuery;
  readonly now: () => number;
  readonly workspaceTelemetryEnabled: boolean | undefined;
  readonly armDeadlineMs?: number;
}

export function parseDeploymentObservationInput(value: unknown): DeploymentObservationInput {
  if (!isRecord(value)) {
    throw new Error('Deployment observation input must be a JSON object.');
  }
  for (const property of Object.keys(value)) {
    if (!OBSERVATION_INPUT_PROPERTIES.has(property)) {
      throw new Error(`Unsupported deployment observation property: ${property}`);
    }
  }

  const skill = requiredString(value, 'skill');
  if (!OBSERVATION_SKILLS.has(skill)) {
    throw new Error(`Unsupported deployment observation skill: ${skill}`);
  }
  const operation = requiredString(value, 'operation');
  if (!OBSERVATION_OPERATIONS.has(operation)) {
    throw new Error(`Unsupported deployment observation operation: ${operation}`);
  }
  const agent = requiredString(value, 'agent');
  const skillsVersion = optionalString(value, 'skillsVersion');
  const environmentName = optionalString(value, 'environmentName');
  // startedAt is a local-only hint. A malformed value must never fail the parse,
  // so read it leniently: keep it only when it is a safe string, otherwise drop it.
  const startedAt = lenientString(value.startedAt);

  return {
    skill: skill as DeploymentObservationInput['skill'],
    operation: operation as DeploymentObservationInput['operation'],
    agent,
    ...(skillsVersion === undefined ? {} : { skillsVersion }),
    ...(environmentName === undefined ? {} : { environmentName }),
    ...(startedAt === undefined ? {} : { startedAt }),
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

export async function collectDeploymentObservationWithDependencies(
  input: DeploymentObservationInput,
  dependencies: DeploymentObservationDependencies,
): Promise<DeploymentObservationResult> {
  if (dependencies.workspaceTelemetryEnabled === false || isOptedOut(dependencies.environment)) {
    return { status: 'disabled' };
  }
  if (!isConfiguredConnectionString(dependencies.connectionString)) {
    return { status: 'not-configured' };
  }

  // Phase 1 locates the deployment by name (the environment name that azd/az use to
  // name the deployment). Without a usable name there is no discovery path, so skip
  // before any subprocess or network call.
  const environmentName = input.environmentName;
  if (environmentName === undefined || !isValidDeploymentName(environmentName)) {
    return { status: 'skipped', reason: 'no-environment-name' };
  }

  const start = dependencies.now();
  const armDeadlineMs = dependencies.armDeadlineMs ?? ARM_COLLECTION_DEADLINE_MS;

  // One shared budget bounds every ARM HTTP request for this collection: the
  // deployment lookup plus the operations traversal. The lookup is one request.
  const budget = createArmRequestBudget();
  if (!budget.tryConsume()) {
    return { status: 'skipped', reason: 'request-limit-exceeded' };
  }

  let deployment: ArmDeploymentSummary | undefined;
  try {
    deployment = await dependencies.query.getDeploymentByName(environmentName);
  } catch {
    return { status: 'skipped', reason: 'deployment-query-failed' };
  }
  if (deployment === undefined) {
    return { status: 'skipped', reason: 'no-recent-deployment' };
  }

  const selected = selectDeployment([deployment], undefined, dependencies.now());
  if (selected === undefined) {
    return { status: 'skipped', reason: 'no-recent-deployment' };
  }

  // Optional lower bound (FRD D-016): the named deployment must have completed at or
  // after the caller-supplied start instant. This removes the false positive where a
  // cache-only run matches an earlier manual deployment that reused the environment
  // name. A malformed startedAt parses to NaN and is ignored (window only).
  const startedAtMs = input.startedAt === undefined ? NaN : Date.parse(input.startedAt);
  if (!Number.isNaN(startedAtMs) && Date.parse(selected.timestamp) < startedAtMs) {
    return { status: 'skipped', reason: 'deployment-precedes-start' };
  }

  const remainingMs = armDeadlineMs - (dependencies.now() - start);
  if (remainingMs <= 0) {
    return { status: 'skipped', reason: 'deadline-exceeded' };
  }
  const types = await collectResourceTypes(selected.id, dependencies.query, {
    now: dependencies.now,
    deadlineMs: remainingMs,
    budget,
  });
  if (types.status === 'skip') {
    return { status: 'skipped', reason: types.reason };
  }

  const event = buildDeploymentObservedEvent(input, types.resourceTypes);
  try {
    const result = await sendDeploymentObservedEventWithDependencies(event, {
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

export async function collectDeploymentObservation(
  input: DeploymentObservationInput,
  options: {
    readonly workspaceTelemetryEnabled?: boolean | undefined;
    readonly armDeadlineMs?: number;
  } = {},
): Promise<DeploymentObservationResult> {
  const armDeadlineMs = options.armDeadlineMs ?? ARM_COLLECTION_DEADLINE_MS;
  return collectDeploymentObservationWithDependencies(input, {
    connectionString: APPLICATION_INSIGHTS_CONNECTION_STRING,
    createClient: createApplicationInsightsClient,
    environment: process.env,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    query: createAzureCliDeploymentQuery(undefined, armDeadlineMs),
    now: () => Date.now(),
    workspaceTelemetryEnabled: options.workspaceTelemetryEnabled,
    armDeadlineMs,
  });
}

function buildDeploymentObservedEvent(
  input: DeploymentObservationInput,
  resourceTypes: readonly string[],
): DeploymentObservedEvent {
  return {
    skill: input.skill,
    operation: input.operation,
    result: 'success',
    resourceTypes,
    deploymentKind: input.skill === 'azure-functions-deploy' ? 'function-app' : 'hosted-agent',
    agent: normalizeObservedAgent(input.agent),
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
    throw new Error(`Missing required deployment observation property: ${property}`);
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
    throw new Error(`Invalid deployment observation property: ${property}`);
  }
  return result;
}

function lenientString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_STRING_LENGTH
    || containsControlCharacter(value)) {
    return undefined;
  }
  return value;
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
