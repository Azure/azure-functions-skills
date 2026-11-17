import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type TelemetryDistribution = 'plugin' | 'workspace' | 'starter';
export const TELEMETRY_DISTRIBUTIONS: ReadonlySet<string> = new Set<TelemetryDistribution>(['plugin', 'workspace', 'starter']);
export const NO_BUNDLE = 'none';
const BUNDLE_NAME = /^[a-z][a-z0-9-]{0,40}$/;
const RESERVED_STATE_FILES = new Set(['runtime.json', 'telemetry.config.json']);

/** Where a runtime was installed, derived from its own directory. */
export function telemetryDistribution(runtimeDir: string): TelemetryDistribution {
  const normalized = runtimeDir.replaceAll('\\', '/').replace(/\/+$/, '');
  if (normalized.endsWith('/.azure-functions-skills/runtime')) return 'starter';
  if (/\/\.(?:github|claude|codex)\/hooks\/runtime$/.test(normalized)) return 'workspace';
  return 'plugin';
}

export function isBundleName(value: string): boolean {
  return value === NO_BUNDLE || BUNDLE_NAME.test(value);
}

/**
 * The starter bundle whose install record lists the skill, or `none`.
 * Records are `.azure-functions-skills/<bundle>.json` files written by the
 * starter installer. Unreadable records are ignored.
 */
export function bundleForSkill(stateDir: string, skillName: string | undefined): string {
  if (skillName === undefined) return NO_BUNDLE;
  let names: string[];
  try {
    names = readdirSync(stateDir).filter(name => name.endsWith('.json') && !RESERVED_STATE_FILES.has(name)).sort();
  } catch {
    return NO_BUNDLE;
  }
  const prefixes = [`.agents/skills/${skillName}/`, `.claude/skills/${skillName}/`];
  for (const name of names) {
    const bundle = name.slice(0, -'.json'.length);
    if (!BUNDLE_NAME.test(bundle)) continue;
    try {
      const record: unknown = JSON.parse(readFileSync(join(stateDir, name), 'utf-8'));
      if (typeof record !== 'object' || record === null) continue;
      const files = (record as { files?: unknown }).files;
      if (typeof files !== 'object' || files === null) continue;
      if (Object.keys(files).some(path => prefixes.some(prefix => path.startsWith(prefix)))) return bundle;
    } catch {
      // A damaged record must not change the hook result.
    }
  }
  return NO_BUNDLE;
}
