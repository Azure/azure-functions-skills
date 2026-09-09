import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readRun, RunStore } from '../workflow/store.js';

const count = z.number().int().nonnegative().safe();
export const workflowEvidenceSchema = z.object({
  runs: count, runsWithReuse: count, executedAttempts: count, retries: count,
  fallbacks: count, reusedNodes: count, unknownNodes: count, artifactBytes: count,
}).strict();

export function collectWorkflowEvidence(workspace: string): z.infer<typeof workflowEvidenceSchema> {
  const evidence = { runs: 0, runsWithReuse: 0, executedAttempts: 0, retries: 0,
    fallbacks: 0, reusedNodes: 0, unknownNodes: 0, artifactBytes: 0 };
  const root = join(workspace, '.azure-functions-workflows', 'runs');
  if (!existsSync(root)) return evidence;
  const entries = readdirSync(root, { withFileTypes: true });
  if (entries.length > 50) throw new Error('Benchmark receipt collection exceeds 50 runs.');
  for (const entry of entries) {
    if (!entry.isDirectory() || !z.string().uuid().safeParse(entry.name).success) throw new Error('Invalid benchmark workflow run directory.');
    const run = readRun(workspace, entry.name);
    if (run.status === 'running') throw new Error('Workflow remains active after the agent completed.');
    const store = new RunStore(workspace, entry.name);
    evidence.runs++;
    if (Object.values(run.nodes).some(node => node.reusedFrom)) evidence.runsWithReuse++;
    for (const node of Object.values(run.nodes)) {
      if (node.reusedFrom) evidence.reusedNodes++;
      else {
        evidence.executedAttempts += node.receipts.length;
        evidence.retries += node.receipts.filter(receipt => receipt.action === 'primary' && receipt.attempt > 1).length;
        evidence.fallbacks += node.receipts.filter(receipt => receipt.action === 'fallback').length;
      }
      if (node.status === 'unknown') evidence.unknownNodes++;
      for (const path of Object.keys(node.artifacts)) evidence.artifactBytes += statSync(store.path(path)).size;
    }
  }
  return workflowEvidenceSchema.parse(evidence);
}
