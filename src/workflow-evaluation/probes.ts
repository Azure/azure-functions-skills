import spawn from 'cross-spawn';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import { z } from 'zod';

export type Command = (program: string, args: string[], cwd?: string, timeoutMs?: number, env?: NodeJS.ProcessEnv) => string;
export interface AzureTarget { subscription: string; group: string; owner: string }
export interface ProbeResult { passed: true; checks: string[]; httpStatus: number; bodyDigest: string; runtimeVersion?: string }

export const runCommand: Command = (program, args, cwd, timeoutMs = 11 * 60_000, env) => {
  const result = spawn.sync(program, args, {
    cwd, env, encoding: 'utf8', shell: false, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${program} failed (${result.error?.message ?? result.status ?? 'unknown'}). Do not assume a timed-out operation was undone.`);
  }
  return result.stdout;
};

async function verifyHttp(url: string, request: typeof fetch, headers?: Record<string, string>): Promise<ProbeResult> {
  const response = await request(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (response.status !== 200) throw new Error(`HTTP probe returned ${response.status}; expected 200.`);
  if (!response.body) throw new Error('HTTP probe returned no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4096) throw new Error('HTTP probe exceeded its body limit.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (body !== 'Hello, Workflow!') throw new Error('HTTP response did not match the requested greeting.');
  return { passed: true, checks: ['http-body'], httpStatus: 200,
    bodyDigest: createHash('sha256').update(body).digest('hex') };
}

export async function probeAzure(command: Command, target: AzureTarget, request: typeof fetch = fetch): Promise<ProbeResult> {
  const query = (args: string[]): string => command('az', args, undefined, 30_000);
  const scope = ['--subscription', target.subscription, '--resource-group', target.group];
  const apps = z.array(z.object({
    name: z.string().min(1), defaultHostName: z.string().regex(/^[a-zA-Z0-9-]+\.azurewebsites\.net$/),
    httpsOnly: z.literal(true), identity: z.object({ type: z.string().regex(/SystemAssigned|UserAssigned/) }),
    serverFarmId: z.string().min(1),
    functionAppConfig: z.object({ runtime: z.object({ name: z.literal('node'), version: z.literal('22') }) }),
  })).length(1).parse(JSON.parse(query(['functionapp', 'list', ...scope, '-o', 'json'])));
  const app = apps[0];
  const plan = z.object({ sku: z.object({ name: z.literal('FC1') }) }).safeParse(
    JSON.parse(query(['appservice', 'plan', 'show', '--ids', app.serverFarmId, '--subscription', target.subscription, '-o', 'json'])));
  if (!plan.success) throw new Error('Deployment must use the FC1 plan.');
  const functionScope = [...scope, '--name', app.name, '--function-name', 'httpTrigger'];
  const fn = z.object({ config: z.object({ bindings: z.array(z.object({
    type: z.string(), authLevel: z.string().optional(),
  })) }) }).parse(JSON.parse(query(['functionapp', 'function', 'show', ...functionScope, '-o', 'json'])));
  if (!fn.config.bindings.some(binding => binding.type === 'httpTrigger' && binding.authLevel === 'function')) {
    throw new Error('HTTP trigger must retain function-level authorization.');
  }
  const keys = z.object({ default: z.string().min(1) }).parse(
    JSON.parse(query(['functionapp', 'function', 'keys', 'list', ...functionScope, '-o', 'json'])));
  const result = await verifyHttp(`https://${app.defaultHostName}/api/httpTrigger?name=Workflow`, request,
    { 'x-functions-key': keys.default });
  return { ...result, runtimeVersion: app.functionAppConfig.runtime.version,
    checks: ['node-22', 'fc1', 'https-only', 'managed-identity', 'function-auth', ...result.checks] };
}

export function cleanupOwnedGroup(command: Command, target: AzureTarget): { confirmedAbsent: true } {
  if (!/^rg-afswf-[a-z0-9-]+$/.test(target.group) || !target.owner) throw new Error('Invalid cleanup ownership target.');
  const scope = ['--subscription', target.subscription, '--name', target.group];
  const exists = (): boolean => z.boolean().parse(JSON.parse(command('az', ['group', 'exists', ...scope, '-o', 'json'])));
  if (!exists()) return { confirmedAbsent: true };
  const group = z.object({
    tags: z.record(z.string()), properties: z.object({ provisioningState: z.string() }).optional(),
  }).parse(JSON.parse(command('az', ['group', 'show', ...scope, '-o', 'json'])));
  if (group.tags['trial-id'] !== target.owner || group.tags['vally-eval'] !== 'true' ||
    group.tags.workflow !== 'workflow-runner-benchmark') throw new Error('Resource group ownership does not match; refusing cleanup.');
  if (group.properties?.provisioningState !== 'Deleting') command('az', ['group', 'delete', ...scope, '--yes', '--no-wait']);
  command('az', ['group', 'wait', ...scope, '--deleted', '--interval', '5', '--timeout', '600']);
  if (exists()) throw new Error('Resource group still exists; do not start the next trial.');
  return { confirmedAbsent: true };
}

export async function probeLocal(
  command: Command, cwd: string, request: typeof fetch = fetch,
  startHost?: (port: number) => ChildProcess,
  worker = z.object({ node: z.string().min(1), npm: z.string().min(1) }).parse({
    node: process.env.WORKFLOW_WORKER_NODE, npm: process.env.WORKFLOW_WORKER_NPM,
  }),
): Promise<ProbeResult> {
  for (const file of ['host.json', 'package.json', 'tsconfig.json', join('src', 'functions', 'httpTrigger.ts')]) {
    if (!existsSync(join(cwd, file))) throw new Error(`Required app file is missing: ${file}`);
  }
  const runtimeVersion = z.string().regex(/^v22\.\d+\.\d+$/).parse(command(worker.node, ['--version']).trim());
  const env = { ...process.env, PATH: `${dirname(worker.node)}${delimiter}${process.env.PATH ?? ''}`,
    languageWorkers__node__defaultExecutablePath: worker.node };
  command(worker.node, [worker.npm, 'run', 'build'], cwd, 60_000, env);
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('No local probe port.')); return; }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
  const host = startHost ? startHost(port) : spawn('func', ['start', '--port', String(port)], {
    cwd, env, stdio: 'ignore', detached: process.platform !== 'win32',
  });
  let closed = false;
  let startupError: Error | undefined;
  const completion = new Promise<void>(resolve => host.once('close', () => { closed = true; resolve(); }));
  host.once('error', error => { startupError = error; });
  const stopHost = async (): Promise<void> => {
    if (!closed && host.pid) {
      if (process.platform === 'win32') {
        spawn.sync('taskkill', ['/PID', String(host.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
      } else process.kill(-host.pid, 'SIGKILL');
      await Promise.race([completion, delay(5000)]);
      if (!closed) throw new Error(`Cannot confirm shutdown of owned probe process ${host.pid}.`);
    }
  };
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (startupError) throw startupError;
      if (closed) throw new Error('Local Functions host exited before verification.');
      try {
        const result = await verifyHttp(`http://127.0.0.1:${port}/api/httpTrigger?name=Workflow`, request);
        return { ...result, runtimeVersion, checks: ['node-22', 'project-files', 'build', ...result.checks] };
      } catch (error) {
        const refused = error instanceof TypeError && error.cause instanceof Error &&
          'code' in error.cause && error.cause.code === 'ECONNREFUSED';
        if (!refused || Date.now() >= deadline) throw error;
        await delay(250);
      }
    }
  } finally { await stopHost(); }
}
