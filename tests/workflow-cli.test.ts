import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(removeDir));
function fixture() {
  const dir = createTempDir('workflow-cli-');
  dirs.push(dir);
  const plan = join(dir, 'plan.json');
  writeFileSync(plan, JSON.stringify({ version: 1, nodes: [{
    id: 'hello', action: { kind: 'exec', command: process.execPath, args: ['-e', 'console.log("hello")'] },
  }] }));
  return { dir, plan };
}
function cli(...args: string[]) {
  return spawnSync(process.execPath, [resolve('bin', 'azure-functions-skills.js'), 'workflow', ...args], { encoding: 'utf8' });
}
it('keeps the split CLI entry available to version control', () => {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--', 'bin/workflow.js'], { encoding: 'utf8' });
  expect(result.status).toBe(1);
});
it('validates without executing or creating run state', () => {
  const { dir, plan } = fixture();
  const result = cli('validate', '--plan', plan, '--dir', dir);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ valid: true, nodes: 1 });
  expect(existsSync(join(dir, '.azure-functions-workflows'))).toBe(false);
});
it('runs the actual CLI and reads persisted output', () => {
  const { dir, plan } = fixture();
  const result = cli('run', '--plan', plan, '--dir', dir);
  expect(result.status).toBe(0);
  const summary = JSON.parse(result.stdout) as { runId: string; status: string };
  expect(summary.status).toBe('succeeded');
  expect(cli('status', '--run', summary.runId, '--dir', dir).status).toBe(0);
  const detail = cli('inspect', '--run', summary.runId, '--node', 'hello', '--artifact', 'stdout', '--dir', dir);
  expect(JSON.parse(detail.stdout).data).toBe('hello\n');
});
it('rejects unsupported options and missing values', () => {
  expect(cli('run', '--whatever', 'x').status).toBe(2);
  expect(cli('run', '--plan').status).toBe(2);
  expect(cli('run', '--plan', 'x', '--format', 'html').status).toBe(2);
});

it('uses input-error exit codes for invalid status and inspect requests', () => {
  const { dir, plan } = fixture();
  expect(cli('status', '--run', 'not-a-uuid', '--dir', dir).status).toBe(2);
  expect(cli('status', '--run', '11111111-1111-4111-8111-111111111111', '--dir', dir).status).toBe(2);
  const run = JSON.parse(cli('run', '--plan', plan, '--dir', dir).stdout) as { runId: string };
  expect(cli('inspect', '--run', run.runId, '--node', 'missing', '--dir', dir).status).toBe(2);
  expect(cli('inspect', '--run', run.runId, '--node', 'hello', '--offset', '-5', '--dir', dir).status).toBe(2);
  expect(cli('inspect', '--run', run.runId, '--node', 'hello', '--limit', '999999', '--dir', dir).status).toBe(2);
});

it('returns a run ID and a node-level limit receipt for excessive output', () => {
  const { dir, plan } = fixture();
  writeFileSync(plan, JSON.stringify({ version: 1, nodes: [{
    id: 'verbose', action: { kind: 'exec', command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(17*1024*1024));setTimeout(()=>{},10000)'] },
  }] }));
  const result = cli('run', '--plan', plan, '--dir', dir);
  expect(result.status).toBe(1);
  const summary = JSON.parse(result.stdout) as { runId: string };
  expect(summary.runId).toBeTruthy();
  expect(cli('inspect', '--run', summary.runId, '--node', 'verbose', '--artifact', 'receipt', '--dir', dir).status).toBe(0);
});

it('retains the run ID even when a child corrupts the state destination', () => {
  const { dir, plan } = fixture();
  writeFileSync(plan, JSON.stringify({ version: 1, nodes: [{
    id: 'corrupt', action: { kind: 'exec', command: process.execPath,
      args: ['--input-type=module', '-e',
        'import{readdirSync,rmSync,mkdirSync}from"node:fs";const root=".azure-functions-workflows/runs/";const path=root+readdirSync(root)[0]+"/state.json";rmSync(path);mkdirSync(path);console.log("ok")'] },
  }] }));
  const result = cli('run', '--plan', plan, '--dir', dir);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({ runId: expect.any(String), error: expect.any(String) });
});
