import { execFile } from 'node:child_process';

const ARM_ORIGIN = 'https://management.azure.com/';
const OPERATIONS_API_VERSION = '2021-04-01';
const DEPLOYMENTS_WRAPPER_TYPE = 'microsoft.resources/deployments';
const RESOURCE_TYPE_PATTERN =
  /^microsoft\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const GENERAL_RESOURCE_TYPE_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const MAX_RESOURCE_TYPE_LENGTH = 256;

export const ARM_COLLECTION_DEADLINE_MS = 20_000;
const DEFAULT_DEADLINE_MS = ARM_COLLECTION_DEADLINE_MS;
const AZURE_CLI_NOT_FOUND_PATTERN = /\((?:DeploymentNotFound|ResourceNotFound)\)/;
const DEFAULT_MAX_REQUESTS = 50;
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_TYPES = 100;

export interface ArmDeploymentSummary {
  readonly id: string;
  readonly name: string;
  readonly provisioningState: string;
  readonly timestamp: string;
}

export interface ArmDeploymentOperation {
  readonly provisioningOperation?: string;
  readonly provisioningState?: string;
  readonly targetResourceType?: string;
  readonly targetResourceId?: string;
}

export interface ArmDeploymentQuery {
  getDeploymentByName(name: string): Promise<ArmDeploymentSummary | undefined>;
  listDeploymentOperations(
    deploymentId: string,
    budget?: ArmRequestBudget,
  ): Promise<readonly ArmDeploymentOperation[]>;
}

export interface ArmRequestBudget {
  tryConsume(): boolean;
}

export type ArmCliRunner = (args: readonly string[], timeoutMs?: number) => Promise<string>;

export interface ResourceTypeCollectionOptions {
  readonly deadlineMs?: number;
  readonly maxRequests?: number;
  readonly maxDepth?: number;
  readonly maxTypes?: number;
  readonly now?: () => number;
  readonly budget?: ArmRequestBudget;
}

export type ArmSkipReason =
  | 'deadline-exceeded'
  | 'request-limit-exceeded'
  | 'depth-limit-exceeded'
  | 'type-limit-exceeded'
  | 'incomplete-child'
  | 'malformed-operation'
  | 'query-failed'
  | 'no-types';

class ArmDeadlineError extends Error {}
class ArmRequestBudgetError extends Error {}

// The only runner failure that means "no such deployment". Every other failure
// (authentication, authorization, network, throttling) is a query failure.
export class ArmNotFoundError extends Error {
  constructor() {
    super('ARM resource not found.');
  }
}

export function isAzureCliNotFound(stderr: string): boolean {
  return AZURE_CLI_NOT_FOUND_PATTERN.test(stderr);
}

function createRequestBudget(max: number): ArmRequestBudget {
  let remaining = max;
  return {
    tryConsume(): boolean {
      if (remaining <= 0) return false;
      remaining -= 1;
      return true;
    },
  };
}

export function createArmRequestBudget(max: number = DEFAULT_MAX_REQUESTS): ArmRequestBudget {
  return createRequestBudget(max);
}

function startDeadline(totalMs: number, now: () => number = Date.now): { remainingMs(): number } {
  const start = now();
  return { remainingMs: () => totalMs - (now() - start) };
}

function withDeadline<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) return Promise.reject(new ArmDeadlineError());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ArmDeadlineError()), remainingMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('ARM query failed.'));
      },
    );
  });
}

export type ResourceTypeResult =
  | { readonly status: 'ok'; readonly resourceTypes: readonly string[] }
  | { readonly status: 'skip'; readonly reason: ArmSkipReason };

