import { execFile } from 'node:child_process';

const ARM_ORIGIN = 'https://management.azure.com/';
const OPERATIONS_API_VERSION = '2021-04-01';
const DEPLOYMENTS_WRAPPER_TYPE = 'microsoft.resources/deployments';
const RESOURCE_TYPE_PATTERN =
  /^microsoft\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const GENERAL_RESOURCE_TYPE_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const MAX_RESOURCE_TYPE_LENGTH = 256;
const MAX_PAGES = 20;

const DEFAULT_DEADLINE_MS = 15_000;
export const ARM_COLLECTION_DEADLINE_MS = DEFAULT_DEADLINE_MS;
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
  listSubscriptionDeployments(): Promise<readonly ArmDeploymentSummary[]>;
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
  const budget = createRequestBudget(maxRequests);
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
    async listSubscriptionDeployments(): Promise<readonly ArmDeploymentSummary[]> {
      const raw = await runner(['deployment', 'sub', 'list', '-o', 'json'], callTimeout());
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(toDeploymentSummary).filter((entry): entry is ArmDeploymentSummary => entry !== undefined);
    },

    async listDeploymentOperations(
      deploymentId: string,
      budget?: ArmRequestBudget,
    ): Promise<readonly ArmDeploymentOperation[]> {
      if (!isArmDeploymentId(deploymentId)) {
        throw new Error('Invalid ARM deployment identifier.');
      }
      const operations: ArmDeploymentOperation[] = [];
      let url = `${ARM_ORIGIN.replace(/\/$/, '')}${deploymentId}/operations?api-version=${OPERATIONS_API_VERSION}`;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (page > 0 && budget !== undefined && !budget.tryConsume()) {
          throw new ArmRequestBudgetError();
        }
        const raw = await runner(['rest', '--method', 'get', '--url', url], callTimeout());
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return operations;
        const value = parsed.value;
        if (Array.isArray(value)) {
          for (const item of value) {
            const operation = toDeploymentOperation(item);
            if (operation !== undefined) operations.push(operation);
          }
        }
        const nextLink = parsed.nextLink;
        if (typeof nextLink !== 'string' || nextLink.length === 0) return operations;
        if (!isSameOriginArmUrl(nextLink)) {
          throw new Error('Refusing to follow a non-ARM pagination link.');
        }
        url = nextLink;
      }
      throw new ArmRequestBudgetError();
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
    || typeof provisioningState !== 'string' || typeof timestamp !== 'string') {
    return undefined;
  }
  return { id, name, provisioningState, timestamp };
}

function toDeploymentOperation(value: unknown): ArmDeploymentOperation | undefined {
  if (!isRecord(value)) return undefined;
  const properties = isRecord(value.properties) ? value.properties : {};
  const targetResource = isRecord(properties.targetResource) ? properties.targetResource : {};
  return {
    provisioningOperation: asString(properties.provisioningOperation),
    provisioningState: asString(properties.provisioningState),
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

function defaultRunner(args: readonly string[], timeoutMs: number = DEFAULT_DEADLINE_MS): Promise<string> {
  const command = process.platform === 'win32' ? 'az.cmd' : 'az';
  const timeout = Math.max(1, Math.floor(timeoutMs));
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout, killSignal: 'SIGKILL' },
      (error, stdout) => {
        if (error) {
          reject(new Error('Azure CLI request failed.'));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
