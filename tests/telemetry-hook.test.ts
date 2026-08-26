import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTempDir, removeDir } from './helpers/fs.js';
import { installLocalSkills } from '../src/setup/index.js';

const ROOT = join(import.meta.dirname, '..');
const TEMP_DIRS: string[] = [];
const POWERSHELL_PROCESS_TIMEOUT_MS = 45_000;
const HOOK_TEST_TIMEOUT_MS = process.platform === 'win32' ? 50_000 : 5_000;
const TEST_REGISTRY = 'https://npm-user:npm-password@example.test/npm?token=registry-secret';
const HOOK_INPUT = JSON.stringify({
  toolName: 'skill',
  sessionId: 'session-123',
  toolArgs: {
    skill: 'azure-functions-help',
    path: 'customer-secret.txt',
  },
});

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('telemetry hook transport', () => {
  it('sends only sanitized fields and ignores a failing package command', () => {
    const tempDir = createTempDir('af-skills-hook-');
    TEMP_DIRS.push(tempDir);
    const capturePath = join(tempDir, 'payload.json');
    const argsPath = join(tempDir, 'args.json');
    const captureScript = join(tempDir, 'capture.mjs');
    writeFileSync(captureScript, [
      "import { writeFileSync } from 'node:fs';",
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      "writeFileSync(process.env.TELEMETRY_CAPTURE, input);",
      "writeFileSync(process.env.TELEMETRY_ARGS, JSON.stringify(process.argv.slice(2)));",
      "process.exit(Number.parseInt(process.env.TELEMETRY_EXIT_CODE || '0', 10));",
      '',
    ].join('\n'));

    const environment = {
      ...process.env,
      COPILOT_CLI: '1',
      FAKE_NPX_CAPTURE: captureScript,
      TELEMETRY_CAPTURE: capturePath,
      TELEMETRY_ARGS: argsPath,
      TELEMETRY_EXIT_CODE: '17',
      PATH: `${tempDir}${delimiter}${process.env.PATH || ''}`,
    };

    const result = process.platform === 'win32'
      ? runPowerShellHook(tempDir, environment)
      : runShellHook(tempDir, environment);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"continue":true}');
    expect(JSON.parse(readFileSync(argsPath, 'utf-8'))).toEqual([
      '-y',
      '@azure/functions-skills@__PACKAGE_VERSION__',
      'telemetry',
    ]);
    expect(JSON.parse(readFileSync(capturePath, 'utf-8'))).toEqual({
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      eventType: 'skill_invocation',
      clientName: 'copilot-cli',
      pluginName: 'azure-functions-skills',
      correlationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      pluginVersion: '__PACKAGE_VERSION__',
      sessionId: 'session-123',
      skillName: 'azure-functions-help',
    });
  }, HOOK_TEST_TIMEOUT_MS);

  it('does not invoke the package command for a workspace-local opt-out', async () => {
    const tempDir = createTempDir('af-skills-hook-opt-out-');
    TEMP_DIRS.push(tempDir);
    await installLocalSkills({
      targetDir: tempDir,
      agents: ['ghcp'],
      telemetryEnabled: false,
      checkForUpdates: false,
    });

    const capturePath = join(tempDir, 'payload.json');
    const environment = {
      ...process.env,
      COPILOT_CLI: '1',
      TELEMETRY_CAPTURE: capturePath,
      PATH: `${tempDir}${delimiter}${process.env.PATH || ''}`,
    };
    if (process.platform === 'win32') {
      writeFileSync(join(tempDir, 'npx.cmd'), '@echo off\r\necho invoked>"%TELEMETRY_CAPTURE%"\r\n');
    } else {
      const npxPath = join(tempDir, 'npx');
      writeFileSync(npxPath, '#!/usr/bin/env sh\nprintf invoked > "$TELEMETRY_CAPTURE"\n');
      chmodSync(npxPath, 0o755);
    }

    const script = join(
      tempDir,
      '.github',
      'hooks',
      'scripts',
      process.platform === 'win32' ? 'track-telemetry.ps1' : 'track-telemetry.sh',
    );
    const result = process.platform === 'win32'
      ? spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
        cwd: tempDir,
        encoding: 'utf-8',
        env: environment,
        input: HOOK_INPUT,
      })
      : spawnSync('bash', [script], {
        cwd: tempDir,
        encoding: 'utf-8',
        env: environment,
        input: HOOK_INPUT,
      });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"continue":true}');
    expect(existsSync(capturePath)).toBe(false);
  });

  it('writes safe opt-in diagnostics without raw hook data or registry credentials', () => {
    const tempDir = createTempDir('af-skills-hook-debug-');
    TEMP_DIRS.push(tempDir);
    const capturePath = join(tempDir, 'payload.json');
    const argsPath = join(tempDir, 'args.json');
    const captureScript = join(tempDir, 'capture.mjs');
    writeFileSync(captureScript, [
      "import { writeFileSync } from 'node:fs';",
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      "writeFileSync(process.env.TELEMETRY_CAPTURE, input);",
      "writeFileSync(process.env.TELEMETRY_ARGS, JSON.stringify(process.argv.slice(2)));",
      "process.exit(17);",
      '',
    ].join('\n'));
    const rawInput = JSON.stringify({
      ...JSON.parse(HOOK_INPUT) as Record<string, unknown>,
      prompt: 'customer prompt must not be logged',
      fileContents: 'customer file contents must not be logged',
      credentials: 'hook-input-secret',
    });
    const environment = {
      ...process.env,
      COPILOT_CLI: '1',
      FAKE_NPX_CAPTURE: captureScript,
      TELEMETRY_CAPTURE: capturePath,
      TELEMETRY_ARGS: argsPath,
      TELEMETRY_TEST_REGISTRY: TEST_REGISTRY,
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG: 'true',
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR: tempDir,
      PATH: `${tempDir}${delimiter}${process.env.PATH || ''}`,
    };

    const result = process.platform === 'win32'
      ? runPowerShellHook(tempDir, environment, rawInput)
      : runShellHook(tempDir, environment, rawInput);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"continue":true}');
    const log = readFileSync(join(tempDir, 'telemetry-debug.jsonl'), 'utf-8');
    const records = log.trim().split(/\r?\n/).map(line => JSON.parse(line) as Record<string, unknown>);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: 'hook', action: 'start', status: 'started' }),
      expect.objectContaining({
        component: 'hook',
        action: 'decision',
        status: 'tracked',
        registryUrl: 'https://example.test/npm',
      }),
      expect.objectContaining({
        component: 'hook',
        action: 'complete',
        npxExitCode: expect.any(Number),
      }),
      expect.objectContaining({
        component: 'hook',
        action: 'package-resolution',
        status: 'resolved',
      }),
    ]));
    for (const forbidden of [
      'npm-user',
      'npm-password',
      'registry-secret',
      'customer prompt',
      'customer file contents',
      'hook-input-secret',
      'customer-secret.txt',
      rawInput,
    ]) {
      expect(log).not.toContain(forbidden);
    }
  }, HOOK_TEST_TIMEOUT_MS);

  it('records a safe filtered reason in debug mode', () => {
    const tempDir = createTempDir('af-skills-hook-filtered-');
    TEMP_DIRS.push(tempDir);
    const environment = {
      ...process.env,
      TELEMETRY_TEST_REGISTRY: TEST_REGISTRY,
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG: 'true',
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR: tempDir,
      PATH: `${tempDir}${delimiter}${process.env.PATH || ''}`,
    };
    const input = JSON.stringify({
      toolName: 'read_file',
      toolArgs: { path: 'customer-secret.txt', contents: 'must-not-be-logged' },
    });

    const result = process.platform === 'win32'
      ? runPowerShellHook(tempDir, environment, input)
      : runShellHook(tempDir, environment, input);

    expect(result.status).toBe(0);
    const log = readFileSync(join(tempDir, 'telemetry-debug.jsonl'), 'utf-8');
    expect(log).toContain('"reason":"filtered"');
    expect(log).not.toContain('customer-secret.txt');
    expect(log).not.toContain('must-not-be-logged');
  }, HOOK_TEST_TIMEOUT_MS);

  it('runs a generated host payload through the real telemetry CLI', async () => {
    const tempDir = createTempDir('af-skills-hook-generated-');
    TEMP_DIRS.push(tempDir);
    await installLocalSkills({
      targetDir: tempDir,
      agents: ['ghcp'],
      checkForUpdates: false,
    });
    const environment = {
      ...process.env,
      TELEMETRY_CLI: join(ROOT, 'bin', 'azure-functions-skills.js'),
      TELEMETRY_TEST_REGISTRY: TEST_REGISTRY,
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG: 'true',
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR: tempDir,
      PATH: `${tempDir}${delimiter}${process.env.PATH || ''}`,
    };
    if (process.platform === 'win32') {
      writeFileSync(join(tempDir, 'npm.cmd'), [
        '@echo off',
        'if "%1"=="config" echo %TELEMETRY_TEST_REGISTRY%',
        'exit /b 0',
        '',
      ].join('\r\n'));
      writeFileSync(join(tempDir, 'npx.cmd'), [
        '@echo off',
        'node "%TELEMETRY_CLI%" telemetry',
        'exit /b %ERRORLEVEL%',
        '',
      ].join('\r\n'));
    } else {
      const npmPath = join(tempDir, 'npm');
      writeFileSync(npmPath, [
        '#!/usr/bin/env sh',
        '[ "$1" = "config" ] && printf "%s\\n" "$TELEMETRY_TEST_REGISTRY"',
        'exit 0',
        '',
      ].join('\n'));
      chmodSync(npmPath, 0o755);
      const npxPath = join(tempDir, 'npx');
      writeFileSync(npxPath, '#!/usr/bin/env sh\nnode "$TELEMETRY_CLI" telemetry\n');
      chmodSync(npxPath, 0o755);
    }

    const script = join(
      tempDir,
      '.github',
      'hooks',
      'scripts',
      process.platform === 'win32' ? 'track-telemetry.ps1' : 'track-telemetry.sh',
    );
    const input = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'azure-functions-help' },
    });
    const result = process.platform === 'win32'
      ? spawnSync('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
      ], {
        cwd: tempDir,
        encoding: 'utf-8',
        env: environment,
        input,
        timeout: POWERSHELL_PROCESS_TIMEOUT_MS,
      })
      : spawnSync('bash', [script], {
        cwd: tempDir,
        encoding: 'utf-8',
        env: environment,
        input,
      });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"continue":true}');
    expect(result.stderr).toBe('');
    const log = readFileSync(join(tempDir, 'telemetry-debug.jsonl'), 'utf-8');
    const packageVersion = (
      JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string }
    ).version;
    expect(log).not.toContain('__PACKAGE_VERSION__');
    expect(log).not.toContain('"reason":"filtered"');
    expect(log).toContain('"npxExitCode":0');
    expect(log).toContain(`"pluginVersion":"${packageVersion}"`);
  }, HOOK_TEST_TIMEOUT_MS);
});

