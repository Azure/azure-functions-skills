import { EXIT, ToolError, type Finding } from './output.js';
import { scrubText } from './redact.js';

export const ARM_ENDPOINT = 'https://management.azure.com';
export const ARM_RESOURCE = 'https://management.azure.com';
export const LOGS_ENDPOINT = 'https://api.loganalytics.io';
export const LOGS_RESOURCE = 'https://api.loganalytics.io';
export const SCM_RESOURCE = 'https://appservice.azure.com';

export interface StreamReader {
  read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>;
  cancel(): Promise<void>;
}

export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  /** Present on real fetch responses; used only for bounded streaming reads. */
  body?: { getReader(): StreamReader } | null;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<HttpResponse>;
export type TokenProvider = (resource: string) => Promise<string>;

export interface AzureClientDeps {
  fetch: FetchLike;
  getToken: TokenProvider;
  sleep: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  body?: unknown;
  /** Reads are retried on throttling and transient server errors; writes never are. */
  idempotent?: boolean;
  /** Sent as-is instead of JSON (for example a Kudu VFS file). */
  rawBody?: string;
  headers?: Record<string, string>;
}

const MAX_RETRIES = 3;

export class AzureError extends ToolError {
  constructor(
    readonly httpStatus: number,
    readonly azureCode: string,
    message: string,
    findings: Finding[] = [],
  ) {
    super(EXIT.azure, message, { findings, data: { httpStatus, code: azureCode } });
  }
}

export class AzureClient {
  constructor(private readonly deps: AzureClientDeps) {}

