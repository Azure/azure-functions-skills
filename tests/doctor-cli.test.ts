import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];
function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}
afterAll(() => { for (const d of TEMP_DIRS) removeDir(d); });

const CLI = join(import.meta.dirname, '..', 'bin', 'azure-functions-skills.js');

function runDoctor(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'doctor', ...args], {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE: '1',
      },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
      exitCode: e.status ?? 2,
    };
  }
}

describe('doctor CLI', () => {
  it('exits 1 for empty directory', () => {
    const dir = makeTmp('cli-doc-empty-');
    const { exitCode, stdout } = runDoctor(['--dir', dir, '--no-deep']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('host.json is missing');
  });

  it('exits 0 for healthy project', () => {
    const dir = makeTmp('cli-doc-ok-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({
      version: '2.0',
      extensionBundle: { id: 'Microsoft.Azure.Functions.ExtensionBundle', version: '[4.0.0, 5.0.0)' },
    }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'test-func', main: 'index.js', engines: { node: '>=22' },
    }));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    writeFileSync(join(dir, 'local.settings.json'), JSON.stringify({
      IsEncrypted: false,
      Values: { FUNCTIONS_WORKER_RUNTIME: 'node', AzureWebJobsStorage: 'UseDevelopmentStorage=true' },
    }));

    const { exitCode, stdout } = runDoctor(['--dir', dir, '--no-deep']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Azure Functions Doctor');
    expect(stdout).toContain('passed');
  });

  it('json format writes valid JSON to output file', () => {
    const dir = makeTmp('cli-doc-json-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const reportPath = join(dir, 'report.json');

    runDoctor(['--dir', dir, '--no-deep', '--format', 'json', '--output', reportPath]);

    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    expect(report.version).toBe(1);
    expect(report.tiers.builtin.ran).toBe(true);
  });

  it('--checks filters to specific checks only', () => {
    const dir = makeTmp('cli-doc-filter-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const reportPath = join(dir, 'report.json');

    runDoctor(['--dir', dir, '--no-deep', '--format', 'json', '--output', reportPath, '--checks', 'project-exists']);

    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    expect(report.tiers.builtin.checks).toHaveLength(1);
    expect(report.tiers.builtin.checks[0].id).toBe('project-exists');
  });

  it('--severity critical makes medium issues non-failing', () => {
    const dir = makeTmp('cli-doc-sev-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    // No local.settings.json → medium warn; no extension bundle → high warn
    // With severity=critical, only critical failures cause exit 1
    const { exitCode } = runDoctor(['--dir', dir, '--no-deep', '--severity', 'critical']);
    expect(exitCode).toBe(0);
  });

  it('writes report file in requested format', () => {
    const dir = makeTmp('cli-doc-report-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const reportPath = join(dir, '.doctor-test', 'report.json');

    runDoctor(['--dir', dir, '--no-deep', '--format', 'json', '--output', reportPath]);

    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    expect(report.version).toBe(1);
  });

  it('writes HTML report when --format html is specified', () => {
    const dir = makeTmp('cli-doc-html-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const reportPath = join(dir, 'report.html');

    runDoctor(['--dir', dir, '--no-deep', '--format', 'html', '--output', reportPath]);

    expect(existsSync(reportPath)).toBe(true);
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Azure Functions Doctor');
  });

  it('prints text summary to stdout regardless of --format', () => {
    const dir = makeTmp('cli-doc-stdout-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const reportPath = join(dir, 'report.json');

    const { stdout } = runDoctor(['--dir', dir, '--no-deep', '--format', 'json', '--output', reportPath]);

    // stdout always contains human-readable text, even when --format json
    expect(stdout).toContain('Azure Functions Doctor');
    expect(stdout).toContain('Summary:');
  });

  it('help doctor prints usage', () => {
    const { stdout } = (() => {
      try {
        return {
          stdout: execFileSync(process.execPath, [CLI, 'help', 'doctor'], { encoding: 'utf-8' }),
        };
      } catch (err: unknown) {
        return { stdout: (err as { stdout?: string }).stdout ?? '' };
      }
    })();
    expect(stdout).toContain('azure-functions-skills doctor');
    expect(stdout).toContain('--deep');
  });
});
