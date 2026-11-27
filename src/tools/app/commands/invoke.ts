import { listFlag, requireFlag, stringFlag } from '../args.js';
import type { AzureClient, FetchLike } from '../azure.js';
import type { Site } from '../inspect.js';
import { EXIT, ToolError, type Finding } from '../output.js';
import { scrubText } from '../redact.js';
import { WEB_API_VERSION, type AppTarget } from '../target.js';
import { appTarget, requireApproval } from './common.js';
import type { CommandSpec, ToolContext } from './types.js';

const BODY_LIMIT = 4000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface Binding {
  type?: string;
  direction?: string;
  authLevel?: string;
  methods?: string[];
  route?: string;
}

export interface FunctionEnvelope {
  name: string;
  properties: { invoke_url_template?: string | null; isDisabled?: boolean; config?: { bindings?: Binding[] } };
}

export interface InvokeRequest {
  method?: string;
  path?: string;
  query?: string[];
  headers?: string[];
  body?: string;
}

export interface InvokeResult {
  function: string;
  trigger: string;
  method: string;
  url: string;
  authLevel?: string;
  status: number;
  elapsedMs: number;
  body?: unknown;
}

export function readFunction(client: AzureClient, app: AppTarget, fn: string): Promise<FunctionEnvelope> {
  return client.arm<FunctionEnvelope>('GET', `${app.id}/functions/${encodeURIComponent(fn)}`, WEB_API_VERSION);
}

export function triggerOf(fn: FunctionEnvelope): Binding | undefined {
  const bindings = fn.properties.config?.bindings ?? [];
  return bindings.find(binding => binding.type?.toLowerCase().endsWith('trigger')) ?? bindings.find(binding => binding.direction === 'in');
}

function splitPair(raw: string, separator: string, flag: string): [string, string] {
  const index = raw.indexOf(separator);
  if (index <= 0) throw new ToolError(EXIT.usage, `--${flag} must look like name${separator}value, got "${raw}".`);
  return [raw.slice(0, index).trim(), raw.slice(index + 1).trim()];
}

function buildUrl(template: string, request: InvokeRequest): URL {
  const url = new URL(template);
  if (request.path !== undefined) url.pathname = request.path.startsWith('/') ? request.path : `/${request.path}`;
  if (/[{}]|%7B|%7D/i.test(url.pathname)) {
    throw new ToolError(EXIT.usage, `The route has parameters (${decodeURIComponent(url.pathname)}). Pass the concrete path with --path, for example --path /api/items/42.`);
  }
  for (const pair of request.query ?? []) {
    const [name, value] = splitPair(pair, '=', 'query');
    url.searchParams.append(name, value);
  }
  return url;
}

function parseResponseBody(text: string, secrets: string[]): unknown {
  let clean = text;
  for (const secret of secrets) clean = clean.split(secret).join('<redacted>');
  clean = scrubText(clean);
  if (clean.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(clean);
    if (clean.length <= BODY_LIMIT) return parsed;
  } catch {
    // not JSON; return text
  }
  return clean.length > BODY_LIMIT ? `${clean.slice(0, BODY_LIMIT)}… (${clean.length} chars, truncated)` : clean;
}

async function send(fetch: FetchLike, now: () => Date, method: string, url: string, headers: Record<string, string>, body: string | undefined, secrets: string[]): Promise<{ status: number; elapsedMs: number; body: unknown }> {
  const started = now().getTime();
  let response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch (error) {
    throw new ToolError(EXIT.azure, `Request to ${new URL(url).host} failed: ${scrubText(String(error))}`, {
      next: ['Check that the app is running (`host status`) and reachable from this machine (private endpoints or access restrictions block it).'],
    });
  }
  const text = await response.text();
  return { status: response.status, elapsedMs: Math.max(0, now().getTime() - started), body: parseResponseBody(text, secrets) };
}

async function functionKey(client: AzureClient, app: AppTarget, fn: string, authLevel: string): Promise<string | undefined> {
  if (authLevel === 'anonymous') return undefined;
  if (authLevel === 'function') {
    const keys = await client.arm<Record<string, string>>('POST', `${app.id}/functions/${encodeURIComponent(fn)}/listkeys`, WEB_API_VERSION, { idempotent: true });
    const key = keys?.default ?? Object.values(keys ?? {})[0];
    if (key) return key;
  }
  return masterKey(client, app);
}

