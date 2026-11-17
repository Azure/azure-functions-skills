import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import {
  buildFixture,
  powerShellScriptBlock,
  runProcess,
  SHELLS,
  shellExecutable,
  toShPath,
  writeFixture,
  type Shell,
} from './helpers/starter.js';

const SHA = 'c'.repeat(40);
const PINNED = 'd'.repeat(40);
const KEY = '00000000-0000-4000-8000-000000000123';
let temp: string;
let port: number;
let lookup: 'ok' | 'rate-limited' = 'ok';
const archives = new Map<string, Buffer>();
const events: Array<Record<string, unknown>> = [];
const lookups: string[] = [];
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    const url = request.url ?? '';
    if (url === '/repos/contoso/starter-repo/commits/main') {
      lookups.push(url);
      if (lookup === 'rate-limited') {
        response.writeHead(403);
        response.end('rate limited');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end(SHA);
      return;
    }
    const archive = url.match(/^\/contoso\/starter-repo\/tar\.gz\/([0-9a-f]{40})$/);
    if (archive && archives.has(archive[1])) {
      response.writeHead(200, { 'Content-Type': 'application/gzip' });
      response.end(archives.get(archive[1]));
      return;
    }
    if (url === '/v2/track' && request.method === 'POST') {
      events.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"itemsReceived":1,"itemsAccepted":1,"errors":[]}');
      return;
    }
    response.writeHead(404);
    response.end();
  });
});

function makeArchive(name: string, commit: string, engine?: string): void {
  const base = `http://127.0.0.1:${port}`;
  const files = buildFixture({ endpoints: { api: base, codeload: base, telemetry: base, instrumentationKey: KEY, httpsOnly: false } });
  if (engine) files.set('engine-version', Buffer.from(`${engine}\n`));
  const stage = join(temp, `stage ${name}`);
  writeFixture(files, join(stage, `starter-repo-${commit}`, 'starter'));
  writeFileSync(join(stage, `starter-repo-${commit}`, 'README.md'), 'outside the payload');
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const output = join(temp, `${name}.tar.gz`);
  const result = spawnSync(tar, ['-czf', output, `starter-repo-${commit}`], { cwd: stage, encoding: 'utf-8' });
  expect(result.status, result.stderr).toBe(0);
  archives.set(commit, readFileSync(output));
  if (name === 'main') writeFileSync(join(temp, 'install.sh'), files.get('install.sh') as Buffer);
  if (name === 'main') writeFileSync(join(temp, 'install.ps1'), files.get('install.ps1') as Buffer);
}

beforeAll(async () => {
  temp = createTempDir('af-starter-install ');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
  makeArchive('main', SHA);
  makeArchive('engine', PINNED, '99');
}, 120_000);

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  removeDir(temp);
});

let counter = 0;
function destination(name: string): string {
  counter += 1;
  const path = join(temp, `app ${counter} ${name}`);
  mkdirSync(path);
  return path;
}

async function install(shell: Shell, target: string, options: { ref?: string; noTelemetry?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^https?_proxy$/i.test(key) && !/^(AZURE_FUNCTIONS_SKILLS|AZURE_MCP)_COLLECT_TELEMETRY$/.test(key)));
  const env = { ...inherited, NO_PROXY: '127.0.0.1', ...options.env };
  const result = shell === 'sh'
    ? await runProcess(shellExecutable('sh'), [
      toShPath(join(temp, 'install.sh')), '--bundle', 'functions', '--agent', 'claude', '--destination', toShPath(target), '--json',
      ...(options.ref ? ['--ref', options.ref] : []), ...(options.noTelemetry ? ['--no-telemetry'] : []),
    ], { env })
    : await runProcess(shellExecutable(shell), powerShellScriptBlock(shell, join(temp, 'install.ps1'), {
      Bundle: 'functions', Agent: 'claude', Destination: target, Json: true,
      ...(options.ref ? { Ref: options.ref } : {}), NoTelemetry: options.noTelemetry ?? false,
    }, '{{CALL}}; exit $LASTEXITCODE'), { env });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
  } catch {
    // Asserted by the caller.
  }
  return { ...result, json };
}

describe.each(SHELLS)('starter installer (%s)', (shell: Shell) => {
  it('resolves, downloads, applies, and sends one setup event (ST-003, ST-009)', async () => {
    lookup = 'ok';
    const target = destination('fresh');
    const first = events.length;
    const result = await install(shell, target);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.json).toMatchObject({ ready: true, sourceCommit: SHA, error: null });
    expect(events.slice(first)).toHaveLength(1);
    const event = events[first];
    expect(Object.keys(event).sort()).toEqual(['data', 'iKey', 'name', 'time']);
    expect(event).toMatchObject({
      name: 'Microsoft.ApplicationInsights.Event',
      iKey: KEY,
      data: {
        baseType: 'EventData',
        baseData: {
          ver: 2,
          name: 'AzureFunctionsSkillsStarterSetup',
          properties: {
            distribution: 'starter', bundle: 'functions', template: 'none', agent: 'claude-code',
            os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
            skillsVersion: '0.0.7-preview',
          },
        },
      },
    });
    expect(String(event.time)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(readFileSync(join(target, '.azure-functions-skills', 'functions.json'), 'utf-8')).toContain(`"commit": "${SHA}"`);

    const again = await install(shell, target);
    expect(again.status).toBe(0);
    expect(events.slice(first)).toHaveLength(1);
  }, 240_000);

  it('sends no setup event with the flag or an environment opt-out (ST-010)', async () => {
    lookup = 'ok';
    const first = events.length;
    expect((await install(shell, destination('flag'), { noTelemetry: true })).status).toBe(0);
    expect((await install(shell, destination('env'), { env: { AZURE_MCP_COLLECT_TELEMETRY: 'FALSE' } })).status).toBe(0);
    expect(events).toHaveLength(first);
  }, 240_000);

  it('reports rate limiting and an engine mismatch with their codes (ST-019)', async () => {
    lookup = 'rate-limited';
    const limited = await install(shell, destination('rate'));
    expect(limited.status).toBe(2);
    expect(limited.json).toMatchObject({ ready: false, error: { code: 'rate-limited' } });
    lookup = 'ok';
    const lookupsBefore = lookups.length;
    const mismatch = await install(shell, destination('engine'), { ref: PINNED });
    expect(mismatch.status).toBe(2);
    expect(mismatch.json).toMatchObject({ error: { code: 'engine-mismatch' } });
    expect(lookups).toHaveLength(lookupsBefore);
    const invalid = await install(shell, destination('ref'), { ref: 'feature' });
    expect(invalid.status).toBe(2);
    expect(invalid.json).toMatchObject({ error: { code: 'invalid-argument' } });
  }, 240_000);
});
