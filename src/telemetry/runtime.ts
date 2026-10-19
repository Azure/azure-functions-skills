import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHookEvent } from './hook-event.js';
import { collectDeploymentObservation, parseDeploymentObservationInput } from './deployment-observation.js';
import { isOptedOut, sendTelemetryEvent } from './sender.js';
import { readWorkspaceTelemetryState } from './workspace-optout.js';

const args = process.argv.slice(2);
const observation = args[0] === 'deployment-observed';
const runtimeDir = dirname(fileURLToPath(import.meta.url));
const dirIndex = args.indexOf('--dir');
const workspaceDir = resolve(dirIndex >= 0 && args[dirIndex + 1] ? args[dirIndex + 1] : process.cwd());
const deadline = setTimeout(() => finish('failed'), observation ? 26_000 : 5_500);
let finished = false;

function finish(status?: string): void {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (observation) {
    process.stdout.once('error', () => process.exit(0));
    process.stdout.write(`${status ?? 'failed'}\n`, () => process.exit(0));
  } else {
    process.exit(0);
  }
}

async function main(): Promise<void> {
  if (args[0] !== 'hook' && !observation) throw new Error('Use hook or deployment-observed.');
  const configPaths = [
    join(runtimeDir, '..', 'telemetry.config.json'),
    ...['.github', '.claude', '.codex'].map(host => join(workspaceDir, host, 'hooks', 'telemetry.config.json')),
  ];
  if (isOptedOut(process.env) || readWorkspaceTelemetryState(configPaths) !== 'active') {
    return finish('disabled');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 16 * 1024) throw new Error('Telemetry input exceeds 16384 bytes.');
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  if (observation) {
    const input = parseDeploymentObservationInput(value);
    return finish((await collectDeploymentObservation(input)).status);
  }
  const event = parseHookEvent(value, process.env);
  if (event !== undefined) await sendTelemetryEvent(event);
  finish();
}

main().catch(() => finish('failed'));