async function masterKey(client: AzureClient, app: AppTarget): Promise<string> {
  const keys = await client.arm<{ masterKey?: string }>('POST', `${app.id}/host/default/listkeys`, WEB_API_VERSION, { idempotent: true });
  if (!keys.masterKey) throw new ToolError(EXIT.azure, `${app.label}: no master key was returned.`, { next: [`Run \`keys list ${app.ref}\` to inspect the host keys.`] });
  return keys.masterKey;
}

function statusFindings(status: number, keyUsed: boolean, app: AppTarget): Finding[] {
  if (status === 401 || status === 403) {
    return [{
      severity: 'error',
      code: keyUsed ? 'KeyRejected' : 'AccessDenied',
      message: keyUsed
        ? `The runtime rejected the key returned by ARM (${status}). After a swap or deployment the host key store can be out of sync with ARM; a restart does not fix it.`
        : `The function returned ${status} without a key (authentication or access restrictions in front of the app).`,
      fix: keyUsed
        ? `Sync triggers once (R1): \`rest POST ${app.id}/syncfunctiontriggers --approve\`, wait 20 seconds, and call again. If it persists: \`host status ${app.ref}\` and \`settings list ${app.ref}\` (AzureWebJobsSecretStorageType, AzureWebJobsStorage). Never print key values while investigating.`
        : 'Check App Service authentication and access restrictions with `rest get` on config/authsettingsV2 and config/web.',
    }];
  }
  if (status === 404) return [{ severity: 'warning', code: 'RouteNotFound', message: 'The function URL returned 404.', fix: `Check \`functions list ${app.ref}\` for the route and whether the latest deployment is active.` }];
  if (status >= 500) return [{ severity: 'error', code: 'FunctionFailed', message: `The function returned ${status}.`, fix: `Run \`logs query ${app.ref} --preset errors --since 30m\`.` }];
  return [];
}

