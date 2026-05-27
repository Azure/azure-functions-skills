import { describe, it, expect, afterAll, vi, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import {
  buildDoctorPrompt,
  buildAgentCommand,
  buildDeepWarning,
  readAiReport,
  mergeReports,
} from '../src/doctor/ai-analysis.js';
import { buildPluginFallbackWarning } from '../src/doctor/runner.js';
import type { DoctorCheckResult, DoctorReport } from '../src/doctor/types.js';

const TEMP_DIRS: string[] = [];
function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}
afterAll(() => { for (const d of TEMP_DIRS) removeDir(d); });
afterEach(() => { vi.restoreAllMocks(); });

// ── buildDoctorPrompt ──

describe('buildDoctorPrompt', () => {
  it('includes tier 1 results in prompt', () => {
    const tier1Results: DoctorCheckResult[] = [
      {
        id: 'project-exists',
        category: 'structure',
        severity: 'critical',
        status: 'pass',
        title: 'Functions project found',
        message: 'host.json exists',
      },
    ];
    const reportPath = '/tmp/report.json';
    const prompt = buildDoctorPrompt(tier1Results, reportPath);
    expect(prompt).toContain('project-exists');
    expect(prompt).toContain('host.json exists');
    expect(prompt).toContain(reportPath);
  });

  it('includes report path placeholder', () => {
    const prompt = buildDoctorPrompt([], '/output/report.json');
    expect(prompt).toContain('/output/report.json');
  });

  it('includes analysis instructions', () => {
    const prompt = buildDoctorPrompt([], '/tmp/r.json');
    expect(prompt).toContain('Exception handling');
    expect(prompt).toContain('Async/await');
    expect(prompt).toContain('JSON array');
  });

  it('instructs the agent to load the supply-chain reference when dependency manifests exist', () => {
    const prompt = buildDoctorPrompt([], '/tmp/r.json');
    // The Tier 2 supply-chain reference is the central mitigation for
    // durabletask-class attacks. The prompt must explicitly route the agent
    // to it, not rely on implicit skill auto-activation.
    expect(prompt).toContain('supply-chain-checks.md');
    expect(prompt.toLowerCase()).toMatch(/supply chain|supply-chain/);
    // Reference the specific check IDs the agent should apply
    expect(prompt).toMatch(/SC-101|SC-102|SC-110/);
  });

  it('warns the agent to treat workspace content as untrusted input', () => {
    const prompt = buildDoctorPrompt([], '/tmp/r.json');
    expect(prompt.toLowerCase()).toMatch(/untrusted|prompt inject|do not follow instructions/);
  });
});

// ── buildAgentCommand ──

describe('buildAgentCommand', () => {
  it('builds github-copilot headless command', () => {
    const cmd = buildAgentCommand('github-copilot', 'analyze this', '/tmp/report.json');
    // On Windows, command may be process.execPath when .cmd wrapper is resolved
    const validCommands = ['copilot', process.execPath];
    expect(validCommands).toContain(cmd.command);
    expect(cmd.args).toContain('-p');
    expect(cmd.args.some(a => a.includes('analyze this'))).toBe(true);
    expect(cmd.args).toContain('--allow-all-tools');
  });

  it('builds claude-code headless command', () => {
    const cmd = buildAgentCommand('claude-code', 'analyze this', '/tmp/report.json');
    expect(cmd.command).toBe('claude');
    expect(cmd.args).toContain('-p');
    expect(cmd.args).toContain('--dangerously-skip-permissions');
  });

  it('builds codex headless command', () => {
    const cmd = buildAgentCommand('codex', 'analyze this', '/tmp/report.json');
    const validCommands = ['codex', process.execPath];
    expect(validCommands).toContain(cmd.command);
    expect(cmd.args).toContain('--approval-mode');
  });

  it('throws for unknown agent', () => {
    expect(() => buildAgentCommand('unknown-agent', 'test', '/tmp/r.json'))
      .toThrow('Unknown agent');
  });
});

// ── buildDeepWarning ──

describe('buildDeepWarning', () => {
  it('mentions elevated permissions and the agent name', () => {
    const warning = buildDeepWarning('github-copilot');
    expect(warning.toLowerCase()).toContain('warning');
    expect(warning).toContain('github-copilot');
    // Should mention file/shell access risk
    expect(warning.toLowerCase()).toMatch(/file|shell|untrusted|workspace/);
  });

  it('different agents are reflected in the warning', () => {
    expect(buildDeepWarning('claude-code')).toContain('claude-code');
    expect(buildDeepWarning('codex')).toContain('codex');
  });

  it('contains only ASCII (no emojis that would mojibake on Windows PowerShell stderr)', () => {
    const warning = buildDeepWarning('github-copilot');
    // eslint-disable-next-line no-control-regex
    expect(warning).toMatch(/^[\x09\x0a\x20-\x7e]+$/);
  });

  it('plugin fallback warning is pure ASCII', () => {
    const warning = buildPluginFallbackWarning('ENOENT: missing /etc/foo');
    // eslint-disable-next-line no-control-regex
    expect(warning).toMatch(/^[\x09\x0a\x20-\x7e]+$/);
    expect(warning).toContain('[WARN]');
    expect(warning).toContain('ENOENT');
  });
});

// ── readAiReport ──

