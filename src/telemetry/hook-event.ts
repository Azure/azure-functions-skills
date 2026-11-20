import { NO_BUNDLE, type TelemetryDistribution } from './distribution.js';
import { parseTelemetryEvent, type TelemetryEvent } from './sender.js';

export interface HookEventContext {
  /** Client name passed by the hook command. It overrides input-shape inference. */
  readonly clientName?: string;
  /** Set by the runtime from its own location, never from hook input. */
  readonly distribution?: TelemetryDistribution;
  /** Starter bundle that installed a skill, or `none`. */
  readonly bundleFor?: (skillName: string | undefined) => string;
}

export function parseHookEvent(
  value: unknown,
  environment: { readonly COPILOT_CLI?: string },
  context: HookEventContext = {},
): TelemetryEvent | undefined {
  if (!isRecord(value)) return undefined;
  const toolName = value.toolName ?? value.tool_name;
  if (typeof toolName !== 'string') return undefined;
  let toolInput: unknown = value.toolArgs ?? value.tool_input;
  if (typeof toolInput === 'string') {
    try {
      toolInput = JSON.parse(toolInput);
    } catch {
      // Malformed arguments cannot produce a valid usage event.
      return undefined;
    }
  }
  const input = isRecord(toolInput) ? toolInput : {};
  const sessionId = value.sessionId ?? value.session_id;
  const base = {
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    clientName: context.clientName ?? clientName(value, environment),
    pluginName: 'azure-functions-skills',
    ...(sessionId === undefined ? {} : { sessionId }),
  };

  let event: unknown;
  if (toolName === 'skill' || toolName === 'Skill') {
    const skillName = typeof input.skill === 'string' ? input.skill.split(':').at(-1) : undefined;
    event = { ...base, eventType: 'skill_invocation', skillName };
  } else if (/^(functions_|azure-functions|mcp__plugin_azure_azure__functions_|mcp_azure_mcp_functions_)/.test(toolName)) {
    event = { ...base, eventType: 'tool_invocation', toolName };
  } else if (['view', 'Read', 'read_file'].includes(toolName)) {
    const path = input.path ?? input.filePath ?? input.file_path;
    if (typeof path !== 'string') return undefined;
    const normalized = path.replaceAll('\\', '/').replace(/\/+/g, '/');
    const match = normalized.match(
      /(?:(?:^|\/)\.(?:github|claude|agents)\/skills\/|\/azure-functions-skills\/(?:azure-functions-skills\/)?(?:[0-9]+\.[0-9]+\.[^/]+\/)?skills\/)(azure-functions-[^/]+\/.+)$/,
    );
    if (!match) return undefined;
    const relative = match[1];
    event = relative.endsWith('/SKILL.md') && relative.split('/').length === 2
      ? { ...base, eventType: 'skill_invocation', skillName: relative.split('/')[0] }
      : { ...base, eventType: 'reference_file_read', fileReference: relative };
  } else {
    return undefined;
  }

  if (context.distribution !== undefined && isRecord(event)) {
    const skill = typeof event.skillName === 'string'
      ? event.skillName
      : typeof event.fileReference === 'string' ? event.fileReference.split('/')[0] : undefined;
    event = { ...event, distribution: context.distribution, bundle: context.bundleFor?.(skill) ?? NO_BUNDLE };
  }

  try {
    return parseTelemetryEvent(event);
  } catch {
    // Invalid hook input is not a telemetry event. Do not emit partial data.
    return undefined;
  }
}

function clientName(
  value: Readonly<Record<string, unknown>>,
  environment: { readonly COPILOT_CLI?: string },
): string {
  if (environment.COPILOT_CLI === '1') return 'copilot-cli';
  if ('hook_event_name' in value) {
    const transcript = typeof value.transcript_path === 'string' ? value.transcript_path : '';
    const toolUseId = typeof value.tool_use_id === 'string' ? value.tool_use_id : '';
    if (/[/\\]Code - Insiders[/\\]/.test(transcript)) return 'Visual Studio Code - Insiders';
    if (/[/\\]Code[/\\]/.test(transcript) || toolUseId.includes('__vscode')) return 'Visual Studio Code';
    return 'claude-code';
  }
  return 'toolArgs' in value ? 'copilot-cli' : 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
