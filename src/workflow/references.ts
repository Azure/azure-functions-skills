import { reference, type Json } from './plan.js';

export function resolveReferences(value: Json, exports: Record<string, Record<string, Json>>): Json {
  const ref = reference(value);
  if (ref) {
    const [node, key] = ref.split('.');
    if (!Object.hasOwn(exports, node) || !Object.hasOwn(exports[node], key)) throw new Error(`Unavailable export ${ref}.`);
    return exports[node][key];
  }
  if (Array.isArray(value)) return value.map(item => resolveReferences(item, exports));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveReferences(item, exports)]));
  }
  return value;
}

export function project(data: Json, pointer: string): Json {
  if (!pointer) return data;
  let current = data;
  for (const segment of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(segment)) throw new Error(`Invalid JSON Pointer ${pointer}.`);
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      throw new Error(`Missing output at ${pointer}.`);
    }
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) throw new Error(`Invalid array pointer ${pointer}.`);
      current = current[Number(key)];
    } else current = current[key];
  }
  return current;
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
