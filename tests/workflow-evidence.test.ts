import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import { collectWorkflowEvidence } from '../src/workflow-evaluation/evidence.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(removeDir));

it('counts actual recovery receipts without double-counting imported attempts', () => {
  const dir = createTempDir('workflow-evidence-');
  dirs.push(dir);
  expect(collectWorkflowEvidence(dir)).toMatchObject({ runs: 0, executedAttempts: 0 });
  const cli = resolve('bin', 'azure-functions-skills.js');
  const first = spawnSync(process.execPath, [cli, 'workflow', 'run', '--plan',
    resolve('samples', 'workflow-runner', 'recovery', 'plan.json'), '--dir', dir], { encoding: 'utf8' });
  expect(first.status).toBe(1);
  const id = (JSON.parse(first.stdout) as { runId: string }).runId;
  const second = spawnSync(process.execPath, [cli, 'workflow', 'run', '--plan',
    resolve('samples', 'workflow-runner', 'recovery', 'revised.json'), '--dir', dir,
    '--from', id, '--reuse', 'prepare'], { encoding: 'utf8' });
  expect(second.status).toBe(0);
  const evidence = collectWorkflowEvidence(dir);
  expect(evidence).toMatchObject({ runs: 2, runsWithReuse: 1, reusedNodes: 1, executedAttempts: 3, retries: 0, fallbacks: 0 });
  expect(evidence.artifactBytes).toBeGreaterThan(0);
  expect(JSON.stringify(evidence)).not.toContain('execution-count');
});
