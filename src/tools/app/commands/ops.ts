import { boolFlag, intFlag, stringFlag } from '../args.js';
import { AzureError, type AzureClient } from '../azure.js';
import type { Finding } from '../output.js';
import { WEB_API_VERSION, type AppTarget } from '../target.js';
import { appTarget, isOutcomeUnknown, outcomeUnknown, requireApproval, tryRead, waitFor } from './common.js';
import type { CommandSpec } from './types.js';

export interface HostStatus {
  id?: string;
  state?: string;
  version?: string;
  platformVersion?: string;
  instanceId?: string;
  /** Milliseconds since the host process started. */
  processUptime?: number;
  errors?: string[];
  extensionBundle?: { id?: string; version?: string };
}

const POLL_MS = 10_000;

/** Reads the Functions host status through the ARM proxy (no master key needed). */
export function readHostStatus(client: AzureClient, app: AppTarget): Promise<HostStatus> {
  return client.arm<HostStatus>('GET', `${app.id}/hostruntime/admin/host/status`, WEB_API_VERSION);
}

/** True when the host process is newer than the one observed before the restart. */
export function isRestarted(before: HostStatus | undefined, after: HostStatus, elapsedMs: number): boolean {
  if (after.state !== 'Running') return false;
  if (before?.instanceId && after.instanceId && before.instanceId !== after.instanceId) return true;
  if (typeof after.processUptime !== 'number') return false;
  if (typeof before?.processUptime === 'number') return after.processUptime < before.processUptime;
  return after.processUptime <= elapsedMs + POLL_MS;
}

interface HostKeys {
  masterKey?: string;
  functionKeys?: Record<string, string>;
  systemKeys?: Record<string, string>;
}

export const opsCommands: CommandSpec[] = [
  {
    name: 'host status',
    usage: 'host status --app <name|id> [--slot <s>] [--full]',
    description: 'Show the Functions host state, version, extension bundle, and uptime.',
    details: ['--full returns the raw host status payload from the runtime (all fields).', 'Function list, trigger types, and disabled state: `functions list`.'],
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const status = await readHostStatus(client, app);
      const findings: Finding[] = [];
      if (status.state !== 'Running') {
        findings.push({ severity: 'error', code: 'HostNotRunning', message: `Host state is ${status.state ?? 'unknown'}${status.errors?.length ? `: ${status.errors.join('; ')}` : ''}.`, fix: 'Check `logs query --preset errors` and `settings list` (storage and Key Vault references).' });
      }
      return {
        summary: `${app.label}: host ${status.state ?? 'unknown'}, version ${status.version ?? 'unknown'}.`,
        data: boolFlag(args, 'full') ? status : { state: status.state, version: status.version, platformVersion: status.platformVersion, extensionBundle: status.extensionBundle, uptimeSeconds: typeof status.processUptime === 'number' ? Math.round(status.processUptime / 1000) : undefined, errors: status.errors },
        findings,
      };
    },
  },
  {
    name: 'keys list',
    usage: 'keys list --app <name|id> [--slot <s>] [--function <name>]',
    description: 'List host key names (master, function, system), or one function\'s key names with --function. Values are never printed.',
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const fn = stringFlag(args, 'function');
      if (fn) {
        const keys = await client.arm<Record<string, string>>('POST', `${app.id}/functions/${encodeURIComponent(fn)}/listkeys`, WEB_API_VERSION, { idempotent: true });
        const names = Object.keys(keys ?? {});
        return {
          summary: `${app.label}/${fn}: ${names.length} function key(s). Values are hidden.`,
          data: { function: fn, keys: names },
          next: ['To call the function with a key, let the user copy it themselves; do not print key values.'],
        };
      }
      const keys = await client.arm<HostKeys>('POST', `${app.id}/host/default/listkeys`, WEB_API_VERSION, { idempotent: true });
      return {
        summary: `${app.label}: ${Object.keys(keys.functionKeys ?? {}).length} function key(s), ${Object.keys(keys.systemKeys ?? {}).length} system key(s). Values are hidden.`,
        data: { masterKey: Boolean(keys.masterKey), functionKeys: Object.keys(keys.functionKeys ?? {}), systemKeys: Object.keys(keys.systemKeys ?? {}) },
        next: ['To call a function with a key, let the user copy it themselves; do not print key values.'],
      };
    },
  },
  {
    name: 'restart',
    usage: 'restart --app <name|id> [--slot <s>] [--approve] [--wait 180]',
    description: 'Restart the app once and verify the new host process through the host status.',
    handler: async (args, { client, sleep }) => {
      const app = await appTarget(client, args);
      const waitSeconds = intFlag(args, 'wait', 180, 900);
      requireApproval(args, `restart ${app.ref}`, {
        risk: 'R1',
        impact: `Restart ${app.label}. In-flight executions stop; the app is unavailable for a short time.`,
        steps: [{ action: 'restart', method: 'POST', url: `${app.id}/restart` }],
        rollback: 'None needed; the app comes back on its own.',
      });
      const before = await tryRead(() => readHostStatus(client, app));
      try {
        await client.arm('POST', `${app.id}/restart`, WEB_API_VERSION);
      } catch (error) {
        if (isOutcomeUnknown(error)) throw outcomeUnknown(error as AzureError, `Restart of ${app.label}`, `host status ${app.ref}`);
        throw error;
      }
      const result = await waitFor(() => tryRead(() => readHostStatus(client, app)), (status, elapsed) => isRestarted(before, status, elapsed), { sleep, waitMs: waitSeconds * 1000, intervalMs: POLL_MS });
      const data = { verified: result.done, waitedSeconds: Math.round(result.elapsedMs / 1000), state: result.value?.state, before: before && { instanceId: before.instanceId, uptimeSeconds: secondsOf(before) }, after: result.value && { instanceId: result.value.instanceId, uptimeSeconds: secondsOf(result.value) } };
      if (result.done) return { summary: `${app.label} restarted and the host is Running.`, data };
      return {
        summary: `${app.label}: restart was sent once, but a new host process was not confirmed within ${waitSeconds}s.`,
        data,
        findings: [{ severity: 'warning', code: 'RestartNotVerified', message: 'The restart request succeeded but the host status did not show a new process yet.', fix: 'Do not restart again. Run `host status` in a minute; if the host is not Running, check `logs query --preset errors`.' }],
      };
    },
  },
];

function secondsOf(status: HostStatus): number | undefined {
  return typeof status.processUptime === 'number' ? Math.round(status.processUptime / 1000) : undefined;
}
