import { LIMITS } from './plan.js';
import { readRun, RunStore, type Run } from './store.js';

export function summarize(run: Run): Record<string, unknown> {
  const nodes = Object.entries(run.nodes).map(([id, node]) => ({
    id, status: node.status, ...(node.usedFallback ? { usedFallback: true } : {}),
    ...(node.reusedFrom ? { reusedFrom: node.reusedFrom } : {}),
    ...(node.status === 'unknown'
      ? { error: node.receipts.at(-1)?.status === 'unknown' ? node.receipts.at(-1)?.code : 'OUTCOME_UNKNOWN' }
      : node.status === 'failed' ? { error: node.receipts.at(-1)?.code } : {}),
  }));
  const base = {
    runId: run.id, status: run.status,
    ...(run.error ? { error: run.error.slice(0, 300) } : {}),
    counts: Object.fromEntries(['succeeded', 'failed', 'unknown', 'blocked', 'notStarted', 'running']
      .map(status => [status, nodes.filter(node => node.status === status).length])),
    state: `.azure-functions-workflows/runs/${run.id}/state.json`,
  };
  const full = { ...base, outputs: run.outputs, unavailableOutputs: run.unavailableOutputs, nodes };
  if (Buffer.byteLength(JSON.stringify(full)) + 1 <= LIMITS.summary) return full;
  return { ...base, truncated: true, message: 'Inspect selected nodes or read selected outputs from the state artifact.' };
}

export function inspectNode(
  dir: string, runId: string, nodeId: string,
  options: { artifact?: 'stdout' | 'stderr' | 'response' | 'receipt'; offset?: number; limit?: number } = {},
): Record<string, unknown> {
  const run = readRun(dir, runId);
  const node = run.nodes[nodeId];
  if (!Object.hasOwn(run.nodes, nodeId)) throw new Error(`Unknown node ${nodeId}.`);
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 2048;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2048) {
    throw new Error('Use a nonnegative integer --offset and --limit between 1 and 2048 bytes.');
  }
  const artifact = options.artifact;
  let content: Buffer;
  if (!artifact) content = Buffer.from(JSON.stringify(node));
  else {
    const ending = { stdout: '/stdout.log', stderr: '/stderr.log', response: '/response.json', receipt: '/receipt.json' }[artifact];
    const path = Object.keys(node.artifacts).filter(path => path.endsWith(ending)).at(-1);
    if (!path) throw new Error(`No ${artifact} artifact for node ${nodeId}.`);
    content = new RunStore(dir, runId).read(path);
  }
  const chunk = content.subarray(offset, Math.min(offset + limit, content.length));
  return {
    runId, nodeId, offset, totalBytes: content.length, data: chunk.toString('utf8'),
    truncated: offset + chunk.length < content.length, nextOffset: offset + chunk.length,
  };
}
