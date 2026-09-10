import { execFile } from 'node:child_process';

const ARM_ORIGIN = 'https://management.azure.com/';
const OPERATIONS_API_VERSION = '2021-04-01';
const DEPLOYMENTS_WRAPPER_TYPE = 'microsoft.resources/deployments';
const RESOURCE_TYPE_PATTERN =
  /^microsoft\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const MAX_RESOURCE_TYPE_LENGTH = 256;
const MAX_PAGES = 20;

const DEFAULT_DEADLINE_MS = 15_000;
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
  listDeploymentOperations(deploymentId: string): Promise<readonly ArmDeploymentOperation[]>;
}

export type ArmCliRunner = (args: readonly string[]) => Promise<string>;

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
  | 'query-failed'
  | 'no-types';

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
  const stack: Array<{ readonly id: string; readonly depth: number }> = [
    { id: rootDeploymentId, depth: 0 },
  ];
  let requests = 0;

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

    if (requests >= maxRequests) {
      return { status: 'skip', reason: 'request-limit-exceeded' };
    }
    requests += 1;

    let operations: readonly ArmDeploymentOperation[];
    try {
      operations = await query.listDeploymentOperations(current.id);
    } catch {
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

      if (normalizedType === undefined) continue;
      types.add(normalizedType);
      if (types.size > maxTypes) {
        return { status: 'skip', reason: 'type-limit-exceeded' };
      }
    }
  }

  if (types.size === 0) {
    return { status: 'skip', reason: 'no-types' };
  }
  return { status: 'ok', resourceTypes: [...types].sort() };
}

export function createAzureCliDeploymentQuery(runner: ArmCliRunner = defaultRunner): ArmDeploymentQuery {
  return {
    async listSubscriptionDeployments(): Promise<readonly ArmDeploymentSummary[]> {
      const raw = await runner(['deployment', 'sub', 'list', '-o', 'json']);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(toDeploymentSummary).filter((entry): entry is ArmDeploymentSummary => entry !== undefined);
    },

    async listDeploymentOperations(deploymentId: string): Promise<readonly ArmDeploymentOperation[]> {
      if (!isArmDeploymentId(deploymentId)) {
        throw new Error('Invalid ARM deployment identifier.');
      }
      const operations: ArmDeploymentOperation[] = [];
      let url = `${ARM_ORIGIN.replace(/\/$/, '')}${deploymentId}/operations?api-version=${OPERATIONS_API_VERSION}`;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const raw = await runner(['rest', '--method', 'get', '--url', url]);
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) break;
        const value = parsed.value;
        if (Array.isArray(value)) {
          for (const item of value) {
            const operation = toDeploymentOperation(item);
            if (operation !== undefined) operations.push(operation);
          }
        }
        const nextLink = parsed.nextLink;
        if (typeof nextLink !== 'string' || nextLink.length === 0) break;
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

function defaultRunner(args: readonly string[]): Promise<string> {
  const command = process.platform === 'win32' ? 'az.cmd' : 'az';
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(new Error('Azure CLI request failed.'));
        return;
      }
      resolve(stdout);
    });
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
