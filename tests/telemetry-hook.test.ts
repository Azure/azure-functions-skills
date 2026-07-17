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
      '@azure/functions-skills@latest',
      'telemetry',
    ]);
    expect(JSON.parse(readFileSync(capturePath, 'utf-8'))).toEqual({
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      eventType: 'skill_invocation',
      clientName: 'copilot-cli',
      pluginName: 'azure-functions-skills',
      sessionId: 'session-123',
      skillName: 'azure-functions-help',
    });
  });

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
});

function runPowerShellHook(tempDir: string, environment: NodeJS.ProcessEnv) {
  writeFileSync(join(tempDir, 'npx.cmd'), '@echo off\r\nnode "%FAKE_NPX_CAPTURE%" %*\r\n');
  return spawnSync(
    'pwsh',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(ROOT, 'templates', 'hooks', 'scripts', 'track-telemetry.ps1'),
    ],
    {
      cwd: ROOT,
      encoding: 'utf-8',
      env: environment,
      input: HOOK_INPUT,
    },
  );
}

function runShellHook(tempDir: string, environment: NodeJS.ProcessEnv) {
  const npxPath = join(tempDir, 'npx');
  writeFileSync(npxPath, '#!/usr/bin/env sh\nnode "$FAKE_NPX_CAPTURE" "$@"\n');
  chmodSync(npxPath, 0o755);
  return spawnSync(
    'bash',
    [join(ROOT, 'templates', 'hooks', 'scripts', 'track-telemetry.sh')],
    {
      cwd: ROOT,
      encoding: 'utf-8',
      env: environment,
      input: HOOK_INPUT,
    },
  );
}
