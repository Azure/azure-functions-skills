/**
 * DoctorRunner — execute checks, aggregate results, produce report.
 */
import type {
  CheckSeverity,
  DoctorCheck,
  DoctorCheckResult,
  DoctorOptions,
  DoctorReport,
  ProjectContext,
  ReportSummary,
} from './types.js';
import { ALL_CHECKS } from './checks.js';
import { loadProjectContext } from './context.js';

const SEVERITY_ORDER: CheckSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

function severityRank(s: CheckSeverity): number {
  return SEVERITY_ORDER.indexOf(s);
}

function meetsThreshold(result: DoctorCheckResult, threshold: CheckSeverity): boolean {
  return severityRank(result.severity) <= severityRank(threshold);
}

function buildSummary(checks: DoctorCheckResult[], threshold: CheckSeverity): ReportSummary {
  let critical = 0, high = 0, medium = 0, low = 0, pass = 0;
  let hasFailing = false;

  for (const c of checks) {
    if (c.status === 'pass' || c.status === 'skip') {
      pass++;
      continue;
    }
    switch (c.severity) {
      case 'critical': critical++; break;
      case 'high': high++; break;
      case 'medium': medium++; break;
      case 'low': low++; break;
    }
    if ((c.status === 'fail' || c.status === 'warn') && meetsThreshold(c, threshold)) {
      hasFailing = true;
    }
  }

  return {
    total: checks.length,
    critical,
    high,
    medium,
    low,
    pass,
    status: hasFailing ? 'fail' : 'pass',
  };
}

export interface RunResult {
  report: DoctorReport;
  exitCode: number;
}

export async function runDoctor(options: DoctorOptions): Promise<RunResult> {
  const ctx = await loadProjectContext(options.dir);
  const checksToRun = filterChecks(ALL_CHECKS, ctx, options.checks);
  const results = await executeChecks(checksToRun, ctx);

  const summary = buildSummary(results, options.severity);
  const report: DoctorReport = {
    version: 1,
    timestamp: new Date().toISOString(),
    workspace: options.dir,
    language: ctx.language,
    tiers: {
      builtin: { ran: true, checks: results },
      ai: { ran: false, checks: [] },
    },
    summary,
  };

  const exitCode = summary.status === 'fail' ? 1 : 0;
  return { report, exitCode };
}

function filterChecks(
  allChecks: DoctorCheck[],
  ctx: ProjectContext,
  selectedIds?: string[],
): DoctorCheck[] {
  let checks = allChecks.filter(c => c.appliesTo(ctx));
  if (selectedIds && selectedIds.length > 0) {
    const idSet = new Set(selectedIds);
    checks = checks.filter(c => idSet.has(c.id));
  }
  return checks;
}

async function executeChecks(
  checks: DoctorCheck[],
  ctx: ProjectContext,
): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];
  for (const check of checks) {
    const checkResults = await check.run(ctx);
    results.push(...checkResults);
  }
  return results;
}
