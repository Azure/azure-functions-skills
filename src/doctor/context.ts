/**
 * Load project context by reading workspace files.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { FunctionInfo, ProjectContext, ProjectLanguage } from './types.js';

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectLanguage(dir: string): ProjectLanguage {
  if (existsSync(join(dir, 'package.json'))) return 'node';
  if (existsSync(join(dir, 'requirements.txt'))) return 'python';
  // Check for .csproj or .fsproj
  try {
    const files = readdirSync(dir);
    if (files.some(f => f.endsWith('.csproj') || f.endsWith('.fsproj'))) return 'dotnet';
  } catch { /* empty */ }
  if (existsSync(join(dir, 'pom.xml'))) return 'java';
  if (existsSync(join(dir, 'profile.ps1'))) return 'powershell';
  return 'unknown';
}

/**
 * Discover v3-style functions (subdirectories containing function.json).
 */
function discoverV3Functions(dir: string): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const functionJsonPath = join(dir, entry.name, 'function.json');
      const functionJson = readJson(functionJsonPath);
      if (!functionJson) continue;

      const bindings = (functionJson.bindings ?? []) as Array<Record<string, unknown>>;
      const trigger = bindings.find(b => typeof b.type === 'string' && (b.type as string).endsWith('Trigger'));
      functions.push({
        name: entry.name,
        triggerType: (trigger?.type as string) ?? 'unknown',
        bindingTypes: bindings.map(b => (b.type as string) ?? 'unknown'),
        scriptFile: functionJson.scriptFile as string | undefined,
        entryPoint: functionJson.entryPoint as string | undefined,
      });
    }
  } catch { /* empty */ }
  return functions;
}

/**
 * Discover v4 programming model functions (files in src/functions/).
 */
function discoverV4Functions(dir: string): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const srcFunctions = join(dir, 'src', 'functions');
  if (!existsSync(srcFunctions)) return functions;

  try {
    for (const entry of readdirSync(srcFunctions, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(ts|js|mts|mjs)$/.test(entry.name)) continue;

      const name = basename(entry.name).replace(/\.(ts|js|mts|mjs)$/, '');
      const content = readFileSync(join(srcFunctions, entry.name), 'utf-8');

      // Detect trigger type from app.http / app.timer / app.storageBlob / etc.
      const triggerMatch = content.match(/app\.(http|timer|storageBlob|storageQueue|serviceBus|eventHub|cosmosDB)\s*\(/);
      const triggerType = triggerMatch
        ? `${triggerMatch[1]}Trigger`
        : 'unknown';

      functions.push({
        name,
        triggerType,
        bindingTypes: [triggerType],
        entryPoint: join('src', 'functions', entry.name),
      });
    }
  } catch { /* empty */ }
  return functions;
}

export async function loadProjectContext(dir: string): Promise<ProjectContext> {
  const hostJson = readJson(join(dir, 'host.json'));
  const localSettings = readJson(join(dir, 'local.settings.json'));
  const packageJson = readJson(join(dir, 'package.json'));
  const language = detectLanguage(dir);

  // Try v4 first, fall back to v3
  let functions = discoverV4Functions(dir);
  if (functions.length === 0) {
    functions = discoverV3Functions(dir);
  }

  return {
    dir,
    language,
    hostJson,
    localSettings,
    packageJson,
    functions,
  };
}
