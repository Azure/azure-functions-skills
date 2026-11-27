import { boolFlag, listFlag, stringFlag, type ParsedArgs } from '../args.js';
import type { AzureClient, AzureError } from '../azure.js';
import { detectPlan, type HostingPlan, type Plan, type Site } from '../inspect.js';
import { EXIT, ToolError, type Finding } from '../output.js';
import { isKeyVaultReference, redactValue } from '../redact.js';
import { WEB_API_VERSION, type AppTarget } from '../target.js';
import { appTarget, isOutcomeUnknown, outcomeUnknown, requireApproval, tryRead, waitFor, type PlanStep } from './common.js';
import type { CommandSpec, ToolContext } from './types.js';

/** From "Flex Consumption plan deprecations" in the Functions app settings reference. */
export const FLEX_UNSUPPORTED_SETTINGS = new Set([
  'ENABLE_ORYX_BUILD',
  'FUNCTIONS_EXTENSION_VERSION',
  'FUNCTIONS_WORKER_RUNTIME',
  'FUNCTIONS_WORKER_RUNTIME_VERSION',
  'FUNCTIONS_MAX_HTTP_CONCURRENCY',
  'FUNCTIONS_WORKER_PROCESS_COUNT',
  'FUNCTIONS_WORKER_DYNAMIC_CONCURRENCY_ENABLED',
  'SCM_DO_BUILD_DURING_DEPLOYMENT',
  'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING',
  'WEBSITE_CONTENTOVERVNET',
  'WEBSITE_CONTENTSHARE',
  'WEBSITE_DNS_SERVER',
  'WEBSITE_MAX_DYNAMIC_APPLICATION_SCALE_OUT',
  'WEBSITE_NODE_DEFAULT_VERSION',
  'WEBSITE_RUN_FROM_PACKAGE',
  'WEBSITE_SKIP_CONTENTSHARE_VALIDATION',
  'WEBSITE_VNET_ROUTE_ALL',
]);

const CONNECTION_STRING_TYPES = ['Custom', 'SQLAzure', 'SQLServer', 'MySql', 'PostgreSQL', 'RedisCache', 'DocDb', 'ServiceBus', 'EventHub', 'NotificationHub', 'ApiHub'];
const SETTING_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,255}$/;
const KV_WAIT_MS = 60_000;
const KV_POLL_MS = 10_000;

type Kind = 'appsettings' | 'connectionstrings';

interface ConnectionString {
  value: string;
  type: string;
}

type Collection = Record<string, string | ConnectionString>;

interface Change {
  name: string;
  action: 'add' | 'update' | 'remove' | 'unchanged';
  /** Redacted new value; omitted for removals. */
  value?: string;
  /** Redacted previous value, only for updates. */
  previous?: string;
}

function valueOf(entry: string | ConnectionString | undefined): string | undefined {
  return typeof entry === 'string' ? entry : entry?.value;
}

function sameEntry(a: string | ConnectionString | undefined, b: string | ConnectionString | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.value === b.value && a.type.toLowerCase() === b.type.toLowerCase();
}

function shown(kind: Kind, name: string, entry: string | ConnectionString): string {
  const value = valueOf(entry) ?? '';
  if (kind === 'connectionstrings' && !isKeyVaultReference(value)) return '<redacted>';
  return redactValue(name, value).value;
}

function listCollection(client: AzureClient, app: AppTarget, kind: Kind): Promise<{ properties: Collection }> {
  return client.arm('POST', `${app.id}/config/${kind}/list`, WEB_API_VERSION, { idempotent: true });
}

async function hostingPlanOf(client: AzureClient, app: AppTarget): Promise<HostingPlan> {
  const site = await client.arm<Site>('GET', app.id, WEB_API_VERSION);
  const plan = !site.properties.functionAppConfig && site.properties.serverFarmId ? await tryRead(() => client.arm<Plan>('GET', site.properties.serverFarmId as string, WEB_API_VERSION)) : undefined;
  return detectPlan(site, plan);
}

