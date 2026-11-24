import type { Runner, RunResult } from '../shared/exec.js';

/**
 * Why a deployment was refused by its package storage.
 * Only `propagation` is retried: every visible condition is correct and the resources were just created,
 * so a role assignment that Azure has not finished applying is the remaining explanation.
 */
export type StorageAccessCause = 'propagation' | 'role-missing' | 'network-restricted' | 'unknown';

export interface StorageAccessEvidence {
  readonly account?: string;
  readonly identity?: 'user-assigned' | 'system-assigned' | 'other';
  readonly role?: string | null;
  readonly publicNetworkAccess?: string;
  readonly defaultAction?: string;
  readonly minutesSinceProvision?: number | null;
}

export interface StorageAccessDiagnosis {
  readonly cause: StorageAccessCause;
  readonly detail: string;
  readonly fix?: string;
  readonly evidence: StorageAccessEvidence;
}

export interface StorageAccessTarget {
  readonly app: string;
  readonly subscription: string;
  readonly dir: string;
  /** When the provision step of this plan finished, if it did. */
  readonly provisionedAt?: string;
  readonly now: Date;
}

/** A provision older than this is unlikely to leave role assignments still propagating. */
export const PROPAGATION_WINDOW_MINUTES = 15;

const BLOB_DATA_ROLES = ['Storage Blob Data Owner', 'Storage Blob Data Contributor'];
/** Error codes only Azure Storage returns. */
const STORAGE_DENIAL_CODE = /\bAuthorizationPermissionMismatch\b|\bAuthorizationFailure\b/;
const GENERIC_DENIAL = /\b403\b|\bForbidden\b|not authorized to perform this operation/i;
const STORAGE_ENDPOINT = /\.blob\.core\.(?:windows\.net|chinacloudapi\.cn|usgovcloudapi\.net)\b/i;

/** True only when the output shows that Azure Storage, not another service, refused the request. */
export function isStorageForbidden(output: string): boolean {
  return STORAGE_DENIAL_CODE.test(output) || (GENERIC_DENIAL.test(output) && STORAGE_ENDPOINT.test(output));
}

/** Milliseconds since provision, or `null` when unknown, in the future, or not a valid time. */
export function provisionAgeMs(provisionedAt: string | undefined, now: Date): number | null {
  if (!provisionedAt) return null;
  const age = now.getTime() - Date.parse(provisionedAt);
  return Number.isFinite(age) && age >= 0 ? age : null;
}

/** True while a role assignment made by the last provision may still be propagating. */
export function withinPropagationWindow(provisionedAt: string | undefined, now: Date): boolean {
  const age = provisionAgeMs(provisionedAt, now);
  return age !== null && age < PROPAGATION_WINDOW_MINUTES * 60_000;
}

interface DeploymentStorage {
  readonly value?: string;
  readonly authentication?: { readonly type?: string; readonly userAssignedIdentityResourceId?: string };
}

interface SiteDocument {
  readonly identity?: { readonly principalId?: string };
  readonly functionAppConfig?: { readonly deployment?: { readonly storage?: DeploymentStorage } };
  readonly properties?: { readonly functionAppConfig?: { readonly deployment?: { readonly storage?: DeploymentStorage } } };
}

