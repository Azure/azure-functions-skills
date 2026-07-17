/**
 * Load project context by reading workspace files.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { FunctionInfo, ProjectContext, ProjectLanguage } from './types.js';
import { discoverPythonV2Functions } from './python-source.js';

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function localWorkerRuntime(localSettings: Record<string, unknown> | null): string | undefined {
  const values = localSettings?.Values;
  if (typeof values !== 'object' || values === null) return undefined;
  const runtime = (values as Record<string, unknown>).FUNCTIONS_WORKER_RUNTIME;
  return typeof runtime === 'string' ? runtime.toLowerCase() : undefined;
}

function hasPythonV1Layout(dir: string): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some(entry => {
      if (!entry.isDirectory()) return false;
      const functionDir = join(dir, entry.name);
      const functionJson = readJson(join(functionDir, 'function.json'));
      if (!functionJson) return false;
      const scriptFile = functionJson.scriptFile;
      return existsSync(join(functionDir, '__init__.py'))
        || (typeof scriptFile === 'string' && scriptFile.endsWith('.py'));
    });
  } catch {
    return false;
  }
}

function detectLanguage(
  dir: string,
  localSettings: Record<string, unknown> | null,
  hasPythonV2: boolean,
): ProjectLanguage {
  const explicitRuntime = localWorkerRuntime(localSettings);
  const knownRuntimes: ReadonlySet<ProjectLanguage> = new Set([
    'node', 'python', 'dotnet', 'java', 'powershell',
  ]);
  if (explicitRuntime && knownRuntimes.has(explicitRuntime as ProjectLanguage)) {
    return explicitRuntime as ProjectLanguage;
  }
  if (
    hasPythonV2
    || hasPythonV1Layout(dir)
    || existsSync(join(dir, 'requirements.txt'))
    || existsSync(join(dir, 'pyproject.toml'))
  ) return 'python';
  if (existsSync(join(dir, 'package.json'))) return 'node';
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
  const pythonV2 = discoverPythonV2Functions(dir);
  const language = detectLanguage(dir, localSettings, pythonV2.hasV2Application);

  const v1Functions = discoverV3Functions(dir);
  const nodeV4Functions = language === 'node' ? discoverV4Functions(dir) : [];
  const functions = language === 'python'
    ? [...v1Functions, ...pythonV2.functions]
    : nodeV4Functions.length > 0
      ? nodeV4Functions
      : v1Functions;
  const python = language === 'python'
    ? {
        programmingModel: v1Functions.length > 0 && pythonV2.hasV2Application
          ? 'mixed' as const
          : pythonV2.hasV2Application
            ? 'v2' as const
            : v1Functions.length > 0
              ? 'v1' as const
              : 'unknown' as const,
      }
    : undefined;

  return {
    dir,
    language,
    hostJson,
    localSettings,
    packageJson,
    functions,
    ...(python ? { python } : {}),
    stacks: [],  // Resolved later by runner
  };
}