function stripFinalNewline(text: string): string {
  return text.replace(/\r?\n$/, '');
}

async function requestedValues(args: ParsedArgs, context: ToolContext): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  const name = stringFlag(args, 'name');
  const inline = stringFlag(args, 'value');
  const file = stringFlag(args, 'value-file');
  if (inline !== undefined && file !== undefined) throw new ToolError(EXIT.usage, 'Use either --value or --value-file, not both.');
  if (name !== undefined) {
    if (inline === undefined && file === undefined) throw new ToolError(EXIT.usage, `Pass --value <v> or --value-file <file|-> for ${name}.`);
    values.set(name, file !== undefined ? stripFinalNewline(await context.readInput(file)) : (inline as string));
  } else if (inline !== undefined || file !== undefined) {
    throw new ToolError(EXIT.usage, '--value and --value-file need --name.');
  }
  for (const pair of listFlag(args, 'set')) {
    const eq = pair.indexOf('=');
    if (eq < 1) throw new ToolError(EXIT.usage, `--set expects NAME=VALUE, got "${pair}".`);
    values.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  if (values.size === 0) throw new ToolError(EXIT.usage, 'Nothing to set. Pass --name <n> --value <v>, --name <n> --value-file <file|->, or --set NAME=VALUE (repeatable).');
  return values;
}

function validateNames(names: Iterable<string>): void {
  for (const name of names) {
    if (!SETTING_NAME.test(name)) throw new ToolError(EXIT.usage, `Invalid setting name "${name}". Use letters, digits, and _ . : -.`);
  }
}

function connectionStringType(args: ParsedArgs): string {
  const raw = stringFlag(args, 'type') ?? 'Custom';
  const type = CONNECTION_STRING_TYPES.find(item => item.toLowerCase() === raw.toLowerCase());
  if (!type) throw new ToolError(EXIT.usage, `Unknown --type "${raw}". Use one of: ${CONNECTION_STRING_TYPES.join(', ')}.`);
  return type;
}

function kindOf(args: ParsedArgs): Kind {
  return boolFlag(args, 'connection-string') ? 'connectionstrings' : 'appsettings';
}

function collectionLabel(kind: Kind): string {
  return kind === 'appsettings' ? 'app settings' : 'connection strings';
}

interface Applied {
  changes: Change[];
  verified: boolean;
  findings: Finding[];
  keyVaultReferences?: KeyVaultStatus[];
}

interface KeyVaultStatus {
  name: string;
  status: string;
}

