import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { delimiter, join } from 'node:path';
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
const OTHER = 'e'.repeat(40);
let lookup: 'ok' | 'rate-limited' = 'ok';
let refs: 'ok' | 'fail' = 'ok';
const archives = new Map<string, Buffer>();
const events: Array<Record<string, unknown>> = [];
const lookups: string[] = [];
const refLookups: string[] = [];
/** Every request the fake GitHub and telemetry server saw, for failure messages. */
const requestLog: Array<{ at: number; method: string; url: string; bytes: number; note?: string }> = [];

/** One pkt-line of the Git smart HTTP protocol. */
function pkt(line: string): string {
  return (Buffer.byteLength(line) + 4).toString(16).padStart(4, '0') + line;
}

/** A ref advertisement with decoys around the wanted branch. */
const ADVERTISEMENT = '001e# service=git-upload-pack\n0000'
  + pkt(`${OTHER} HEAD\0multi_ack symref=HEAD:refs/heads/main agent=git/test\n`)
  + pkt(`${OTHER} refs/heads/feature/main\n`)
  + pkt(`${SHA} refs/heads/main\n`)
  + pkt(`${OTHER} refs/heads/main-old\n`)
  + pkt(`${OTHER} refs/tags/main\n`)
  + '0000';

const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const started = Date.now();
  request.on('aborted', () => requestLog.push({ at: Date.now(), method: request.method ?? '', url: request.url ?? '', bytes: 0, note: `aborted after ${Date.now() - started} ms` }));
  request.on('end', () => {
    const url = request.url ?? '';
    requestLog.push({ at: Date.now(), method: request.method ?? '', url, bytes: Buffer.concat(chunks).length });
    if (url === '/contoso/starter-repo.git/info/refs?service=git-upload-pack') {
      refLookups.push(url);
      if (refs === 'fail') {
        response.writeHead(503);
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' });
      response.end(ADVERTISEMENT);
      return;
    }
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
      try {
        events.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>);
      } catch (error) {
        requestLog[requestLog.length - 1].note = `unparsable body: ${String(error)}`;
      }
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
  const files = buildFixture({ endpoints: { api: base, codeload: base, git: base, telemetry: base, instrumentationKey: KEY, httpsOnly: false } });
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

/**
 * A `curl` on the PATH that runs the real one and logs each call's URL and exit
 * code, so a missing setup event on CI shows whether the installer sent it.
 */
function curlLogger(name: string): { path: string; log: string } {
  const directory = join(temp, `curl ${name}`);
  mkdirSync(directory);
  const log = join(directory, 'calls.log');
  writeFileSync(join(directory, 'curl'), [
    '#!/bin/sh',
    'PATH=${PATH#*:}',
    'for argument in "$@"; do url=$argument; done',
    'started=$(date +%s)',
    'curl "$@"',
    'status=$?',
    `printf '%s exit=%s seconds=%s\\n' "$url" "$status" "$(( $(date +%s) - started ))" >> '${toShPath(log)}'`,
    'exit "$status"',
    '',
  ].join('\n'), { mode: 0o755 });
  return { path: directory, log };
}

async function install(shell: Shell, target: string, options: { ref?: string; noTelemetry?: boolean; env?: NodeJS.ProcessEnv; prependPath?: string } = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^https?_proxy$/i.test(key) && !/^(AZURE_FUNCTIONS_SKILLS|AZURE_MCP)_COLLECT_TELEMETRY$/.test(key)
      && !(options.prependPath && key.toUpperCase() === 'PATH')));
  const env: NodeJS.ProcessEnv = { ...inherited, NO_PROXY: '127.0.0.1', ...options.env };
  if (options.prependPath) env.PATH = [options.prependPath, process.env.PATH ?? process.env.Path ?? ''].join(delimiter);
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
    const logStart = requestLog.length;
    const curl = shell === 'sh' ? curlLogger('fresh') : undefined;
    const started = Date.now();
    const result = await install(shell, target, { prependPath: curl?.path });
    const finished = Date.now();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.json).toMatchObject({ ready: true, sourceCommit: SHA, error: null });
    const diagnostics = JSON.stringify({
      installMs: finished - started,
      requests: requestLog.slice(logStart).map(entry => ({ ...entry, at: entry.at - started })),
      stderr: result.stderr,
      curl: curl && existsSync(curl.log) ? readFileSync(curl.log, 'utf-8') : 'not logged',
    });
    expect(events.slice(first), diagnostics).toHaveLength(1);
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

  it('resolves the branch from the Git ref advertisement when the API is rate limited (ST-019)', async () => {
    lookup = 'rate-limited';
    refs = 'ok';
    const apiBefore = lookups.length;
    const refsBefore = refLookups.length;
    const result = await install(shell, destination('fallback'), { noTelemetry: true });
    lookup = 'ok';
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.json).toMatchObject({ ready: true, sourceCommit: SHA, error: null });
    expect(lookups.length - apiBefore).toBe(1);
    expect(refLookups.length - refsBefore).toBe(1);
  }, 240_000);

  it('does not use the Git ref advertisement when the API answers', async () => {
    lookup = 'ok';
    const refsBefore = refLookups.length;
    expect((await install(shell, destination('api'), { noTelemetry: true })).status).toBe(0);
    expect(refLookups).toHaveLength(refsBefore);
  }, 240_000);

  it('reports rate limiting and an engine mismatch with their codes (ST-019)', async () => {
    lookup = 'rate-limited';
    refs = 'fail';
    const limited = await install(shell, destination('rate'));
    refs = 'ok';
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
