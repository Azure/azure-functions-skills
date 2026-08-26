import applicationInsights from 'applicationinsights';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_INSIGHTS_CONNECTION_STRING } from './config.js';
import {
  writeTelemetryDiagnostic,
  type SafeIngestionDiagnostic,
  type TelemetryDiagnosticEnvironment,
} from './diagnostics.js';
import { PACKAGE_VERSION } from './version.js';

const EVENT_NAME = 'AzureFunctionsSkillsPluginExecuted';
const DEFAULT_TIMEOUT_MS = 5_000;
const CONNECTION_STRING_PLACEHOLDER = '__APPLICATIONINSIGHTS_CONNECTION_STRING__';
const BUNDLED_SKILLS_ROOT = fileURLToPath(new URL('../../templates/skills/', import.meta.url));
const ALLOWED_PROPERTIES = new Set([
  'timestamp',
  'eventType',
  'clientName',
  'pluginName',
  'correlationId',
  'pluginVersion',
  'sessionId',
  'skillName',
  'toolName',
  'fileReference',
]);
const EVENT_TYPES = new Set<TelemetryEventType>([
  'skill_invocation',
  'tool_invocation',
  'reference_file_read',
  'telemetry_diagnostic',
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
  | 'reference_file_read'
  | 'telemetry_diagnostic';

export interface TelemetryEvent {
  readonly timestamp: string;
  readonly eventType: TelemetryEventType;
  readonly clientName: string;
  readonly pluginName: 'azure-functions-skills';
  readonly correlationId?: string;
  readonly pluginVersion?: string;
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

export interface TelemetryEnvironment extends TelemetryDiagnosticEnvironment {
  readonly AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY?: string;
  readonly AZURE_MCP_COLLECT_TELEMETRY?: string;
}

export interface TelemetryDependencies {
  readonly connectionString: string;
  readonly createClient: (connectionString: string) => ApplicationInsightsClient;
  readonly environment: TelemetryEnvironment;
  readonly packageVersion: string;
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
  const correlationId = optionalString(value, 'correlationId', 64);
  const pluginVersion = optionalString(value, 'pluginVersion', 64);
  const skillName = optionalString(value, 'skillName', 128);
  const toolName = optionalString(value, 'toolName', 256);
  const fileReference = optionalString(value, 'fileReference', 512);

  if (correlationId !== undefined
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(correlationId)) {
    throw new Error('Invalid telemetry correlation ID.');
  }
  if (pluginVersion !== undefined && !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(pluginVersion)) {
    throw new Error('Invalid telemetry plugin version.');
  }

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
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(pluginVersion === undefined ? {} : { pluginVersion }),
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
  const enrichedEvent = {
    ...parsedEvent,
    correlationId: parsedEvent.correlationId || randomUUID(),
    pluginVersion: parsedEvent.pluginVersion || dependencies.packageVersion,
  };
  writeTelemetryDiagnostic(dependencies.environment, {
    component: 'sender',
    action: 'start',
    status: 'started',
    correlationId: enrichedEvent.correlationId,
    packageVersion: dependencies.packageVersion,
    pluginVersion: enrichedEvent.pluginVersion,
    event: enrichedEvent,
  });
  if (isTelemetryOptedOut(dependencies.environment)) {
    writeTelemetryDiagnostic(dependencies.environment, {
      component: 'sender',
      action: 'decision',
      status: 'skipped',
      reason: 'disabled',
      correlationId: enrichedEvent.correlationId,
    });
    return { status: 'disabled' };
  }
  if (!isTelemetryConfigured(dependencies.connectionString)) {
    writeTelemetryDiagnostic(dependencies.environment, {
      component: 'sender',
      action: 'decision',
      status: 'skipped',
      reason: 'not-configured',
      correlationId: enrichedEvent.correlationId,
    });
    return { status: 'not-configured' };
  }

  const deadline = Date.now() + dependencies.timeoutMs;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const client = dependencies.createClient(dependencies.connectionString);
      client.trackEvent({
        name: EVENT_NAME,
        properties: telemetryProperties(
          enrichedEvent,
          dependencies.packageVersion,
        ),
      });
      const ingestion = await flushWithTimeout(
        client,
        remainingTime(deadline),
        dependencies.timeoutMs,
      );
      writeTelemetryDiagnostic(dependencies.environment, {
        component: 'sender',
        action: 'delivery',
        status: 'accepted',
        correlationId: enrichedEvent.correlationId,
        packageVersion: dependencies.packageVersion,
        pluginVersion: enrichedEvent.pluginVersion,
        attempt,
        ingestion,
      });
      return { status: 'sent' };
    } catch (error) {
      const deliveryError = toDeliveryError(error);
      writeTelemetryDiagnostic(dependencies.environment, {
        component: 'sender',
        action: 'delivery',
        status: 'failed',
        reason: 'transport',
        correlationId: enrichedEvent.correlationId,
        packageVersion: dependencies.packageVersion,
        pluginVersion: enrichedEvent.pluginVersion,
        attempt,
        ingestion: deliveryError.ingestion,
      });
      if (attempt === 1 && deliveryError.transient && Date.now() < deadline) continue;
      throw deliveryError;
    }
  }
  throw new Error('Telemetry delivery failed.');
}

export async function sendTelemetryEvent(
  event: TelemetryEvent,
  environment: TelemetryEnvironment = process.env,
): Promise<TelemetrySendResult> {
  return sendTelemetryEventWithDependencies(event, {
    connectionString: APPLICATION_INSIGHTS_CONNECTION_STRING,
    createClient: createApplicationInsightsClient,
    environment,
    packageVersion: PACKAGE_VERSION,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}

function createApplicationInsightsClient(connectionString: string): ApplicationInsightsClient {
  return new applicationInsights.TelemetryClient(connectionString);
}

function telemetryProperties(
  event: TelemetryEvent & { readonly correlationId: string; readonly pluginVersion: string },
  packageVersion: string,
): Record<string, string> {
  return {
    Plugin_ClientName: event.clientName,
    Plugin_CorrelationId: event.correlationId,
    Plugin_EventType: event.eventType,
    Plugin_PackageVersion: packageVersion,
    Plugin_PluginName: event.pluginName,
    Plugin_PluginVersion: event.pluginVersion,
    Plugin_Timestamp: event.timestamp,
    ...(event.sessionId === undefined ? {} : { Plugin_SessionId: event.sessionId }),
    ...(event.skillName === undefined ? {} : { Plugin_SkillName: event.skillName }),
    ...(event.toolName === undefined ? {} : { Plugin_ToolName: event.toolName }),
    ...(event.fileReference === undefined ? {} : { Plugin_FileReference: event.fileReference }),
  };
}

function flushWithTimeout(
  client: ApplicationInsightsClient,
  timeoutMs: number,
  totalTimeoutMs: number,
): Promise<SafeIngestionDiagnostic> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new TelemetryDeliveryError(
        `Telemetry delivery timed out after ${totalTimeoutMs}ms`,
        false,
        { category: 'timeout' },
      ));
    }, timeoutMs);
    try {
      client.flush({
        callback: response => {
          clearTimeout(timeout);
          try {
            resolve(parseIngestionResponse(response));
          } catch (error) {
            reject(error);
          }
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

export function isTelemetryConfigured(connectionString: string): boolean {
  return connectionString.trim().length > 0
    && connectionString !== CONNECTION_STRING_PLACEHOLDER;
}

export function isTelemetryOptedOut(environment: TelemetryEnvironment): boolean {
  return environment.AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY?.toLowerCase() === 'false'
    || environment.AZURE_MCP_COLLECT_TELEMETRY?.toLowerCase() === 'false';
}

class TelemetryDeliveryError extends Error {
  readonly transient: boolean;
  readonly ingestion: SafeIngestionDiagnostic;

  constructor(message: string, transient: boolean, ingestion: SafeIngestionDiagnostic) {
    super(message);
    this.name = 'TelemetryDeliveryError';
    this.transient = transient;
    this.ingestion = ingestion;
  }
}

function parseIngestionResponse(response?: string): SafeIngestionDiagnostic {
  if (!response) return { category: 'empty-response' };

  let value: unknown;
  try {
    value = JSON.parse(response);
  } catch {
    const transient = /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|429|5\d\d)\b/i
      .test(response);
    throw new TelemetryDeliveryError(
      transient ? 'Telemetry delivery failed due to a transient network error.' : 'Telemetry delivery failed.',
      transient,
      { category: transient ? 'network' : 'unknown' },
    );
  }
  if (!isRecord(value)
    || typeof value.itemsReceived !== 'number'
    || typeof value.itemsAccepted !== 'number'
    || !Array.isArray(value.errors)) {
    throw new TelemetryDeliveryError(
      'Telemetry delivery returned an unrecognized response.',
      false,
      { category: 'unknown' },
    );
  }

  const itemsReceived = value.itemsReceived;
  const itemsAccepted = value.itemsAccepted;
  if (itemsReceived === itemsAccepted && value.errors.length === 0) {
    return { category: 'accepted', itemsReceived, itemsAccepted };
  }

  const statusCodes = value.errors
    .filter(isRecord)
    .map(error => error.statusCode)
    .filter((statusCode): statusCode is number => typeof statusCode === 'number');
  const statusCode = statusCodes[0];
  const transient = statusCodes.some(code => code === 429 || (code >= 500 && code <= 599));
  throw new TelemetryDeliveryError(
    `Telemetry ingestion rejected ${itemsReceived - itemsAccepted} of ${itemsReceived} item(s).`,
    transient,
    {
      category: 'partial',
      itemsReceived,
      itemsAccepted,
      ...(statusCode === undefined ? {} : { statusCode }),
    },
  );
}

function toDeliveryError(error: unknown): TelemetryDeliveryError {
  if (error instanceof TelemetryDeliveryError) return error;
  const message = error instanceof Error ? error.message : '';
  const transient = /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/i.test(message);
  return new TelemetryDeliveryError(
    transient ? 'Telemetry delivery failed due to a transient network error.' : 'Telemetry delivery failed.',
    transient,
    { category: transient ? 'network' : 'unknown' },
  );
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new TelemetryDeliveryError(
      'Telemetry delivery timed out.',
      false,
      { category: 'timeout' },
    );
  }
  return remaining;
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
