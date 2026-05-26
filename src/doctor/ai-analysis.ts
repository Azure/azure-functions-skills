/**
 * Tier 2: AI-powered analysis via headless agent execution.
 *
 * Builds the doctor prompt, launches an agent in headless mode,
 * reads the resulting report file, and merges findings into the report.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { DoctorCheckResult, DoctorReport } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Prompt builder ──

export function buildDoctorPrompt(
  tier1Results: DoctorCheckResult[],
  reportPath: string,
): string {
  const tier1Summary = tier1Results.length > 0
    ? tier1Results.map(r => `- [${r.status}] ${r.id}: ${r.message}`).join('\n')
    : '(no built-in checks ran)';

  return `You are running azure-functions-doctor. Analyze the workspace for Azure Functions code and configuration issues.

## Context from built-in checks (Tier 1)
${tier1Summary}

## Analysis scope

Focus on issues that require semantic understanding:

### Code quality
- Exception handling gaps in function handlers
- Resource disposal issues (HttpClient, database connections not disposed)
- Async/await anti-patterns (fire-and-forget, missing await)
- Hardcoded secrets or connection strings in source code
- Deprecated API usage

### Configuration coherence
- host.json settings conflicting with function bindings
- App settings referenced in code but missing from local.settings.json
- Scaling configuration issues
- Timer trigger schedule conflicts with execution time
- Connection setting name mismatches between bindings and settings

### Azure Functions-specific patterns
- Durable Functions orchestrator determinism violations
- Service Bus autoComplete conflicts with manual completion
- Missing or incorrect FUNCTIONS_WORKER_RUNTIME

## Output

Write your findings as a JSON array to: ${reportPath}

Each finding must have: id (kebab-case), category (code|configuration|pattern), severity (critical|high|medium|low|info), status (fail|warn), title, message. Optional: file, line, recommendation.

If no issues are found, write an empty JSON array [].
Do not modify any project files — read-only analysis only.`;
}

// ── Agent command builder ──

export interface AgentCommand {
  command: string;
  args: string[];
}

export function buildAgentCommand(
  agent: string,
  prompt: string,
  _reportPath: string,
): AgentCommand {
  switch (agent) {
    case 'github-copilot':
      return {
        command: 'copilot',
        args: ['-p', prompt, '--allow-tool=write', '--allow-tool=shell(cat)', '--allow-tool=shell(node)'],
      };

    case 'claude-code':
      return {
        command: 'claude',
        args: [
          '-p', prompt,
          '--dangerously-skip-permissions',
          '--max-turns', '20',
        ],
      };

    case 'codex':
      return {
        command: 'codex',
        args: ['--approval-mode', 'full-auto', '-q', prompt],
      };

    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

// ── Agent executor ──

export interface AiAnalysisResult {
  findings: DoctorCheckResult[];
  durationMs: number;
  error?: string;
}

export async function runAiAnalysis(
  agent: string,
  prompt: string,
  reportPath: string,
  dir: string,
  timeoutMs: number,
): Promise<AiAnalysisResult> {
  const startTime = Date.now();
  const cmd = buildAgentCommand(agent, prompt, reportPath);

  try {
    await spawnAgent(cmd, dir, timeoutMs);
  } catch (err) {
    return {
      findings: [],
      durationMs: Date.now() - startTime,
      error: `AI analysis failed: ${(err as Error).message}`,
    };
  }

  const findings = await readAiReport(reportPath);
  return {
    findings,
    durationMs: Date.now() - startTime,
  };
}

function spawnAgent(cmd: AgentCommand, dir: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, {
      cwd: dir,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Agent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Agent exited with code ${code}`));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Report file reader ──

export async function readAiReport(reportPath: string): Promise<DoctorCheckResult[]> {
  try {
    if (!existsSync(reportPath)) return [];
    const content = await readFile(reportPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed)) return [];

    // Validate each entry has required fields
    return parsed.filter((entry: unknown): entry is DoctorCheckResult => {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return (
        typeof e.id === 'string' &&
        typeof e.category === 'string' &&
        typeof e.severity === 'string' &&
        typeof e.status === 'string' &&
        typeof e.title === 'string' &&
        typeof e.message === 'string'
      );
    });
  } catch {
    return [];
  }
}

// ── Report merger ──

export function mergeReports(
  report: DoctorReport,
  aiFindings: DoctorCheckResult[],
  agent: string,
  durationMs: number,
): DoctorReport {
  const allChecks = [...report.tiers.builtin.checks, ...aiFindings];

  let critical = 0, high = 0, medium = 0, low = 0, pass = 0;
  for (const c of allChecks) {
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
  }

  const hasFailing = critical > 0 || high > 0;

  return {
    ...report,
    tiers: {
      ...report.tiers,
      ai: {
        ran: true,
        checks: aiFindings,
        agent,
        durationMs,
      },
    },
    summary: {
      total: allChecks.length,
      critical,
      high,
      medium,
      low,
      pass,
      status: hasFailing ? 'fail' : 'pass',
    },
  };
}
