import { intFlag, stringFlag } from '../args.js';
import { SCM_RESOURCE } from '../azure.js';
import { detectPlan, scmHost, type Site } from '../inspect.js';
import { EXIT, ToolError, type Finding } from '../output.js';
import { scrubText } from '../redact.js';
import { WEB_API_VERSION } from '../target.js';
import { appTarget, requireApproval, tryRead } from './common.js';
import { invokeFunction, readFunction, triggerOf, type InvokeResult } from './invoke.js';
import type { CommandSpec } from './types.js';

const MAX_SECONDS = 120;
const MAX_CHARS = 200_000;
const MAX_LINES = 200;
const LINE_LIMIT = 1000;
/** Lets the stream settle before --invoke so the call's log lines are not missed. */
const INVOKE_DELAY_MS = 2000;
const SENTINEL_PATH = '/api/vfs/LogFiles/Application/Functions/Host/debug_sentinel';
const SENTINEL_TEXT = 'This is a system managed marker file used to control runtime debug mode behavior.';
const BANNER = /connected to log-streaming service|No new trace in the past/i;

/** Splits streamed text into scrubbed, de-duplicated lines (Windows writes each line to the host and function logs). */
export function logLines(text: string): { lines: string[]; total: number } {
  const seen = new Set<string>();
  const lines: string[] = [];
  const segments = text.split('\n');
  const partial = text.endsWith('\n') ? undefined : segments.pop()?.trim();
  for (const raw of segments) {
    const line = raw.trim();
    if (!line || BANNER.test(line) || seen.has(line)) continue;
    seen.add(line);
  }
  // A line cut off by the end of the window is kept only when it is not the start of a line already shown.
  if (partial && !BANNER.test(partial) && ![...seen].some(line => line.startsWith(partial))) seen.add(partial);
  for (const line of seen) {
    const scrubbed = scrubText(line);
    lines.push(scrubbed.length > LINE_LIMIT ? `${scrubbed.slice(0, LINE_LIMIT)}...` : scrubbed);
  }
  return { lines: lines.slice(-MAX_LINES), total: lines.length };
}

