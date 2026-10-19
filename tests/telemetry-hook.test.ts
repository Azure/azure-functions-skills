import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTempDir, removeDir } from './helpers/fs.js';

const ROOT = join(import.meta.dirname, '..');
const TEMP_DIRS: string[] = [];
const HOOK_INPUTS = [
  JSON.stringify({ toolName: 'skill', toolArgs: { skill: 'azure-functions-help' } }),
  JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    tool_input: { skill: 'azure-functions-skills:azure-functions-deploy' },
  }),
  JSON.stringify({ toolName: 'functions_project_get' }),
  JSON.stringify({
    toolName: 'Read',
    tool_input: { file_path: '/workspace/.github/skills/azure-functions-help/SKILL.md' },
  }),
  '{invalid-json',
  '',
];

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('automatic telemetry suspension', () => {
  it.each([process.platform === 'win32' ? 'powershell' : 'bash'] as const)(
    '%s hooks do not run a package command in a workspace with a registry override',
    (shell) => {
      const tempDir = createTempDir('af-skills-hook-suspended-');
      TEMP_DIRS.push(tempDir);
      const scriptsDir = join(tempDir, 'hooks', 'scripts');
      mkdirSync(scriptsDir, { recursive: true });
      const scriptName = shell === 'bash' ? 'track-telemetry.sh' : 'track-telemetry.ps1';
      const script = join(scriptsDir, scriptName);
      copyFileSync(join(ROOT, 'templates', 'hooks', 'scripts', scriptName), script);
      writeFileSync(join(tempDir, 'package.json'), '{"name":"hook-test","version":"1.0.0"}');
      writeFileSync(join(tempDir, '.npmrc'), '@azure:registry=http://127.0.0.1:9/\n');
      const marker = join(tempDir, 'package-command-ran');
      const npxPath = join(tempDir, 'npx');
      writeFileSync(npxPath, '#!/bin/sh\nprintf invoked > "$TELEMETRY_CAPTURE"\n');
      chmodSync(npxPath, 0o755);
      writeFileSync(join(tempDir, 'npx.cmd'), '@echo off\r\necho invoked>"%TELEMETRY_CAPTURE%"\r\n');

      for (const enabled of [true, false]) {
        writeFileSync(join(tempDir, 'hooks', 'telemetry.config.json'), JSON.stringify({ enabled }));
        for (const input of HOOK_INPUTS) {
          const args = shell === 'bash'
            ? [script]
            : [
              '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
              'function npx { [IO.File]::WriteAllText($env:TELEMETRY_CAPTURE, "invoked") }; & $env:TELEMETRY_HOOK',
            ];
          const result = spawnSync(shell === 'bash' ? 'bash' : 'pwsh', args, {
            cwd: tempDir,
            encoding: 'utf-8',
            env: {
              ...process.env,
              PATH: `${tempDir}${delimiter}${process.env.PATH || ''}`,
              TELEMETRY_HOOK: script,
              TELEMETRY_CAPTURE: marker,
              AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY: String(enabled),
              AZURE_MCP_COLLECT_TELEMETRY: String(enabled),
            },
            input,
            timeout: 10_000,
          });

          expect(result.error).toBeUndefined();
          expect(result.status).toBe(0);
          expect(result.stdout.trim()).toBe('{"continue":true}');
          expect(result.stderr).toBe('');
          expect(existsSync(marker)).toBe(false);
        }
      }
    },
    60_000,
  );
});
