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
import type { BuildTargetName } from '../types.js';
import { ALL_CHECKS } from './checks.js';
import { loadProjectContext } from './context.js';
import { resolveStacks } from './stacks.js';
import { buildDoctorPrompt, runAiAnalysis, mergeReports } from './ai-analysis.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

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

  // Resolve stacks from API / cache / fallback
  const cacheDir = join(options.dir, '.azure-functions-doctor');
  ctx.stacks = await resolveStacks({
    cacheDir,
    offline: process.env.AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE === '1',
  });

  const checksToRun = filterChecks(ALL_CHECKS, ctx, options.checks);
  const results = await executeChecks(checksToRun, ctx);

  const summary = buildSummary(results, options.severity);
  let report: DoctorReport = {
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

  // Tier 2: AI analysis (when --deep is enabled)
  if (options.deep) {
    if (!options.acceptDeepRisk) {
      report = {
        ...report,
        tiers: {
          ...report.tiers,
          ai: {
            ran: false,
            checks: [],
            error: 'AI analysis skipped: --deep runs the agent with elevated permissions (file write, shell execution). Re-run with --accept-deep-risk only on trusted workspaces.',
          },
        },
      };
    } else if (isContributorPrContext()) {
      // Refuse --deep on contributor PR contexts: pull-request workspaces
      // contain untrusted code that can prompt-inject the agent.
      report = {
        ...report,
        tiers: {
          ...report.tiers,
          ai: {
            ran: false,
            checks: [],
            error: 'AI analysis refused: --deep must not run on contributor pull request workspaces. Pull request code is untrusted and can prompt-inject the agent. Run --deep only in post-merge or release jobs where the workspace is trusted. See docs/doctor-guide.md → Security model.',
          },
        },
      };
    } else {
      const resolvedAgent = options.agent;
      if (!resolvedAgent) {
        report = {
          ...report,
          tiers: {
            ...report.tiers,
            ai: {
              ran: false,
              checks: [],
              error: 'AI analysis skipped: --agent is required. Pass --agent github-copilot|claude-code|codex.',
            },
          },
        };
      } else if (ctx.hostJson === null) {
        report = {
          ...report,
          tiers: {
            ...report.tiers,
            ai: {
              ran: false,
              checks: [],
              agent: resolvedAgent,
              error: 'AI analysis skipped because host.json is missing. Run doctor from an Azure Functions project directory or pass --dir.',
            },
          },
        };
      } else {
        // Ensure skill files are installed so the agent has context
        await ensureSkillsInstalled(options.dir, resolvedAgent);

        const reportPath = join(
          options.dir,
          '.azure-functions-doctor',
          'doctor-ai-findings.json',
        );
        const prompt = buildDoctorPrompt(results, reportPath);
        const timeoutMs = options.timeout * 1000;
        const aiResult = await runAiAnalysis(
          resolvedAgent,
          prompt,
          reportPath,
          options.dir,
          timeoutMs,
        );
        report = mergeReports(report, aiResult.findings, resolvedAgent, aiResult.durationMs, aiResult.error, options.severity);
      }
    }
  }

  const exitCode = report.summary.status === 'fail' ? 1 : 0;
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

/**
 * Ensure workspace-local skills are available before deep analysis.
 */
async function ensureSkillsInstalled(dir: string, agentLauncher: string): Promise<void> {
  const target = launcherToTarget(agentLauncher);
  if (existsSync(localSkillRoot(dir, target))) return;
  const { installLocalSkills } = await import('../setup/index.js');
  await installLocalSkills({
    targetDir: dir,
    agents: [target],
    checkForUpdates: false,
  });
}

function launcherToTarget(agent: string): BuildTargetName {
  switch (agent) {
    case 'github-copilot': return 'ghcp';
    case 'claude-code': return 'claude';
    case 'codex': return 'codex';
    default: throw new Error(`Unknown agent launcher: ${agent}. Expected: github-copilot, claude-code, or codex`);
  }
}

function localSkillRoot(dir: string, target: BuildTargetName): string {
  if (target === 'ghcp') return join(dir, '.github', 'skills', 'azure-functions-doctor', 'SKILL.md');
  if (target === 'claude') return join(dir, '.claude', 'skills', 'azure-functions-doctor', 'SKILL.md');
  return join(dir, '.agents', 'skills', 'azure-functions-doctor', 'SKILL.md');
}

/**
 * Detect whether doctor is being invoked on a contributor pull request context.
 *
 * --deep spawns an LLM agent with file-write and shell-execution permissions.
 * Running it on workspace files from an untrusted PR is equivalent to giving
 * that PR shell access to the runner: prompt injection in the PR's source
 * code can hijack the agent into exfiltrating secrets, modifying files, or
 * running arbitrary commands. We therefore refuse --deep when a PR-like
 * context is detected.
 *
 * Heuristics across GitHub Actions, Azure DevOps, and GitLab CI:
 *   - GitHub Actions: GITHUB_EVENT_NAME=pull_request or pull_request_target
 *   - Azure DevOps: BUILD_REASON=PullRequest
 *   - GitLab CI: CI_PIPELINE_SOURCE=merge_request_event
 *
 * Override: AZURE_FUNCTIONS_DOCTOR_TRUST_PR=1 explicitly opts in (for
 * mirror or trusted-environment workflows that need to scan PRs).
 */
export function isContributorPrContext(): boolean {
  if (process.env.AZURE_FUNCTIONS_DOCTOR_TRUST_PR === '1') return false;
  const githubEvent = process.env.GITHUB_EVENT_NAME;
  if (githubEvent === 'pull_request' || githubEvent === 'pull_request_target') return true;
  if (process.env.BUILD_REASON === 'PullRequest') return true;
  if (process.env.CI_PIPELINE_SOURCE === 'merge_request_event') return true;
  return false;
}
