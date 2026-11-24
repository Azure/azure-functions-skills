import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { inspectProject } from '../deploy/project.js';

export type WorkerFamily = 'python' | 'node' | 'dotnet' | 'java' | 'powershell' | 'custom';

export type TriggerKind =
  | 'http' | 'timer' | 'blob' | 'queue' | 'eventhub' | 'servicebus' | 'cosmos' | 'eventgrid' | 'durable' | 'sql' | 'mcp';

export type StorageConnection = 'development' | 'other' | 'missing';

export interface LocalSettings {
  readonly path: string;
  readonly exists: boolean;
  readonly values: Readonly<Record<string, string>>;
}

/** Trigger kinds whose extension keeps state in `AzureWebJobsStorage`. */
export const STORAGE_TRIGGERS: ReadonlySet<TriggerKind> = new Set(['timer', 'blob', 'queue', 'eventhub', 'durable']);

const TRIGGER_PATTERNS: ReadonlyArray<readonly [TriggerKind, RegExp]> = [
  ['http', /@app\.route\(|\.http_trigger\(|\bapp\.(?:http|get|post|put|patch|delete)\(|\[HttpTrigger|@HttpTrigger|"httpTrigger"/],
  ['timer', /timer_trigger\(|\bapp\.schedule\(|\bapp\.timer\(|\[TimerTrigger|@TimerTrigger|"timerTrigger"/],
  ['blob', /blob_trigger\(|\bapp\.storageBlob\(|\[BlobTrigger|@BlobTrigger|"blobTrigger"/],
  ['queue', /queue_trigger\(|\bapp\.storageQueue\(|\[QueueTrigger|@QueueTrigger|"queueTrigger"/],
  ['eventhub', /event_hub_message_trigger\(|\bapp\.eventHub\(|\[EventHubTrigger|@EventHubTrigger|"eventHubTrigger"/],
  ['servicebus', /service_bus_(?:queue|topic)_trigger\(|\bapp\.serviceBus(?:Queue|Topic)\(|\[ServiceBusTrigger|@ServiceBus(?:Queue|Topic)Trigger|"serviceBusTrigger"/],
  ['cosmos', /cosmos_db_trigger\(|\bapp\.cosmosDB\(|\[CosmosDBTrigger|@CosmosDBTrigger|"cosmosDBTrigger"/],
  ['eventgrid', /event_grid_trigger\(|\bapp\.eventGrid\(|\[EventGridTrigger|@EventGridTrigger|"eventGridTrigger"/],
  ['durable', /orchestration_trigger\(|df\.app\.orchestration\(|\[OrchestrationTrigger|"orchestrationTrigger"|DFApp\(/],
  ['sql', /sql_trigger\(|\bapp\.sql\(|\[SqlTrigger|@SqlTrigger|"sqlTrigger"/],
  ['mcp', /mcp_tool_trigger\(|\bapp\.mcpTool\(|\[McpToolTrigger|@McpToolTrigger|"mcpToolTrigger"/],
];

const SOURCE_EXTENSIONS = new Set(['.py', '.js', '.mjs', '.cjs', '.ts', '.mts', '.cs', '.fs', '.java', '.ps1']);
const SKIPPED_FOLDERS = new Set([
  'node_modules', 'venv', 'bin', 'obj', 'dist', 'target', 'infra', 'tests', 'test', '__pycache__',
]);
const MAX_DEPTH = 5;
const MAX_FILES = 1000;

/** The folder with `host.json`: the given folder, the azd function service, or a single child folder. */
export function findFunctionDir(dir: string): string | null {
  const root = resolve(dir);
  if (isFile(join(root, 'host.json'))) return root;
  for (const service of inspectProject(root).azureYaml?.services ?? []) {
    const candidate = resolve(root, service.project);
    if (service.host === 'function' && isFile(join(candidate, 'host.json'))) return candidate;
  }
  const children = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !isSkipped(entry.name))
    .map(entry => join(root, entry.name))
    .filter(folder => isFile(join(folder, 'host.json')));
  return children.length === 1 ? children[0] : null;
}

export function readLocalSettings(functionDir: string): LocalSettings {
  const path = join(functionDir, 'local.settings.json');
  if (!isFile(path)) return { path, exists: false, values: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { Values?: Record<string, unknown> };
    const values = Object.fromEntries(Object.entries(parsed.Values ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    return { path, exists: true, values };
  } catch {
    return { path, exists: true, values: {} };
  }
}

export function detectWorker(functionDir: string, settings: LocalSettings): WorkerFamily | null {
  const runtime = settings.values.FUNCTIONS_WORKER_RUNTIME?.toLowerCase();
  if (runtime?.startsWith('dotnet')) return 'dotnet';
  if (runtime === 'python' || runtime === 'node' || runtime === 'java' || runtime === 'powershell' || runtime === 'custom') {
    return runtime;
  }
  const names = readdirSync(functionDir);
  if (names.some(name => name === 'function_app.py' || name === 'requirements.txt')) return 'python';
  if (names.some(name => /\.(?:cs|fs)proj$/i.test(name))) return 'dotnet';
  if (names.some(name => name === 'pom.xml' || name.startsWith('build.gradle'))) return 'java';
  if (names.includes('package.json')) return 'node';
  if (names.some(name => name === 'profile.ps1' || name === 'requirements.psd1')) return 'powershell';
  return null;
}

/** The FUNCTIONS_WORKER_RUNTIME value for a new local.settings.json. */
export function workerRuntimeSetting(worker: WorkerFamily): string {
  return worker === 'dotnet' ? 'dotnet-isolated' : worker;
}

/** Finds trigger kinds by scanning source files. A heuristic; the host's function index is authoritative. */
export function scanTriggers(functionDir: string): TriggerKind[] {
  const found = new Set<TriggerKind>();
  let budget = MAX_FILES;
  const visit = (folder: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (budget <= 0) return;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!isSkipped(entry.name)) visit(path, depth + 1);
        continue;
      }
      if (!SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()) && entry.name !== 'function.json') continue;
      budget--;
      const text = readFileSync(path, 'utf-8');
      for (const [kind, pattern] of TRIGGER_PATTERNS) if (pattern.test(text)) found.add(kind);
    }
  };
  visit(functionDir, 0);
  return TRIGGER_PATTERNS.map(([kind]) => kind).filter(kind => found.has(kind));
}

export function storageConnection(values: Readonly<Record<string, string>>): StorageConnection {
  const value = values.AzureWebJobsStorage;
  if (value && /UseDevelopmentStorage=true|devstoreaccount1|127\.0\.0\.1:1000[0-2]/i.test(value)) return 'development';
  if (value || Object.keys(values).some(key => key.startsWith('AzureWebJobsStorage__'))) return 'other';
  return 'missing';
}

function isSkipped(name: string): boolean {
  return name.startsWith('.') || SKIPPED_FOLDERS.has(name);
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}
