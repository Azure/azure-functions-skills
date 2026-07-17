import applicationInsights from 'applicationinsights';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_INSIGHTS_CONNECTION_STRING } from './config.js';

const EVENT_NAME = 'AzureFunctionsSkillsPluginExecuted';
const DEFAULT_TIMEOUT_MS = 5_000;
const CONNECTION_STRING_PLACEHOLDER = '__APPLICATIONINSIGHTS_CONNECTION_STRING__';
const BUNDLED_SKILLS_ROOT = fileURLToPath(new URL('../../templates/skills/', import.meta.url));
const ALLOWED_PROPERTIES = new Set([
  'timestamp',
  'eventType',
  'clientName',
  'pluginName',
  'sessionId',
  'skillName',
  'toolName',
  'fileReference',
]);
const EVENT_TYPES = new Set<TelemetryEventType>([
  'skill_invocation',
  'tool_invocation',
  'reference_file_read',
]);
const CLIENT_NAMES = new Set([
  'copilot-cli',
  'claude-code',
  'Visual Studio Code',
  'Visual Studio Code - Insiders',
  'unknown',
]);
export const BUNDLED_SKILL_NAMES = new Set([
  'azure-functions-agents',
  'azure-functions-best-practices',
  'azure-functions-common',
  'azure-functions-create',
  'azure-functions-deploy',
  'azure-functions-diagnostics',
  'azure-functions-doctor',
  'azure-functions-feedback',
  'azure-functions-health-status',
  'azure-functions-help',
  'azure-functions-inventory',
  'azure-functions-setup',
]);

export type TelemetryEventType =
  | 'skill_invocation'
  | 'tool_invocation'
  | 'reference_file_read';

export interface TelemetryEvent {
  readonly timestamp: string;
  readonly eventType: TelemetryEventType;
  readonly clientName: string;
  readonly pluginName: 'azure-functions-skills';
  readonly sessionId?: string;
  readonly skillName?: string;
  readonly toolName?: string;
  readonly fileReference?: string;
}

export type TelemetrySendStatus = 'sent' | 'disabled' | 'not-configured';

export interface TelemetrySendResult {
  readonly status: TelemetrySendStatus;
}

export interface ApplicationInsightsClient {
  trackEvent(event: {
    readonly name: string;
    readonly properties: Readonly<Record<string, string>>;
  }): void;
  flush(options: { readonly callback: (response?: string) => void }): void;
}

interface TelemetryEnvironment {
  readonly AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY?: string;
  readonly AZURE_MCP_COLLECT_TELEMETRY?: string;
}

export interface TelemetryDependencies {
  readonly connectionString: string;
  readonly createClient: (connectionString: string) => ApplicationInsightsClient;
  readonly environment: TelemetryEnvironment;
  readonly timeoutMs: number;
}

export function parseTelemetryEvent(value: unknown): TelemetryEvent {
  if (!isRecord(value)) {
    throw new Error('Telemetry input must be a JSON object.');
  }
  for (const property of Object.keys(value)) {
    if (!ALLOWED_PROPERTIES.has(property)) {
      throw new Error(`Unsupported telemetry property: ${property}`);
    }
  }

  const timestamp = requiredString(value, 'timestamp');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)
    || Number.isNaN(Date.parse(timestamp))) {
    throw new Error('Invalid telemetry timestamp.');
  }

  const eventTypeValue = requiredString(value, 'eventType');
  if (!EVENT_TYPES.has(eventTypeValue as TelemetryEventType)) {
    throw new Error(`Unsupported telemetry event type: ${eventTypeValue}`);
  }
  const eventType = eventTypeValue as TelemetryEventType;

  const clientName = requiredString(value, 'clientName');
  if (!CLIENT_NAMES.has(clientName)) {
    throw new Error(`Unsupported telemetry client name: ${clientName}`);
  }
  if (requiredString(value, 'pluginName') !== 'azure-functions-skills') {
    throw new Error('Unsupported telemetry plugin name.');
  }

  const sessionId = optionalString(value, 'sessionId', 256);
  const skillName = optionalString(value, 'skillName', 128);
  const toolName = optionalString(value, 'toolName', 256);
  const fileReference = optionalString(value, 'fileReference', 512);

  if (skillName !== undefined && !BUNDLED_SKILL_NAMES.has(skillName)) {
    throw new Error(`Unsupported skill name: ${skillName}`);
  }
  if (toolName !== undefined && !isFunctionsToolName(toolName)) {
    throw new Error(`Unsupported tool name: ${toolName}`);
  }
  if (fileReference !== undefined && !isBundledFileReference(fileReference)) {
    throw new Error(`Unsupported file reference: ${fileReference}`);
  }

  if (eventType === 'skill_invocation' && skillName === undefined) {
    throw new Error('skill_invocation requires skillName.');
  }
  if (eventType === 'tool_invocation' && toolName === undefined) {
    throw new Error('tool_invocation requires toolName.');
  }
  if (eventType === 'reference_file_read' && fileReference === undefined) {
    throw new Error('reference_file_read requires fileReference.');
  }

  return {
    timestamp,
    eventType,
    clientName,
    pluginName: 'azure-functions-skills',
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(skillName === undefined ? {} : { skillName }),
    ...(toolName === undefined ? {} : { toolName }),
    ...(fileReference === undefined ? {} : { fileReference }),
  };
}