export async function collectResourceTypes(
  rootDeploymentId: string,
  query: ArmDeploymentQuery,
  options: ResourceTypeCollectionOptions = {},
): Promise<ResourceTypeResult> {
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxTypes = options.maxTypes ?? DEFAULT_MAX_TYPES;
  const now = options.now ?? Date.now;

  const start = now();
  const visited = new Set<string>();
  const types = new Set<string>();
  const budget = options.budget ?? createRequestBudget(maxRequests);
  const stack: Array<{ readonly id: string; readonly depth: number }> = [
    { id: rootDeploymentId, depth: 0 },
  ];

  while (stack.length > 0) {
    if (now() - start > deadlineMs) {
      return { status: 'skip', reason: 'deadline-exceeded' };
    }
    const current = stack.pop() as { readonly id: string; readonly depth: number };
    if (current.depth > maxDepth) {
      return { status: 'skip', reason: 'depth-limit-exceeded' };
    }
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (!budget.tryConsume()) {
      return { status: 'skip', reason: 'request-limit-exceeded' };
    }

    const remainingMs = deadlineMs - (now() - start);
    if (remainingMs <= 0) {
      return { status: 'skip', reason: 'deadline-exceeded' };
    }

    let operations: readonly ArmDeploymentOperation[];
    try {
      operations = await withDeadline(
        Promise.resolve(query.listDeploymentOperations(current.id, budget)),
        remainingMs,
      );
    } catch (error) {
      if (error instanceof ArmDeadlineError) {
        return { status: 'skip', reason: 'deadline-exceeded' };
      }
      if (error instanceof ArmRequestBudgetError) {
        return { status: 'skip', reason: 'request-limit-exceeded' };
      }
      return { status: 'skip', reason: 'query-failed' };
    }

    for (const operation of operations) {
      if (operation.provisioningOperation !== 'Create') continue;

      const normalizedType = normalizeResourceType(operation.targetResourceType);
      const isWrapper = normalizedType === DEPLOYMENTS_WRAPPER_TYPE;

      if (operation.provisioningState !== 'Succeeded') {
        if (isWrapper) {
          return { status: 'skip', reason: 'incomplete-child' };
        }
        continue;
      }

      if (isWrapper) {
        const childId = operation.targetResourceId;
        if (typeof childId !== 'string' || !isArmDeploymentId(childId)) {
          return { status: 'skip', reason: 'incomplete-child' };
        }
        stack.push({ id: childId, depth: current.depth + 1 });
        continue;
      }

      if (normalizedType !== undefined) {
        types.add(normalizedType);
        if (types.size > maxTypes) {
          return { status: 'skip', reason: 'type-limit-exceeded' };
        }
        continue;
      }

      if (isValidResourceTypeSyntax(operation.targetResourceType)) {
        continue;
      }
      return { status: 'skip', reason: 'malformed-operation' };
    }
  }

  if (types.size === 0) {
    return { status: 'skip', reason: 'no-types' };
  }
  return { status: 'ok', resourceTypes: [...types].sort() };
}

export function createAzureCliDeploymentQuery(
  runner: ArmCliRunner = defaultRunner,
  deadlineMs: number = DEFAULT_DEADLINE_MS,
): ArmDeploymentQuery {
  const deadline = startDeadline(deadlineMs);
  const callTimeout = (): number => Math.max(1, Math.ceil(deadline.remainingMs()));
  return {
    async getDeploymentByName(name: string): Promise<ArmDeploymentSummary | undefined> {
      if (!isValidDeploymentName(name)) {
        throw new Error('Invalid ARM deployment name.');
      }
      let raw: string;
      try {
        raw = await runner(['deployment', 'sub', 'show', '--name', name, '-o', 'json'], callTimeout());
      } catch (error) {
        if (error instanceof ArmNotFoundError) return undefined;
        throw error instanceof Error ? error : new Error('ARM deployment lookup failed.');
      }
      const summary = toDeploymentSummary(JSON.parse(raw));
      if (summary === undefined || summary.name.toLowerCase() !== name.toLowerCase()) {
        throw new Error('Malformed ARM deployment response.');
      }
      return summary;
    },

    async listDeploymentOperations(
      deploymentId: string,
      budget?: ArmRequestBudget,
    ): Promise<readonly ArmDeploymentOperation[]> {
      if (!isArmDeploymentId(deploymentId)) {
        throw new Error('Invalid ARM deployment identifier.');
      }
      const operations: ArmDeploymentOperation[] = [];
      let url: string | undefined = `${ARM_ORIGIN.replace(/\/$/, '')}${deploymentId}/operations?api-version=${OPERATIONS_API_VERSION}`;
      let firstPage = true;
      while (url !== undefined) {
        // The first page is charged by the caller (it is the deployment's own request);
        // every subsequent page must consume the shared budget before it runs.
        if (!firstPage) {
          if (budget === undefined || !budget.tryConsume()) {
            throw new ArmRequestBudgetError();
          }
        }
        firstPage = false;
        const raw = await runner(['rest', '--method', 'get', '--url', url], callTimeout());
        // A malformed page makes the traversal incomplete. Reject it so the caller
        // skips, rather than returning a silently truncated operation list.
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed) || !Array.isArray(parsed.value)) {
          throw new Error('Malformed ARM operations page.');
        }
        for (const item of parsed.value) {
          const operation = toDeploymentOperation(item);
          if (operation === undefined) {
            throw new Error('Malformed ARM deployment operation.');
          }
          operations.push(operation);
        }
        const nextLink = parsed.nextLink;
        if (nextLink === undefined || nextLink === null || nextLink === '') return operations;
        if (typeof nextLink !== 'string') {
          throw new Error('Malformed ARM pagination link.');
        }
        if (!isSameOriginArmUrl(nextLink)) {
          throw new Error('Refusing to follow a non-ARM pagination link.');
        }
        url = nextLink;
      }
      return operations;
    },
  };
}

