import { existsSync, readFileSync } from 'node:fs';
import { EXIT, ToolError } from './output.js';
import { tokenize } from './docs.js';

export interface ApiOperation {
  id: string;
  method: string;
  path: string;
  apiVersion: string;
  summary: string;
  /** True when Azure processes the request as a long-running operation. */
  lro?: boolean;
  /** True when the operation requires a request body. */
  body?: boolean;
  /** Host for non-ARM data-plane APIs, for example `https://api.loganalytics.io`. */
  host?: string;
}

export interface ApiIndex {
  schemaVersion: 1;
  sources: { name: string; ref: string }[];
  operations: ApiOperation[];
}

export function loadApiIndex(path: string): ApiIndex {
  if (!existsSync(path)) throw new ToolError(EXIT.failed, `API index not found at ${path}. Reinstall the azure-functions-skills plugin.`);
  return JSON.parse(readFileSync(path, 'utf-8')) as ApiIndex;
}

export interface ApiHit extends ApiOperation {
  score: number;
}

/** Maps portal and colloquial words to the terms used in operation IDs and paths. */
const SYNONYMS: Record<string, string[]> = {
  easy: ['auth'],
  easyauth: ['auth'],
  authentication: ['auth'],
  kudu: ['scm', 'deployments'],
  env: ['settings'],
  environment: ['settings'],
  variables: ['settings'],
  appsettings: ['application', 'settings'],
  vnet: ['virtual', 'network'],
  keyvault: ['configreferences'],
  kv: ['configreferences'],
  logs: ['query'],
  plan: ['serverfarms'],
};

/** Returns one group per query word: the word plus its synonyms. A group counts as matched when any member matches. */
export function expandTerms(query: string): string[][] {
  return [...new Set(tokenize(query))].map(term => [...new Set([term, ...(SYNONYMS[term] ?? [])])]);
}

/** Ranks operations by query terms across operation ID, path, and summary. */
export function findOperations(index: ApiIndex, query: string, options: { method?: string; limit: number }): ApiHit[] {
  const groups = expandTerms(query);
  if (groups.length === 0) return [];
  const method = options.method?.toUpperCase();
  const hits: ApiHit[] = [];
  for (const operation of index.operations) {
    if (method && operation.method !== method) continue;
    const idTerms = new Set(tokenize(operation.id));
    const pathText = operation.path.replace(/\{[^}]+\}/g, '').toLowerCase();
    const summary = operation.summary.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const group of groups) {
      const groupScore = Math.max(...group.map(term => (idTerms.has(term) ? 4 : 0) + (pathText.includes(term) ? 2 : 0) + (summary.includes(term) ? 1 : 0)));
      if (groupScore > 0) matched++;
      score += groupScore;
    }
    if (matched === 0) continue;
    score = score * (matched / groups.length) - operation.path.length / 1000;
    hits.push({ ...operation, score: Math.round(score * 100) / 100 });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, options.limit);
}
