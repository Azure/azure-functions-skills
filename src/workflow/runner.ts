import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { executeCommand } from './adapters/exec.js';
import { McpConnections } from './adapters/mcp.js';
import { mcpConfigSchema, parsePlan, type Action, type Json, type McpConfig, type Plan, type PlanNode } from './plan.js';
import { canonical, project, resolveReferences } from './references.js';
import { normalizeOutput } from './output.js';
import { actionCwd, digest, readRun, RunStore, type NodeRecord, type Outcome, type Run } from './store.js';

export interface RunOptions {
  dir: string; mcpConfig?: McpConfig; from?: string; reuse?: string[]; signal?: AbortSignal;
  onRunCreated?: (id: string) => void;
}
function emptyNode(): NodeRecord { return { status: 'notStarted', exports: {}, receipts: [], artifacts: {} }; }
function validateReuse(plan: Plan, options: RunOptions, configDigest: string): Run | undefined {
  const reuse = options.reuse ?? [];
  if (!options.from && reuse.length) throw new Error('--reuse requires --from.');
  if (!options.from) return undefined;
  if (!reuse.length) throw new Error('--from requires an explicit nonempty --reuse list.');
  if (new Set(reuse).size !== reuse.length) throw new Error('Duplicate reuse IDs.');
  const old = readRun(options.dir, options.from);
  if (old.status === 'running') throw new Error('Source run is active or interrupted; resolve its ownership and unknown outcomes before importing.');
  if (old.configDigest !== configDigest) throw new Error('MCP configuration changed; reuse is not permitted.');
  const oldStore = new RunStore(options.dir, options.from);
  const oldPlan = parsePlan(oldStore.readJson('plan.json'));
  for (const id of reuse) {
    const node = plan.nodes.find(node => node.id === id);
    const previous = oldPlan.nodes.find(node => node.id === id);
    if (!node || !previous || canonical(node) !== canonical(previous)) throw new Error(`Node ${id} definition changed or does not match.`);
    if (node.dependsOn.some(parent => !reuse.includes(parent))) throw new Error(`Reuse of ${id} requires its dependency ancestors.`);
    if (old.nodes[id]?.status !== 'succeeded') throw new Error(`Node ${id} is not a recorded success.`);
    for (const [path, hash] of Object.entries(old.nodes[id].artifacts)) {
      if (digest(oldStore.read(path)) !== hash) throw new Error(`Artifact digest mismatch for ${id}.`);
    }
    if (!old.nodes[id].primaryArtifact || !Object.hasOwn(old.nodes[id].artifacts, old.nodes[id].primaryArtifact!)) {
      throw new Error(`Missing primary artifact for ${id}.`);
    }
    const record = old.nodes[id];
    const receipt = record.receipts.at(-1);
    if (!receipt || receipt.status !== 'succeeded') throw new Error(`Missing successful receipt for ${id}.`);
    const action = receipt.action === 'fallback' ? previous.fallback?.action : previous.action;
    if (!action) throw new Error(`Missing successful action for ${id}.`);
    const prefix = `nodes/${id}/${receipt.action === 'fallback' ? 'fallback' : `attempt-${receipt.attempt}`}`;
    if (record.primaryArtifact !== `${prefix}/${action.kind === 'exec' ? 'stdout.log' : 'response.json'}` ||
      !Object.hasOwn(record.artifacts, `${prefix}/receipt.json`) ||
      canonical(oldStore.readJson(`${prefix}/receipt.json`)) !== canonical(receipt)) {
      throw new Error(`Successful receipt or primary artifact does not match for ${id}.`);
    }
    const data = normalizeOutput(action, oldStore.read(record.primaryArtifact).toString('utf8'));
    const expected = Object.fromEntries(Object.entries(node.exports).map(([key, pointer]) => [key, project(data, pointer)]));
    if (canonical(expected) !== canonical(record.exports)) throw new Error(`Recorded exports do not match verified output for ${id}.`);
  }
  return old;
}

function prepare(input: Plan, options: RunOptions) {
  const plan = parsePlan(input);
  const dir = realpathSync(options.dir);
  const config = mcpConfigSchema.parse(options.mcpConfig ?? { servers: {} });
  const configDigest = digest(canonical(config));
  for (const node of plan.nodes) {
    for (const action of [node.action, ...(node.fallback ? [node.fallback.action] : [])]) {
      if (action.kind === 'exec') actionCwd(dir, action.cwd);
      else if (!Object.hasOwn(config.servers, action.server)) throw new Error(`MCP server ${action.server} is not explicitly configured.`);
    }
  }
  const previous = validateReuse(plan, { ...options, dir }, configDigest);
  return { plan, dir, config, configDigest, previous };
}

export function validateWorkflow(input: Plan, options: RunOptions): { valid: true; nodes: number } {
  const { plan } = prepare(input, options);
  return { valid: true, nodes: plan.nodes.length };
}

