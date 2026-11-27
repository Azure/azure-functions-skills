import { boolFlag, durationFlag, intFlag, stringFlag } from '../args.js';
import { AzureError, LOGS_ENDPOINT, LOGS_RESOURCE, SCM_RESOURCE, type AzureClient } from '../azure.js';
import { scmHost, summarizeApp, type Plan, type Site, type SiteConfig } from '../inspect.js';
import { EXIT, ToolError, type Finding } from '../output.js';
import { redactSettings, scrubText } from '../redact.js';
import { WEB_API_VERSION, queryGraph, validateScope, type AppTarget } from '../target.js';
import { appTarget as target, tryRead } from './common.js';
import { readSlotConfigNames } from './settings.js';
import type { CommandSpec } from './types.js';

const ACTIVITY_LOG_API_VERSION = '2015-04-01';

function listSettings(client: AzureClient, app: AppTarget): Promise<{ properties: Record<string, string> }> {
  return client.arm('POST', `${app.id}/config/appsettings/list`, WEB_API_VERSION, { idempotent: true });
}

interface FunctionEnvelope {
  name: string;
  properties: {
    config?: { bindings?: { type?: string; direction?: string; name?: string; route?: string; methods?: string[]; authLevel?: string; schedule?: string; queueName?: string; topicName?: string; eventHubName?: string; connection?: string }[] };
    invoke_url_template?: string | null;
    isDisabled?: boolean;
    language?: string | null;
  };
}

interface Deployment {
  id: string;
  status: number;
  message?: string;
  deployer?: string;
  author?: string | null;
  start_time?: string;
  end_time?: string | null;
  complete?: boolean;
  active?: boolean;
}

const DEPLOYMENT_STATUS: Record<number, string> = { 0: 'Pending', 1: 'Building', 2: 'Deploying', 3: 'Failed', 4: 'Success' };

interface LogTable {
  columns: { name: string; type: string }[];
  rows: unknown[][];
}

const LOG_PRESETS: Record<string, string> = {
  errors: "union traces, exceptions | where cloud_RoleName =~ '{app}' and severityLevel >= 3 | project timestamp, itemType, operation_Name, message = coalesce(message, outerMessage), problemId, operation_Id | order by timestamp desc",
  exceptions: "exceptions | where cloud_RoleName =~ '{app}' | project timestamp, operation_Name, type, outerMessage, problemId, operation_Id | order by timestamp desc",
  failures: "requests | where cloud_RoleName =~ '{app}' and success == false | project timestamp, operation_Name, resultCode, duration, operation_Id | order by timestamp desc",
  requests: "requests | where cloud_RoleName =~ '{app}' | summarize count = count(), failures = countif(success == false), p95ms = percentile(duration, 95) by operation_Name | order by count desc",
  traces: "traces | where cloud_RoleName =~ '{app}' | project timestamp, severityLevel, operation_Name, message | order by timestamp desc",
  instances: "union requests, traces | where cloud_RoleName =~ '{app}' | summarize instances = dcount(cloud_RoleInstance) by bin(timestamp, 5m) | order by timestamp desc",
};

const AI_COMPONENT_ID = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[-\w.()]+\/providers\/Microsoft\.Insights\/components\/[-\w.()]+$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extracts the instrumentation key without printing it; it is only used to locate the component. */
export function instrumentationKeyOf(settings: Record<string, string>): string | undefined {
  const fromConnection = /InstrumentationKey=([^;]+)/i.exec(settings.APPLICATIONINSIGHTS_CONNECTION_STRING ?? '')?.[1];
  const key = (fromConnection ?? settings.APPINSIGHTS_INSTRUMENTATIONKEY ?? '').trim();
  return GUID.test(key) ? key : undefined;
}

async function findAppInsights(client: AzureClient, app: AppTarget, explicit: string | undefined): Promise<string> {
  if (explicit) {
    if (!AI_COMPONENT_ID.test(explicit)) throw new ToolError(EXIT.usage, '--app-insights must be a Microsoft.Insights/components resource ID.');
    return explicit;
  }
  const key = instrumentationKeyOf((await listSettings(client, app)).properties);
  if (!key) {
    throw new ToolError(EXIT.precheck, 'The app has no Application Insights connection string, so there are no logs to query.', {
      findings: [{ severity: 'error', code: 'NoAppInsights', message: 'APPLICATIONINSIGHTS_CONNECTION_STRING is not set.', fix: 'Connect Application Insights (R1), or pass --app-insights <component-id>.' }],
    });
  }
  const rows = await queryGraph(client, `resources | where type =~ 'microsoft.insights/components' and properties.InstrumentationKey =~ '${key}' | project id, name, resourceGroup, subscriptionId`);
  if (rows.length !== 1) {
    throw new ToolError(EXIT.precheck, 'Could not find the Application Insights resource for this app in the subscriptions you can access.', {
      next: ['Pass --app-insights <component-resource-id>.'],
    });
  }
  return rows[0].id;
}

