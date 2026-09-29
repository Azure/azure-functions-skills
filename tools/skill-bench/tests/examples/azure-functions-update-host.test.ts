import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkPorts, checkTools, parseOptions, preflight, toolCommand,
} from '../../examples/azure-functions-update/plugins/host-preflight.ts';
import type { ToolSpawn } from '../../examples/azure-functions-update/plugins/host-preflight.ts';

const workflowFile = fileURLToPath(new URL('../../../../.github/workflows/skill-benchmark.yml', import.meta.url));

const options = {
  tools: { dotnet: { args: ['--version'], version: '10.0.401' }, func: { args: ['--version'], version: '4.15.1' } },
  ports: { 'azurite-blob': 10000, 'azurite-queue': 10001 },
  readyTimeoutSeconds: 1,
};

function versions(map: Record<string, string | null>): ToolSpawn {
  return command => {
    const name = command.split(/\s/)[0];
    const value = map[name];
    return value === null || value === undefined
      ? { status: null, stdout: '', error: new Error('spawn ENOENT') }
      : { status: 0, stdout: `${value}\n` };
  };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(done => { server.close(done); })));
});

async function listen(): Promise<number> {
  const server = createServer(socket => socket.destroy());
  servers.push(server);
  await new Promise<void>(done => { server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('host-preflight example plugin', () => {
  it('accepts exact versions and refuses loose or unsafe options', () => {
    expect(parseOptions(options).tools.func.version).toBe('4.15.1');
    expect(() => parseOptions({ ...options, tools: { func: { args: ['--version'], version: '4' } } })).toThrow(/exact version/);
    expect(() => parseOptions({ ...options, tools: { 'func & calc': { args: [], version: '4.15.1' } } })).toThrow(/tool name/);
    expect(() => parseOptions({ ...options, tools: { func: { args: ['--version;calc'], version: '4.15.1' } } })).toThrow(/args/);
    expect(() => parseOptions({ ...options, ports: { azurite: 70000 } })).toThrow(/port/);
    expect(() => parseOptions({ ...options, readyTimeoutSeconds: 0 })).toThrow(/readyTimeoutSeconds/);
    expect(() => parseOptions({ ...options, extra: true })).toThrow(/unknown option/);
  });

  it('builds one command line from validated parts, with no user input', () => {
    expect(toolCommand('func', ['--version'])).toBe('func --version');
  });

  it('returns the installed versions when they match the pins', () => {
    const result = checkTools(parseOptions(options), {}, {}, versions({ dotnet: '10.0.401', func: '4.15.1' }));
    expect(result).toEqual({ tools: { dotnet: '10.0.401', func: '4.15.1' }, warnings: [] });
  });

  it('stops a paid run when a version differs from the pin', () => {
    expect(() => checkTools(parseOptions(options), {}, {}, versions({ dotnet: '10.0.401', func: '4.15.0' })))
      .toThrow(/func 4\.15\.0 is installed, but this scenario pins 4\.15\.1[\s\S]*SKILL_BENCH_ALLOW_TOOL_DRIFT=1/);
  });

  it('continues with a recorded warning when the operator allows drift', () => {
    const result = checkTools(parseOptions(options), {}, { SKILL_BENCH_ALLOW_TOOL_DRIFT: '1' },
      versions({ dotnet: '10.0.402', func: '4.15.1' }));
    expect(result.tools).toEqual({ dotnet: '10.0.402', func: '4.15.1' });
    expect(result.warnings).toEqual(['dotnet 10.0.402 is installed, but this scenario pins 10.0.401.']);
  });

  it('always stops when a tool is missing or prints no version', () => {
    const drift = { SKILL_BENCH_ALLOW_TOOL_DRIFT: '1' };
    expect(() => checkTools(parseOptions(options), {}, drift, versions({ dotnet: '10.0.401', func: null })))
      .toThrow(/cannot start func/);
    expect(() => checkTools(parseOptions(options), {}, drift, versions({ dotnet: 'unknown', func: '4.15.1' })))
      .toThrow(/dotnet printed no version/);
  });

  const sdkOptions = { ...options, installed: { dotnet: { args: ['--list-sdks'], versions: ['10.0.401', '8.0.425'] } } };
  const sdkList = (list: string): ToolSpawn => command => command === 'dotnet --list-sdks'
    ? { status: 0, stdout: list } : { status: 0, stdout: command.startsWith('dotnet') ? '10.0.401\n' : '4.15.1\n' };

  it('checks every pinned SDK in the installed list, not only the default SDK', () => {
    const list = '8.0.425 [C:\\Program Files\\dotnet\\sdk]\n10.0.401 [C:\\Program Files\\dotnet\\sdk]\n';
    expect(checkTools(parseOptions(sdkOptions), {}, {}, sdkList(list))).toEqual({
      tools: { dotnet: '10.0.401', func: '4.15.1', 'dotnet-10.0': '10.0.401', 'dotnet-8.0': '8.0.425' }, warnings: [],
    });
  });

  it('stops when a pinned SDK is missing, and accepts the same feature band only with drift allowed', () => {
    expect(() => checkTools(parseOptions(sdkOptions), {}, {}, sdkList('10.0.401 [/usr/share/dotnet/sdk]\n')))
      .toThrow(/dotnet 8\.0\.425 is not installed/);
    const drift = { SKILL_BENCH_ALLOW_TOOL_DRIFT: '1' };
    expect(() => checkTools(parseOptions(sdkOptions), {}, drift, sdkList('10.0.401 [/usr/share/dotnet/sdk]\n')))
      .toThrow(/dotnet 8\.0\.425 is not installed/);
    const result = checkTools(parseOptions(sdkOptions), {}, drift,
      sdkList('8.0.419 [/usr/share/dotnet/sdk]\n10.0.401 [/usr/share/dotnet/sdk]\n'));
    expect(result.tools['dotnet-8.0']).toBe('8.0.419');
    expect(result.warnings).toEqual(['dotnet 8.0.419 is installed, but this scenario pins 8.0.425.']);
    expect(() => parseOptions({ ...options, installed: { dotnet: { args: ['--list-sdks'], versions: ['8'] } } }))
      .toThrow(/exact version/);
  });

  it('accepts open loopback ports and names the closed one', async () => {
    const open = await listen();
    await expect(checkPorts({ blob: open }, 1_000)).resolves.toBeUndefined();
    const closed = await listen();
    await new Promise(done => { servers.pop()?.close(done); });
    await expect(checkPorts({ blob: open, queue: closed }, 300))
      .rejects.toThrow(new RegExp(`queue is not ready on 127\\.0\\.0\\.1:${closed} after 0\\.3 s`));
  });

  it('validates the options in a dry-run through the plugin object', () => {
    expect(preflight.name).toBe('host-preflight');
    expect(() => preflight.validate?.(options)).not.toThrow();
    expect(() => preflight.validate?.({ tools: {} })).toThrow(/tools/);
  });

  // The workflow is outside the tool. Skip this check when the tool is used alone.
  it.skipIf(!existsSync(workflowFile))('pins the same versions as the benchmark workflow', () => {
    const config = JSON.parse(readFileSync(fileURLToPath(new URL(
      '../../examples/azure-functions-update/skill-bench.config.json', import.meta.url)), 'utf8'));
    const host = config.skills['azure-functions-update'].plugins.preflight
      .find((item: { module: string }) => item.module.endsWith('host-preflight.ts'));
    const parsed = parseOptions(host.options);
    const pins = parsed.tools;
    const workflow = readFileSync(workflowFile, 'utf8');
    expect(workflow).toContain(`azure-functions-core-tools@${pins.func.version}`);
    expect(parsed.installed.dotnet.versions).toContain(pins.dotnet.version);
    for (const version of parsed.installed.dotnet.versions) {
      expect(workflow).toMatch(new RegExp(`dotnet-version:[\\s\\S]*${version.replaceAll('.', '\\.')}`));
    }
    expect(workflow).toMatch(/azurite@\d+\.\d+\.\d+/);
  });
});
