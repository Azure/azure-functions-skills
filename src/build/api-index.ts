export interface SwaggerOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: { in?: string; required?: boolean; $ref?: string }[];
  'x-ms-long-running-operation'?: boolean;
}

export interface SwaggerSpec {
  info?: { version?: string };
  paths?: Record<string, Record<string, SwaggerOperation | unknown>>;
}

export interface IndexedOperation {
  id: string;
  method: string;
  path: string;
  apiVersion: string;
  summary: string;
  lro?: boolean;
  body?: boolean;
  host?: string;
}

const METHODS = ['get', 'put', 'patch', 'post', 'delete'];
const MAX_SUMMARY = 140;

export function shortSummary(operation: SwaggerOperation): string {
  const text = (operation.summary || operation.description || '').replace(/\s+/g, ' ').trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return sentence.length > MAX_SUMMARY ? `${sentence.slice(0, MAX_SUMMARY - 3)}...` : sentence;
}

/** Extracts compact operation entries from an ARM OpenAPI 2.0 spec, skipping deployment-slot variants. */
export function extractOperations(spec: SwaggerSpec, apiVersion: string): IndexedOperation[] {
  const operations: IndexedOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (/\/slots\//i.test(path)) continue;
    for (const method of METHODS) {
      const operation = item[method] as SwaggerOperation | undefined;
      if (!operation?.operationId) continue;
      const entry: IndexedOperation = { id: operation.operationId, method: method.toUpperCase(), path, apiVersion, summary: shortSummary(operation) };
      if (operation['x-ms-long-running-operation']) entry.lro = true;
      if (operation.parameters?.some(parameter => parameter.in === 'body' && parameter.required)) entry.body = true;
      operations.push(entry);
    }
  }
  return operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