export const logStreamCommands: CommandSpec[] = [
  {
    name: 'logs tail',
    usage: 'logs tail --app <name|id> [--slot <s>] [--seconds 30] [--invoke <function>] [--approve]',
    description: 'Watch the live log stream for a bounded time (no portal needed), with the current instance list. --invoke calls a function once while watching.',
    details: [
      'Windows: turns on Functions debug mode first (the same marker file the portal log stream writes; file logging stays on for 15 minutes), then streams LogFiles/Application/Functions over Kudu. Lines from every instance appear because the log files are shared.',
      'Linux (Premium/Dedicated): streams the container log over Kudu; no debug mode is needed.',
      'Flex Consumption and Container Apps have no Kudu log stream: use `logs query` (Application Insights, 1-5 minute delay).',
      '--seconds 1-120 (default 30). Returns up to 200 de-duplicated, redacted lines; the connection banner is dropped.',
      '--invoke <function>: calls the function about 2 s after the stream opens (HTTP GET runs directly; other triggers need --approve) and returns its status with the lines.',
      'Output: data.lines, data.instances {count, names}, data.invoke, data.debugMode, data.ended (timeout | limit | closed).',
    ],
    handler: async (args, context) => {
      const { client, sleep } = context;
      const seconds = intFlag(args, 'seconds', 30, MAX_SECONDS);
      const app = await appTarget(client, args);
      const fnName = stringFlag(args, 'invoke');
      const site = await client.arm<Site>('GET', app.id, WEB_API_VERSION);
      const plan = detectPlan(site);
      const host = scmHost(site);
      if (plan === 'FlexConsumption' || plan === 'ContainerApps' || !host) {
        throw new ToolError(EXIT.unsupported, `${app.label} has no Kudu log stream (${plan === 'Dedicated' ? 'no SCM endpoint' : plan}).`, {
          next: [`Use \`logs query ${app.ref} --preset traces --since 15m\` (Application Insights; new events take 1-5 minutes to appear).`],
        });
      }

      const preview = fnName ? await readFunction(client, app, fnName) : undefined;
      if (fnName && preview) {
        const trigger = triggerOf(preview);
        const method = (trigger?.methods?.[0] ?? 'GET').toUpperCase();
        if (trigger?.type?.toLowerCase() !== 'httptrigger' || method !== 'GET') {
          requireApproval(args, `logs tail ${app.ref} --invoke ${fnName}`, {
            risk: 'R1',
            impact: `Run ${fnName} (${trigger?.type ?? 'unknown trigger'}) once on ${app.label} while watching the log stream. Its side effects happen for real.`,
            steps: [{ action: 'run function', method: trigger?.type?.toLowerCase() === 'httptrigger' ? method : 'POST', url: preview.properties.invoke_url_template ?? `https://<host>/admin/functions/${fnName}` }],
            rollback: 'None; undo any side effects of the function yourself.',
          });
        }
      }

      const findings: Finding[] = [];
      const linux = (site.kind ?? '').toLowerCase().includes('linux');
      let debugMode = 'not needed (Linux container log)';
      if (!linux) {
        try {
          await client.send('PUT', `https://${host}${SENTINEL_PATH}`, SCM_RESOURCE, { rawBody: SENTINEL_TEXT, headers: { 'If-Match': '*' } });
          debugMode = 'on for 15 min (function logs are written to files)';
        } catch (error) {
          debugMode = 'could not be turned on';
          findings.push({ severity: 'warning', code: 'DebugModeNotSet', message: `Could not write the debug marker, so function logs may not appear: ${error instanceof Error ? error.message : String(error)}`, fix: 'Check that you can write to the app (Website Contributor) and that SCM basic or Entra access is allowed.' });
        }
      }

      const instances = await tryRead(() => client.arm<{ value: { name: string }[] }>('GET', `${app.id}/instances`, WEB_API_VERSION));
      const path = linux ? '/api/logstream' : '/api/logstream/application/functions';
      let invoking: Promise<{ result?: InvokeResult; findings: Finding[] }> | undefined;
      const streamed = await client.stream(`https://${host}${path}`, SCM_RESOURCE, seconds * 1000, MAX_CHARS, () => {
        if (!fnName) return;
        invoking = sleep(INVOKE_DELAY_MS)
          .then(() => invokeFunction(context, app, fnName, { method: 'GET' }, preview))
          .catch((error: unknown) => ({ findings: [{ severity: 'error' as const, code: 'InvokeFailed', message: `Calling ${fnName} failed: ${error instanceof Error ? scrubText(error.message) : String(error)}`, fix: `Retry with \`functions invoke ${app.ref} --function ${fnName}\` for details.` }] }));
      });
      const invoked = invoking ? await invoking : undefined;
      if (invoked) findings.push(...invoked.findings);

      const { lines, total } = logLines(streamed.text);
      if (lines.length === 0) {
        findings.push({
          severity: 'info',
          code: 'NoLogLines',
          message: `No log lines in ${seconds}s. The stream only shows new events.`,
          fix: `Trigger the function while watching (\`--invoke <function>\`), widen --seconds, or read recent history with \`logs query ${app.ref} --preset traces --since 30m\`.`,
        });
      }
      const instanceNames = instances?.value.map(instance => instance.name);
      const invokeSummary = invoked?.result ? ` ${fnName} → ${invoked.result.status}.` : '';
      return {
        summary: `${lines.length} log line(s) from ${app.label} in ${seconds}s; ${instanceNames ? `${instanceNames.length} instance(s)` : 'instances unknown'}.${invokeSummary}`,
        data: {
          seconds,
          stream: `https://${host}${path}`,
          debugMode,
          ended: streamed.ended,
          instances: instanceNames ? { count: instanceNames.length, names: instanceNames } : undefined,
          invoke: invoked?.result,
          lines,
          truncatedLines: total > lines.length ? total - lines.length : undefined,
        },
        findings,
      };
    },
  },
];
