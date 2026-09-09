import { z } from 'zod';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(),
  z.array(jsonSchema), z.record(jsonSchema),
]));
export const LIMITS = { artifact: 16 * 1024 * 1024, run: 128 * 1024 * 1024, summary: 8192, inspect: 16384 };
const nodeId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const exportId = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
const execSchema = z.object({
  kind: z.literal('exec'), command: z.string().min(1), args: z.array(jsonSchema).default([]),
  cwd: z.string().default('.'), output: z.enum(['text', 'json']).default('text'),
  stdinFrom: nodeId.optional(),
}).strict();
const mcpSchema = z.object({
  kind: z.literal('mcp'), server: nodeId, tool: z.string().min(1),
  arguments: z.record(jsonSchema).default({}), output: z.enum(['structured', 'json', 'text']).default('structured'),
}).strict();
const actionSchema = z.discriminatedUnion('kind', [execSchema, mcpSchema]);
const codes = z.array(z.string().min(1)).min(1);
const nodeSchema = z.object({
  id: nodeId, dependsOn: z.array(nodeId).default([]), action: actionSchema,
  exports: z.record(exportId, z.string().regex(/^(?:$|\/.*)$/)).default({}),
  timeoutMs: z.number().int().min(1).max(3_600_000).default(300_000),
  replaySafe: z.boolean().default(false),
  retry: z.object({
    maxAttempts: z.number().int().min(1).max(3), delayMs: z.number().int().min(0).max(60_000),
    on: codes,
  }).strict().optional(),
  fallback: z.object({ on: codes, action: actionSchema }).strict().optional(),
}).strict();
const planSchema = z.object({
  version: z.literal(1), maxConcurrency: z.number().int().min(1).max(8).default(1),
  nodes: z.array(nodeSchema).min(1).max(50), outputs: z.record(exportId, jsonSchema).default({}),
}).strict();
export type Plan = z.infer<typeof planSchema>;
export type PlanNode = Plan['nodes'][number];
export type Action = PlanNode['action'];
export const mcpConfigSchema = z.object({
  servers: z.record(nodeId, z.object({
    command: z.string().min(1), args: z.array(z.string()).default([]),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().min(1)).default({}),
  }).strict()),
}).strict();
export type McpConfig = z.input<typeof mcpConfigSchema>;

export function reference(value: Json): string | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && '$ref' in value) {
    if (Object.keys(value).length !== 1 || typeof value.$ref !== 'string' ||
        !/^[a-z][a-z0-9-]{0,63}\.[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.$ref)) {
      throw new Error('Invalid reference: use {"$ref":"node.export"}.');
    }
    return value.$ref;
  }
  return undefined;
}

export function visitReferences(value: Json, visit: (ref: string) => void): void {
  const ref = reference(value);
  if (ref) { visit(ref); return; }
  if (Array.isArray(value)) value.forEach(item => visitReferences(item, visit));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(item => visitReferences(item, visit));
}

export function parsePlan(input: unknown): Plan {
  const plan = planSchema.parse(input);
  const nodes = new Map(plan.nodes.map(node => [node.id, node]));
  if (nodes.size !== plan.nodes.length) throw new Error('Duplicate node IDs.');
  const checkRef = (ref: string, consumer?: PlanNode): void => {
    const [id, key] = ref.split('.');
    if (!nodes.get(id) || !Object.hasOwn(nodes.get(id)!.exports, key)) throw new Error(`Unknown export ${ref}.`);
    if (consumer && !consumer.dependsOn.includes(id)) throw new Error(`${consumer.id} must depend on ${id}.`);
  };
  for (const node of plan.nodes) {
    if (new Set(node.dependsOn).size !== node.dependsOn.length) throw new Error(`Duplicate dependencies: ${node.id}.`);
    for (const dependency of node.dependsOn) {
      if (!nodes.has(dependency)) throw new Error(`Unknown dependency ${dependency}.`);
    }
    for (const action of [node.action, ...(node.fallback ? [node.fallback.action] : [])]) {
      if (action.kind === 'exec') {
        if (action.command.includes('\0') || action.args.some(arg =>
          typeof arg === 'string' ? arg.includes('\0') : !reference(arg))) {
          throw new Error('Exec requires a NUL-free command and string arguments or export references.');
        }
      }
      const inputs = action.kind === 'exec' ? action.args : action.arguments;
      visitReferences(inputs, ref => checkRef(ref, node));
      if (action.kind === 'exec' && action.stdinFrom && !node.dependsOn.includes(action.stdinFrom)) {
        throw new Error(`stdinFrom must be a dependency of ${node.id}.`);
      }
    }
  }
  for (const value of Object.values(plan.outputs)) {
    const ref = reference(value);
    if (!ref) throw new Error('Final outputs must be export references.');
    checkRef(ref);
  }
  const complete = new Set<string>();
  while (complete.size < nodes.size) {
    const ready = plan.nodes.filter(node => !complete.has(node.id) && node.dependsOn.every(id => complete.has(id)));
    if (!ready.length) throw new Error('Workflow contains a dependency cycle.');
    ready.forEach(node => complete.add(node.id));
  }
  return plan;
}