/** Reads the collection, applies the edits, asks for approval, writes the full collection once, and reads it back. */
async function applyEdits(
  args: ParsedArgs,
  context: ToolContext,
  app: AppTarget,
  kind: Kind,
  edit: (current: Collection) => Map<string, string | ConnectionString | undefined>,
  command: string,
  extraSteps: PlanStep[] = [],
): Promise<Applied> {
  const { client } = context;
  const current = (await listCollection(client, app, kind)).properties ?? {};
  const edits = edit(current);
  const merged: Collection = { ...current };
  const changes: Change[] = [];
  for (const [name, next] of edits) {
    const existingName = Object.keys(current).find(key => key.toLowerCase() === name.toLowerCase());
    const before = existingName === undefined ? undefined : current[existingName];
    if (next === undefined) {
      if (existingName === undefined) {
        changes.push({ name, action: 'unchanged' });
        continue;
      }
      delete merged[existingName];
      changes.push({ name: existingName, action: 'remove' });
      continue;
    }
    if (existingName !== undefined) delete merged[existingName];
    merged[existingName ?? name] = next;
    if (before === undefined) changes.push({ name, action: 'add', value: shown(kind, name, next) });
    else if (sameEntry(before, next)) changes.push({ name: existingName as string, action: 'unchanged', value: shown(kind, name, next) });
    else changes.push({ name: existingName as string, action: 'update', value: shown(kind, name, next), previous: shown(kind, name, before) });
  }

  const effective = changes.filter(change => change.action !== 'unchanged');
  if (effective.length === 0) return { changes, verified: true, findings: [] };

  const destructive = effective.some(change => change.action !== 'add');
  const step: PlanStep = { action: `replace ${collectionLabel(kind)} (full merged collection, ${Object.keys(merged).length} entries)`, method: 'PUT', url: `${app.id}/config/${kind}?api-version=${WEB_API_VERSION}` };
  requireApproval(args, command, {
    risk: destructive ? 'R2' : 'R1',
    impact: `${effective.map(change => `${change.action} ${change.name}`).join(', ')} on ${app.label}. Every other entry is kept. The app restarts.`,
    steps: [step, ...extraSteps],
    rollback: destructive ? 'Set the previous values again; the tool cannot restore secret values it never printed, so keep them before you approve.' : `settings delete ${app.ref} ${effective.map(change => `--name ${change.name}`).join(' ')}${kind === 'connectionstrings' ? ' --connection-string' : ''}`,
    changes,
  });

  try {
    await client.arm('PUT', `${app.id}/config/${kind}`, WEB_API_VERSION, { body: { properties: merged } });
  } catch (error) {
    if (isOutcomeUnknown(error)) throw outcomeUnknown(error as AzureError, `Update of ${collectionLabel(kind)}`, `settings list ${app.ref}`);
    throw error;
  }

  const after = (await listCollection(client, app, kind)).properties ?? {};
  const findings: Finding[] = [];
  const verified = effective.every(change => (change.action === 'remove' ? !(change.name in after) : sameEntry(after[change.name], merged[change.name])));
  if (!verified) findings.push({ severity: 'warning', code: 'SettingsNotVerified', message: 'The read-back does not match the requested change yet.', fix: `Run \`settings list ${app.ref}\` in a minute. Do not resend.` });
  if (kind !== 'appsettings') return { changes, verified, findings };
  const keyVault = await checkKeyVaultReferences(context, app, effective, merged);
  findings.push(...keyVault.findings);
  return { changes, verified, findings, keyVaultReferences: keyVault.statuses.length ? keyVault.statuses : undefined };
}

async function checkKeyVaultReferences(context: ToolContext, app: AppTarget, changes: Change[], merged: Collection): Promise<{ findings: Finding[]; statuses: KeyVaultStatus[] }> {
  const names = changes.filter(change => change.action !== 'remove' && isKeyVaultReference(valueOf(merged[change.name]) ?? '')).map(change => change.name);
  const findings: Finding[] = [];
  const statuses: KeyVaultStatus[] = [];
  for (const name of names) {
    const read = (): Promise<{ properties?: { status?: string; details?: string } } | undefined> =>
      tryRead(() => context.client.arm('GET', `${app.id}/config/configreferences/appsettings/${encodeURIComponent(name)}`, WEB_API_VERSION));
    let status = await read();
    if (status?.properties?.status !== 'Resolved' && !isFinalFailure(status?.properties?.status)) {
      status = (await waitFor(read, value => value.properties?.status === 'Resolved' || isFinalFailure(value.properties?.status), { sleep: context.sleep, waitMs: KV_WAIT_MS, intervalMs: KV_POLL_MS })).value ?? status;
    }
    const state = status?.properties?.status;
    statuses.push({ name, status: state ?? 'Unknown' });
    if (state !== 'Resolved') {
      findings.push({ severity: 'error', code: 'KeyVaultReferenceUnresolved', message: `${name}: ${state ?? 'status unavailable'}. ${status?.properties?.details ?? ''}`.trim(), fix: 'Grant the app identity "Key Vault Secrets User" on the vault (separate approval), check the secret URI and vault network access, then run `settings list`.' });
    }
  }
  return { findings, statuses };
}

interface SlotConfigNames {
  properties?: { appSettingNames?: string[] | null; connectionStringNames?: string[] | null };
}

/** Sticky (slot) setting names live on the production site and apply to every slot. */
export function readSlotConfigNames(client: AzureClient, app: AppTarget): Promise<SlotConfigNames | undefined> {
  return tryRead(() => client.arm<SlotConfigNames>('GET', `${app.siteId}/config/slotConfigNames`, WEB_API_VERSION));
}

