import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import { cleanupOwnedGroup, probeAzure, probeLocal, type Command } from '../src/workflow-evaluation/probes.js';

const target = { subscription: 'subscription', group: 'rg-afswf-fixture', owner: 'trial-owner' };

describe('independent benchmark probes and cleanup (WE-004, WE-005)', () => {
  it('owns a finite local HTTP host and closes it after the independent request', async () => {
    const dir = createTempDir('workflow-probe-');
    let host: ReturnType<typeof spawn> | undefined;
    try {
      mkdirSync(join(dir, 'src', 'functions'), { recursive: true });
      for (const file of ['host.json', 'package.json', 'tsconfig.json', join('src', 'functions', 'httpTrigger.ts')]) {
        writeFileSync(join(dir, file), '{}');
      }
      const commands: string[][] = [];
      const result = await probeLocal((program, args) => {
        commands.push([program, ...args]);
        return args[0] === '--version' ? 'v22.20.0' : '';
      }, dir, fetch, port => {
        host = spawn(process.execPath, ['--input-type=module', '-e',
          'import{createServer}from"node:http";createServer((q,s)=>s.end("Hello, Workflow!")).listen(Number(process.argv[1]),"127.0.0.1")',
          String(port)], { detached: process.platform !== 'win32', stdio: 'ignore' });
        return host;
      }, { node: process.execPath, npm: 'fixture-npm-cli.js' });
      expect(result.passed).toBe(true);
      expect(result.runtimeVersion).toBe('v22.20.0');
      expect(commands).toContainEqual([process.execPath, 'fixture-npm-cli.js', 'run', 'build']);
      expect(host?.exitCode !== null || host?.signalCode !== null).toBe(true);
    } finally { removeDir(dir); }
  });
  it('checks actual FC1 configuration and HTTP without returning the function key', async () => {
    const responses = [
      JSON.stringify([{ name: 'sample', defaultHostName: 'sample.azurewebsites.net',
        httpsOnly: true, identity: { type: 'UserAssigned' }, serverFarmId: 'plan-id',
        functionAppConfig: { runtime: { name: 'node', version: '22' } } }]),
      JSON.stringify({ sku: { name: 'FC1' } }),
      JSON.stringify({ config: { bindings: [{ type: 'httpTrigger', authLevel: 'function' }] } }),
      JSON.stringify({ default: 'fixture-function-key' }),
    ];
    const command: Command = (_program, _args, _cwd) => {
      const response = responses.shift();
      if (response === undefined) throw new Error('Unexpected command.');
      return response;
    };
    const result = await probeAzure(command, target, async (_input, init) => {
      expect(new Headers(init?.headers).get('x-functions-key')).toBe('fixture-function-key');
      return new Response('Hello, Workflow!');
    });
    expect(result.passed).toBe(true);
    expect(result.runtimeVersion).toBe('22');
    expect(JSON.stringify(result)).not.toContain('fixture-function-key');
    expect(responses).toHaveLength(0);
  });

  it('rejects non-Flex deployment without fetching keys or an endpoint', async () => {
    let calls = 0;
    const command: Command = () => ++calls === 1
      ? JSON.stringify([{ name: 'sample', defaultHostName: 'sample.azurewebsites.net',
        httpsOnly: true, identity: { type: 'SystemAssigned' }, serverFarmId: 'plan-id',
        functionAppConfig: { runtime: { name: 'node', version: '22' } } }])
      : JSON.stringify({ sku: { name: 'Y1' } });
    await expect(probeAzure(command, target)).rejects.toThrow(/FC1/);
    expect(calls).toBe(2);
  });

  it('rejects a different Azure worker runtime before retrieving keys', async () => {
    const command: Command = () => JSON.stringify([{ name: 'sample', defaultHostName: 'sample.azurewebsites.net',
      httpsOnly: true, identity: { type: 'SystemAssigned' }, serverFarmId: 'plan-id',
      functionAppConfig: { runtime: { name: 'node', version: '24' } } }]);
    await expect(probeAzure(command, target)).rejects.toThrow();
  });

  it('refuses to delete a group not owned by the trial', () => {
    const calls: string[][] = [];
    const command: Command = (_program, args) => {
      calls.push(args);
      return calls.length === 1 ? 'true' : JSON.stringify({ tags: { 'trial-id': 'someone-else' } });
    };
    expect(() => cleanupOwnedGroup(command, target)).toThrow(/ownership/);
    expect(calls.flat()).not.toContain('delete');
  });

  it('waits for deletion and then verifies absence rather than accepting no-wait', () => {
    const responses = ['true', JSON.stringify({ tags: {
      'trial-id': target.owner, 'vally-eval': 'true', workflow: 'workflow-runner-benchmark',
    } }), '', '', 'false'];
    const calls: string[][] = [];
    const command: Command = (_program, args) => {
      calls.push(args);
      const result = responses.shift();
      if (result === undefined) throw new Error('Unexpected command.');
      return result;
    };
    expect(cleanupOwnedGroup(command, target)).toEqual({ confirmedAbsent: true });
    expect(calls[2]).toContain('--no-wait');
    expect(calls[3]).toContain('--deleted');
    expect(calls[4]).toContain('exists');
  });

  it('fails cleanup when resources remain, preventing the next trial', () => {
    const responses = ['true', JSON.stringify({ tags: {
      'trial-id': target.owner, 'vally-eval': 'true', workflow: 'workflow-runner-benchmark',
    } }), '', '', 'true'];
    const command: Command = () => responses.shift() ?? 'true';
    expect(() => cleanupOwnedGroup(command, target)).toThrow(/still exists/);
  });
});
