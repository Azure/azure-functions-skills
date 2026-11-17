import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleForSkill, NO_BUNDLE, telemetryDistribution } from './distribution.js';
import { parseHookEvent } from './hook-event.js';
import { collectDeploymentObservation, parseDeploymentObservationInput } from './deployment-observation.js';
import { isOptedOut, sendTelemetryEvent } from './sender.js';
import { readWorkspaceTelemetryState } from './workspace-optout.js';

const HOOK_INPUT_LIMIT_BYTES = 1024 * 1024;
const OBSERVATION_INPUT_LIMIT_BYTES = 16 * 1024;
const HOOK_DEADLINE_MS = 5_500;
const runtimeDir = dirname(fileURLToPath(import.meta.url));

/**
 * Hook entry for the starter's `node -e` command. It reads the hook input from
 * stdin and sends at most one usage event. It never throws and never writes
 * to stdout or stderr.
 */
export async function runHook(client?: string): Promise<void> {
  // Copilot CLI also reads `.claude/settings.json`; that hook belongs to Claude.
  if (client === 'claude-code' && process.env.COPILOT_CLI === '1') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>(resolveDeadline => {
    timer = setTimeout(resolveDeadline, HOOK_DEADLINE_MS);
  });
  try {
    await Promise.race([handleHook(client, process.cwd()), deadline]);
  } catch {
    // Telemetry must not change the tool result.
  } finally {
    clearTimeout(timer);
  }
}

async function handleHook(client: string | undefined, workspaceDir: string): Promise<void> {
  if (!telemetryActive(workspaceDir)) return;
  const value: unknown = JSON.parse(await readInput(HOOK_INPUT_LIMIT_BYTES));
  const distribution = telemetryDistribution(runtimeDir);
  const event = parseHookEvent(value, process.env, {
    clientName: client,
    distribution,
    // Only the starter writes bundle install records next to its runtime.
    bundleFor: skillName => (distribution === 'starter' ? bundleForSkill(join(runtimeDir, '..'), skillName) : NO_BUNDLE),
  });
  if (event !== undefined) await sendTelemetryEvent(event);
}

function telemetryActive(workspaceDir: string): boolean {
  const configPaths = [join(runtimeDir, '..', 'telemetry.config.json')];
  // Hooks can run below the workspace root. An enabled child must not override
  // an ancestor's opt-out, including when no Git metadata is available.
  for (let directory = workspaceDir; ; directory = dirname(directory)) {
    configPaths.push(...['.github', '.claude', '.codex']
      .map(host => join(directory, host, 'hooks', 'telemetry.config.json')));
    configPaths.push(join(directory, '.azure-functions-skills', 'telemetry.config.json'));
    if (dirname(directory) === directory) break;
  }
  return !isOptedOut(process.env) && readWorkspaceTelemetryState(configPaths) === 'active';
}

async function readInput(limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new Error(`Telemetry input exceeds ${limit} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function runCommandLine(args: readonly string[]): Promise<void> {
  const observation = args[0] === 'deployment-observed';
  const dirIndex = args.indexOf('--dir');
  const workspaceDir = resolve(dirIndex >= 0 && args[dirIndex + 1] ? args[dirIndex + 1] : process.cwd());
  let finished = false;
  const finish = (status?: string): void => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    if (observation) {
      process.stdout.once('error', () => process.exit(0));
      process.stdout.write(`${status ?? 'failed'}\n`, () => process.exit(0));
    } else {
      process.exit(0);
    }
  };
  const deadline = setTimeout(() => finish('failed'), observation ? 26_000 : HOOK_DEADLINE_MS);
  try {
    if (args[0] !== 'hook' && !observation) throw new Error('Use hook or deployment-observed.');
    if (!telemetryActive(workspaceDir)) return finish('disabled');
    if (observation) {
      const input = parseDeploymentObservationInput(JSON.parse(await readInput(OBSERVATION_INPUT_LIMIT_BYTES)));
      return finish((await collectDeploymentObservation(input)).status);
    }
    await handleHook(undefined, workspaceDir);
    finish();
  } catch {
    finish('failed');
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) void runCommandLine(process.argv.slice(2));
