import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTempDir, removeDir } from './helpers/fs.js';
import { inspectNode, parsePlan, readRun, runWorkflow, summarize } from '../src/workflow/index.js';

const directories: string[] = [];
function workspace(): string {
  const dir = createTempDir('workflow-test-');
  directories.push(dir);
  return dir;
}
function execNode(id: string, script = 'console.log("{}")') {
  return { id, action: { kind: 'exec', command: process.execPath, args: ['-e', script], output: 'json' } };
}
afterEach(() => { directories.splice(0).forEach(removeDir); });

describe('workflow plan', () => {
  it('normalizes safe defaults', () => {
    const plan = parsePlan({ version: 1, nodes: [execNode('hello')] });
    expect(plan.maxConcurrency).toBe(1);
    expect(plan.nodes[0].replaySafe).toBe(false);
  });
  it.each([
    { version: 2, nodes: [execNode('a')] },
    { version: 1, nodes: [execNode('a')], unexpected: true },
    { version: 1, nodes: [execNode('../a')] },
    { version: 1, nodes: [execNode('a,b')] },
    { version: 1, nodes: [execNode('a'), execNode('a')] },
    { version: 1, nodes: [{ ...execNode('a'), dependsOn: ['missing'] }] },
    { version: 1, nodes: [{ ...execNode('a'), dependsOn: ['b'] }, { ...execNode('b'), dependsOn: ['a'] }] },
    { version: 1, nodes: [{ id: 'a', action: { kind: 'exec', command: 'node', args: [3] } }] },
    { version: 1, nodes: [{ id: 'a', action: { kind: 'exec', command: 'node', args: [{ literal: true }] } }] },
    { version: 1, nodes: [{ id: 'a', action: { kind: 'exec', command: 'node\0', args: [] } }] },
    { version: 1, nodes: [{ ...execNode('a'), exports: { name: '/name' } }, {
      id: 'b', action: { kind: 'exec', command: 'node', args: [{ $ref: 'a.name' }] },
    }] },
  ])('rejects invalid input without executing it', input => {
    expect(() => parsePlan(input)).toThrow();
  });
});

