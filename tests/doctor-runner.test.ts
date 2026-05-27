import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import { runDoctor } from '../src/doctor/runner.js';
import { formatReport } from '../src/doctor/formatters.js';
import type { DoctorOptions } from '../src/doctor/types.js';

const TEMP_DIRS: string[] = [];
let previousStacksOffline: string | undefined;
function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}
beforeAll(() => {
  previousStacksOffline = process.env.AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE;
  process.env.AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE = '1';
});
afterAll(() => {
  if (previousStacksOffline === undefined) {
    delete process.env.AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE;
  } else {
    process.env.AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE = previousStacksOffline;
  }
  for (const d of TEMP_DIRS) removeDir(d);
});

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

  it('skips AI analysis when deep is requested outside a Functions project', async () => {
    const dir = makeTmp('runner-empty-deep-');
    const { report, exitCode } = await runDoctor(defaultOpts(dir, {
      deep: true,
      agent: 'github-copilot',
      acceptDeepRisk: true,
    }));

    expect(exitCode).toBe(1);
    expect(report.tiers.ai.ran).toBe(false);
    expect(report.tiers.ai.agent).toBe('github-copilot');
    expect(report.tiers.ai.error).toContain('host.json is missing');
  });

  it('errors when --deep is requested without --agent and no state', async () => {
    const dir = makeTmp('runner-deep-no-agent-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const { report } = await runDoctor(defaultOpts(dir, { deep: true, acceptDeepRisk: true }));

    // Tier 1 should still run; Tier 2 should be skipped with explanation
    expect(report.tiers.builtin.ran).toBe(true);
    expect(report.tiers.ai.ran).toBe(false);
    expect(report.tiers.ai.agent).toBeUndefined();
    expect(report.tiers.ai.error).toMatch(/agent/i);
  });

  it('refuses to run --deep without acceptDeepRisk acknowledgement', async () => {
    const dir = makeTmp('runner-deep-no-accept-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const { report } = await runDoctor(defaultOpts(dir, {
      deep: true,
      agent: 'github-copilot',
      acceptDeepRisk: false,
    }));

    expect(report.tiers.builtin.ran).toBe(true);
    expect(report.tiers.ai.ran).toBe(false);
    expect(report.tiers.ai.error).toMatch(/--accept-deep-risk|untrusted|elevated/i);
  });

  it('refuses --deep when GITHUB_EVENT_NAME=pull_request (contributor PR context)', async () => {
    const dir = makeTmp('runner-deep-pr-ctx-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const savedEvent = process.env.GITHUB_EVENT_NAME;
    const savedTrust = process.env.AZURE_FUNCTIONS_DOCTOR_TRUST_PR;
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    delete process.env.AZURE_FUNCTIONS_DOCTOR_TRUST_PR;
    try {
      const { report } = await runDoctor(defaultOpts(dir, {
        deep: true,
        agent: 'github-copilot',
        acceptDeepRisk: true,
      }));
      expect(report.tiers.ai.ran).toBe(false);
      expect(report.tiers.ai.error).toMatch(/pull request|contributor|untrusted/i);
    } finally {
      if (savedEvent === undefined) delete process.env.GITHUB_EVENT_NAME;
      else process.env.GITHUB_EVENT_NAME = savedEvent;
      if (savedTrust !== undefined) process.env.AZURE_FUNCTIONS_DOCTOR_TRUST_PR = savedTrust;
    }
  });

  it('allows --deep on pull_request context when AZURE_FUNCTIONS_DOCTOR_TRUST_PR=1 (opt-in for trusted pipelines)', async () => {
    const dir = makeTmp('runner-deep-pr-trust-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const savedEvent = process.env.GITHUB_EVENT_NAME;
    const savedTrust = process.env.AZURE_FUNCTIONS_DOCTOR_TRUST_PR;
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.AZURE_FUNCTIONS_DOCTOR_TRUST_PR = '1';
    try {
      // Without an agent installed in state, ai will be skipped for that reason — but
      // crucially NOT for the PR-context reason. Confirm the error is not about PR.
      const { report } = await runDoctor(defaultOpts(dir, {
        deep: true,
        acceptDeepRisk: true,
      }));
      expect(report.tiers.ai.error ?? '').not.toMatch(/pull request|contributor/i);
    } finally {
      if (savedEvent === undefined) delete process.env.GITHUB_EVENT_NAME;
      else process.env.GITHUB_EVENT_NAME = savedEvent;
      if (savedTrust === undefined) delete process.env.AZURE_FUNCTIONS_DOCTOR_TRUST_PR;
      else process.env.AZURE_FUNCTIONS_DOCTOR_TRUST_PR = savedTrust;
    }
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

  it('html format has valid structure and embedded styles', async () => {
    const dir = makeTmp('fmt-html-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const { report } = await runDoctor(defaultOpts(dir));
    const html = formatReport(report, 'html');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Azure Functions Doctor Report</title>');
    expect(html).toContain('<style>');
    expect(html).toContain('Azure Functions Doctor');
    expect(html).toContain('Built-in Checks');
    // Status badge present
    expect(html).toMatch(/class="overall-status status-(pass|fail)"/);
    // Summary cards present
    expect(html).toContain('Critical');
    expect(html).toContain('High');
    expect(html).toContain('Passed');
  });

  it('html format escapes user-provided content', async () => {
    const dir = makeTmp('fmt-html-esc-');
    // Use a path-like name that would be reflected back into the report
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const { report } = await runDoctor(defaultOpts(dir));
    // Inject a hostile value into a check message to verify escaping
    report.tiers.builtin.checks.push({
      id: 'evil-check',
      category: 'configuration',
      severity: 'low',
      status: 'warn',
      title: 'evil <script>alert(1)</script>',
      message: '"quotes" & <tags>',
    });
    const html = formatReport(report, 'html');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;quotes&quot;');
  });

  it('html format defends against malicious status/severity/category/line values', async () => {
    const dir = makeTmp('fmt-html-enum-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const { report } = await runDoctor(defaultOpts(dir));
    // Inject malicious enum-like values that would break CSS class attributes
    // (cast through unknown to bypass strict types — simulates AI returning bad JSON)
    report.tiers.builtin.checks.push({
      id: 'evil-enum',
      category: 'evil"><script>x</script>',
      severity: 'evil"><script>y</script>' as unknown as 'low',
      status: 'fail', // valid so check renders
      title: 'Evil',
      message: 'M',
      file: 'evil"><script>f</script>',
      line: '1"><script>l</script>' as unknown as number,
    });
    const html = formatReport(report, 'html');
    // No raw <script> tags anywhere (case-insensitive)
    expect(html.toLowerCase()).not.toMatch(/<script[\s>]/);
    // CSS class attributes must not be broken out of
    expect(html).not.toContain('sev-evil');
    expect(html).not.toContain('check-cat">evil"');
  });

  it('html format defends against malicious values in AI tier findings', async () => {
    const dir = makeTmp('fmt-html-ai-enum-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const { report } = await runDoctor(defaultOpts(dir));
    // AI tier renders findings without the builtin status filter — bigger attack surface
    report.tiers.ai = {
      ran: true,
      agent: 'github-copilot',
      durationMs: 1000,
      checks: [{
        id: 'ai-evil',
        category: 'evil"><script>a</script>',
        severity: 'evil"><script>b</script>' as unknown as 'critical',
        status: 'evil"><script>c</script>' as unknown as 'fail',
        title: 'AI Evil',
        message: 'M',
        file: 'evil"><script>d</script>',
        line: '99"><script>e</script>' as unknown as number,
      }],
    };
    const html = formatReport(report, 'html');
    // No raw <script> tags anywhere
    expect(html.toLowerCase()).not.toMatch(/<script[\s>]/);
    // CSS class attributes must not be broken out of
    expect(html).not.toContain('status-evil');
    expect(html).not.toContain('sev-evil');
    expect(html).not.toContain('check-evil');
  });
});