export async function sendTelemetryEventWithDependencies(
  event: TelemetryEvent,
  dependencies: TelemetryDependencies,
): Promise<TelemetrySendResult> {
  const parsedEvent = parseTelemetryEvent(event);
  if (isOptedOut(dependencies.environment)) {
    return { status: 'disabled' };
  }
  if (!isConfiguredConnectionString(dependencies.connectionString)) {
    return { status: 'not-configured' };
  }

  const client = dependencies.createClient(dependencies.connectionString);
  client.trackEvent({
    name: EVENT_NAME,
    properties: telemetryProperties(parsedEvent),
  });
  await flushWithTimeout(client, dependencies.timeoutMs);
  return { status: 'sent' };
}

export async function sendTelemetryEvent(event: TelemetryEvent): Promise<TelemetrySendResult> {
  return sendTelemetryEventWithDependencies(event, {
    connectionString: APPLICATION_INSIGHTS_CONNECTION_STRING,
    createClient: createApplicationInsightsClient,
    environment: process.env,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}

function createApplicationInsightsClient(connectionString: string): ApplicationInsightsClient {
  return new applicationInsights.TelemetryClient(connectionString);
}

function telemetryProperties(event: TelemetryEvent): Record<string, string> {
  return {
    Plugin_ClientName: event.clientName,
    Plugin_EventType: event.eventType,
    Plugin_PluginName: event.pluginName,
    Plugin_Timestamp: event.timestamp,
    ...(event.sessionId === undefined ? {} : { Plugin_SessionId: event.sessionId }),
    ...(event.skillName === undefined ? {} : { Plugin_SkillName: event.skillName }),
    ...(event.toolName === undefined ? {} : { Plugin_ToolName: event.toolName }),
    ...(event.fileReference === undefined ? {} : { Plugin_FileReference: event.fileReference }),
  };
}

function flushWithTimeout(client: ApplicationInsightsClient, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Telemetry delivery timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    try {
      client.flush({
        callback: response => {
          clearTimeout(timeout);
          if (response) {
            reject(new Error(`Telemetry delivery failed: ${response}`));
          } else {
            resolve();
          }
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function isConfiguredConnectionString(connectionString: string): boolean {
  return connectionString.trim().length > 0
    && connectionString !== CONNECTION_STRING_PLACEHOLDER;
}

function isOptedOut(environment: TelemetryEnvironment): boolean {
  return environment.AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY?.toLowerCase() === 'false'
    || environment.AZURE_MCP_COLLECT_TELEMETRY?.toLowerCase() === 'false';
}

function isFunctionsToolName(toolName: string): boolean {
  return toolName.startsWith('functions_')
    || toolName.startsWith('azure-functions')
    || toolName.startsWith('mcp__plugin_azure_azure__functions_')
    || toolName.startsWith('mcp_azure_mcp_functions_');
}

function isBundledFileReference(fileReference: string): boolean {
  const normalized = fileReference.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.includes('../') || normalized.includes('/..')) {
    return false;
  }
  const [skillName] = normalized.split('/');
  if (!BUNDLED_SKILL_NAMES.has(skillName) || !normalized.includes('/')) {
    return false;
  }
  const bundledPath = join(BUNDLED_SKILLS_ROOT, ...normalized.split('/'));
  return existsSync(bundledPath) && statSync(bundledPath).isFile();
}

function requiredString(value: Readonly<Record<string, unknown>>, property: string): string {
  const result = optionalString(value, property, 512);
  if (result === undefined) {
    throw new Error(`Missing required telemetry property: ${property}`);
  }
  return result;
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  property: string,
  maxLength: number,
): string | undefined {
  const result = value[property];
  if (result === undefined) return undefined;
  if (typeof result !== 'string' || result.length === 0 || result.length > maxLength
    || containsControlCharacter(result)) {
    throw new Error(`Invalid telemetry property: ${property}`);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  return [...value].some(character => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}
