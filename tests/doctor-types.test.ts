import { describe, it, expect } from 'vitest';
import type {
  CheckSeverity,
  CheckStatus,
  DoctorCheck,
  DoctorCheckResult,
  DoctorOptions,
  DoctorReport,
  FunctionInfo,
  OutputFormat,
  ProjectContext,
  ProjectLanguage,
} from '../src/doctor/types.js';

describe('Doctor types', () => {
  it('DoctorCheckResult has required fields', () => {
    const result: DoctorCheckResult = {
      id: 'project-exists',
      category: 'structure',
      severity: 'critical',
      status: 'pass',
      title: 'Functions project found',
      message: 'host.json exists',
    };
    expect(result.id).toBe('project-exists');
    expect(result.status).toBe('pass');
    expect(result.severity).toBe('critical');
  });

  it('DoctorCheckResult accepts optional fields', () => {
    const result: DoctorCheckResult = {
      id: 'extension-bundle',
      category: 'configuration',
      severity: 'high',
      status: 'fail',
      title: 'Extension bundle outdated',
      message: 'Bundle version [3.*, 4.0.0) is outdated',
      file: 'host.json',
      line: 5,
      recommendation: 'Update extensionBundle to [4.0.0, 5.0.0)',
    };
    expect(result.file).toBe('host.json');
    expect(result.line).toBe(5);
    expect(result.recommendation).toBeDefined();
  });

  it('ProjectContext captures workspace metadata', () => {
    const ctx: ProjectContext = {
      dir: '/test/project',
      language: 'node',
      hostJson: { version: '2.0' },
      localSettings: { IsEncrypted: false, Values: {} },
      packageJson: { name: 'my-func', version: '1.0.0' },
      functions: [],
    };
    expect(ctx.language).toBe('node');
    expect(ctx.hostJson).not.toBeNull();
  });

  it('FunctionInfo captures trigger metadata', () => {
    const fn: FunctionInfo = {
      name: 'HttpTrigger1',
      triggerType: 'httpTrigger',
      bindingTypes: ['httpTrigger', 'http'],
      entryPoint: 'src/functions/httpTrigger1.ts',
    };
    expect(fn.triggerType).toBe('httpTrigger');
    expect(fn.bindingTypes).toHaveLength(2);
  });

  it('DoctorCheck interface works as a check implementation', async () => {
    const check: DoctorCheck = {
      id: 'test-check',
      category: 'test',
      defaultSeverity: 'medium',
      appliesTo: (_ctx) => _ctx.language === 'node',
      run: async (_ctx) => [{
        id: 'test-check',
        category: 'test',
        severity: 'medium',
        status: 'pass',
        title: 'Test check',
        message: 'OK',
      }],
    };

    const ctx: ProjectContext = {
      dir: '/test',
      language: 'node',
      hostJson: null,
      localSettings: null,
      packageJson: null,
      functions: [],
    };

    expect(check.appliesTo(ctx)).toBe(true);
    const results = await check.run(ctx);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pass');
  });

  it('DoctorReport has the expected structure', () => {
    const report: DoctorReport = {
      version: 1,
      timestamp: '2026-05-26T00:00:00Z',
      workspace: '/test/project',
      language: 'typescript' as ProjectLanguage,
      tiers: {
        builtin: { ran: true, checks: [] },
        ai: { ran: false, checks: [] },
      },
      summary: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        pass: 0,
        status: 'pass',
      },
    };
    expect(report.version).toBe(1);
    expect(report.tiers.builtin.ran).toBe(true);
    expect(report.tiers.ai.ran).toBe(false);
  });

  it('DoctorOptions defaults are sensible', () => {
    const opts: DoctorOptions = {
      dir: '.',
      deep: false,
      timeout: 300,
      format: 'text',
      output: '.azure-functions-skills/doctor-report.json',
      severity: 'high',
    };
    expect(opts.deep).toBe(false);
    expect(opts.format).toBe('text');
    expect(opts.severity).toBe('high');
  });

  it('CheckSeverity and CheckStatus cover all expected values', () => {
    const severities: CheckSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    const statuses: CheckStatus[] = ['pass', 'warn', 'fail', 'skip'];
    expect(severities).toHaveLength(5);
    expect(statuses).toHaveLength(4);
  });

  it('OutputFormat covers text, json, markdown', () => {
    const formats: OutputFormat[] = ['text', 'json', 'markdown'];
    expect(formats).toHaveLength(3);
  });
});
