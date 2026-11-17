import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { buildTelemetryRuntime } from '../src/build/telemetry-runtime.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import { buildFixture, ROOT, runBootstrap, runProcess, SHELLS, shellExecutable, writeFixture } from './helpers/starter.js';

const PRELOAD = join(ROOT, 'tests', 'fixtures', 'telemetry', 'local-transport.mjs');
const INPUT = JSON.stringify({ toolName: 'skill', toolArgs: { skill: 'azure-functions-help', secret: 'private-input' } });
const requests: Array<{ path: string; body: string }> = [];
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    const bytes = Buffer.concat(chunks);
    requests.push({
      path: request.url ?? '',
      body: (request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString('utf-8'),
    });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"itemsReceived":1,"itemsAccepted":1,"errors":[]}');
  });
});
let temp: string;
let starter: string;
let port: number;
const installShell = SHELLS.includes('sh') ? 'sh' : SHELLS[0];

beforeAll(async () => {
  temp = createTempDir('af-starter-hook ');
  starter = writeFixture(buildFixture({ runtime: buildTelemetryRuntime(join(ROOT, 'templates', 'skills')) }), join(temp, 'payload'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
}, 120_000);

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  removeDir(temp);
});

function environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^https?_proxy$/i.test(key) && !/^(AZURE_FUNCTIONS_SKILLS|AZURE_MCP)_COLLECT_TELEMETRY$/.test(key)
      && key !== 'CLAUDE_PROJECT_DIR' && key !== 'COPILOT_CLI'));
  return {
    ...inherited,
    NODE_OPTIONS: `--import="${pathToFileURL(PRELOAD).href}"`,
    NODE_NO_WARNINGS: '1',
    AF_TEST_PORT: String(port),
    AF_TEST_MARKER: join(temp, 'project-code-ran'),
    AF_TEST_AZ_CALLS: join(temp, 'az-calls.jsonl'),
    ...extra,
  };
}

async function project(name: string, agent: string): Promise<string> {
  const root = join(temp, name);
  mkdirSync(join(root, '.git'), { recursive: true });
  const result = await runBootstrap(installShell, starter, { destination: root, agent });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  mkdirSync(join(root, 'src', 'nested'), { recursive: true });
  return root;
}

function installedCommand(root: string, agent: 'copilot' | 'claude' | 'codex', form: 'bash' | 'powershell'): string {
  if (agent === 'copilot') {
    const hooks = JSON.parse(readFileSync(join(root, '.github', 'hooks', 'azure-functions-skills.json'), 'utf-8')) as {
      hooks: { postToolUse: Array<{ bash: string; powershell: string }> };
    };
    return hooks.hooks.postToolUse[0][form];
  }
  const file = agent === 'claude' ? join(root, '.claude', 'settings.json') : join(root, '.codex', 'hooks.json');
  const hooks = JSON.parse(readFileSync(file, 'utf-8')) as {
    hooks: { PostToolUse: Array<{ hooks: Array<{ command: string; commandWindows?: string }> }> };
  };
  const hook = hooks.hooks.PostToolUse[0].hooks[0];
  return form === 'bash' ? hook.command : hook.commandWindows ?? '';
}

async function runHook(command: string, form: 'bash' | 'powershell', cwd: string, extra: NodeJS.ProcessEnv = {}) {
  const [file, args] = form === 'bash'
    ? [process.platform === 'win32' ? shellExecutable('sh').replace(/sh\.exe$/i, 'bash.exe') : 'bash', ['-c', command]]
    : [process.platform === 'win32' ? 'powershell' : 'pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]];
  return runProcess(file, args, { cwd, env: environment(extra), input: INPUT });
}

type Properties = Record<string, string>;
function properties(body: string): Properties {
  return (JSON.parse(body.trim()) as { data: { baseData: { properties: Properties } } }).data.baseData.properties;
}

const FORMS: Array<'bash' | 'powershell'> = ['bash', ...(process.platform === 'win32' || SHELLS.includes('pwsh') ? ['powershell' as const] : [])];

describe('starter telemetry hook', () => {
  it.each([
    ['claude', 'bash', 'claude-code'],
    ['codex', 'bash', 'codex'],
    ['copilot', 'bash', 'copilot-cli'],
    ...(FORMS.includes('powershell') ? [['codex', 'powershell', 'codex'], ['copilot', 'powershell', 'copilot-cli']] : []),
  ] as Array<['copilot' | 'claude' | 'codex', 'bash' | 'powershell', string]>)(
    'runs the installed %s %s command verbatim from a subdirectory (ST-007, ST-008)',
    async (agent, form, client) => {
      const root = await project(`project ${agent} ${form}`, agent);
      const first = requests.length;
      const result = await runHook(installedCommand(root, agent, form), form, join(root, 'src', 'nested'));
      expect(result.status, result.stderr).toBe(0);
      expect(requests.slice(first)).toHaveLength(1);
      expect(requests[first].body).not.toContain('private-input');
      expect(properties(requests[first].body)).toMatchObject({
        Plugin_ClientName: client,
        Plugin_EventType: 'skill_invocation',
        Plugin_SkillName: 'azure-functions-help',
        Plugin_Distribution: 'starter',
        Plugin_Bundle: 'functions',
      });
    }, 120_000);

  it('sends nothing when the starter preference or an environment variable opts out (ST-010)', async () => {
    const root = await project('project optout', 'claude');
    const command = installedCommand(root, 'claude', 'bash');
    const first = requests.length;
    await runHook(command, 'bash', root, { AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY: 'False' });
    writeFileSync(join(root, '.azure-functions-skills', 'telemetry.config.json'), '{"enabled": false}');
    await runHook(command, 'bash', root);
    expect(requests).toHaveLength(first);
  }, 120_000);

  it('does not load a runtime from above the project root (ST-017)', async () => {
    const parent = join(temp, 'hostile parent');
    const root = join(parent, 'project');
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(parent, '.azure-functions-skills', 'runtime'), { recursive: true });
    const marker = join(temp, 'hostile-ran');
    writeFileSync(join(parent, '.azure-functions-skills', 'runtime', 'telemetry.mjs'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran'); export async function runHook() {}\n`);
    const command = (await import('../src/starter/hooks.js')).bashHookCommand('claude');
    const first = requests.length;
    const result = await runHook(command, 'bash', root);
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(requests).toHaveLength(first);
  }, 120_000);

  it('collects a deployment observation with the installed starter runtime (ST-015)', async () => {
    const root = await project('project deploy', 'codex');
    const runtime = join(root, '.azure-functions-skills', 'runtime', 'telemetry.mjs');
    const first = requests.length;
    const result = await runProcess(process.execPath, [runtime, 'deployment-observed', '--dir', root], {
      cwd: root,
      env: environment(),
      input: JSON.stringify({ skill: 'azure-functions-deploy', operation: 'deploy', agent: 'codex', environmentName: 'private-env' }),
    });
    expect(result).toEqual({ status: 0, stdout: 'sent\n', stderr: '' });
    expect(requests.slice(first)).toHaveLength(1);
    expect(requests[first].body).toContain('azure_deployment_observed');
    for (const path of [
      join(ROOT, 'templates', 'skills', 'azure-functions-deploy', 'SKILL.md'),
      join(ROOT, 'templates', 'skills', 'azure-functions-hosted-skills', 'references', 'infra-and-deployment.md'),
    ]) {
      expect(readFileSync(path, 'utf-8'), path).toContain('.azure-functions-skills/runtime/telemetry.mjs');
    }
  }, 120_000);
});