function stickyField(kind: Kind): 'appSettingNames' | 'connectionStringNames' {
  return kind === 'appsettings' ? 'appSettingNames' : 'connectionStringNames';
}

/** Returns the slotConfigNames write that adds `names`, or undefined when they are already sticky. */
async function planSticky(client: AzureClient, app: AppTarget, kind: Kind, names: string[]): Promise<{ step: PlanStep; added: string[] } | undefined> {
  const current = (await readSlotConfigNames(client, app))?.properties ?? {};
  const lists = { appSettingNames: [...(current.appSettingNames ?? [])], connectionStringNames: [...(current.connectionStringNames ?? [])] };
  const field = stickyField(kind);
  const added = names.filter(name => !lists[field].some(existing => existing.toLowerCase() === name.toLowerCase()));
  if (added.length === 0) return undefined;
  lists[field].push(...added);
  return { step: { action: `mark ${added.join(', ')} as slot settings (sticky)`, method: 'PUT', url: `${app.siteId}/config/slotConfigNames?api-version=${WEB_API_VERSION}`, body: { properties: lists } }, added };
}

async function applySticky(context: ToolContext, app: AppTarget, kind: Kind, plan: { step: PlanStep; added: string[] }): Promise<{ verified: boolean; findings: Finding[] }> {
  try {
    await context.client.arm('PUT', `${app.siteId}/config/slotConfigNames`, WEB_API_VERSION, { body: plan.step.body });
  } catch (error) {
    if (isOutcomeUnknown(error)) throw outcomeUnknown(error as AzureError, 'Update of slot setting names', `slots list --app ${app.name}`);
    throw error;
  }
  const after = (await readSlotConfigNames(context.client, app))?.properties?.[stickyField(kind)] ?? [];
  const verified = plan.added.every(name => after.some(existing => existing.toLowerCase() === name.toLowerCase()));
  return { verified, findings: verified ? [] : [{ severity: 'warning', code: 'StickyNotVerified', message: 'slotConfigNames does not show the new sticky names yet.', fix: `Run \`slots list --app ${app.name}\` in a minute. Do not resend.` }] };
}

function isFinalFailure(status: string | undefined): boolean {
  return Boolean(status && status !== 'Resolved' && status !== 'Initialized');
}

function flexFindings(plan: HostingPlan, kind: Kind, names: Iterable<string>): Finding[] {
  if (plan !== 'FlexConsumption' || kind !== 'appsettings') return [];
  return [...names]
    .filter(name => FLEX_UNSUPPORTED_SETTINGS.has(name.toUpperCase()))
    .map(name => ({ severity: 'error' as const, code: 'FlexUnsupportedSetting', message: `${name} is not used on Flex Consumption.`, fix: 'Use properties.functionAppConfig instead (`docs search flex consumption deprecations`).' }));
}

function keyVaultSummary(statuses: KeyVaultStatus[] | undefined): string {
  if (!statuses?.length) return '';
  const unresolved = statuses.filter(item => item.status !== 'Resolved');
  return unresolved.length === 0
    ? ` Key Vault reference resolved: ${statuses.map(item => item.name).join(', ')}.`
    : ` Key Vault reference not resolved: ${unresolved.map(item => `${item.name} (${item.status})`).join(', ')}.`;
}

function result(app: AppTarget, kind: Kind, applied: Applied): { summary: string; data: unknown; findings: Finding[]; next: string[] } {
  const effective = applied.changes.filter(change => change.action !== 'unchanged');
  const summary = effective.length === 0
    ? `${app.label}: nothing to change; the ${collectionLabel(kind)} already match.`
    : `${app.label}: ${effective.map(change => `${change.action} ${change.name}`).join(', ')}${applied.verified ? ' (verified)' : ' (not verified yet)'}.${keyVaultSummary(applied.keyVaultReferences)}`;
  return {
    summary,
    data: { verified: applied.verified, changes: applied.changes, ...(applied.keyVaultReferences ? { keyVaultReferences: applied.keyVaultReferences } : {}) },
    findings: applied.findings,
    next: effective.length ? ['The app restarts after a settings change. If the host matters, run `host status` once.'] : [],
  };
}

