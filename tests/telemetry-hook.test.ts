import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { hostname } from 'node:os';
import { createTempDir, removeDir } from './helpers/fs.js';

const ROOT = join(import.meta.dirname, '..');
const INPUT = JSON.stringify({ toolName: 'skill', toolArgs: { skill: 'azure-functions-help', secret: 'private-input' } });
const PRELOAD = join(ROOT, 'tests', 'fixtures', 'telemetry', 'local-transport.mjs');
const SHELLS = process.platform === 'win32' ? ['bash', 'powershell'] as const : ['bash'] as const;
const PUBLIC_KEY = 'a5ea7fbd-8657-4d92-8dd1-c059329b11e8';
const PUBLIC_ENDPOINT = 'https://westus2-2.in.applicationinsights.azure.com';
const requests: Array<{ path: string; method: string; originalHost: string; body: string }> = [];
const layouts: Array<{ name: string; root: string; hooks: string }> = [];
let tempDir: string;
let port: number;
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    const bytes = Buffer.concat(chunks);
    requests.push({
      path: request.url || '',
      method: request.method || '',
      originalHost: String(request.headers['x-af-test-original-host'] || ''),
      body: (request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString('utf-8'),
    });
    if (request.url === '/test-hang') return;
    if (request.url === '/test-fail') {
      response.writeHead(500);
      response.end('Test transport failure');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"itemsReceived":1,"itemsAccepted":1,"errors":[]}');
  });
});

beforeAll(async () => {
  tempDir = createTempDir('af-skills-bundled runtime ');
  const built = join(tempDir, 'built assets');
  const result = spawnSync(process.execPath, [join(ROOT, 'lib', 'build', 'build.js'), '--dist-dir', built], {
    cwd: ROOT, encoding: 'utf-8', timeout: 30_000,
  });
  expect(result.status, result.stderr).toBe(0);
  const plugin = join(built, 'plugin', 'azure-functions-skills');
  layouts.push({ name: 'plugin', root: plugin, hooks: join(plugin, 'hooks') });
  for (const target of ['ghcp', 'claude', 'codex'] as const) {
    const root = join(built, 'workspace', target);
    layouts.push({
      name: target,
      root,
      hooks: join(root, target === 'ghcp' ? '.github' : target === 'claude' ? '.claude' : '.codex', 'hooks'),
    });
  }
  for (const layout of layouts) poisonWorkspace(layout.root);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  removeDir(tempDir);
});

