import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Runner, RunResult } from '../shared/exec.js';
import { EXIT, fail, succeed, type Finding, type ToolResult } from '../shared/output.js';
import { redact } from '../shared/redact.js';
import {
  ensureWorkDir, isValidStep, logFilePath, planFilePath, readPlan, readState, writeState,
  type DeployPlan, type PlanStep, type StepId,
} from './plan-file.js';
import { inspectProject, readEnvironmentValues } from './project.js';

export interface ApplyOptions {
  readonly dir: string;
  /** The plan id that the user approved. */
  readonly approve: string;
  /** Prepare the environment and show the infrastructure change, then stop. */
  readonly preview: boolean;
}

export interface ApplyDependencies {
  readonly run: Runner;
}

export interface ApplyData {
  readonly planId?: string;
  readonly environment?: string;
  readonly completed?: readonly StepId[];
  readonly failedStep?: StepId;
  readonly outputTail?: string;
  readonly logFile?: string;
  readonly preview?: string;
  readonly functionApp?: string | null;
  /** Present when the run matches a full `azd up`, which the deployment collector supports. */
  readonly telemetry?: { readonly operation: 'deploy'; readonly environmentName: string };
}

const COMMAND = 'deploy apply';
const TAIL_LINES = 40;

export async function applyDeploy(options: ApplyOptions, dependencies: ApplyDependencies): Promise<ToolResult<ApplyData>> {
  const dir = resolve(options.dir);
  const plan = readPlan(planFilePath(dir));
  if (!plan) {
    return blocked('No usable plan was found', {
      id: 'DEPLOY-PLAN-MISSING', severity: 'error', title: 'The plan file is missing or was changed after it was written',
      fix: 'Run deploy plan again and ask the user to approve the new plan.',
    });
  }
  if (!options.approve || options.approve !== plan.planId) {
    return blocked('The plan was not approved', {
      id: 'DEPLOY-PLAN-NOT-APPROVED', severity: 'error', title: '--approve does not match the current plan id',
      fix: 'Show the current plan to the user. Pass its plan id only after they approve it.',
    });
  }
  if (plan.steps.some(step => !isValidStep(step, plan))) {
    return blocked('The plan contains a step that is not part of a deployment', {
      id: 'DEPLOY-PLAN-INVALID', severity: 'error', title: 'A plan step is not one of the allowed azd commands',
      fix: 'Run deploy plan again.',
    });
  }
  if (inspectProject(dir).fingerprint !== plan.fingerprint) {
    return blocked('The project changed after the plan was written', {
      id: 'DEPLOY-PLAN-STALE', severity: 'error', title: 'azure.yaml or infra/ changed after planning',
      fix: 'Run deploy plan again and ask the user to approve the new plan.',
    });
  }

  ensureWorkDir(dir);
  const logFile = logFilePath(dir);
  const completed = [...readState(dir, plan).completed];
  for (const step of plan.steps) {
    if (completed.includes(step.id)) continue;
    const isPreview = options.preview && step.changes !== 'local-environment';
    const args = isPreview ? [...step.args, '--preview'] : [...step.args];
    if (isPreview && step.id !== 'provision') break;

    const outcome = await dependencies.run('azd', args, { cwd: dir, timeoutMs: step.timeoutSeconds * 1000 });
    const output = redact([outcome.stdout, outcome.stderr].filter(Boolean).join('\n'));
    appendFileSync(logFile, `--- ${step.id} (exit ${outcome.code ?? 'none'})\n${output}\n`);

    if (outcome.code !== 0) {
      return fail<ApplyData>(COMMAND, EXIT.stepFailed, `Step ${step.id} failed`, {
        data: { planId: plan.planId, environment: plan.environment, completed, failedStep: step.id, outputTail: tail(output), logFile },
        findings: [failure(step, outcome, output)],
        next: {
          action: 'fix-then-resume',
          reason: 'Fix the cause, then run the same command. Finished steps are not repeated. Do not retry unchanged.',
          command: resumeCommand(dir, plan),
        },
      });
    }
    if (isPreview) {
      return succeed<ApplyData>(COMMAND, 'Previewed the infrastructure change. Nothing was provisioned.', {
        planId: plan.planId, environment: plan.environment, completed, preview: tail(output), logFile,
      }, { next: { action: 'approve', reason: 'Run without --preview after the user approves.', command: resumeCommand(dir, plan) } });
    }
    completed.push(step.id);
    writeState(dir, { planId: plan.planId, completed });
  }
  if (options.preview) {
    return succeed<ApplyData>(COMMAND, 'This plan has no infrastructure change to preview.', {
      planId: plan.planId, environment: plan.environment, completed, logFile,
    });
  }

  const functionApp = functionAppName(readEnvironmentValues(dir, plan.environment) ?? {});
  return succeed<ApplyData>(COMMAND, `Deployed environment ${plan.environment}`, {
    planId: plan.planId,
    environment: plan.environment,
    completed,
    functionApp,
    logFile,
    ...(plan.mode === 'provision-and-deploy'
      ? { telemetry: { operation: 'deploy' as const, environmentName: plan.environment } }
      : {}),
  }, {
    next: {
      action: 'verify', reason: 'Confirm that the functions are listed and respond.',
      command: `deploy verify --dir "${dir}" --env ${plan.environment}`,
    },
  });
}

/** Reads the function app name from the outputs that azd templates write to the environment. */
export function functionAppName(values: Readonly<Record<string, string>>): string | null {
  if (values.AZURE_FUNCTION_NAME) return values.AZURE_FUNCTION_NAME;
  const serviceNames = Object.entries(values).filter(([key, value]) => /^SERVICE_[A-Z0-9_]+_NAME$/.test(key) && value);
  return serviceNames.length === 1 ? serviceNames[0][1] : null;
}

function blocked(summary: string, finding: Finding): ToolResult<ApplyData> {
  return fail<ApplyData>(COMMAND, EXIT.blocked, summary, { findings: [finding] });
}

function resumeCommand(dir: string, plan: DeployPlan): string {
  return `deploy apply --dir "${dir}" --approve ${plan.planId}`;
}

function failure(step: PlanStep, outcome: RunResult, output: string): Finding {
  const base = { id: 'DEPLOY-STEP-FAILED', severity: 'error' as const };
  if (outcome.notFound) return { ...base, title: 'The azd command was not found', fix: 'Install the Azure Developer CLI.' };
  if (outcome.timedOut) {
    return {
      ...base,
      title: `azd ${step.args[0]} timed out after ${step.timeoutSeconds} seconds`,
      detail: 'The operation may still be running in Azure. Check its state before resuming.',
    };
  }
  const title = `azd ${step.args[0]} exited with code ${outcome.code}`;
  if (/not logged in|azd auth login|AADSTS|reauthentication required/i.test(output)) {
    return { ...base, title, detail: 'Authentication failed.', fix: 'azd auth login' };
  }
  if (/quota|SkuNotAvailable|LocationNotAvailable|not available in (?:the )?(?:location|region)/i.test(output)) {
    return {
      ...base, title, detail: 'The subscription or region cannot supply the requested resources.',
      fix: 'Plan again with another --location and a new --env name.',
    };
  }
  return { ...base, title, detail: 'Read data.outputTail and the log file for the cause.' };
}

function tail(text: string): string {
  return text.split(/\r?\n/).slice(-TAIL_LINES).join('\n').trim();
}