export async function runWorkflow(input: Plan, options: RunOptions): Promise<Run> {
  const { plan, dir, config, configDigest, previous } = prepare(input, options);
  const store = new RunStore(dir, undefined, true);
  options.onRunCreated?.(store.id);
  const run: Run = {
    version: 1, id: store.id, dir, configDigest, pid: process.pid,
    processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    startedAt: new Date().toISOString(), status: 'running',
    nodes: Object.fromEntries(plan.nodes.map(node => [node.id, emptyNode()])), outputs: {}, unavailableOutputs: [],
  };
  store.writeJson('plan.json', plan);
  store.writeJson('state.json', run);
  const connections = new McpConnections(config, dir);
  const exports: Record<string, Record<string, Json>> = {};
  const save = (): void => store.writeJson('state.json', run);
  const closeConnections = async (): Promise<void> => {
    try { await connections.close(); }
    catch (error) {
      run.status = 'unknown';
      run.error = 'MCP shutdown failed; inspect owned server processes before continuing.';
      save();
      throw error;
    }
  };
  try {
    if (previous) {
      const source = new RunStore(dir, previous.id);
      for (const id of options.reuse ?? []) {
        const record = structuredClone(previous.nodes[id]);
        for (const path of Object.keys(record.artifacts)) store.write(path, source.read(path));
        record.reusedFrom = { run: previous.id, node: id };
        run.nodes[id] = record;
        exports[id] = record.exports;
      }
      save();
    }
    const execute = async (node: PlanNode, action: Action, prefix: string): Promise<Outcome> => {
      const resolved = structuredClone(action);
      try {
        if (resolved.kind === 'exec') {
          resolved.args = resolved.args.map(arg => resolveReferences(arg, exports));
          const inputPath = resolved.stdinFrom ? run.nodes[resolved.stdinFrom].primaryArtifact : undefined;
          return await executeCommand(resolved, store, prefix, node.timeoutMs,
            inputPath ? store.path(inputPath) : undefined, options.signal);
        }
        resolved.arguments = Object.fromEntries(Object.entries(resolved.arguments).map(([key, value]) => [key, resolveReferences(value, exports)]));
      } catch (error) {
        // Reference resolution is deterministic. Adapter/persistence errors must propagate.
        if (error instanceof Error && error.message.startsWith('Unavailable export')) {
          return { status: 'failed', code: 'INPUT_INVALID', message: error.message, notStarted: true };
        }
        throw error;
      }
      return connections.execute(resolved, store, prefix, node.timeoutMs, options.signal);
    };
    const executeNode = async (node: PlanNode): Promise<void> => {
      const record = run.nodes[node.id];
      record.status = 'running';
      save();
      const attempt = async (action: Action, number: number, fallback: boolean): Promise<Outcome> => {
        const prefix = `nodes/${node.id}/${fallback ? 'fallback' : `attempt-${number}`}`;
        const startedAt = new Date().toISOString();
        const result = await execute(node, action, prefix);
        if (result.status === 'succeeded') {
          try {
            record.exports = Object.fromEntries(Object.entries(node.exports).map(([key, pointer]) => [key, project(result.data ?? null, pointer)]));
          } catch (error) {
            result.status = 'failed'; result.code = 'OUTPUT_INVALID';
            result.message = error instanceof Error ? error.message : 'Output projection failed.';
          }
        }
        record.receipts.push({
          action: fallback ? 'fallback' : 'primary', attempt: number, startedAt,
          endedAt: new Date().toISOString(), status: result.status, code: result.code,
          ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
          ...(result.message ? { message: result.message } : {}),
        });
        if (result.primaryArtifact) record.primaryArtifact = result.primaryArtifact;
        const prefixPath = store.path(prefix);
        if (existsSync(prefixPath)) for (const name of readdirSync(prefixPath)) {
          const path = `${prefix}/${name}`;
          record.artifacts[path] = digest(store.read(path));
        }
        store.writeJson(`${prefix}/receipt.json`, record.receipts.at(-1));
        record.artifacts[`${prefix}/receipt.json`] = digest(store.read(`${prefix}/receipt.json`));
        save();
        return result;
      };
      let outcome = await attempt(node.action, 1, false);
      for (let number = 2; node.retry && number <= node.retry.maxAttempts; number++) {
        if (outcome.status !== 'failed' || !(node.replaySafe || outcome.notStarted) ||
            !node.retry.on.includes(outcome.code) || options.signal?.aborted) break;
        await delay(node.retry.delayMs);
        outcome = await attempt(node.action, number, false);
      }
      if (outcome.status === 'failed' && node.fallback && (node.replaySafe || outcome.notStarted) &&
          node.fallback.on.includes(outcome.code) && !options.signal?.aborted) {
        outcome = await attempt(node.fallback.action, 1, true);
        record.usedFallback = outcome.status === 'succeeded';
      }
      record.status = outcome.status;
      if (outcome.status === 'succeeded') exports[node.id] = record.exports;
      else record.exports = {};
      save();
    };
    while (!options.signal?.aborted) {
      const ready = plan.nodes.filter(node => run.nodes[node.id].status === 'notStarted' &&
        node.dependsOn.every(parent => run.nodes[parent].status === 'succeeded')).slice(0, plan.maxConcurrency);
      if (!ready.length) break;
      const settled = await Promise.allSettled(ready.map(executeNode));
      const rejected = settled.find(result => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      if (ready.some(node => run.nodes[node.id].status !== 'succeeded')) break;
    }
    for (let round = 0; round < plan.nodes.length; round++) {
      for (const node of plan.nodes) {
        if (run.nodes[node.id].status === 'notStarted' && node.dependsOn.some(id =>
          ['failed', 'unknown', 'blocked'].includes(run.nodes[id].status))) run.nodes[node.id].status = 'blocked';
      }
    }
    run.status = options.signal?.aborted || Object.values(run.nodes).some(node => node.status === 'unknown') ? 'unknown'
      : Object.values(run.nodes).every(node => node.status === 'succeeded') ? 'succeeded' : 'failed';
    for (const [name, value] of Object.entries(plan.outputs)) {
      try { run.outputs[name] = resolveReferences(value, exports); }
      catch { run.unavailableOutputs.push(name); }
    }
    run.endedAt = new Date().toISOString();
    save();
    return run;
  } catch (error) {
    run.status = 'unknown';
    run.error = 'Runner or storage failure; inspect the persisted state before retrying.';
    for (const node of Object.values(run.nodes)) if (node.status === 'running') node.status = 'unknown';
    run.endedAt = new Date().toISOString();
    save();
    throw error;
  } finally {
    await closeConnections();
  }
}