function cell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const scrubbed = scrubText(value);
  return scrubbed.length > 1500 ? `${scrubbed.slice(0, 1500)}...` : scrubbed;
}

/** Policy evaluations and list actions (for example list keys or settings) are reads, not changes. */
export function isNoise(operation: string | undefined): boolean {
  if (!operation) return false;
  return /^Microsoft\.Authorization\/policies\//i.test(operation) || /\/list[^/]*\/action$/i.test(operation);
}

export const readCommands: CommandSpec[] = [
  {
    name: 'app find',
    usage: 'app find [--name <part>] [--resource-group <rg>] [--subscription <id>]',
    description: 'List Function Apps you can access.',
    handler: async (args, { client }) => {
      const name = stringFlag(args, 'name');
      const resourceGroup = stringFlag(args, 'resource-group');
      const subscription = stringFlag(args, 'subscription');
      if (name !== undefined && !/^[A-Za-z0-9-]{1,60}$/.test(name)) throw new ToolError(EXIT.usage, '--name may contain only letters, digits, and hyphens.');
      validateScope({ resourceGroup, subscription });
      const filters = [`type =~ 'microsoft.web/sites'`, `kind contains 'functionapp'`];
      if (name) filters.push(`name contains '${name}'`);
      if (resourceGroup) filters.push(`resourceGroup =~ '${resourceGroup}'`);
      const rows = await queryGraph(
        client,
        `resources | where ${filters.join(' and ')} | project id, name, resourceGroup, subscriptionId, location, kind, state = tostring(properties.state), sku = tostring(properties.sku) | order by name asc`,
        subscription,
      );
      return {
        summary: `${rows.length} Function App(s) found.`,
        data: rows.map(row => ({ ...row, portal: `https://portal.azure.com/#@/resource${row.id}` })),
        next: rows.length ? ['Run `app inspect --app <name>` for details.'] : ['Check the signed-in account with `az account show`, or pass --subscription.'],
      };
    },
  },
  {
    name: 'app inspect',
    usage: 'app inspect --app <name|id> [--slot <s>]',
    description: 'Summarize plan, runtime, scale, identity, security, and network, with findings.',
    handler: async (args, { client }) => {
      const app = await target(client, args);
      const [site, config, settings] = await Promise.all([
        client.arm<Site>('GET', app.id, WEB_API_VERSION),
        client.arm<SiteConfig>('GET', `${app.id}/config/web`, WEB_API_VERSION),
        listSettings(client, app),
      ]);
      const plan = site.properties.serverFarmId ? await client.arm<Plan>('GET', site.properties.serverFarmId, WEB_API_VERSION) : undefined;
      const { data, findings } = summarizeApp(site, config, plan, settings.properties);
      return {
        summary: `${site.name}: ${String(data.hostingPlan)}, ${site.properties.state ?? 'unknown state'}, ${findings.length} finding(s).`,
        data,
        findings,
        next: ['`functions list`, `settings list`, `deployments list`, `logs query`, and `changes` take the same --app.'],
      };
    },
  },
  {
    name: 'functions list',
    usage: 'functions list --app <name|id> [--slot <s>]',
    description: 'List functions with trigger type, route, and enabled state (no keys).',
    handler: async (args, { client }) => {
      const app = await target(client, args);
      const result = await client.arm<{ value: FunctionEnvelope[] }>('GET', `${app.id}/functions`, WEB_API_VERSION);
      const functions = result.value.map(fn => {
        const trigger = fn.properties.config?.bindings?.find(binding => binding.type?.toLowerCase().endsWith('trigger'));
        return {
          name: fn.name.split('/').pop(),
          trigger: trigger?.type,
          route: trigger?.route,
          methods: trigger?.methods,
          authLevel: trigger?.authLevel,
          schedule: trigger?.schedule,
          source: trigger?.queueName ?? trigger?.topicName ?? trigger?.eventHubName,
          isDisabled: fn.properties.isDisabled ?? false,
          invokeUrlTemplate: fn.properties.invoke_url_template ?? undefined,
        };
      });
      const findings: Finding[] = functions.length
        ? []
        : [{ severity: 'warning', code: 'NoFunctions', message: 'The host reports no functions.', fix: 'Check the latest deployment (`deployments list`) and startup errors (`logs query --preset errors`).' }];
      return { summary: `${functions.length} function(s) in ${app.label}.`, data: functions, findings };
    },
  },
  {
    name: 'settings list',
    usage: 'settings list --app <name|id> [--slot <s>]',
    description: 'List app settings and connection strings with secrets redacted and Key Vault reference status.',
    handler: async (args, { client }) => {
      const app = await target(client, args);
      const [settings, connectionStrings, sticky] = await Promise.all([
        listSettings(client, app),
        client.arm<{ properties: Record<string, { value: string; type: string }> }>('POST', `${app.id}/config/connectionstrings/list`, WEB_API_VERSION, { idempotent: true }),
        readSlotConfigNames(client, app),
      ]);
      const isSticky = (names: string[] | null | undefined, name: string): true | undefined => (names ?? []).some(item => item.toLowerCase() === name.toLowerCase()) || undefined;
      const views = redactSettings(settings.properties).map(view => ({ ...view, sticky: isSticky(sticky?.properties?.appSettingNames, view.name) }));
      const findings: Finding[] = [];
      let keyVaultReferences: { name: string; status?: string; details?: string }[] | undefined;
      if (views.some(view => view.source === 'keyVaultReference')) {
        const refs = await client.arm<{ value: { name: string; properties: { status?: string; details?: string } }[] }>('GET', `${app.id}/config/configreferences/appsettings`, WEB_API_VERSION);
        keyVaultReferences = refs.value.map(ref => ({ name: ref.name.split('/').pop() ?? ref.name, status: ref.properties.status, details: ref.properties.details }));
        for (const ref of keyVaultReferences.filter(item => item.status && item.status !== 'Resolved')) {
          findings.push({ severity: 'error', code: 'KeyVaultReferenceUnresolved', message: `${ref.name}: ${ref.status}. ${ref.details ?? ''}`.trim(), fix: 'Grant the app identity "Key Vault Secrets User" on the vault and check the secret URI.' });
        }
      }
      return {
        summary: `${views.length} app setting(s), ${Object.keys(connectionStrings.properties).length} connection string(s). Secret values are redacted.`,
        data: {
          appSettings: views,
          connectionStrings: Object.entries(connectionStrings.properties).map(([name, value]) => ({ name, type: value.type, value: '<redacted>', sticky: isSticky(sticky?.properties?.connectionStringNames, name) })),
          keyVaultReferences,
        },
        findings,
      };
    },
  },
  {
    name: 'deployments list',
    usage: 'deployments list --app <name|id> [--slot <s>] [--top 10]',
    description: 'List recent code deployments from the SCM (Kudu) endpoint.',
    handler: async (args, { client }) => {
      const app = await target(client, args);
      const site = await client.arm<Site>('GET', app.id, WEB_API_VERSION);
      const host = scmHost(site);
      if (!host) throw new ToolError(EXIT.unsupported, 'This app has no SCM endpoint, so deployment history is not available here.', { next: ['Fall back to `docs get inspection/deployments`.'] });
      const deployments = await client.request<Deployment[]>('GET', `https://${host}/api/deployments`, SCM_RESOURCE);
      const top = intFlag(args, 'top', 10, 50);
      const rows = deployments
        .sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''))
        .slice(0, top)
        .map(d => ({ id: d.id, status: DEPLOYMENT_STATUS[d.status] ?? String(d.status), active: d.active, deployer: d.deployer, message: d.message || undefined, start: d.start_time, end: d.end_time ?? undefined }));
      const findings: Finding[] = rows[0]?.status === 'Failed'
        ? [{ severity: 'error', code: 'LatestDeploymentFailed', message: `The latest deployment ${rows[0].id} failed.`, fix: `Read its log: GET https://${host}/api/deployments/${rows[0].id}/log` }]
        : [];
      return { summary: `${rows.length} deployment(s) for ${app.label}.`, data: rows, findings };
    },
  },
  {
    name: 'logs query',
    usage: `logs query --app <name|id> [--slot <s>] [--preset ${Object.keys(LOG_PRESETS).join('|')}] [--kql <query> | --kql-file <file|->] [--since 1h] [--top 50] [--app-insights <id>]`,
    description: 'Query Application Insights logs for the app (default preset: errors).',
    handler: async (args, { client, readInput }) => {
      const app = await target(client, args);
      const kqlFile = stringFlag(args, 'kql-file');
      if (kqlFile && stringFlag(args, 'kql')) throw new ToolError(EXIT.usage, 'Use either --kql or --kql-file, not both.');
      const kql = kqlFile ? (await readInput(kqlFile)).trim() : stringFlag(args, 'kql');
      const presetName = stringFlag(args, 'preset') ?? (kql ? undefined : 'errors');
      if (kql && presetName) throw new ToolError(EXIT.usage, 'Use either --preset or a custom query, not both.');
      const preset = presetName ? LOG_PRESETS[presetName] : undefined;
      if (presetName && !preset) throw new ToolError(EXIT.usage, `Unknown --preset "${presetName}". Use one of: ${Object.keys(LOG_PRESETS).join(', ')}.`);
      const since = durationFlag(args, 'since', '1h');
      const top = intFlag(args, 'top', 50, 500);
      const componentId = await findAppInsights(client, app, stringFlag(args, 'app-insights'));
      const query = kql ?? (preset ?? '').replaceAll('{app}', app.name);
      const runQuery = (text: string): Promise<{ tables: LogTable[] }> =>
        client.request<{ tables: LogTable[] }>('POST', `${LOGS_ENDPOINT}/v1${componentId}/query`, LOGS_RESOURCE, { body: { query: text, timespan: since.iso }, idempotent: true });
      let result: { tables: LogTable[] };
      try {
        result = await runQuery(query);
      } catch (error) {
        if (error instanceof AzureError && error.httpStatus === 400) {
          throw new AzureError(error.httpStatus, error.azureCode, error.message, [
            ...error.options.findings ?? [],
            { severity: 'error', code: 'KqlRejected', message: 'Application Insights rejected the query.', fix: "Quote column names that are KQL keywords as ['count'] or ['name'], use classic table names (requests, traces, exceptions, dependencies), and check the syntax with a smaller query." },
          ]);
        }
        throw error;
      }
      const table = result.tables[0] ?? { columns: [], rows: [] };
      const rows = table.rows.slice(0, top).map(row => Object.fromEntries(table.columns.map((column, i) => [column.name, cell(row[i])])));
      const findings: Finding[] = [];
      if (table.rows.length === 0) {
        findings.push({ severity: 'info', code: 'NoRows', message: 'No rows. Telemetry usually arrives 1-5 minutes after the event.', fix: 'Widen --since or retry shortly.' });
        if (preset) {
          const roles = await tryRead(() => runQuery('union requests, traces, exceptions | summarize count() by cloud_RoleName | top 5 by count_'));
          const names = (roles?.tables[0]?.rows ?? []).map(row => String(row[0])).filter(name => name && name.toLowerCase() !== app.name.toLowerCase());
          if (names.length) {
            findings.push({ severity: 'warning', code: 'NoRowsForRoleName', message: `Presets filter on cloud_RoleName == '${app.name}', but this Application Insights resource has telemetry for: ${names.join(', ')}.`, fix: 'If one of these is this app (for example a slot or a custom role name), rerun with --kql and that cloud_RoleName.' });
          }
        }
      }
      return {
        summary: `${table.rows.length} row(s) from ${presetName ? `preset ${presetName}` : 'custom KQL'} over ${since.iso}${table.rows.length > top ? `, showing ${top}` : ''}.`,
        data: { appInsights: componentId, query, rows },
        findings,
      };
    },
  },
  {
    name: 'changes',
    usage: 'changes --app <name|id> [--slot <s>] [--since 24h] [--top 30] [--all]',
    description: 'List control-plane changes to the app from the Activity Log (--all includes policy evaluations and list/read actions).',
    handler: async (args, { client, now }) => {
      const app = await target(client, args);
      const since = durationFlag(args, 'since', '24h');
      const top = intFlag(args, 'top', 30, 200);
      const from = new Date(now().getTime() - since.ms).toISOString();
      const filter = encodeURIComponent(`eventTimestamp ge '${from}' and resourceUri eq '${app.id}'`);
      const select = encodeURIComponent('eventTimestamp,operationName,status,caller,correlationId,level');
      const result = await client.arm<{ value: { eventTimestamp: string; operationName?: { value?: string; localizedValue?: string }; status?: { value?: string }; caller?: string; correlationId?: string; level?: string }[] }>(
        'GET',
        `/subscriptions/${app.subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values?$filter=${filter}&$select=${select}`,
        ACTIVITY_LOG_API_VERSION,
      );
      const latest = new Map<string, (typeof result.value)[number]>();
      const includeAll = boolFlag(args, 'all');
      for (const event of result.value) {
        if (!includeAll && isNoise(event.operationName?.value)) continue;
        const key = `${event.correlationId ?? event.eventTimestamp}|${event.operationName?.value ?? ''}`;
        const seen = latest.get(key);
        if (!seen || seen.eventTimestamp < event.eventTimestamp) latest.set(key, event);
      }
      const rows = [...latest.values()]
        .sort((a, b) => b.eventTimestamp.localeCompare(a.eventTimestamp))
        .slice(0, top)
        .map(event => ({ time: event.eventTimestamp, operation: event.operationName?.localizedValue ?? event.operationName?.value, status: event.status?.value, caller: event.caller, level: event.level }));
      const failures = rows.filter(row => row.status === 'Failed');
      return {
        summary: `${rows.length} change(s) to ${app.label} since ${from}${failures.length ? `, ${failures.length} failed` : ''}.`,
        data: rows,
        findings: failures.map(row => ({ severity: 'warning' as const, code: 'ChangeFailed', message: `${row.operation} failed at ${row.time} (caller ${row.caller ?? 'unknown'}).` })),
      };
    },
  },
];
