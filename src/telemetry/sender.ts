import applicationInsights from 'applicationinsights';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_INSIGHTS_CONNECTION_STRING } from './config.js';
import { isNormalizedResourceType } from './arm-deployments.js';

const EVENT_NAME = 'AzureFunctionsSkillsPluginExecuted';
export const CONTRIBUTION_EVENT_NAME = 'azure_contribution';
export const DEFAULT_TIMEOUT_MS = 5_000;
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
const CONTRIBUTION_AGENTS = new Set([...CLIENT_NAMES, 'codex']);
const CONTRIBUTION_SKILLS = new Set(['azure-functions-deploy', 'azure-functions-hosted-skills']);
const CONTRIBUTION_OPERATIONS = new Set(['deploy', 'provision']);
const CONTRIBUTION_DEPLOYMENT_KINDS = new Set(['function-app', 'hosted-agent']);
const SKILLS_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9a-z][0-9a-z.]{0,20})?$/;
const CONTRIBUTION_PROPERTIES = new Set([
  'skill',
  'operation',
  'result',
  'resourceTypes',
  'deploymentKind',
  'agent',
  'skillsVersion',
]);
export const BUNDLED_SKILL_NAMES = new Set([
  'azure-functions-best-practices',
  'azure-functions-common',
  'azure-functions-create',
  'azure-functions-deploy',
  'azure-functions-diagnostics',
  'azure-functions-doctor',
  'azure-functions-feedback',
  'azure-functions-health-status',
  'azure-functions-help',
  'azure-functions-hosted-skills',
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

export interface ContributionEvent {
  readonly skill: 'azure-functions-deploy' | 'azure-functions-hosted-skills';
  readonly operation: 'deploy' | 'provision';
  readonly result: 'success';
  readonly resourceTypes: readonly string[];
  readonly deploymentKind: 'function-app' | 'hosted-agent';
  readonly agent: string;
  readonly skillsVersion: string;
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

export interface TelemetryEnvironment {
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

export function parseContributionEvent(value: unknown): ContributionEvent {
  if (!isRecord(value)) {
    throw new Error('Contribution event must be a JSON object.');
  }
  for (const property of Object.keys(value)) {
    if (!CONTRIBUTION_PROPERTIES.has(property)) {
      throw new Error(`Unsupported contribution event property: ${property}`);
    }
  }

  const skill = requiredString(value, 'skill');
  if (!CONTRIBUTION_SKILLS.has(skill)) {
    throw new Error(`Unsupported contribution skill: ${skill}`);
  }
  const operation = requiredString(value, 'operation');
  if (!CONTRIBUTION_OPERATIONS.has(operation)) {
    throw new Error(`Unsupported contribution operation: ${operation}`);
  }
  if (requiredString(value, 'result') !== 'success') {
    throw new Error('Contribution result must be success.');
  }
  const deploymentKind = requiredString(value, 'deploymentKind');
  if (!CONTRIBUTION_DEPLOYMENT_KINDS.has(deploymentKind)) {
    throw new Error(`Unsupported contribution deployment kind: ${deploymentKind}`);
  }
  const expectedDeploymentKind = skill === 'azure-functions-deploy' ? 'function-app' : 'hosted-agent';
  if (deploymentKind !== expectedDeploymentKind) {
    throw new Error('Contribution deploymentKind does not match skill.');
  }
  const agent = requiredString(value, 'agent');
  if (!CONTRIBUTION_AGENTS.has(agent)) {
    throw new Error(`Unsupported contribution agent: ${agent}`);
  }
  const skillsVersion = normalizeSkillsVersion(requiredString(value, 'skillsVersion'));

  const resourceTypesValue = value.resourceTypes;
  if (!Array.isArray(resourceTypesValue) || resourceTypesValue.length === 0) {
    throw new Error('Contribution resourceTypes must be a non-empty array.');
  }
  const resourceTypes = resourceTypesValue.map(entry => {
    if (typeof entry !== 'string' || !isNormalizedResourceType(entry)) {
      throw new Error('Invalid contribution resource type.');
    }
    return entry;
  });

  return {
    skill: skill as ContributionEvent['skill'],
    operation: operation as ContributionEvent['operation'],
    result: 'success',
    resourceTypes,
    deploymentKind: deploymentKind as ContributionEvent['deploymentKind'],
    agent,
    skillsVersion,
  };
}

export function normalizeContributionAgent(agent: string): string {
  return CONTRIBUTION_AGENTS.has(agent) ? agent : 'unknown';
}

export function normalizeSkillsVersion(value: string | undefined): string {
  if (typeof value !== 'string') return 'unknown';
  const trimmed = value.trim();
  if (trimmed === 'unknown') return 'unknown';
  return SKILLS_VERSION_PATTERN.test(trimmed) ? trimmed : 'unknown';
}

export async function sendContributionEventWithDependencies(
  event: ContributionEvent,
  dependencies: TelemetryDependencies,
): Promise<TelemetrySendResult> {
  const parsedEvent = parseContributionEvent(event);
  if (isOptedOut(dependencies.environment)) {
    return { status: 'disabled' };
  }
  if (!isConfiguredConnectionString(dependencies.connectionString)) {
    return { status: 'not-configured' };
  }

  const client = dependencies.createClient(dependencies.connectionString);
  client.trackEvent({
    name: CONTRIBUTION_EVENT_NAME,
    properties: contributionProperties(parsedEvent),
  });
  await flushWithTimeout(client, dependencies.timeoutMs);
  return { status: 'sent' };
}

export async function sendContributionEvent(event: ContributionEvent): Promise<TelemetrySendResult> {
  return sendContributionEventWithDependencies(event, {
    connectionString: APPLICATION_INSIGHTS_CONNECTION_STRING,
    createClient: createApplicationInsightsClient,
    environment: process.env,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}

function contributionProperties(event: ContributionEvent): Record<string, string> {
  return {
    skill: event.skill,
    operation: event.operation,
    result: event.result,
    resourceTypes: JSON.stringify([...event.resourceTypes]),
    deploymentKind: event.deploymentKind,
    agent: event.agent,
    skillsVersion: event.skillsVersion,
  };
}

export function createApplicationInsightsClient(connectionString: string): ApplicationInsightsClient {
  const client = new applicationInsights.TelemetryClient(connectionString);
  stripHostContextTags(client);
  installEnvelopeTagAllowlist(client);
  return client;
}

function installEnvelopeTagAllowlist(client: unknown): void {
  if (!isRecord(client)) return;
  const addProcessor = client.addTelemetryProcessor;
  if (typeof addProcessor !== 'function') return;
  const context = isRecord(client.context) ? client.context : {};
  const keys = isRecord(context.keys) ? context.keys : {};
  const sdkVersionKey = typeof keys.internalSdkVersion === 'string'
    ? keys.internalSdkVersion
    : 'ai.internal.sdkVersion';
  const allowed = new Set<string>([sdkVersionKey]);
  addProcessor.call(client, (envelope: unknown): boolean => {
    if (isRecord(envelope) && isRecord(envelope.tags)) {
      const tags = envelope.tags as Record<string, unknown>;
      for (const key of Object.keys(tags)) {
        if (!allowed.has(key)) delete tags[key];
      }
    }
    return true;
  });
}

function stripHostContextTags(client: unknown): void {
  if (!isRecord(client)) return;
  const context = client.context;
  if (!isRecord(context)) return;
  const tags = context.tags;
  if (!isRecord(tags)) return;
  const keys = isRecord(context.keys) ? context.keys : {};
  const derivedKeys = [
    keys.cloudRoleInstance,
    keys.deviceOSVersion,
    'ai.cloud.roleInstance',
    'ai.device.osVersion',
    'ai.device.osArchitecture',
    'ai.device.osPlatform',
  ];
  for (const key of derivedKeys) {
    if (typeof key === 'string') delete tags[key];
  }
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
          if (isAcceptedIngestionResponse(response)) {
            resolve();
          } else {
            reject(new Error(`Telemetry delivery failed: ${response}`));
          }
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function isAcceptedIngestionResponse(response: string | undefined): boolean {
  if (response === undefined || response.length === 0) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  const { itemsReceived, itemsAccepted, errors } = parsed;
  return Array.isArray(errors)
    && errors.length === 0
    && typeof itemsAccepted === 'number'
    && itemsAccepted >= 1
    && typeof itemsReceived === 'number'
    && itemsAccepted === itemsReceived;
}

export function isConfiguredConnectionString(connectionString: string): boolean {
  return connectionString.trim().length > 0
    && connectionString !== CONNECTION_STRING_PLACEHOLDER;
}

export function isOptedOut(environment: TelemetryEnvironment): boolean {
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