describe('readAiReport', () => {
  it('reads valid report file', async () => {
    const dir = makeTmp('ai-report-ok-');
    const reportPath = join(dir, 'report.json');
    const findings: DoctorCheckResult[] = [{
      id: 'async-disposal',
      category: 'code',
      severity: 'high',
      status: 'fail',
      title: 'HttpClient not disposed',
      message: 'HttpClient created but never disposed in queueHandler.ts',
      file: 'src/functions/queueHandler.ts',
      line: 42,
    }];
    writeFileSync(reportPath, JSON.stringify(findings));

    const result = await readAiReport(reportPath);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('async-disposal');
  });

  it('returns empty array for missing file', async () => {
    const result = await readAiReport('/nonexistent/report.json');
    expect(result).toEqual([]);
  });

  it('returns empty array for malformed JSON', async () => {
    const dir = makeTmp('ai-report-bad-');
    const reportPath = join(dir, 'report.json');
    writeFileSync(reportPath, '{ bad json }');

    const result = await readAiReport(reportPath);
    expect(result).toEqual([]);
  });

  it('returns empty array for non-array JSON', async () => {
    const dir = makeTmp('ai-report-obj-');
    const reportPath = join(dir, 'report.json');
    writeFileSync(reportPath, JSON.stringify({ error: 'not an array' }));

    const result = await readAiReport(reportPath);
    expect(result).toEqual([]);
  });

  it('filters out invalid entries from the array', async () => {
    const dir = makeTmp('ai-report-mixed-');
    const reportPath = join(dir, 'report.json');
    writeFileSync(reportPath, JSON.stringify([
      { id: 'valid', category: 'code', severity: 'high', status: 'fail', title: 'Valid', message: 'OK' },
      { bad: 'entry' },
      'not-an-object',
    ]));

    const result = await readAiReport(reportPath);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid');
  });
});

// ── mergeReports ──

describe('mergeReports', () => {
  function makeBaseReport(): DoctorReport {
    return {
      version: 1,
      timestamp: '2026-05-26T00:00:00Z',
      workspace: '/test',
      language: 'node',
      tiers: {
        builtin: {
          ran: true,
          checks: [{
            id: 'project-exists',
            category: 'structure',
            severity: 'critical',
            status: 'pass',
            title: 'OK',
            message: 'host.json exists',
          }],
        },
        ai: { ran: false, checks: [] },
      },
      summary: { total: 1, critical: 0, high: 0, medium: 0, low: 0, pass: 1, status: 'pass' },
    };
  }

  it('merges AI findings into the report', () => {
    const report = makeBaseReport();
    const aiFindings: DoctorCheckResult[] = [{
      id: 'async-issue',
      category: 'code',
      severity: 'high',
      status: 'fail',
      title: 'Async issue',
      message: 'Missing await',
    }];

    const merged = mergeReports(report, aiFindings, 'github-copilot', 5000);
    expect(merged.tiers.ai.ran).toBe(true);
    expect(merged.tiers.ai.checks).toHaveLength(1);
    expect(merged.tiers.ai.agent).toBe('github-copilot');
    expect(merged.tiers.ai.durationMs).toBe(5000);
    expect(merged.summary.total).toBe(2);
    expect(merged.summary.high).toBe(1);
    expect(merged.summary.status).toBe('fail');
  });

  it('keeps pass status when AI finds no issues', () => {
    const report = makeBaseReport();
    const merged = mergeReports(report, [], 'claude-code', 3000);
    expect(merged.tiers.ai.ran).toBe(true);
    expect(merged.tiers.ai.checks).toHaveLength(0);
    expect(merged.summary.status).toBe('pass');
  });

  it('recalculates summary totals', () => {
    const report = makeBaseReport();
    const aiFindings: DoctorCheckResult[] = [
      { id: 'f1', category: 'code', severity: 'critical', status: 'fail', title: 'T1', message: 'M1' },
      { id: 'f2', category: 'code', severity: 'medium', status: 'warn', title: 'T2', message: 'M2' },
    ];

    const merged = mergeReports(report, aiFindings, 'codex', 8000);
    expect(merged.summary.total).toBe(3);
    expect(merged.summary.critical).toBe(1);
    expect(merged.summary.medium).toBe(1);
    expect(merged.summary.pass).toBe(1);
  });

  it('honors severity threshold when computing status (critical threshold ignores high AI findings)', () => {
    const report = makeBaseReport();
    const aiFindings: DoctorCheckResult[] = [
      { id: 'f-high', category: 'code', severity: 'high', status: 'fail', title: 'High', message: 'M' },
    ];
    const merged = mergeReports(report, aiFindings, 'github-copilot', 1000, undefined, 'critical');
    expect(merged.summary.high).toBe(1);
    expect(merged.summary.status).toBe('pass');
  });

  it('honors severity threshold (high threshold fails on AI high finding)', () => {
    const report = makeBaseReport();
    const aiFindings: DoctorCheckResult[] = [
      { id: 'f-high', category: 'code', severity: 'high', status: 'fail', title: 'High', message: 'M' },
    ];
    const merged = mergeReports(report, aiFindings, 'github-copilot', 1000, undefined, 'high');
    expect(merged.summary.status).toBe('fail');
  });

  it('honors severity threshold (low threshold fails on AI medium warn)', () => {
    const report = makeBaseReport();
    const aiFindings: DoctorCheckResult[] = [
      { id: 'f-med', category: 'code', severity: 'medium', status: 'warn', title: 'Med', message: 'M' },
    ];
    const merged = mergeReports(report, aiFindings, 'github-copilot', 1000, undefined, 'low');
    expect(merged.summary.status).toBe('fail');
  });

  it('treats unknown severity as fail-closed (matches Tier 1 semantics)', () => {
    const report = makeBaseReport();
    // AI returned an unrecognized severity — should NOT silently pass
    const aiFindings: DoctorCheckResult[] = [
      { id: 'f-bad', category: 'code', severity: 'foo' as unknown as 'high', status: 'fail', title: 'Bad', message: 'M' },
    ];
    const merged = mergeReports(report, aiFindings, 'github-copilot', 1000, undefined, 'high');
    expect(merged.summary.status).toBe('fail');
  });
});
