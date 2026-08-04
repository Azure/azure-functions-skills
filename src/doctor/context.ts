/**
 * Load project context by reading workspace files.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
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
  // go.mod is checked first: a Go Functions project may also carry a package.json
  // for unrelated tooling, and Go has no other reliable marker.
  if (existsSync(join(dir, 'go.mod'))) return 'go';
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

/**
 * Go worker registration methods mapped to their Azure Functions trigger type.
 * Mirrors the `app.*` surface of github.com/azure/azure-functions-golang-worker.
 */
const GO_TRIGGER_METHODS: Record<string, string> = {
  HTTP: 'httpTrigger',
  Timer: 'timerTrigger',
  CosmosDB: 'cosmosDBTrigger',
  SQL: 'sqlTrigger',
  EventGrid: 'eventGridTrigger',
  Queue: 'queueTrigger',
  EventHub: 'eventHubTrigger',
  ServiceBusQueue: 'serviceBusTrigger',
  ServiceBusTopic: 'serviceBusTrigger',
  Blob: 'blobTrigger',
};

const GO_REGISTRATION_RE = new RegExp(
  String.raw`\.(${Object.keys(GO_TRIGGER_METHODS).join('|')})\s*\(\s*"([^"\r\n]+)"`,
  'g',
);

/** Directories that never contain first-party function registrations. */
const GO_SKIP_DIRS = new Set(['vendor', 'testdata', 'node_modules', 'bin', 'obj']);

function collectGoSourceFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 6) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (GO_SKIP_DIRS.has(entry.name)) continue;
      collectGoSourceFiles(join(dir, entry.name), out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.go')) continue;
    if (entry.name.endsWith('_test.go')) continue;
    out.push(join(dir, entry.name));
  }
}

/**
 * Discover functions in a Go project.
 *
 * The Go worker indexes functions from code, so there is no function.json to read.
 * Registrations look like `app.HTTP("name", handler, ...)`; the receiver is matched
 * loosely because projects are free to name the `*sdk.App` variable however they like.
 */
function discoverGoFunctions(dir: string): FunctionInfo[] {
  const files: string[] = [];
  collectGoSourceFiles(dir, files);

  const byName = new Map<string, FunctionInfo>();
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    GO_REGISTRATION_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = GO_REGISTRATION_RE.exec(content)) !== null) {
      const triggerType = GO_TRIGGER_METHODS[match[1]];
      const name = match[2];
      if (!triggerType || byName.has(name)) continue;
      byName.set(name, {
        name,
        triggerType,
        bindingTypes: [triggerType],
        entryPoint: relative(dir, file).split(sep).join('/'),
      });
    }
  }
  return [...byName.values()];
}

export async function loadProjectContext(dir: string): Promise<ProjectContext> {
  const hostJson = readJson(join(dir, 'host.json'));
  const localSettings = readJson(join(dir, 'local.settings.json'));
  const packageJson = readJson(join(dir, 'package.json'));
  const language = detectLanguage(dir);

  // Go uses worker-driven indexing: no function.json and no src/functions convention.
  let functions = language === 'go' ? discoverGoFunctions(dir) : discoverV4Functions(dir);
  if (functions.length === 0 && language !== 'go') {
    functions = discoverV3Functions(dir);
  }

  return {
    dir,
    language,
    hostJson,
    localSettings,
    packageJson,
    functions,
    stacks: [],  // Resolved later by runner
  };
}
