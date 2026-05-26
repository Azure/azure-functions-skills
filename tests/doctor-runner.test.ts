import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import { runDoctor } from '../src/doctor/runner.js';
import { formatReport } from '../src/doctor/formatters.js';
import type { DoctorOptions } from '../src/doctor/types.js';

const TEMP_DIRS: string[] = [];
function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}
afterAll(() => { for (const d of TEMP_DIRS) removeDir(d); });

function defaultOpts(dir: string, overrides?: Partial<DoctorOptions>): DoctorOptions {
  return {
    dir,
    deep: false,
    timeout: 300,
    format: 'text',
    output: join(dir, '.azure-functions-skills', 'doctor-report.json'),
    severity: 'high',
    ...overrides,
  };
}

// ── Runner ──

describe('runDoctor', () => {
  it('returns exit 1 for empty directory (no host.json)', async () => {
    const dir = makeTmp('runner-empty-');
    const { report, exitCode } = await runDoctor(defaultOpts(dir));
    expect(exitCode).toBe(1);
    expect(report.summary.status).toBe('fail');
    expect(report.summary.critical).toBeGreaterThanOrEqual(1);
  });

  it('returns exit 0 for a healthy project', async () => {
    const dir = makeTmp('runner-ok-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({
      version: '2.0',
      extensionBundle: {
        id: 'Microsoft.Azure.Functions.ExtensionBundle',
        version: '[4.0.0, 5.0.0)',
      },
    }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'test-func',
      main: 'index.js',
      engines: { node: '>=22' },
    }));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    writeFileSync(join(dir, 'local.settings.json'), JSON.stringify({
      IsEncrypted: false,
      Values: { FUNCTIONS_WORKER_RUNTIME: 'node', AzureWebJobsStorage: 'UseDevelopmentStorage=true' },
    }));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { outDir: 'dist', target: 'ES2022' },
    }));
    const { report, exitCode } = await runDoctor(defaultOpts(dir));
    expect(exitCode).toBe(0);
    expect(report.summary.status).toBe('pass');
    expect(report.tiers.builtin.ran).toBe(true);
    expect(report.language).toBe('node');
  });

  it('respects --checks filter', async () => {
    const dir = makeTmp('runner-filter-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const { report } = await runDoctor(defaultOpts(dir, { checks: ['project-exists'] }));
    expect(report.tiers.builtin.checks).toHaveLength(1);
    expect(report.tiers.builtin.checks[0].id).toBe('project-exists');
  });

  it('uses severity threshold for exit code', async () => {
    const dir = makeTmp('runner-sev-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    // Missing extensionBundle is high severity, missing local.settings is medium
    // With severity=critical, only critical failures cause exit 1
    const { exitCode } = await runDoctor(defaultOpts(dir, { severity: 'critical' }));
    expect(exitCode).toBe(0); // No critical failures in this project
  });

  it('report has correct version and timestamp', async () => {
    const dir = makeTmp('runner-meta-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const { report } = await runDoctor(defaultOpts(dir));
    expect(report.version).toBe(1);
    expect(report.timestamp).toBeTruthy();
    expect(report.workspace).toBe(dir);
  });
});

// ── Formatters ──

describe('formatReport', () => {
  it('text format contains project info and summary', async () => {
    const dir = makeTmp('fmt-text-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const { report } = await runDoctor(defaultOpts(dir));
    const text = formatReport(report, 'text');
    expect(text).toContain('Azure Functions Doctor');
    expect(text).toContain('Summary:');
    expect(text).toContain('passed');
  });

  it('json format is valid JSON', async () => {
    const dir = makeTmp('fmt-json-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const { report } = await runDoctor(defaultOpts(dir));
    const json = formatReport(report, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.tiers.builtin.ran).toBe(true);
  });

  it('markdown format has table headers', async () => {
    const dir = makeTmp('fmt-md-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const { report } = await runDoctor(defaultOpts(dir));
    const md = formatReport(report, 'markdown');
    expect(md).toContain('# Azure Functions Doctor Report');
    expect(md).toContain('| Status | Check | Message |');
  });
});