function poisonWorkspace(root: string): void {
  writeFileSync(join(root, '.npmrc'), '@azure:registry=http://127.0.0.1:9/\nregistry=http://127.0.0.1:9/\nnode-options=--import=./hostile-config.mjs\n');
  const poison = 'import { writeFileSync } from "node:fs"; writeFileSync(process.env.AF_TEST_MARKER, "executed"); throw new Error("Project code ran");';
  writeFileSync(join(root, 'hostile-config.mjs'), poison);
  writeFileSync(join(root, 'applicationinsights.json'), '{"enableAutoCollectRequests":true,"enableAutoCollectConsole":true}');
  writeFileSync(join(root, 'applicationinsights.config.js'), poison);
  writeFileSync(join(root, 'package.json'), '{"name":"hostile-project","version":"99.0.0","scripts":{"preinstall":"node hostile-config.mjs"}}');
  for (const name of ['applicationinsights', 'applicationinsights-native-metrics', 'cls-hooked', 'diagnostic-channel']) {
    const dir = join(root, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', main: './index.js' }));
    writeFileSync(join(dir, 'index.js'), poison);
  }
  const tools = join(root, 'fake tools');
  mkdirSync(tools);
  for (const tool of ['npm', 'npx']) {
    writeFileSync(join(tools, tool), '#!/bin/sh\nprintf invoked > "$AF_TEST_MARKER"\nexit 1\n');
    chmodSync(join(tools, tool), 0o755);
    writeFileSync(join(tools, `${tool}.cmd`), '@echo off\r\necho invoked>"%AF_TEST_MARKER%"\r\nexit /b 1\r\n');
  }
}

async function run(
  file: string,
  args: string[],
  root: string,
  input: string,
  environment: NodeJS.ProcessEnv = {},
  cwd: string = root,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^https?_proxy$/i.test(key)));
  const child = spawn(file, args, {
    cwd,
    windowsHide: true,
    env: {
      ...inherited,
      PATH: `${join(root, 'fake tools')}${delimiter}${process.env.PATH || ''}`,
      NODE_PATH: join(root, 'node_modules'),
      NODE_OPTIONS: `--import="${pathToFileURL(PRELOAD).href}"`,
      NODE_NO_WARNINGS: '1',
      AF_TEST_PORT: String(port),
      AF_TEST_MARKER: join(root, 'project-code-ran'),
      AF_TEST_AZ_CALLS: join(root, 'az-calls.jsonl'),
      AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY: 'true',
      AZURE_MCP_COLLECT_TELEMETRY: 'true',
      APPLICATIONINSIGHTS_CONNECTION_STRING:
        'InstrumentationKey=00000000-0000-4000-8000-000000000099;IngestionEndpoint=https://project.invalid',
      ...environment,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.stdin.on('error', () => { /* Opt-out can close stdin before input is read. */ });
  const timer = setTimeout(() => child.kill(), 35_000);
  child.stdin.end(input);
  try {
    const [status] = await once(child, 'close') as [number | null];
    expect(existsSync(join(root, 'project-code-ran'))).toBe(false);
    return { status, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

function hookArgs(shell: 'bash' | 'powershell', hooks: string): string[] {
  const path = join(hooks, 'scripts', `track-telemetry.${shell === 'bash' ? 'sh' : 'ps1'}`);
  return shell === 'bash' ? [path] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path];
}

describe('distributed telemetry runtime', () => {
  it('bundles the public key and endpoint without a public connection string', () => {
    for (const layout of layouts) {
      const bundle = readFileSync(join(layout.hooks, 'runtime', 'telemetry.mjs'), 'utf-8');
      expect(bundle.includes(PUBLIC_KEY), layout.name).toBe(true);
      expect(bundle.includes(PUBLIC_ENDPOINT), layout.name).toBe(true);
      expect(bundle.includes(`InstrumentationKey=${PUBLIC_KEY}`), layout.name).toBe(false);
    }
  });

  it.each(SHELLS)('%s isolates the test transport from inherited proxy settings', async shell => {
    const layout = layouts[0];
    const first = requests.length;
    vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:9');
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:9');
    try {
      const result = await run(shell === 'bash' ? 'bash' : 'pwsh',
        hookArgs(shell, layout.hooks), layout.root, INPUT);
      expect(result).toEqual({ status: 0, stdout: expect.stringMatching(/^\{"continue":true\}\r?\n$/), stderr: '' });
      expect(requests.slice(first)).toHaveLength(1);
      expect(requests[first].path).toBe('/v2/track');
      expect(requests[first].originalHost).toBe(new URL(PUBLIC_ENDPOINT).hostname);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.skipIf(process.platform !== 'win32')('PowerShell hooks use the first Node application on PATH', async () => {
    const layout = layouts[0];
    const shim = join(layout.root, 'fake tools', 'node.cmd');
    const marker = join(layout.root, 'selected-node');
    writeFileSync(shim, `@echo off\r\necho selected>"%AF_TEST_NODE_SELECTION%"\r\n"${process.execPath}" %*\r\n`);
    try {
      const first = requests.length;
      const result = await run('pwsh', hookArgs('powershell', layout.hooks), layout.root, INPUT, {
        AF_TEST_NODE_SELECTION: marker,
      });
      expect(result).toEqual({ status: 0, stdout: expect.stringMatching(/^\{"continue":true\}\r?\n$/), stderr: '' });
      expect(requests.slice(first)).toHaveLength(1);
      expect(readFileSync(marker, 'utf-8').trim()).toBe('selected');
    } finally {
      rmSync(shim);
      rmSync(marker, { force: true });
    }
  });

  it.each(SHELLS)('%s hooks send through the bundled SDK in all layouts', async shell => {
    for (const layout of layouts) {
      const first = requests.length;
      for (const input of [
        INPUT,
        JSON.stringify({ toolName: 'skill', toolArgs: JSON.stringify({ skill: 'azure-functions-help', secret: 'private-input' }) }),
        JSON.stringify({ toolName: 'view', toolArgs: JSON.stringify({ path: '.github/skills/azure-functions-help/SKILL.md' }) }),
        JSON.stringify({ tool_name: 'functions_project_get', hook_event_name: 'PostToolUse' }),
        JSON.stringify({
          tool_name: 'Read',
          tool_input: { file_path: '/repo/.agents/skills/azure-functions-hosted-skills/references/infra-and-deployment.md' },
        }),
      ]) {
        const result = await run(shell === 'bash' ? 'bash' : 'pwsh', hookArgs(shell, layout.hooks), layout.root, input);
        expect(result, layout.name).toEqual({ status: 0, stdout: expect.stringMatching(/^\{"continue":true\}\r?\n$/), stderr: '' });
      }
      const sent = requests.slice(first);
      expect(sent, layout.name).toHaveLength(5);
      for (const request of sent) {
        expect(request.path).toBe('/v2/track');
        expect(request.method).toBe('POST');
        expect(request.originalHost).toBe(new URL(PUBLIC_ENDPOINT).hostname);
        expect(request.body).not.toContain('private-input');
        expect(request.body).not.toContain(hostname());
        expect(request.body).not.toContain('99.0.0');
        const envelope = JSON.parse(request.body.trim()) as {
          iKey: string;
          tags: Record<string, string>;
          data: { baseType: string; baseData: { name: string; properties: Record<string, string> } };
        };
        expect(envelope.iKey).toBe(PUBLIC_KEY);
        expect(Object.keys(envelope.tags)).toEqual(['ai.internal.sdkVersion']);
        expect(envelope.tags['ai.internal.sdkVersion']).toBe('node:1.8.10');
        expect(envelope.data.baseType).toBe('EventData');
        expect(envelope.data.baseData.name).toBe('AzureFunctionsSkillsPluginExecuted');
        for (const property of Object.keys(envelope.data.baseData.properties)) {
          expect([
            'Plugin_ClientName', 'Plugin_EventType', 'Plugin_PluginName', 'Plugin_Timestamp',
            'Plugin_SkillName', 'Plugin_ToolName', 'Plugin_FileReference',
          ]).toContain(property);
        }
      }
      expect(existsSync(join(layout.root, 'az-calls.jsonl'))).toBe(false);
    }
  }, 90_000);

  it.each(SHELLS)('%s hooks honor ancestor opt-out in nested directories for all layouts', async shell => {
    const project = join(tempDir, `nested project ${shell}`);
    const nested = join(project, 'infra', 'nested');
    mkdirSync(nested, { recursive: true });
    poisonWorkspace(project);
    mkdirSync(join(nested, '.github', 'hooks'), { recursive: true });
    writeFileSync(join(nested, '.github', 'hooks', 'telemetry.config.json'), '{"enabled":true}');
    const first = requests.length;
    for (const host of ['.github', '.claude', '.codex']) {
      const config = join(project, host, 'hooks', 'telemetry.config.json');
      mkdirSync(join(project, host, 'hooks'), { recursive: true });
      try {
        for (const content of ['{"enabled":false}', '{invalid-config']) {
          writeFileSync(config, content);
          for (const layout of layouts) {
            const result = await run(shell === 'bash' ? 'bash' : 'pwsh',
              hookArgs(shell, layout.hooks), project, INPUT, {}, nested);
            expect(result).toEqual({
              status: 0, stdout: expect.stringMatching(/^\{"continue":true\}\r?\n$/), stderr: '',
            });
          }
          expect(requests).toHaveLength(first);
        }
      } finally {
        rmSync(config);
      }
    }
    // No disabled ancestor remains: nested execution can send again.
    const result = await run(shell === 'bash' ? 'bash' : 'pwsh',
      hookArgs(shell, layouts[0].hooks), project, INPUT, {}, nested);
    expect(result.status).toBe(0);
    expect(requests.slice(first)).toHaveLength(1);
  }, 60_000);

  it.each(SHELLS)('%s hooks accept a full bundled Read response but bound hook input', async shell => {
    const layout = layouts[0];
    const content = readFileSync(join(ROOT, 'templates', 'skills', 'azure-functions-hosted-skills', 'SKILL.md'), 'utf-8');
    const event = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/repo/.agents/skills/azure-functions-hosted-skills/SKILL.md' },
      tool_response: { content: `${content}\nprivate-output-marker` },
    };
    const input = JSON.stringify(event);
    expect(Buffer.byteLength(input)).toBeGreaterThan(16 * 1024);
    const first = requests.length;
    const result = await run(shell === 'bash' ? 'bash' : 'pwsh', hookArgs(shell, layout.hooks), layout.root, input);
    expect(result).toEqual({ status: 0, stdout: expect.stringMatching(/^\{"continue":true\}\r?\n$/), stderr: '' });
    expect(requests.slice(first)).toHaveLength(1);
    expect(requests[first].body).toContain('azure-functions-hosted-skills');
    expect(requests[first].body).not.toContain('private-output-marker');
    const atLimit = input + ' '.repeat(1024 * 1024 - Buffer.byteLength(input));
    expect(Buffer.byteLength(atLimit)).toBe(1024 * 1024);
    const accepted = await run(shell === 'bash' ? 'bash' : 'pwsh', hookArgs(shell, layout.hooks), layout.root, atLimit);
    expect(accepted.status).toBe(0);
    expect(requests.slice(first)).toHaveLength(2);
    const oversized = `${atLimit} `;
    const rejected = await run(shell === 'bash' ? 'bash' : 'pwsh', hookArgs(shell, layout.hooks), layout.root, oversized);
    expect(rejected.status).toBe(0);
    expect(rejected.stdout).toContain('{"continue":true}');
    expect(requests.slice(first)).toHaveLength(2);
  }, 30_000);

  it('keeps the deployment input limit at 16 KiB before any ARM request', async () => {
    const layout = layouts[0];
    const callsPath = join(layout.root, 'az-calls.jsonl');
    const input = JSON.stringify({
      skill: 'azure-functions-deploy', operation: 'deploy', agent: 'codex', environmentName: 'private-env',
    });
    const args = [
      join(layout.hooks, 'runtime', 'telemetry.mjs'), 'deployment-observed',
    ];
    const accepted = await run(process.execPath, args, layout.root, input.padEnd(16 * 1024, ' '));
    expect(accepted).toEqual({ status: 0, stdout: 'sent\n', stderr: '' });
    const before = readFileSync(callsPath, 'utf-8');
    const first = requests.length;
    const result = await run(process.execPath, args, layout.root, input.padEnd(16 * 1024 + 1, ' '));
    expect(result).toEqual({ status: 0, stdout: 'failed\n', stderr: '' });
    expect(requests).toHaveLength(first);
    expect(existsSync(callsPath) ? readFileSync(callsPath, 'utf-8') : '').toBe(before);
  });

  it.each(SHELLS)('%s hooks preserve success for opt-out and invalid input', async shell => {
    const layout = layouts[0];
    const first = requests.length;
    for (const environment of [
      { AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY: 'FALSE' },
      { AZURE_MCP_COLLECT_TELEMETRY: 'false' },
    ]) {
      await run(shell === 'bash' ? 'bash' : 'pwsh', hookArgs(shell, layout.hooks), layout.root, INPUT, environment);
    }
    for (const content of ['{"enabled":false}', '{invalid-config']) {
      writeFileSync(join(layout.hooks, 'telemetry.config.json'), content);
      await run(shell === 'bash' ? 'bash' : 'pwsh', hookArgs(shell, layout.hooks), layout.root, INPUT);
    }
    writeFileSync(join(layout.hooks, 'telemetry.config.json'), '{"enabled":true}');
    for (const input of ['', '{invalid-json', 'x'.repeat(16 * 1024 + 1), '{"toolName":"unrelated"}']) {
      const result = await run(shell === 'bash' ? 'bash' : 'pwsh', hookArgs(shell, layout.hooks), layout.root, input);
      expect(result).toEqual({ status: 0, stdout: expect.stringContaining('{"continue":true}'), stderr: '' });
    }
    expect(requests).toHaveLength(first);
  }, 60_000);

  it.each(SHELLS)('%s runs both skill-owned observations with local payloads in all layouts', async shell => {
    for (const layout of layouts) {
      const callsPath = join(layout.root, 'az-calls.jsonl');
      const before = existsSync(callsPath) ? readFileSync(callsPath, 'utf-8') : '';
      for (const skill of ['azure-functions-deploy', 'azure-functions-hosted-skills']) {
        const first = requests.length;
        const runtime = join(layout.hooks, 'runtime', 'telemetry.mjs');
        const args = shell === 'bash'
          ? ['-c', 'node "$AF_TEST_RUNTIME" deployment-observed --dir "$AF_TEST_WORKSPACE"']
          : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& node $env:AF_TEST_RUNTIME deployment-observed --dir $env:AF_TEST_WORKSPACE'];
        const result = await run(shell === 'bash' ? 'bash' : 'pwsh', args, layout.root, JSON.stringify({
          skill, operation: 'deploy', agent: 'copilot-cli', environmentName: 'private-env',
        }), { AF_TEST_RUNTIME: runtime, AF_TEST_WORKSPACE: layout.root });
        expect(result, layout.name).toEqual({ status: 0, stdout: 'sent\n', stderr: '' });
        expect(requests.slice(first)).toHaveLength(1);
        expect(requests[first].originalHost).toBe(new URL(PUBLIC_ENDPOINT).hostname);
        const body = requests[first].body;
        expect(body).toContain('azure_deployment_observed');
        expect(body).not.toContain('private-env');
        expect(body).not.toContain('/subscriptions/');
        expect(body).not.toContain(hostname());
        const envelope = JSON.parse(body.trim()) as {
          iKey: string;
          data: { baseData: { properties: Record<string, string> } };
        };
        expect(envelope.iKey).toBe(PUBLIC_KEY);
        expect(Object.keys(envelope.data.baseData.properties).sort()).toEqual([
          'agent', 'deploymentKind', 'operation', 'resourceTypes', 'result', 'skill', 'skillsVersion',
        ]);
      }
      const calls = readFileSync(callsPath, 'utf-8').slice(before.length);
      expect(calls.trim().split('\n')).toHaveLength(4);
    }
  }, 60_000);

  it('checks workspace opt-out before ARM queries and reports categorical failures', async () => {
    const layout = layouts[0];
    const runtime = join(layout.hooks, 'runtime', 'telemetry.mjs');
    const args = [runtime, 'deployment-observed', '--dir', layout.root];
    const config = join(layout.root, '.github', 'hooks', 'telemetry.config.json');
    mkdirSync(join(layout.root, '.github', 'hooks'), { recursive: true });
    writeFileSync(config, '{"enabled":false}');
    const callsPath = join(layout.root, 'az-calls.jsonl');
    const before = existsSync(callsPath) ? readFileSync(callsPath, 'utf-8') : '';
    const first = requests.length;
    const input = JSON.stringify({ skill: 'azure-functions-deploy', operation: 'deploy', agent: 'codex', environmentName: 'private-env' });
    expect((await run(process.execPath, args, layout.root, input)).stdout).toBe('disabled\n');
    rmSync(config);
    expect((await run(process.execPath, args, layout.root, input, { AF_TEST_ARM_FAIL: '1' })).stdout).toBe('skipped\n');
    expect((await run(process.execPath, args, layout.root, '{invalid')).stdout).toBe('failed\n');
    expect(requests).toHaveLength(first);
    expect(existsSync(callsPath) ? readFileSync(callsPath, 'utf-8') : '').toBe(before);
  });

  it('drains the observation status line before exit', async () => {
    const layout = layouts[0];
    const result = await run(process.execPath, [
      join(layout.hooks, 'runtime', 'telemetry.mjs'), 'deployment-observed',
    ], layout.root, '', {
      AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY: 'false',
      AF_TEST_DELAY_STDOUT: '1',
    });
    expect(result).toEqual({ status: 0, stdout: 'disabled\n', stderr: '' });
  });

  it.each(SHELLS)('%s hooks do not use a fallback if the payload or Node is absent', async shell => {
    const layout = layouts[0];
    const first = requests.length;
    const runtime = join(layout.hooks, 'runtime', 'telemetry.mjs');
    const saved = readFileSync(runtime);
    rmSync(runtime);
    try {
      const result = await run(shell === 'bash' ? 'bash' : 'pwsh', hookArgs(shell, layout.hooks), layout.root, INPUT);
      expect(result.stdout).toContain('{"continue":true}');
      expect(result.status).toBe(0);
    } finally {
      writeFileSync(runtime, saved);
    }
    const missingNode = join(layout.root, 'no node');
    mkdirSync(missingNode, { recursive: true });
    // Invoke the shell by absolute path, but give it no Node or package tools.
    const commandName = shell === 'bash' ? 'bash' : 'pwsh';
    const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [commandName], { encoding: 'utf-8' });
    expect(lookup.status).toBe(0);
    const command = lookup.stdout.trim().split(/\r?\n/)[0];
    const result = await run(command, hookArgs(shell, layout.hooks), layout.root, INPUT, { PATH: missingNode });
    expect(result.stdout).toContain('{"continue":true}');
    expect(result.status).toBe(0);
    expect(requests).toHaveLength(first);
  }, 30_000);

  it('runs each plugin host hook registration from a path with spaces', async () => {
    const layout = layouts[0];
    const registrations = [
      ['copilot-hooks.json', '${PLUGIN_ROOT}', 'bash'],
      ['hooks.json', '${CLAUDE_PLUGIN_ROOT}', 'command'],
      ['cursor-hooks.json', '${CURSOR_PLUGIN_ROOT}', 'command'],
    ];
    for (const [file, variable, field] of registrations) {
      const manifest = readFileSync(join(layout.hooks, file), 'utf-8');
      const match = manifest.match(new RegExp(`"${field}": ("(?:[^"\\\\]|\\\\.)*")`));
      expect(match).not.toBeNull();
      const command = (JSON.parse(match![1]) as string).replace(variable, layout.root);
      const first = requests.length;
      const result = await run('bash', ['-c', command], layout.root, INPUT);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('{"continue":true}');
      expect(requests.slice(first)).toHaveLength(1);
    }
  }, 30_000);

  it.each(SHELLS)('%s hooks do not retry a failed or stalled send', async shell => {
    const layout = layouts[0];
    for (const mode of ['fail', 'hang']) {
      const first = requests.length;
      const start = Date.now();
      const result = await run(shell === 'bash' ? 'bash' : 'pwsh', hookArgs(shell, layout.hooks), layout.root, INPUT, {
        AF_TEST_TRANSPORT: mode,
      });
      expect(result).toEqual({ status: 0, stdout: expect.stringContaining('{"continue":true}'), stderr: '' });
      expect(Date.now() - start).toBeLessThan(9_000);
      expect(requests.slice(first)).toHaveLength(1);
    }
  }, 30_000);
});
