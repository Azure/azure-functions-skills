import { resolve } from 'node:path';
import type { Runner, RunResult } from '../shared/exec.js';
import { EXIT, fail, succeed, type Finding, type Gap, type ToolResult } from '../shared/output.js';
import { functionAppName } from './apply.js';
import { inspectProject, readEnvironmentValues } from './project.js';

export interface VerifyOptions {
  readonly dir: string;
  readonly env?: string;
  readonly app?: string;
  readonly subscription?: string;
}

export interface VerifyDependencies {
  readonly run: Runner;
  /** Sends one GET request and returns the HTTP status. */
  readonly fetchStatus: (url: string) => Promise<number>;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export interface VerifiedFunction {
  readonly name: string;
  readonly trigger: string;
  readonly authLevel?: string;
}

export interface VerifyData {
  readonly functionApp?: string;
  readonly resourceGroup?: string;
  readonly state?: string;
  readonly hostName?: string;
  readonly functions?: readonly VerifiedFunction[];
  readonly http?: ReadonlyArray<{ readonly function: string; readonly status: number; readonly reachable: boolean }>;
}

interface FunctionEntry {
  readonly name?: string;
  readonly invokeUrlTemplate?: string;
  readonly config?: { readonly bindings?: ReadonlyArray<{ type?: string; authLevel?: string; methods?: string[] }> };
}

const COMMAND = 'deploy verify';
/** The function list can lag behind a deployment, so it is read a fixed number of times. */
const LIST_ATTEMPTS = 6;
const LIST_INTERVAL_MS = 10_000;
const MAX_HTTP_CHECKS = 3;

export async function verifyDeploy(options: VerifyOptions, dependencies: VerifyDependencies): Promise<ToolResult<VerifyData>> {
  const dir = resolve(options.dir);
  const environment = options.env ?? inspectProject(dir).environments.defaultName;
  const values = (environment ? readEnvironmentValues(dir, environment) : null) ?? {};
  const app = options.app ?? functionAppName(values);
  const subscription = options.subscription ?? values.AZURE_SUBSCRIPTION_ID;
  if (!app || !subscription) {
    return blocked('The function app could not be identified', {
      id: 'VERIFY-APP-UNKNOWN', severity: 'error',
      title: 'The azd environment does not name a function app or subscription',
      fix: 'Pass --app and --subscription, or run deploy apply first.',
    });
  }

  const scope = ['--subscription', subscription, '--output', 'json'];
  const located = await dependencies.run('az',
    ['resource', 'list', '--name', app, '--resource-type', 'Microsoft.Web/sites', ...scope], { cwd: dir });
  if (located.notFound) {
    return blocked('Azure CLI is not installed', {
      id: 'VERIFY-AZ-MISSING', severity: 'error', title: 'The az command was not found',
      fix: 'Install the Azure CLI, or check the app in the Azure portal.',
    });
  }
  const resourceGroup = parse<Array<{ resourceGroup?: string }>>(located)?.[0]?.resourceGroup;
  if (!resourceGroup) {
    return blocked(`Function app ${app} was not found`, {
      id: 'VERIFY-APP-NOT-FOUND', severity: 'error', title: `No function app named ${app} is visible in the subscription`,
      fix: 'Check az login and the subscription, then run deploy verify again.',
    });
  }

  const target = ['--name', app, '--resource-group', resourceGroup, ...scope];
  const site = parse<{ state?: string; defaultHostName?: string }>(
    await dependencies.run('az', ['functionapp', 'show', ...target], { cwd: dir }));
  const entries = await listFunctions(target, dir, dependencies);

  const findings: Finding[] = [];
  const gaps: Gap[] = [];
  const functions = entries.map(describe);
  if (site?.state !== 'Running') {
    findings.push({
      id: 'VERIFY-APP-NOT-RUNNING', severity: 'error',
      title: `The function app state is ${site?.state ?? 'unknown'}`,
    });
  }
  if (functions.length === 0) {
    findings.push({
      id: 'VERIFY-NO-FUNCTIONS', severity: 'error', title: 'The function app lists no functions',
      detail: 'The package may have failed to build or load. Use azure-functions-diagnostics.',
    });
  }

  const http: Array<{ function: string; status: number; reachable: boolean }> = [];
  for (const entry of entries) {
    const info = describe(entry);
    if (info.trigger !== 'httpTrigger') continue;
    const reason = skipReason(entry, info, http.length);
    if (reason) {
      gaps.push({ check: `http:${info.name}`, reason });
      continue;
    }
    const status = await dependencies.fetchStatus(entry.invokeUrlTemplate as string).catch(() => 0);
    const reachable = status >= 200 && status < 500 && status !== 404;
    http.push({ function: info.name, status, reachable });
    if (!reachable) {
      findings.push({
        id: 'VERIFY-HTTP-FAILED', severity: 'error',
        title: `GET ${info.name} returned ${status === 0 ? 'no response' : `HTTP ${status}`}`,
      });
    }
  }

  const data: VerifyData = {
    functionApp: app, resourceGroup, state: site?.state ?? 'unknown', hostName: site?.defaultHostName, functions, http,
  };
  const failed = findings.some(finding => finding.severity === 'error');
  const summary = failed
    ? `Verification found ${findings.length} problem(s) in ${app}`
    : `${app} is running with ${functions.length} function(s)`;
  return failed
    ? { exitCode: EXIT.ok, body: { ...succeed(COMMAND, summary, data, { findings, gaps }).body, ok: false } }
    : succeed(COMMAND, summary, data, { findings, gaps });
}

async function listFunctions(target: string[], dir: string, dependencies: VerifyDependencies): Promise<FunctionEntry[]> {
  for (let attempt = 1; attempt <= LIST_ATTEMPTS; attempt++) {
    const listed = parse<FunctionEntry[]>(
      await dependencies.run('az', ['functionapp', 'function', 'list', ...target], { cwd: dir }));
    if (Array.isArray(listed) && listed.length > 0) return listed;
    if (attempt < LIST_ATTEMPTS) await dependencies.sleep(LIST_INTERVAL_MS);
  }
  return [];
}

function describe(entry: FunctionEntry): VerifiedFunction {
  const trigger = entry.config?.bindings?.find(binding => binding.type?.endsWith('Trigger'));
  return {
    name: (entry.name ?? '').split('/').pop() ?? '',
    trigger: trigger?.type ?? 'unknown',
    ...(trigger?.authLevel ? { authLevel: trigger.authLevel } : {}),
  };
}

function skipReason(entry: FunctionEntry, info: VerifiedFunction, checked: number): string | null {
  const methods = entry.config?.bindings?.find(binding => binding.type === 'httpTrigger')?.methods;
  if (info.authLevel?.toLowerCase() !== 'anonymous') return 'Needs a function key. The script does not read keys.';
  if (methods && methods.length > 0 && !methods.some(method => method.toLowerCase() === 'get')) return 'Does not accept GET.';
  if (!entry.invokeUrlTemplate || entry.invokeUrlTemplate.includes('{')) return 'The route needs parameters.';
  if (checked >= MAX_HTTP_CHECKS) return `Only the first ${MAX_HTTP_CHECKS} HTTP triggers are requested.`;
  return null;
}

function parse<T>(outcome: RunResult): T | null {
  if (outcome.code !== 0) return null;
  try {
    return JSON.parse(outcome.stdout) as T;
  } catch {
    return null;
  }
}

function blocked(summary: string, finding: Finding): ToolResult<VerifyData> {
  return fail<VerifyData>(COMMAND, EXIT.blocked, summary, { findings: [finding] });
}
