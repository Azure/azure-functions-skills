import { randomUUID } from 'node:crypto';
import { APPLICATION_INSIGHTS_CONNECTION_STRING } from './config.js';
import {
  isTelemetryConfigured,
  isTelemetryOptedOut,
  sendTelemetryEvent,
  type TelemetryEnvironment,
} from './sender.js';
import {
  isTelemetryDebugEnabled,
  telemetryDiagnosticLogDirectory,
} from './diagnostics.js';
import { PACKAGE_VERSION } from './version.js';

export interface TelemetryDiagnosticReport {
  readonly packageResolved: true;
  readonly packageVersion: string;
  readonly telemetryEnabled: boolean;
  readonly configurationStatus: 'disabled' | 'not-configured' | 'configured';
  readonly transportStatus: 'not-attempted' | 'accepted' | 'failed';
  readonly ingestionAccepted: boolean;
  readonly correlationId: string;
  readonly diagnosticsEnabled: boolean;
  readonly logDirectory?: string;
}

export async function diagnoseTelemetry(
  environment: TelemetryEnvironment = process.env,
): Promise<TelemetryDiagnosticReport> {
  const correlationId = randomUUID();
  const diagnosticsEnabled = isTelemetryDebugEnabled(environment);
  const common = {
    packageResolved: true as const,
    packageVersion: PACKAGE_VERSION,
    correlationId,
    diagnosticsEnabled,
    ...(diagnosticsEnabled
      ? { logDirectory: telemetryDiagnosticLogDirectory(environment) }
      : {}),
  };

  if (isTelemetryOptedOut(environment)) {
    return {
      ...common,
      telemetryEnabled: false,
      configurationStatus: 'disabled',
      transportStatus: 'not-attempted',
      ingestionAccepted: false,
    };
  }
  if (!isTelemetryConfigured(APPLICATION_INSIGHTS_CONNECTION_STRING)) {
    return {
      ...common,
      telemetryEnabled: true,
      configurationStatus: 'not-configured',
      transportStatus: 'not-attempted',
      ingestionAccepted: false,
    };
  }

  try {
    await sendTelemetryEvent({
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      eventType: 'telemetry_diagnostic',
      clientName: 'unknown',
      pluginName: 'azure-functions-skills',
      correlationId,
      pluginVersion: PACKAGE_VERSION,
    }, environment);
    return {
      ...common,
      telemetryEnabled: true,
      configurationStatus: 'configured',
      transportStatus: 'accepted',
      ingestionAccepted: true,
    };
  } catch {
    return {
      ...common,
      telemetryEnabled: true,
      configurationStatus: 'configured',
      transportStatus: 'failed',
      ingestionAccepted: false,
    };
  }
}
