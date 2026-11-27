import type { FetchLike, HttpResponse } from '../../src/tools/app/azure.js';
import type { CliDeps } from '../../src/tools/app/cli.js';

export const SUB = '00000000-0000-0000-0000-000000000001';
export const APP_ID = `/subscriptions/${SUB}/resourceGroups/rg-demo/providers/Microsoft.Web/sites/func-demo`;

export interface Call {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface RouteResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Streamed body chunks (for example the Kudu log stream); the stream then ends. */
  chunks?: string[];
}

export type Route = (call: Call) => RouteResult | undefined;

export function response(status: number, body: unknown, headers: Record<string, string> = {}, chunks?: string[]): HttpResponse {
  const encoder = new TextEncoder();
  const queue = [...(chunks ?? [])];
  return {
    status,
    body: chunks
      ? {
          getReader: () => ({
            read: async () => (queue.length ? { done: false as const, value: encoder.encode(queue.shift()) } : { done: true as const, value: undefined }),
            cancel: async () => undefined,
          }),
        }
      : null,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** Answers each call with the first matching route, or 404. */
export function fakeFetch(routes: Route[], calls: Call[] = []): FetchLike {
  return async (url, init) => {
    const call: Call = { method: init.method, url, body: init.body ? parseBody(init.body) : undefined, headers: init.headers };
    calls.push(call);
    for (const route of routes) {
      const hit = route(call);
      if (hit) return response(hit.status, hit.body, hit.headers, hit.chunks);
    }
    return response(404, { error: { code: 'NoRoute', message: `${init.method} ${url}` } });
  };
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function on(method: string, fragment: string, body: unknown, status = 200, headers?: Record<string, string>): Route {
  return call => (call.method === method && call.url.includes(fragment) ? { status, body, headers } : undefined);
}

/** Returns each result in turn for matching calls, then repeats the last one. */
export function sequence(method: string, fragment: string, results: RouteResult[]): Route {
  let index = 0;
  return call => {
    if (call.method !== method || !call.url.includes(fragment)) return undefined;
    return results[Math.min(index++, results.length - 1)];
  };
}

export function deps(fetch: FetchLike, overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    fetch,
    getToken: async () => 'secret-token',
    sleep: async () => undefined,
    referencesDir: '',
    assetsDir: '',
    readInput: async source => {
      throw new Error(`unexpected input ${source}`);
    },
    now: () => new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

export interface TestEnvelope {
  status: string;
  summary: string;
  data: unknown;
  findings: { code: string; severity: string }[];
  next: string[];
}

export function envelope(output: unknown): TestEnvelope {
  return output as TestEnvelope;
}