describe('workflow execution', () => {
  it.skipIf(process.platform !== 'win32')('preserves argument values through Windows command shims', async () => {
    const dir = workspace();
    const capture = join(dir, 'capture.mjs');
    const shim = join(dir, 'capture.cmd');
    writeFileSync(capture, 'console.log(JSON.stringify({args:process.argv.slice(2)}))');
    writeFileSync(shim, `@"${process.execPath}" "${capture}" %*\r\n`);
    const args = ['hello world', 'a&b', 'a"b', '%WORKFLOW_LITERAL%', 'C:\\path with spaces\\'];
    const run = await runWorkflow(parsePlan({ version: 1, nodes: [{
      id: 'shim', action: { kind: 'exec', command: shim, args, output: 'json' }, exports: { args: '/args' },
    }], outputs: { args: { $ref: 'shim.args' } } }), { dir });
    expect(run.status).toBe('succeeded');
    expect(run.outputs.args).toEqual(args);
  });
  it('resolves typed exports and returns only selected output', async () => {
    const dir = workspace();
    const result = await runWorkflow(parsePlan({
      version: 1,
      nodes: [
        { ...execNode('first', 'console.log(JSON.stringify({name:"world",private:"not-summary"}))'), exports: { name: '/name' } },
        { id: 'second', dependsOn: ['first'], action: {
          kind: 'exec', command: process.execPath,
          args: ['-e', 'console.log(JSON.stringify({greeting:process.argv[1]}))', { $ref: 'first.name' }],
          output: 'json',
        }, exports: { greeting: '/greeting' } },
      ],
      outputs: { greeting: { $ref: 'second.greeting' } },
    }), { dir });
    expect(result.status).toBe('succeeded');
    expect(summarize(result).outputs).toEqual({ greeting: 'world' });
    expect(JSON.stringify(summarize(result))).not.toContain('not-summary');
    expect(readRun(dir, result.id).status).toBe('succeeded');
  });

  it('retries only declared safe errors, then uses one fallback', async () => {
    const dir = workspace();
    const run = await runWorkflow(parsePlan({ version: 1, nodes: [{
      ...execNode('recover', 'process.exit(75)'), replaySafe: true,
      retry: { maxAttempts: 2, delayMs: 1, on: ['EXEC_EXIT_NONZERO'] },
      fallback: { on: ['EXEC_EXIT_NONZERO'], action: execNode('fallback').action },
    }] }), { dir });
    expect(run.status).toBe('succeeded');
    expect(run.nodes.recover.receipts).toHaveLength(3);
    expect(run.nodes.recover.usedFallback).toBe(true);
  });

  it('does not retry a failed unsafe action', async () => {
    const run = await runWorkflow(parsePlan({ version: 1, nodes: [{
      ...execNode('unsafe', 'process.exit(1)'),
      retry: { maxAttempts: 3, delayMs: 1, on: ['EXEC_EXIT_NONZERO'] },
    }] }), { dir: workspace() });
    expect(run.nodes.unsafe.receipts).toHaveLength(1);
    expect(run.status).toBe('failed');
  });

  it('records successes in the active wave and stops new waves', async () => {
    const run = await runWorkflow(parsePlan({ version: 1, maxConcurrency: 2, nodes: [
      execNode('bad', 'process.exit(1)'), execNode('good'),
      { ...execNode('blocked'), dependsOn: ['bad'] }, execNode('not-started'),
    ] }), { dir: workspace() });
    expect(run.nodes.good.status).toBe('succeeded');
    expect(run.nodes.blocked.status).toBe('blocked');
    expect(run.nodes['not-started'].status).toBe('notStarted');
  });

  it('never retries or falls back after timeout', async () => {
    const run = await runWorkflow(parsePlan({ version: 1, nodes: [{
      ...execNode('slow', 'setTimeout(()=>console.log("{}"),10000)'), timeoutMs: 100,
      replaySafe: true, retry: { maxAttempts: 2, delayMs: 1, on: ['OUTCOME_UNKNOWN'] },
      fallback: { on: ['OUTCOME_UNKNOWN'], action: execNode('fallback').action },
    }] }), { dir: workspace() });
    expect(run.status).toBe('unknown');
    expect(run.nodes.slow.receipts).toHaveLength(1);
  });

  it('reports invalid output instead of substituting empty data', async () => {
    const run = await runWorkflow(parsePlan({ version: 1, nodes: [
      execNode('bad-json', 'console.log("not json")'),
    ] }), { dir: workspace() });
    expect(run.status).toBe('failed');
    expect(run.nodes['bad-json'].receipts[0].code).toBe('OUTPUT_INVALID');
  });

  it('streams a large intermediate artifact to a dependent command', async () => {
    const dir = workspace();
    const run = await runWorkflow(parsePlan({ version: 1, nodes: [
      { id: 'large', action: { kind: 'exec', command: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(150000))'] } },
      { id: 'count', dependsOn: ['large'], action: { kind: 'exec', command: process.execPath,
        args: ['-e', 'let n=0;process.stdin.on("data",x=>n+=x.length);process.stdin.on("end",()=>console.log(JSON.stringify({n})))'],
        stdinFrom: 'large', output: 'json' }, exports: { count: '/n' } },
    ], outputs: { count: { $ref: 'count.count' } } }), { dir });
    expect(run.outputs.count).toBe(150000);
    expect(Buffer.byteLength(JSON.stringify(summarize(run)))).toBeLessThanOrEqual(8192);
    const page = inspectNode(dir, run.id, 'large', { artifact: 'stdout', limit: 120 });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16384);
    expect(page.truncated).toBe(true);
  });

  it('imports matching successes without rerunning side effects', async () => {
    const dir = workspace();
    const counter = join(dir, 'counter.txt');
    const first = execNode('first', `import{appendFileSync}from"node:fs";appendFileSync(${JSON.stringify(counter)},"x");console.log("{}")`);
    const original = await runWorkflow(parsePlan({ version: 1, nodes: [
      first, { ...execNode('second', 'process.exit(1)'), dependsOn: ['first'] },
    ] }), { dir });
    const revised = parsePlan({ version: 1, nodes: [first, { ...execNode('second'), dependsOn: ['first'] }] });
    const resumed = await runWorkflow(revised, { dir, from: original.id, reuse: ['first'] });
    expect(resumed.status).toBe('succeeded');
    expect(readFileSync(counter, 'utf8')).toBe('x');
    expect(resumed.nodes.first.reusedFrom?.run).toBe(original.id);
    expect(resumed.id).not.toBe(original.id);
  });

  it('rejects changed definitions and missing dependency closure before executing', async () => {
    const dir = workspace();
    const plan = parsePlan({ version: 1, nodes: [execNode('a'), { ...execNode('b'), dependsOn: ['a'] }] });
    const old = await runWorkflow(plan, { dir });
    await expect(runWorkflow(plan, { dir, from: old.id, reuse: ['b'] })).rejects.toThrow(/ancestor|depend/i);
    const changed = parsePlan({ version: 1, nodes: [execNode('a', 'console.log("[]")')] });
    await expect(runWorkflow(changed, { dir, from: old.id, reuse: ['a'] })).rejects.toThrow(/changed|match/i);
  });

  it('rejects corrupt artifacts and unsafe run paths', async () => {
    const dir = workspace();
    const plan = parsePlan({ version: 1, nodes: [execNode('a')] });
    const old = await runWorkflow(plan, { dir });
    const path = join(dir, '.azure-functions-workflows', 'runs', old.id, old.nodes.a.primaryArtifact!);
    expect(existsSync(path)).toBe(true);
    writeFileSync(path, 'tampered');
    await expect(runWorkflow(plan, { dir, from: old.id, reuse: ['a'] })).rejects.toThrow(/digest|artifact/i);
    expect(() => readRun(dir, '../escape')).toThrow();
  });

  it('rejects NUL bytes from resolved arguments without losing a receipt', async () => {
    const run = await runWorkflow(parsePlan({ version: 1, nodes: [
      { ...execNode('source', 'console.log(JSON.stringify({value:"a\\u0000b"}))'), exports: { value: '/value' } },
      { id: 'consumer', dependsOn: ['source'], action: {
        kind: 'exec', command: process.execPath, args: ['-e', '', { $ref: 'source.value' }],
      } },
    ] }), { dir: workspace() });
    expect(run.status).toBe('failed');
    expect(run.nodes.consumer.receipts[0].code).toBe('INPUT_INVALID');
  });

  it('records partial logs and never replays a command terminated at the artifact limit', async () => {
    const dir = workspace();
    const run = await runWorkflow(parsePlan({ version: 1, nodes: [{
      id: 'verbose', replaySafe: true,
      retry: { maxAttempts: 2, delayMs: 0, on: ['ARTIFACT_LIMIT'] },
      action: { kind: 'exec', command: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(17*1024*1024));setTimeout(()=>{},10000)'] },
    }] }), { dir });
    expect(run.status).toBe('unknown');
    expect(run.nodes.verbose.receipts).toHaveLength(1);
    expect(run.nodes.verbose.receipts[0].code).toBe('ARTIFACT_LIMIT');
    expect(inspectNode(dir, run.id, 'verbose', { artifact: 'stdout', limit: 10 }).data).toBe('xxxxxxxxxx');
  });

  it('cross-checks reused exports against the original output instead of trusting edited state', async () => {
    const dir = workspace();
    const plan = parsePlan({ version: 1, nodes: [
      { ...execNode('source', 'console.log(JSON.stringify({value:"original"}))'), exports: { value: '/value' } },
    ] });
    const old = await runWorkflow(plan, { dir });
    old.nodes.source.exports.value = 'tampered';
    writeFileSync(join(dir, '.azure-functions-workflows', 'runs', old.id, 'state.json'), JSON.stringify(old));
    await expect(runWorkflow(plan, { dir, from: old.id, reuse: ['source'] })).rejects.toThrow(/export|projection/i);
  });

  it('treats an exited owner as unknown while preserving reusable committed successes', async () => {
    const dir = workspace();
    const plan = parsePlan({ version: 1, nodes: [execNode('good'), { ...execNode('unfinished'), dependsOn: ['good'] }] });
    const old = await runWorkflow(plan, { dir });
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    old.pid = exited.pid;
    old.status = 'running';
    old.nodes.unfinished.status = 'running';
    const state = join(dir, '.azure-functions-workflows', 'runs', old.id, 'state.json');
    writeFileSync(state, JSON.stringify(old));
    expect(readRun(dir, old.id).nodes.unfinished.status).toBe('unknown');
    expect(summarize(readRun(dir, old.id))).toMatchObject({
      status: 'unknown', error: expect.stringContaining('Owner'),
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'unfinished', error: 'OUTCOME_UNKNOWN' })]),
    });
    const revised = await runWorkflow(parsePlan({ version: 1, nodes: [execNode('good')] }),
      { dir, from: old.id, reuse: ['good'] });
    expect(revised.nodes.good.reusedFrom?.run).toBe(old.id);
    expect((JSON.parse(readFileSync(state, 'utf8')) as { status: string }).status).toBe('running');
  });

  it('refuses reuse when the recorded owner may still be alive', async () => {
    const dir = workspace();
    const plan = parsePlan({ version: 1, nodes: [execNode('good')] });
    const old = await runWorkflow(plan, { dir });
    old.status = 'running';
    writeFileSync(join(dir, '.azure-functions-workflows', 'runs', old.id, 'state.json'), JSON.stringify(old));
    await expect(runWorkflow(plan, { dir, from: old.id, reuse: ['good'] })).rejects.toThrow(/owner|active/);
  });
});
