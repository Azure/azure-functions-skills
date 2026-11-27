import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { boolFlag, intFlag, listFlag, stringFlag, type ParsedArgs } from '../args.js';
import { ARM_ENDPOINT, ARM_RESOURCE, AzureError, LOGS_RESOURCE, SCM_RESOURCE, type AzureResponse } from '../azure.js';
import { loadApiIndex, type ApiOperation } from '../api.js';
import { EXIT, ToolError, type Finding } from '../output.js';
import { redactResponse, scrubText } from '../redact.js';
import { isOutcomeUnknown, outcomeUnknown, requireApproval, type WritePlan } from './common.js';
import type { CommandSpec, ToolContext } from './types.js';

const METHODS = new Set(['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']);
const MAX_OUTPUT_CHARS = 80_000;

interface Target {
  url: string;
  path: string;
  resource: string;
  kind: 'arm' | 'scm' | 'logs';
}

/** Accepts an ARM path or an https URL on an allowed Azure host, and picks the token audience for it. */
export function resolveTarget(raw: string): Target {
  const absolute = raw.startsWith('/') ? `${ARM_ENDPOINT}${raw}` : raw;
  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    throw new ToolError(EXIT.usage, `"${raw}" is not an ARM path (starting with /subscriptions or /providers) or an https URL.`);
  }
  if (parsed.protocol !== 'https:') throw new ToolError(EXIT.usage, 'Only https URLs are allowed.');
  const host = parsed.host.toLowerCase();
  const kind = host === 'management.azure.com' ? 'arm' : host === 'api.loganalytics.io' ? 'logs' : /\.scm\.([a-z0-9-]+\.)?azurewebsites\.net$/.test(host) ? 'scm' : undefined;
  if (!kind) {
    throw new ToolError(EXIT.usage, `Host ${host} is not allowed. Use management.azure.com (ARM), <app>.scm.azurewebsites.net (Kudu), or api.loganalytics.io.`);
  }
  const resource = kind === 'arm' ? ARM_RESOURCE : kind === 'logs' ? LOGS_RESOURCE : SCM_RESOURCE;
  return { url: absolute, path: parsed.pathname, resource, kind };
}

