import { describe, it, expect, afterAll, vi, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import {
  buildDoctorPrompt,
  buildAgentCommand,
  readAiReport,
  mergeReports,
} from '../src/doctor/ai-analysis.js';
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
});

// ── buildAgentCommand ──

describe('buildAgentCommand', () => {
  it('builds github-copilot headless command', () => {
    const cmd = buildAgentCommand('github-copilot', 'analyze this', '/tmp/report.json');
    expect(cmd.command).toBe('copilot');
    expect(cmd.args).toContain('-p');
    expect(cmd.args.some(a => a.includes('analyze this'))).toBe(true);
  });

  it('builds claude-code headless command', () => {
    const cmd = buildAgentCommand('claude-code', 'analyze this', '/tmp/report.json');
    expect(cmd.command).toBe('claude');
    expect(cmd.args).toContain('-p');
    expect(cmd.args).toContain('--dangerously-skip-permissions');
  });

  it('builds codex headless command', () => {
    const cmd = buildAgentCommand('codex', 'analyze this', '/tmp/report.json');
    expect(cmd.command).toBe('codex');
    expect(cmd.args).toContain('--approval-mode');
  });

  it('throws for unknown agent', () => {
    expect(() => buildAgentCommand('unknown-agent', 'test', '/tmp/r.json'))
      .toThrow('Unknown agent');
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
});
