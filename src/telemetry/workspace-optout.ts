import { existsSync, readFileSync } from 'node:fs';

export type WorkspaceTelemetryState = 'active' | 'disabled' | 'unreadable';

export function readWorkspaceTelemetryState(configPaths: readonly string[]): WorkspaceTelemetryState {
  let sawUnreadable = false;
  for (const path of configPaths) {
    if (!existsSync(path)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      sawUnreadable = true;
      continue;
    }
    if (isRecord(parsed) && parsed.enabled === false) {
      return 'disabled';
    }
  }
  return sawUnreadable ? 'unreadable' : 'active';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
