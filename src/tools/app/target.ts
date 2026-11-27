import type { AzureClient } from './azure.js';
import { EXIT, ToolError } from './output.js';

export const WEB_API_VERSION = '2024-11-01';
export const RESOURCE_GRAPH_API_VERSION = '2022-10-01';

export interface AppTarget {
  /** Resource ID of the target: the site, or the slot when `slot` is set. */
  id: string;
  /** Site name (without the slot). */
  name: string;
  resourceGroup: string;
  subscriptionId: string;
  /** Production site resource ID. */
  siteId: string;
  slot?: string;
  /** Display name: `app` or `app/slot`. */
  label: string;
  /** Flags that select this target again in suggested commands: `--app app [--slot slot]`. */
  ref: string;
}

export interface TargetOptions {
  app: string;
  resourceGroup?: string;
  subscription?: string;
  slot?: string;
}

const APP_ID = /^\/subscriptions\/([0-9a-f-]{36})\/resourceGroups\/([-\w.()]+)\/providers\/Microsoft\.Web\/sites\/([A-Za-z0-9-]+)(?:\/slots\/([A-Za-z0-9-]+))?$/i;
const SLOT_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,58}$/;
const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,59}$/;
const RESOURCE_GROUP = /^[-\w.()]{1,90}$/;
const SUBSCRIPTION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAppId(id: string): AppTarget | undefined {
  const match = APP_ID.exec(id.trim());
  if (!match) return undefined;
  const siteId = `/subscriptions/${match[1]}/resourceGroups/${match[2]}/providers/Microsoft.Web/sites/${match[3]}`;
  return makeTarget(siteId, match[1], match[2], match[3], match[4]);
}

function makeTarget(siteId: string, subscriptionId: string, resourceGroup: string, name: string, slot: string | undefined): AppTarget {
  const useSlot = slot && slot.toLowerCase() !== 'production' ? slot : undefined;
  return {
    id: useSlot ? `${siteId}/slots/${useSlot}` : siteId,
    siteId,
    name,
    resourceGroup,
    subscriptionId,
    slot: useSlot,
    label: useSlot ? `${name}/${useSlot}` : name,
    ref: useSlot ? `--app ${name} --slot ${useSlot}` : `--app ${name}`,
  };
}

/** Applies `--slot` to a resolved target. A slot in the resource ID and a different --slot conflict. */
export function withSlot(target: AppTarget, slot: string | undefined): AppTarget {
  if (slot === undefined) return target;
  if (!SLOT_NAME.test(slot)) throw new ToolError(EXIT.usage, `Invalid --slot "${slot}". Pass the slot name, for example --slot staging.`);
  const requested = slot.toLowerCase() === 'production' ? undefined : slot.toLowerCase();
  if (target.slot && target.slot.toLowerCase() !== requested) throw new ToolError(EXIT.usage, `--app points to slot ${target.slot} but --slot is ${slot}. Pass only one.`);
  return makeTarget(target.siteId, target.subscriptionId, target.resourceGroup, target.name, slot);
}

export function validateScope(options: { resourceGroup?: string; subscription?: string }): void {
  if (options.resourceGroup !== undefined && !RESOURCE_GROUP.test(options.resourceGroup)) {
    throw new ToolError(EXIT.usage, `Invalid --resource-group "${options.resourceGroup}".`);
  }
  if (options.subscription !== undefined && !SUBSCRIPTION.test(options.subscription)) {
    throw new ToolError(EXIT.usage, `--subscription must be a subscription ID (GUID).`);
  }
}

export interface GraphRow {
  id: string;
  name: string;
  resourceGroup: string;
  subscriptionId: string;
  [key: string]: unknown;
}

export async function queryGraph(client: AzureClient, query: string, subscription?: string): Promise<GraphRow[]> {
  const body: Record<string, unknown> = { query, options: { resultFormat: 'objectArray', $top: 200 } };
  if (subscription) body.subscriptions = [subscription];
  const result = await client.arm<{ data: GraphRow[] }>('POST', '/providers/Microsoft.ResourceGraph/resources', RESOURCE_GRAPH_API_VERSION, { body, idempotent: true });
  return result.data;
}

/** Resolves `--app` (name or resource ID) to exactly one Function App. */
export async function resolveApp(client: AzureClient, options: TargetOptions): Promise<AppTarget> {
  return withSlot(await resolveSite(client, options), options.slot);
}

async function resolveSite(client: AzureClient, options: TargetOptions): Promise<AppTarget> {
  const fromId = parseAppId(options.app);
  if (fromId) return fromId;
  if (options.app.startsWith('/')) throw new ToolError(EXIT.usage, `--app is not a Microsoft.Web/sites resource ID: ${options.app}`);
  if (!APP_NAME.test(options.app)) throw new ToolError(EXIT.usage, `Invalid app name "${options.app}". Use letters, digits, and hyphens, or pass the full resource ID.`);
  validateScope(options);

  const filters = [`type =~ 'microsoft.web/sites'`, `name =~ '${options.app}'`];
  if (options.resourceGroup) filters.push(`resourceGroup =~ '${options.resourceGroup}'`);
  const rows = await queryGraph(client, `resources | where ${filters.join(' and ')} | project id, name, resourceGroup, subscriptionId, kind`, options.subscription);

  if (rows.length === 0) {
    throw new ToolError(EXIT.usage, `No app named "${options.app}" was found in the subscriptions you can access.`, {
      next: ['Run `app find` to list Function Apps, or pass --subscription / the full resource ID.'],
    });
  }
  if (rows.length > 1) {
    throw new ToolError(EXIT.usage, `"${options.app}" matches ${rows.length} apps. Pass --resource-group, --subscription, or the full resource ID.`, {
      data: rows.map(row => row.id),
    });
  }
  const row = rows[0];
  return makeTarget(row.id, row.subscriptionId, row.resourceGroup, row.name, undefined);
}