function toDeploymentSummary(value: unknown): ArmDeploymentSummary | undefined {
  if (!isRecord(value)) return undefined;
  const properties = isRecord(value.properties) ? value.properties : {};
  const id = value.id;
  const name = value.name;
  const provisioningState = properties.provisioningState;
  const timestamp = properties.timestamp;
  if (typeof id !== 'string' || typeof name !== 'string'
    || typeof provisioningState !== 'string' || typeof timestamp !== 'string'
    || !isArmDeploymentId(id) || Number.isNaN(Date.parse(timestamp))) {
    return undefined;
  }
  return { id, name, provisioningState, timestamp };
}

function toDeploymentOperation(value: unknown): ArmDeploymentOperation | undefined {
  if (!isRecord(value) || !isRecord(value.properties)) return undefined;
  const properties = value.properties;
  const provisioningOperation = asString(properties.provisioningOperation);
  const provisioningState = asString(properties.provisioningState);
  if (provisioningOperation === undefined || provisioningState === undefined) return undefined;
  const targetResource = isRecord(properties.targetResource) ? properties.targetResource : {};
  return {
    provisioningOperation,
    provisioningState,
    targetResourceType: asString(targetResource.resourceType),
    targetResourceId: asString(targetResource.id),
  };
}

function normalizeResourceType(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_RESOURCE_TYPE_LENGTH) return undefined;
  const lowered = trimmed.toLowerCase();
  if (!RESOURCE_TYPE_PATTERN.test(lowered)) return undefined;
  return lowered;
}

function isValidResourceTypeSyntax(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_RESOURCE_TYPE_LENGTH) return false;
  return GENERAL_RESOURCE_TYPE_PATTERN.test(trimmed.toLowerCase());
}

export function isNormalizedResourceType(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_RESOURCE_TYPE_LENGTH
    && RESOURCE_TYPE_PATTERN.test(value);
}

function isArmDeploymentId(value: string): boolean {
  return value.startsWith('/subscriptions/')
    && value.toLowerCase().includes('/providers/microsoft.resources/deployments/')
    && !value.includes('..')
    && !/\s/.test(value);
}

function isSameOriginArmUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === new URL(ARM_ORIGIN).origin;
  } catch {
    return false;
  }
}

export interface RunnerInvocation {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: {
    readonly maxBuffer: number;
    readonly windowsHide: boolean;
    readonly timeout: number;
    readonly killSignal: 'SIGKILL';
    readonly windowsVerbatimArguments?: boolean;
  };
}

const RUNNER_MAX_BUFFER = 8 * 1024 * 1024;

function quoteForCmd(arg: string): string {
  if (hasUnsafeCmdCharacter(arg)) {
    throw new Error('Refusing to pass an unsafe argument to the Azure CLI.');
  }
  return `"${arg}"`;
}

function hasUnsafeCmdCharacter(value: string): boolean {
  return [...value].some(character => {
    if (character === '"') return true;
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint <= 0x1f;
  });
}

export function buildRunnerInvocation(
  platform: NodeJS.Platform,
  args: readonly string[],
  timeoutMs: number = DEFAULT_DEADLINE_MS,
  comSpec: string = process.env.ComSpec ?? 'cmd.exe',
): RunnerInvocation {
  const timeout = Math.max(1, Math.floor(timeoutMs));
  const baseOptions = {
    maxBuffer: RUNNER_MAX_BUFFER,
    windowsHide: true,
    timeout,
    killSignal: 'SIGKILL' as const,
  };
  if (platform !== 'win32') {
    return { file: 'az', args: [...args], options: baseOptions };
  }
  // `az` on Windows is `az.cmd`; Node >= 18.20.2 refuses to spawn `.cmd` without a
  // shell, and execFile with `shell: true` does not quote arguments (our nextLink
  // URLs contain `&`). Route through cmd.exe with each argument quoted, keeping the
  // program name unquoted so az.cmd's `%~dp0` interpreter resolution still works.
  const commandLine = `"az ${args.map(quoteForCmd).join(' ')}"`;
  return {
    file: comSpec,
    args: ['/d', '/s', '/c', commandLine],
    options: { ...baseOptions, windowsVerbatimArguments: true },
  };
}

function defaultRunner(args: readonly string[], timeoutMs: number = DEFAULT_DEADLINE_MS): Promise<string> {
  const invocation = buildRunnerInvocation(process.platform, args, timeoutMs);
  return new Promise((resolve, reject) => {
    execFile(
      invocation.file,
      [...invocation.args],
      invocation.options,
      (error, stdout, stderr) => {
        if (error) {
          // Classify only; never keep or forward CLI output.
          reject(isAzureCliNotFound(String(stderr)) ? new ArmNotFoundError() : new Error('Azure CLI request failed.'));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function isValidDeploymentName(value: string): boolean {
  return /^[A-Za-z0-9._()-]{1,64}$/.test(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
