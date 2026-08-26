import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TELEMETRY_DIAGNOSTIC_LOG_NAME = 'telemetry-debug.jsonl';
export const TELEMETRY_DIAGNOSTIC_MAX_BYTES = 1024 * 1024;

export interface TelemetryDiagnosticEnvironment {
  readonly AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG?: string;
  readonly AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR?: string;
}

export interface SafeDiagnosticTelemetryEvent {
  readonly timestamp: string;
  readonly eventType: string;
  readonly clientName: string;
  readonly pluginName: 'azure-functions-skills';
  readonly correlationId: string;
  readonly pluginVersion: string;
  readonly sessionId?: string;
  readonly skillName?: string;
  readonly toolName?: string;
  readonly fileReference?: string;
}

export interface SafeIngestionDiagnostic {
  readonly itemsReceived?: number;
  readonly itemsAccepted?: number;
  readonly statusCode?: number;
  readonly category: 'accepted' | 'empty-response' | 'partial' | 'network' | 'timeout' | 'unknown';
}

export interface TelemetryDiagnosticEntry {
  readonly component: 'sender' | 'cli';
  readonly action: 'start' | 'decision' | 'delivery' | 'complete';
  readonly status: 'started' | 'tracked' | 'skipped' | 'accepted' | 'failed';
  readonly reason?: 'disabled' | 'not-configured' | 'invalid-input' | 'transport';
  readonly correlationId?: string;
  readonly packageVersion?: string;
  readonly pluginVersion?: string;
  readonly attempt?: number;
  readonly event?: SafeDiagnosticTelemetryEvent;
  readonly ingestion?: SafeIngestionDiagnostic;
}

export function isTelemetryDebugEnabled(environment: TelemetryDiagnosticEnvironment): boolean {
  return environment.AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG?.toLowerCase() === 'true';
}

export function telemetryDiagnosticLogDirectory(
  environment: TelemetryDiagnosticEnvironment,
): string {
  return environment.AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR?.trim()
    || join(tmpdir(), 'azure-functions-skills-telemetry');
}

export function writeTelemetryDiagnostic(
  environment: TelemetryDiagnosticEnvironment,
  entry: TelemetryDiagnosticEntry,
): boolean {
  if (!isTelemetryDebugEnabled(environment)) return false;

  try {
    const directory = telemetryDiagnosticLogDirectory(environment);
    const path = join(directory, TELEMETRY_DIAGNOSTIC_LOG_NAME);
    const backupPath = `${path}.1`;
    const line = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    })}\n`;
    const lineBytes = Buffer.byteLength(line);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (existsSync(path) && statSync(path).size + lineBytes > TELEMETRY_DIAGNOSTIC_MAX_BYTES) {
      rmSync(backupPath, { force: true });
      renameSync(path, backupPath);
    }
    appendFileSync(path, line, { encoding: 'utf-8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