export const settingsCommands: CommandSpec[] = [
  {
    name: 'settings set',
    usage: 'settings set --app <name|id> [--slot <s>] (--name <n> (--value <v> | --value-file <file|->) | --set NAME=VALUE ...) [--connection-string [--type Custom]] [--sticky] [--approve]',
    description: 'Add or update app settings (or connection strings): merges into the full collection, keeps every other value, verifies, and checks Key Vault references. Values are never printed.',
    details: [
      'Use --value-file - (stdin) for secrets so the value is not in the command line; one trailing newline is removed. Prefer a Key Vault reference: --value "@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/<name>)".',
      '--sticky also marks the names as slot settings (config/slotConfigNames on the site), so they stay with their slot during a swap.',
      'Adding a setting is R1; replacing an existing value is R2. Every change restarts the app.',
      'On Flex Consumption, settings that the plan does not use (for example WEBSITE_RUN_FROM_PACKAGE, FUNCTIONS_WORKER_RUNTIME) are rejected with exit 6.',
      'To disable one function: --set AzureWebJobs.<FunctionName>.Disabled=true.',
    ],
    handler: async (args, context) => {
      const app = await appTarget(context.client, args);
      const kind = kindOf(args);
      if (kind === 'appsettings' && stringFlag(args, 'type') !== undefined) throw new ToolError(EXIT.usage, '--type applies only with --connection-string.');
      const type = kind === 'connectionstrings' ? connectionStringType(args) : undefined;
      const values = await requestedValues(args, context);
      validateNames(values.keys());
      const blocked = flexFindings(await hostingPlanOf(context.client, app), kind, values.keys());
      if (blocked.length) throw new ToolError(EXIT.precheck, `Pre-check failed: ${blocked.map(finding => finding.message).join(' ')}`, { findings: blocked });
      const command = `settings set ${app.ref}`;
      const sticky = boolFlag(args, 'sticky') ? await planSticky(context.client, app, kind, [...values.keys()]) : undefined;
      const applied = await applyEdits(args, context, app, kind, () => new Map([...values].map(([name, value]) => [name, type ? { value, type } : value])), command, sticky ? [sticky.step] : []);
      if (!sticky) return result(app, kind, applied);
      if (!applied.changes.some(change => change.action !== 'unchanged')) {
        requireApproval(args, command, { risk: 'R1', impact: `Mark ${sticky.added.join(', ')} on ${app.name} as slot settings: they stay with their slot during a swap.`, steps: [sticky.step], rollback: 'Remove the names from config/slotConfigNames with `rest put`.' });
      }
      const stuck = await applySticky(context, app, kind, sticky);
      const output = result(app, kind, { ...applied, verified: applied.verified && stuck.verified, findings: [...applied.findings, ...stuck.findings] });
      return { ...output, summary: `${output.summary} Sticky: ${sticky.added.join(', ')}.`, data: { ...(output.data as object), sticky: sticky.added } };
    },
  },
  {
    name: 'settings delete',
    usage: 'settings delete --app <name|id> [--slot <s>] --name <n> [--name <n2> ...] [--connection-string] [--approve]',
    description: 'Remove app settings (or connection strings) by name; keeps every other value and verifies (R2).',
    handler: async (args, context) => {
      const app = await appTarget(context.client, args);
      const kind = kindOf(args);
      const names = listFlag(args, 'name');
      if (names.length === 0) throw new ToolError(EXIT.usage, 'Pass --name <setting> (repeatable).');
      validateNames(names);
      const applied = await applyEdits(args, context, app, kind, () => new Map(names.map(name => [name, undefined])), `settings delete ${app.ref}`);
      return result(app, kind, applied);
    },
  },
];
