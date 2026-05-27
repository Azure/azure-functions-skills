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
  const cacheDir = join(options.dir, '.azure-functions-skills');
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
      const resolvedAgent = await resolveDeepAgent(options.dir, options.agent);
      if (!resolvedAgent) {
        report = {
          ...report,
          tiers: {
            ...report.tiers,
            ai: {
              ran: false,
              checks: [],
              error: 'AI analysis skipped: no agent specified and none installed in workspace state. Pass --agent github-copilot|claude-code|codex.',
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
        await ensureSkillsInstalled(options.dir, resolvedAgent, options.installMode);

        const reportPath = join(
          options.dir,
          '.azure-functions-skills',
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
 * Ensure skill/agent workspace files are installed before deep analysis.
 * Checks install state; if no agent is installed, runs the install flow.
 *
 * Default: local workspace install (applySetup) — safe for CI and ephemeral environments.
 * With installMode 'plugin': plugin registration + workspace activation.
 */
async function ensureSkillsInstalled(dir: string, agentLauncher: string, installMode: 'local' | 'plugin' = 'local'): Promise<void> {
  const { readState, getInstalledTargets, recordInstallState } = await import('../setup/state.js');

  const target = launcherToTarget(agentLauncher);

  const state = readState(dir);
  if (state) {
    const installed = getInstalledTargets(state);
    // Check that this specific target is installed, not just any target
    if (installed.includes(target)) return;
  }

  let effectiveMode: 'local' | 'plugin' = installMode;
  const includeAgent = target === 'ghcp';

  if (installMode === 'plugin') {
    // Plugin registration + workspace activation (developer machine)
    try {
      const { runPluginOperation } = await import('../setup/plugin-install.js');
      const { applyWorkspace } = await import('../setup/workspace.js');

      await runPluginOperation({
        action: 'install',
        agents: [target],
        projectDir: dir,
        workspace: false,
        yes: true,
      });

      await applyWorkspace(dir, {
        agents: [target],
        mode: 'plugin-reference',
        yes: true,
        includeMcp: true,
        includeHooks: true,
        includeAgent,
      });
    } catch (err) {
      // Fall back to local install if plugin CLI is unavailable
      console.error(`⚠️  Plugin install failed (${(err as Error).message}), falling back to local install.`);
      effectiveMode = 'local';
      const { applySetup } = await import('../setup/index.js');
      await applySetup(dir, { agents: [target], prerequisites: 'skip' });
    }
  } else {
    // Local workspace install (default — CI-safe)
    const { applySetup } = await import('../setup/index.js');
    await applySetup(dir, { agents: [target], prerequisites: 'skip' });
  }

  // Record state with the actual install mode used
  recordInstallState(dir, {
    action: 'install',
    agents: [target],
    mode: effectiveMode,
    source: 'doctor-auto',
    scope: 'workspace',
    includeMcp: effectiveMode === 'plugin',
    includeHooks: effectiveMode === 'plugin',
    includeAgent,
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

function targetToLauncher(target: BuildTargetName): string {
  switch (target) {
    case 'ghcp': return 'github-copilot';
    case 'claude': return 'claude-code';
    case 'codex': return 'codex';
  }
}

/**
 * Resolve which launcher to use for deep analysis.
 * Priority: explicit --agent > first installed agent recorded in state > undefined.
 */
async function resolveDeepAgent(dir: string, explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit;
  const { readState, getInstalledTargets } = await import('../setup/state.js');
  const state = readState(dir);
  if (!state) return undefined;
  const installed = getInstalledTargets(state);
  if (installed.length === 0) return undefined;
  return targetToLauncher(installed[0]);
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

