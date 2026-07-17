import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CliAgentName } from '../types.js';

const MANAGED_TOML_START = '# azure-functions-skills:start';
const MANAGED_TOML_END = '# azure-functions-skills:end';

export function telemetryConfigPath(root: string, agent: CliAgentName): string {
  if (agent === 'ghcp') return join(root, '.github', 'hooks', 'telemetry.config.json');
  if (agent === 'claude') return join(root, '.claude', 'hooks', 'telemetry.config.json');
  return join(root, '.codex', 'hooks', 'telemetry.config.json');
}

export function resolveTelemetryEnabled(
  targetDir: string,
  explicit: boolean | undefined,
): boolean | undefined {
  if (explicit !== undefined) return explicit;
  if (legacyTelemetryDisabled(targetDir)) return false;
  if ((['ghcp', 'claude', 'codex'] as const)
    .some(agent => configTelemetryDisabled(telemetryConfigPath(targetDir, agent)))) return false;
  return undefined;
}

export function setTelemetryEnabled(configPath: string, enabled: boolean): void {
  const config = existsSync(configPath) ? parseJsonFile(configPath) : {};
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({ ...config, enabled }, null, 2)}\n`);
}

export function prepareWorkspaceFile(relativePath: string, existingPath: string, generatedPath: string): void {
  if (!existsSync(existingPath)) return;
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized === '.mcp.json') {
    writeFileSync(generatedPath, mergeMcpJson(existingPath, generatedPath));
    return;
  }
  if (normalized === '.claude/settings.json') {
    writeFileSync(generatedPath, mergeClaudeSettings(existingPath, generatedPath));
    return;
  }
  if (normalized === '.claude/hooks/hooks.json' || normalized === '.codex/hooks.json') {
    writeFileSync(generatedPath, mergeHookSettings(existingPath, generatedPath));
    return;
  }
  if (normalized === '.codex/config.toml') {
    writeFileSync(generatedPath, mergeCodexToml(existingPath, generatedPath));
  }
}

function mergeMcpJson(existingPath: string, generatedPath: string): string {
  const existing = parseJsonFile(existingPath);
  const generated = parseJsonFile(generatedPath);
  return formatJson({
    ...existing,
    ...generated,
    mcpServers: {
      ...recordValue(existing.mcpServers),
      ...recordValue(generated.mcpServers),
    },
  });
}

function mergeClaudeSettings(existingPath: string, generatedPath: string): string {
  const existing = parseJsonFile(existingPath);
  const generated = parseJsonFile(generatedPath);
  const merged = {
    ...existing,
    ...generated,
    mcpServers: {
      ...recordValue(existing.mcpServers),
      ...recordValue(generated.mcpServers),
    },
    hooks: mergeHooks(recordValue(existing.hooks), recordValue(generated.hooks)),
  };
  return formatJson(merged);
}

function mergeHookSettings(existingPath: string, generatedPath: string): string {
  const existing = parseJsonFile(existingPath);
  const generated = parseJsonFile(generatedPath);
  return formatJson({
    ...existing,
    ...generated,
    hooks: mergeHooks(recordValue(existing.hooks), recordValue(generated.hooks)),
  });
}

function mergeHooks(
  existing: Record<string, unknown>,
  generated: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing, ...generated };
  for (const [eventName, generatedEntries] of Object.entries(generated)) {
    if (!Array.isArray(generatedEntries)) continue;
    const existingEntries = Array.isArray(existing[eventName]) ? existing[eventName] : [];
    result[eventName] = [
      ...existingEntries.filter(entry => !isManagedTelemetryHook(entry)),
      ...generatedEntries,
    ];
  }
  return result;
}

function isManagedTelemetryHook(value: unknown): boolean {
  return JSON.stringify(value).includes('track-telemetry.');
}

function mergeCodexToml(existingPath: string, generatedPath: string): string {
  const existing = readFileSync(existingPath, 'utf-8');
  const generated = readFileSync(generatedPath, 'utf-8').trim();
  const withoutManagedBlock = existing.replace(
    new RegExp(`${escapeRegExp(MANAGED_TOML_START)}[\\s\\S]*?${escapeRegExp(MANAGED_TOML_END)}\\s*`, 'g'),
    '',
  );
  const lines = withoutManagedBlock.split(/\r?\n/);
  const preserved: string[] = [];
  let skipOwnedSection = false;
  for (const line of lines) {
    const section = line.trim().match(/^\[([^\]]+)\]$/)?.[1];
    if (section !== undefined) {
      skipOwnedSection = section === 'mcp_servers.azure' || section.startsWith('mcp_servers.azure.');
    }
    if (!skipOwnedSection) preserved.push(line);
  }
  const prefix = preserved.join('\n').trimEnd();
  return [
    ...(prefix ? [prefix, ''] : []),
    MANAGED_TOML_START,
    generated,
    MANAGED_TOML_END,
    '',
  ].join('\n');
}

function legacyTelemetryDisabled(targetDir: string): boolean {
  const statePath = join(targetDir, '.azure-functions-skills', 'state.local.json');
  if (!existsSync(statePath)) return false;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as unknown;
    return isRecord(state) && isRecord(state.telemetry) && state.telemetry.enabled === false;
  } catch {
    return false;
  }
}

function configTelemetryDisabled(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return parseJsonFile(path).enabled === false;
  } catch {
    return false;
  }
}

function parseJsonFile(path: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!isRecord(value)) throw new Error('expected a JSON object');
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot safely update ${path}: ${message}`, { cause: error });
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatJson(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