  arm<T>(method: string, path: string, apiVersion: string, options: RequestOptions = {}): Promise<T> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${ARM_ENDPOINT}${path}${separator}api-version=${encodeURIComponent(apiVersion)}`;
    return this.request<T>(method, url, ARM_RESOURCE, options);
  }

  async request<T>(method: string, url: string, resource: string, options: RequestOptions = {}): Promise<T> {
    return (await this.send(method, url, resource, options)).body as T;
  }

  /** Sends one request and returns status, the headers needed for polling, and the parsed body. Throws AzureError on failure. */
  async send(method: string, url: string, resource: string, options: RequestOptions = {}): Promise<AzureResponse> {
    const idempotent = options.idempotent ?? method.toUpperCase() === 'GET';
    const token = await this.deps.getToken(resource);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json', ...options.headers };
    const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    if (body !== undefined && options.rawBody === undefined) headers['Content-Type'] = 'application/json';

    for (let attempt = 0; ; attempt++) {
      let response: HttpResponse;
      try {
        response = await this.deps.fetch(url, { method: method.toUpperCase(), headers, body });
      } catch (error) {
        if (idempotent && attempt < MAX_RETRIES) {
          await this.deps.sleep(backoff(attempt));
          continue;
        }
        throw new AzureError(0, 'NetworkError', `Request to ${describeUrl(url)} failed: ${scrubText(String(error))}`);
      }
      const text = await response.text();
      if (response.status >= 200 && response.status < 300) {
        return { status: response.status, headers: pickHeaders(response), body: parseBody(text) };
      }
      if (idempotent && attempt < MAX_RETRIES && (response.status === 429 || response.status >= 500)) {
        await this.deps.sleep(retryAfter(response) ?? backoff(attempt));
        continue;
      }
      throw toAzureError(response.status, text, url);
    }
  }

  /**
   * Opens a streaming GET and collects text until `durationMs` passes, `maxChars` is reached, or the server
   * closes the stream. `onOpen` runs once the stream is connected (for example to trigger the event to watch).
   */
  async stream(url: string, resource: string, durationMs: number, maxChars: number, onOpen?: () => void): Promise<StreamResult> {
    const token = await this.deps.getToken(resource);
    const controller = new AbortController();
    let response: HttpResponse;
    try {
      response = await this.deps.fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'text/plain' }, signal: controller.signal });
    } catch (error) {
      throw new AzureError(0, 'NetworkError', `Request to ${describeUrl(url)} failed: ${scrubText(String(error))}`);
    }
    if (response.status < 200 || response.status >= 300) throw toAzureError(response.status, await response.text(), url);
    onOpen?.();
    const reader = response.body?.getReader();
    if (!reader) return { text: await response.text(), ended: 'closed' };
    const decoder = new TextDecoder();
    const timeout = this.deps.sleep(durationMs).then(() => 'timeout' as const);
    let text = '';
    let ended: StreamResult['ended'] = 'closed';
    try {
      for (;;) {
        const next = await Promise.race([reader.read(), timeout]);
        if (next === 'timeout') {
          ended = 'timeout';
          break;
        }
        if (next.done) break;
        text += decoder.decode(next.value, { stream: true });
        if (text.length >= maxChars) {
          ended = 'limit';
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      controller.abort();
    }
    return { text, ended };
  }

  /**
   * Follows an accepted long-running operation through `Azure-AsyncOperation` or `Location` until it
   * finishes or `timeoutMs` of waiting has passed. Polls are reads, so they are retried; the write never is.
   */
  async poll(accepted: AzureResponse, resource: string, timeoutMs: number): Promise<PollResult> {
    const asyncUrl = accepted.headers['azure-asyncoperation'];
    const pollUrl = asyncUrl ?? accepted.headers.location;
    if (!pollUrl) return { done: true, status: 'Succeeded', body: accepted.body };
    let waitMs = retryAfterMs(accepted.headers['retry-after']) ?? DEFAULT_POLL_MS;
    let waited = 0;
    for (;;) {
      if (waited + waitMs > timeoutMs) return { done: false, status: 'InProgress', pollUrl };
      await this.deps.sleep(waitMs);
      waited += waitMs;
      const response = await this.send('GET', pollUrl, resource, { idempotent: true });
      waitMs = retryAfterMs(response.headers['retry-after']) ?? DEFAULT_POLL_MS;
      if (asyncUrl) {
        const operation = response.body as { status?: string; error?: unknown } | undefined;
        const status = operation?.status ?? 'Unknown';
        if (TERMINAL.has(status)) return { done: true, status, body: operation, pollUrl };
      } else if (response.status !== 202) {
        return { done: true, status: 'Succeeded', body: response.body, pollUrl };
      }
    }
  }
}

export interface AzureResponse {
  status: number;
  /** Lower-case names; only the headers used for long-running operations. */
  headers: Record<string, string>;
  body: unknown;
}

export interface StreamResult {
  text: string;
  ended: 'timeout' | 'limit' | 'closed';
}

export interface PollResult {
  done: boolean;
  status: string;
  body?: unknown;
  pollUrl?: string;
}

const DEFAULT_POLL_MS = 5000;
const TERMINAL = new Set(['Succeeded', 'Failed', 'Canceled', 'Cancelled']);
const POLL_HEADERS = ['azure-asyncoperation', 'location', 'retry-after'];

function pickHeaders(response: HttpResponse): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of POLL_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function retryAfterMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 1), 30) * 1000 : undefined;
}

function backoff(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function retryAfter(response: HttpResponse): number | undefined {
  return retryAfterMs(response.headers.get('retry-after') ?? undefined);
}

function describeUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname}`;
}

function toAzureError(status: number, text: string, url: string): AzureError {
  let code = `Http${status}`;
  let message = text.slice(0, 500);
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string }; Code?: string; Message?: string };
    code = parsed.error?.code ?? parsed.Code ?? code;
    message = parsed.error?.message ?? parsed.Message ?? message;
  } catch {
    // Non-JSON error bodies are reported as text.
  }
  const findings: Finding[] = [];
  if (status === 401) {
    findings.push({ severity: 'error', code: 'Unauthenticated', message: 'The Azure token was rejected.', fix: 'Run `az login` (or `azd auth login`) and retry.' });
  } else if (status === 403) {
    findings.push({ severity: 'error', code: 'Forbidden', message: 'The signed-in identity lacks permission for this operation.', fix: 'Ask for an Azure role that grants this action (Reader for reads, Contributor or Website Contributor for app writes).' });
  } else if (status === 404) {
    findings.push({ severity: 'error', code: 'NotFound', message: 'The resource or endpoint was not found.', fix: 'Check the app name, resource group, and subscription with `app find`.' });
  }
  return new AzureError(status, code, `Azure returned ${status} ${code} for ${describeUrl(url)}: ${scrubText(message)}`, findings);
}