/** Calls one function once. HTTP functions use their URL; other triggers go through the admin endpoint with the master key. */
export async function invokeFunction(context: ToolContext, app: AppTarget, fn: string, request: InvokeRequest, known?: FunctionEnvelope): Promise<{ result: InvokeResult; findings: Finding[] }> {
  const envelope = known ?? (await readFunction(context.client, app, fn));
  const trigger = triggerOf(envelope);
  const triggerType = trigger?.type ?? 'unknown';
  const findings: Finding[] = [];
  if (envelope.properties.isDisabled) findings.push({ severity: 'warning', code: 'FunctionDisabled', message: `${fn} is disabled; the call is expected to fail.`, fix: `Check AzureWebJobs.${fn}.Disabled in \`settings list\`.` });

  if (triggerType.toLowerCase() === 'httptrigger') {
    const template = envelope.properties.invoke_url_template;
    if (!template) throw new ToolError(EXIT.azure, `${fn} has no invoke URL; the host may not have indexed it yet.`, { next: [`Run \`functions list ${app.ref}\` and \`host status ${app.ref}\`.`] });
    const authLevel = (trigger?.authLevel ?? 'function').toLowerCase();
    const url = buildUrl(template, request).toString();
    const method = (request.method ?? trigger?.methods?.[0] ?? 'GET').toUpperCase();
    const key = await functionKey(context.client, app, fn, authLevel);
    const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' };
    for (const raw of request.headers ?? []) {
      const [name, value] = splitPair(raw, ':', 'header');
      headers[name] = value;
    }
    if (request.body !== undefined && !Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    if (key) headers['x-functions-key'] = key;
    const response = await send(context.fetch, context.now, method, url, headers, request.body, key ? [key] : []);
    findings.push(...statusFindings(response.status, Boolean(key), app));
    return { result: { function: fn, trigger: triggerType, method, url, authLevel, ...response }, findings };
  }

  const site = await context.client.arm<Site>('GET', app.id, WEB_API_VERSION);
  const host = site.properties.defaultHostName;
  if (!host) throw new ToolError(EXIT.azure, `${app.label} has no default host name.`);
  const key = await masterKey(context.client, app);
  const url = `https://${host}/admin/functions/${encodeURIComponent(fn)}`;
  const body = JSON.stringify({ input: request.body ?? '' });
  const response = await send(context.fetch, context.now, 'POST', url, { 'Content-Type': 'application/json', 'x-functions-key': key }, body, [key]);
  if (response.status !== 202) findings.push(...statusFindings(response.status, true, app));
  return { result: { function: fn, trigger: triggerType, method: 'POST', url, status: response.status, elapsedMs: response.elapsedMs, body: response.body }, findings };
}

export const invokeCommands: CommandSpec[] = [
  {
    name: 'functions invoke',
    usage: 'functions invoke --app <name|id> [--slot <s>] --function <name> [--method GET] [--path /api/x/1] [--query k=v]... [--header "Name: value"]... [--body <json> | --body-file <path|->] [--approve]',
    description: 'Call one function once and return the status, time, and response body. Keys are fetched through ARM and never printed.',
    details: [
      'HTTP triggers: uses the function URL; adds the function key (authLevel function) or master key (admin). Anonymous functions get no key. GET/HEAD/OPTIONS run directly; other methods need --approve (R1).',
      'Routes with parameters need --path. --query and --header can repeat.',
      'Other triggers (timer, queue, ...): POST /admin/functions/<name> with the master key; --body becomes the input string. Needs --approve (it runs the function once). Expect 202; check results with `logs query`.',
      '401 with a key usually means the host key store is out of sync after a swap or deployment — see the KeyRejected finding (sync triggers, not restart).',
    ],
    handler: async (args, context) => {
      const app = await appTarget(context.client, args);
      const fn = requireFlag(args, 'function', 'Pass the function name from `functions list`.');
      const bodyFile = stringFlag(args, 'body-file');
      const inline = stringFlag(args, 'body');
      if (bodyFile !== undefined && inline !== undefined) throw new ToolError(EXIT.usage, 'Pass only one of --body and --body-file.');
      const body = bodyFile !== undefined ? await context.readInput(bodyFile) : inline;
      const request: InvokeRequest = { method: stringFlag(args, 'method'), path: stringFlag(args, 'path'), query: listFlag(args, 'query'), headers: listFlag(args, 'header'), body };

      const preview = await readFunction(context.client, app, fn);
      const trigger = triggerOf(preview);
      const isHttp = trigger?.type?.toLowerCase() === 'httptrigger';
      const method = (request.method ?? trigger?.methods?.[0] ?? 'GET').toUpperCase();
      if (isHttp && !SAFE_METHODS.has(method)) {
        requireApproval(args, `functions invoke ${app.ref} --function ${fn} --method ${method}`, {
          risk: 'R1',
          impact: `Send ${method} to ${fn} on ${app.label} once. The function runs for real with this body.`,
          steps: [{ action: 'call function', method, url: preview.properties.invoke_url_template ?? fn }],
          rollback: 'None; undo any side effects of the function yourself.',
        });
      }
      if (!isHttp) {
        requireApproval(args, `functions invoke ${app.ref} --function ${fn}`, {
          risk: 'R1',
          impact: `Run ${fn} (${triggerOf(preview)?.type ?? 'unknown trigger'}) once on ${app.label} through the admin endpoint. Its side effects happen for real.`,
          steps: [{ action: 'run function', method: 'POST', url: `https://<host>/admin/functions/${fn}` }],
          rollback: 'None; undo any side effects of the function yourself.',
        });
      }
      const { result, findings } = await invokeFunction(context, app, fn, request, preview);
      const ok = result.status >= 200 && result.status < 300;
      return {
        summary: `${app.label}/${fn}: ${result.method} → ${result.status} in ${result.elapsedMs} ms${ok ? '' : ' (see findings)'}.`,
        data: result,
        findings,
        next: ok && result.status === 202 ? [`Check the run with \`logs query ${app.ref} --preset traces --since 15m\`.`] : undefined,
      };
    },
  },
];