function runPowerShellHook(
  tempDir: string,
  environment: NodeJS.ProcessEnv,
  input = HOOK_INPUT,
) {
  const hookScript = join(ROOT, 'templates', 'hooks', 'scripts', 'track-telemetry.ps1');
  const harness = [
    'function npx {',
    '  $payload = @($input) -join [Environment]::NewLine',
    '  $arguments = @($args)',
    '  [IO.File]::WriteAllText($env:TELEMETRY_CAPTURE, $payload)',
    '  [IO.File]::WriteAllText($env:TELEMETRY_ARGS, (ConvertTo-Json -Compress -InputObject $arguments))',
    '  $global:LASTEXITCODE = 17',
    '}',
    'function npm {',
    '  Write-Output $env:TELEMETRY_TEST_REGISTRY',
    '}',
    '& $env:TELEMETRY_HOOK',
    '',
  ].join('\n');
  return spawnSync(
    'pwsh',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      harness,
    ],
    {
      cwd: ROOT,
      encoding: 'utf-8',
      env: {
        ...environment,
        TELEMETRY_HOOK: hookScript,
      },
      input,
      timeout: POWERSHELL_PROCESS_TIMEOUT_MS,
    },
  );
}

function runShellHook(
  tempDir: string,
  environment: NodeJS.ProcessEnv,
  input = HOOK_INPUT,
) {
  const npxPath = join(tempDir, 'npx');
  writeFileSync(npxPath, '#!/usr/bin/env sh\nnode "$FAKE_NPX_CAPTURE" "$@"\n');
  chmodSync(npxPath, 0o755);
  const npmPath = join(tempDir, 'npm');
  writeFileSync(npmPath, '#!/usr/bin/env sh\nprintf "%s\\n" "$TELEMETRY_TEST_REGISTRY"\n');
  chmodSync(npmPath, 0o755);
  return spawnSync(
    'bash',
    [join(ROOT, 'templates', 'hooks', 'scripts', 'track-telemetry.sh')],
    {
      cwd: ROOT,
      encoding: 'utf-8',
      env: environment,
      input,
    },
  );
}
