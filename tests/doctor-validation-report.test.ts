import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];
const REPORT_SCRIPT = join(import.meta.dirname, '..', 'scripts', 'doctor-validation-report.mjs');

interface Finding {
  id: string;
  title: string;
  message: string;
  severity?: string;
}

function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of TEMP_DIRS) removeDir(dir);
});

function writeResult(root: string, fixture: string, findings: Finding[], options?: {
  readonly ran?: boolean;
  readonly requestedModel?: string;
  readonly cachedFindings?: Finding[];
}): void {
  const fixtureDir = join(root, fixture);
  mkdirSync(fixtureDir, { recursive: true });
  const checks = findings.map(finding => ({
    category: 'code',
    severity: finding.severity ?? 'high',
    status: 'fail',
    ...finding,
  }));
  writeFileSync(join(fixtureDir, 'doctor-result.json'), JSON.stringify({
    language: 'node',
    summary: { status: 'fail' },
    tiers: {
      ai: {
        ran: options?.ran ?? true,
        agent: 'github-copilot',
        requestedModel: options?.requestedModel ?? 'gpt-5.6-sol',
        effectiveModel: options?.requestedModel ?? 'gpt-5.6-sol',
        durationMs: 1000,
        checks,
      },
    },
  }));
  if (options?.cachedFindings) {
    const cacheDir = join(fixtureDir, '.azure-functions-doctor');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'doctor-ai-findings.json'), JSON.stringify(
      options.cachedFindings.map(finding => ({
        category: 'code',
        severity: finding.severity ?? 'high',
        status: 'fail',
        ...finding,
      })),
    ));
  }
}

function runReport(root: string): { stdout: string; html: string } {
  const output = join(root, 'report.html');
  const stdout = execFileSync(process.execPath, [
    REPORT_SCRIPT,
    '--fixtures-dir', root,
    '--output', output,
  ], { encoding: 'utf-8' });
  return { stdout, html: readFileSync(output, 'utf-8') };
}

function runInvalidReport(root: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [REPORT_SCRIPT, '--fixtures-dir', root], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const result = error as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? '',
      exitCode: result.status ?? 1,
    };
  }
}

describe('doctor deep validation report', () => {
  it('keeps the machine-readable expectation catalog aligned with deep fixture documentation', () => {
    const output = execFileSync(process.execPath, [REPORT_SCRIPT, '--list-expectations'], { encoding: 'utf-8' });
    const catalog = JSON.parse(output) as Record<string, string[]>;
    const fixtureRoot = join(import.meta.dirname, 'fixtures', 'doctor-bad-apps');
    const documented = readFileSync(join(fixtureRoot, 'expected-results.md'), 'utf-8');
    const fixtureNames = readdirSync(fixtureRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => name.includes('-deep-') || name.includes('-supply-chain-'))
      .filter(name => !name.endsWith('-unpinned-deps'));

    expect(Object.keys(catalog).sort()).toEqual(fixtureNames.sort());
    for (const fixture of Object.keys(catalog)) {
      expect(documented).toContain(`**\`${fixture}\`**`);
      expect(catalog[fixture].length).toBeGreaterThan(0);
    }
  });

  it('lets one finding satisfy multiple explicitly covered expectations without becoming extra', () => {
    const root = makeTmp('doctor-validation-many-');
    writeResult(root, 'csharp-deep-blocking-async', [{
      id: 'blocked-async',
      title: 'Asynchronous HTTP calls are blocked synchronously',
      message: 'GetAsync().Result and PostAsync().Wait() block async work and risk deadlocks.',
    }]);

    const { stdout, html } = runReport(root);

    expect(stdout).toContain('2/5 expected findings matched');
    expect(stdout).toContain('Extras: 0');
    expect(html).toContain('matched 2 expectations');
    expect(html).toContain('.result');
    expect(html).toContain('wait()');
  });

  it('rejects generic client-reuse and request-validation false matches', () => {
    const root = makeTmp('doctor-validation-false-');
    writeResult(root, 'node-deep-secrets-obfuscated', [{
      id: 'client-reuse',
      title: 'BlobServiceClient created per invocation',
      message: 'Move the client to module scope for reuse.',
    }]);
    writeResult(root, 'node-deep-output-binding-errors', [{
      id: 'request-validation',
      title: 'Request validation missing',
      message: 'Validate input before returning success from the handler.',
    }]);

    const { stdout } = runReport(root);

    expect(stdout).toContain('0/4 expected findings matched');
    expect(stdout).toContain('Extras: 2');
  });

  it('is independent of expectation order and includes Go expectations', () => {
    const root = makeTmp('doctor-validation-go-');
    writeResult(root, 'go-deep-toolchain-and-runtime', [{
      id: 'go-runtime',
      title: 'Go worker runtime and client lifecycle issues',
      message: 'FUNCTIONS_WORKER_RUNTIME must be native; construct http.Client at package scope, not inside the hello handler.',
    }]);

    const { stdout, html } = runReport(root);

    expect(stdout).toContain('2/5 expected findings matched');
    expect(html).toContain('[GO-003]');
    expect(html).toContain('[GO-004]');
  });

  it('invalidates nested fixture workspaces', () => {
    const root = makeTmp('doctor-validation-nested-');
    writeResult(root, 'node-deep-client-reuse', []);
    mkdirSync(join(root, 'node-deep-client-reuse', 'node-deep-client-reuse'), { recursive: true });

    const result = runInvalidReport(root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('INVALID');
    expect(result.stdout).toContain('nested fixture directory');
  });

  it('invalidates reports where deep analysis did not run or cached findings conflict', () => {
    const root = makeTmp('doctor-validation-stale-');
    writeResult(root, 'node-deep-client-reuse', [], { ran: false });
    writeResult(root, 'python-deep-blocking-sync', [{
      id: 'sync-http',
      title: 'Synchronous HTTP',
      message: 'requests.get blocks the worker.',
    }], {
      cachedFindings: [{
        id: 'different',
        title: 'Different cache',
        message: 'Stale.',
      }],
    });

    const result = runInvalidReport(root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('deep analysis did not run');
    expect(result.stdout).toContain('cached AI findings conflict');
  });

  it('shows model provenance in the report', () => {
    const root = makeTmp('doctor-validation-model-');
    writeResult(root, 'node-deep-client-reuse', [], { requestedModel: 'gpt-5.6-sol' });

    const { html } = runReport(root);

    expect(html).toContain('gpt-5.6-sol');
    expect(html).toContain('Requested model');
    expect(html).toContain('Effective model');
  });
});