/** Reads the deployment storage, its identity role, and its network rules. Reads only; changes nothing. */
export async function diagnoseStorageAccess(target: StorageAccessTarget, run: Runner): Promise<StorageAccessDiagnosis> {
  const age = provisionAgeMs(target.provisionedAt, target.now);
  const minutesSinceProvision = age === null ? null : Math.floor(age / 60_000);
  const unknown = (detail: string, evidence: StorageAccessEvidence = {}): StorageAccessDiagnosis => ({
    cause: 'unknown', detail, evidence: { ...evidence, minutesSinceProvision },
    fix: 'Read the log file, check the identity role and storage network rules, then resume.',
  });

  const scope = ['--subscription', target.subscription, '--output', 'json'];
  const az = async (args: string[]): Promise<RunResult> => run('az', [...args, ...scope], { cwd: target.dir });
  const resourceGroup = parse<Array<{ resourceGroup?: string }>>(await az(
    ['resource', 'list', '--name', target.app, '--resource-type', 'Microsoft.Web/sites']))?.[0]?.resourceGroup;
  if (!resourceGroup) return unknown(`Function app ${target.app} could not be read.`);

  const site = parse<SiteDocument>(await az(['functionapp', 'show', '--name', target.app, '--resource-group', resourceGroup]));
  const storage = site?.functionAppConfig?.deployment?.storage ?? site?.properties?.functionAppConfig?.deployment?.storage;
  const account = storage?.value ? accountName(storage.value) : null;
  if (!account) return unknown('The deployment storage of the function app could not be read.');

  const authentication = storage?.authentication?.type?.toLowerCase();
  const identity = authentication === 'userassignedidentity' ? 'user-assigned'
    : authentication === 'systemassignedidentity' ? 'system-assigned' : 'other';
  if (identity === 'other') {
    return unknown('The deployment storage does not use a managed identity, so a role delay cannot explain the refusal.',
      { account, identity });
  }
  const principalId = identity === 'user-assigned'
    ? parse<{ principalId?: string }>(await az(
      ['identity', 'show', '--ids', storage?.authentication?.userAssignedIdentityResourceId ?? '']))?.principalId
    : site?.identity?.principalId;

  const accountInfo = parse<{ id?: string; publicNetworkAccess?: string | null; networkRuleSet?: { defaultAction?: string } }>(
    await az(['storage', 'account', 'show', '--name', account]));
  if (!principalId || !accountInfo?.id) return unknown('The identity or the storage account could not be read.', { account, identity });
  const publicNetworkAccess = accountInfo.publicNetworkAccess ?? 'Enabled';
  const defaultAction = accountInfo.networkRuleSet?.defaultAction ?? 'Allow';

  const assignments = parse<Array<{ roleDefinitionName?: string; condition?: string | null }>>(await az(
    ['role', 'assignment', 'list', '--assignee', principalId, '--scope', accountInfo.id, '--include-inherited']));
  const matching = (assignments ?? []).filter(assignment =>
    !!assignment.roleDefinitionName && BLOB_DATA_ROLES.includes(assignment.roleDefinitionName));
  const unconditional = matching.find(assignment => !assignment.condition?.trim());
  const role = (unconditional ?? matching[0])?.roleDefinitionName ?? null;
  const evidence: StorageAccessEvidence = { account, identity, role, publicNetworkAccess, defaultAction, minutesSinceProvision };

  if (!assignments) return unknown('The role assignments could not be read.', evidence);
  if (!role) {
    return {
      cause: 'role-missing', evidence,
      detail: `The ${identity} identity has no Storage Blob Data role on ${account}.`,
      fix: `Assign Storage Blob Data Owner on ${account} to the identity in the infrastructure, run provision again, then resume.`,
    };
  }
  if (!unconditional) {
    return unknown(`The ${role} assignment on ${account} has a condition that may deny this request.`, evidence);
  }
  if (publicNetworkAccess.toLowerCase() !== 'enabled' || defaultAction.toLowerCase() !== 'allow') {
    return {
      cause: 'network-restricted', evidence,
      detail: `${account} does not accept requests from this machine (public access ${publicNetworkAccess}, default action ${defaultAction}).`,
      fix: 'Deploy from a network the storage account allows, or change its network rules with the user\'s approval, then resume.',
    };
  }
  if (!withinPropagationWindow(target.provisionedAt, target.now)) {
    return unknown('The role and network rules look correct, but the resources were not just provisioned, so a role delay is unlikely.',
      evidence);
  }
  return {
    cause: 'propagation', evidence,
    detail: `The role and network rules are correct and provision finished ${minutesSinceProvision} minute(s) ago. The role assignment is probably still propagating.`,
  };
}

function accountName(blobUrl: string): string | null {
  try {
    const host = new URL(blobUrl).hostname;
    return host.split('.')[0] || null;
  } catch {
    return null;
  }
}

function parse<T>(outcome: RunResult): T | null {
  if (outcome.code !== 0) return null;
  try {
    return JSON.parse(outcome.stdout) as T;
  } catch {
    return null;
  }
}