function templateRegex(template: string): RegExp {
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map(part => {
      if (part === '{resourceUri}' || part === '{scope}') return '.+';
      if (/^\{[^}]+\}$/.test(part)) return '[^/]+';
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${pattern}$`, 'i');
}

/** Finds the pinned api-version for an ARM path from the bundled API index (most specific template wins). */
export function lookupApiVersion(operations: readonly ApiOperation[], method: string, path: string): string | undefined {
  const matches = operations
    .filter(operation => !operation.host && templateRegex(operation.path).test(path))
    .sort((a, b) => Number(b.method === method) - Number(a.method === method) || literalLength(b.path) - literalLength(a.path));
  return matches[0]?.apiVersion;
}

function literalLength(template: string): number {
  return template.replace(/\{[^}]+\}/g, '').length;
}

export function isReadRequest(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  if (method !== 'POST') return false;
  return /\/list[a-z]*$/i.test(path) || /\/query$/i.test(path) || /\/Microsoft\.ResourceGraph\/resources$/i.test(path);
}

const COLLECTION_PUT = /\/config\/(appsettings|connectionstrings|authsettingsv2|web|azurestorageaccounts|metadata)$/i;

function planFindings(method: string, path: string): Finding[] {
  const findings: Finding[] = [];
  if (method === 'PUT' && COLLECTION_PUT.test(path)) {
    findings.push({
      severity: 'warning',
      code: 'ReplacesCollection',
      message: 'PUT replaces the whole collection; anything not in the body is deleted.',
      fix: 'Read the current values first (for app settings: `rest POST <app>/config/appsettings/list`), merge, then send the full set. Prefer `settings set` when available.',
    });
  }
  if (method === 'DELETE') findings.push({ severity: 'warning', code: 'Delete', message: 'DELETE is R2: state what stops working and how to roll back before asking for approval.' });
  return findings;
}

async function readBody(args: ParsedArgs, context: ToolContext): Promise<unknown> {
  const source = stringFlag(args, 'body-file');
  if (source === undefined) return undefined;
  const text = await context.readInput(source);
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolError(EXIT.usage, `--body-file ${source} is not valid JSON.`);
  }
}

function buildUrl(target: Target, args: ParsedArgs, method: string, context: ToolContext): string {
  const params: string[] = [];
  for (const pair of listFlag(args, 'query')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new ToolError(EXIT.usage, `--query must look like name=value, got "${pair}".`);
    params.push(`${encodeURIComponent(pair.slice(0, eq))}=${encodeURIComponent(pair.slice(eq + 1))}`);
  }
  const hasVersion = /[?&]api-version=/i.test(target.url);
  if (target.kind === 'arm' && !hasVersion) {
    const explicit = stringFlag(args, 'api-version');
    const indexPath = join(context.referencesDir, 'api-index.json');
    const version = explicit ?? (existsSync(indexPath) ? lookupApiVersion(loadApiIndex(indexPath).operations, method, target.path) : undefined);
    if (!version) {
      throw new ToolError(EXIT.usage, `No pinned api-version for ${target.path}. Pass --api-version.`, {
        next: ['Find the operation and its version with `api find <words>`.'],
      });
    }
    params.unshift(`api-version=${encodeURIComponent(version)}`);
  }
  if (params.length === 0) return target.url;
  return `${target.url}${target.url.includes('?') ? '&' : '?'}${params.join('&')}`;
}

function fitOutput(body: unknown): { body: unknown; findings: Finding[] } {
  const size = JSON.stringify(body ?? null).length;
  if (size <= MAX_OUTPUT_CHARS) return { body, findings: [] };
  if (body && typeof body === 'object' && Array.isArray((body as { value?: unknown }).value)) {
    const items = (body as { value: unknown[] }).value;
    const kept: unknown[] = [];
    let used = 0;
    for (const item of items) {
      used += JSON.stringify(item).length;
      if (used > MAX_OUTPUT_CHARS) break;
      kept.push(item);
    }
    return {
      body: { ...(body as object), value: kept },
      findings: [{ severity: 'info', code: 'Truncated', message: `Showing ${kept.length} of ${items.length} items.`, fix: 'Narrow the request with --query $filter=... / $top=..., or a more specific path.' }],
    };
  }
  return {
    body: `${JSON.stringify(body).slice(0, MAX_OUTPUT_CHARS)}...`,
    findings: [{ severity: 'info', code: 'Truncated', message: `The response is ${size} characters; output was cut.`, fix: 'Request a narrower path or fewer properties.' }],
  };
}

export const restCommands: CommandSpec[] = [
  {
    name: 'rest',
    usage: 'rest <GET|POST|PUT|PATCH|DELETE> <arm-path|https-url> [--api-version <v>] [--query name=value]... [--body-file <file|->] [--approve] [--wait 120]',
    description: 'Call any Azure REST operation (fallback for tasks without a command). Fills api-version from the index, gates writes on --approve, polls long-running operations, never resends uncertain writes, and redacts secrets.',
    handler: async (args, context) => {
      const [rawMethod, rawUrl, ...extra] = args.positionals;
      const method = rawMethod?.toUpperCase();
      if (!method || !METHODS.has(method) || !rawUrl || extra.length > 0) {
        throw new ToolError(EXIT.usage, 'Usage: rest <METHOD> <arm-path|https-url>. Quote the path, and pass query parameters with --query name=value.');
      }
      const target = resolveTarget(rawUrl);
      const read = isReadRequest(method, target.path);
      const body = await readBody(args, context);
      const url = buildUrl(target, args, method, context);
      const display = scrubText(url.replace(ARM_ENDPOINT, ''));

      if (!read) {
        const plan: WritePlan = { risk: method === 'DELETE' ? 'R2' : 'R1', impact: `${method} ${display}`, steps: [{ action: 'request', method, url: display, body }] };
        requireApproval(args, `rest ${method} ${rawUrl}`, plan, planFindings(method, target.path));
      }

      let response: AzureResponse;
      try {
        response = await context.client.send(method, url, target.resource, { body, idempotent: read });
      } catch (error) {
        if (!read && isOutcomeUnknown(error)) throw outcomeUnknown(error as AzureError, `${method} ${display}`, 'changes --app <app> --since 15m` or `rest GET <resource>');
        throw error;
      }

      const findings: Finding[] = [];
      let finalBody = response.body;
      let operationStatus: string | undefined;
      if (!read && (response.status === 201 || response.status === 202) && (response.headers['azure-asyncoperation'] || response.headers.location)) {
        const waitSeconds = intFlag(args, 'wait', 120, 1800);
        const result = await context.client.poll(response, target.resource, waitSeconds * 1000);
        operationStatus = result.status;
        if (!result.done) {
          findings.push({ severity: 'warning', code: 'OperationPending', message: `Still running after ${waitSeconds}s.`, fix: `Check later with \`rest GET ${scrubText(result.pollUrl ?? '')}\`. Do not resend the write.` });
        } else if (result.status !== 'Succeeded') {
          throw new ToolError(EXIT.azure, `${method} ${display} finished with status ${result.status}.`, { data: redactResponse(target.path, result.body) });
        } else if (result.body !== undefined && response.headers.location && !response.headers['azure-asyncoperation']) {
          finalBody = result.body;
        }
      }
      const fitted = fitOutput(redactResponse(target.path, finalBody));
      return {
        summary: `${method} ${display} -> ${response.status}${operationStatus ? ` (${operationStatus})` : ''}.`,
        data: { status: response.status, operationStatus, body: fitted.body },
        findings: [...findings, ...fitted.findings],
        next: read || boolFlag(args, 'lean') ? [] : ['Verify the change with one GET of the resource; do not repeat the write.'],
      };
    },
  },
];
