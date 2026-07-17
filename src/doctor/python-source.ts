import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, join, sep } from 'node:path';
import type { FunctionInfo } from './types.js';

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.pytest_cache',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'venv',
]);

const TRIGGER_DECORATORS: Readonly<Record<string, string>> = {
  route: 'httpTrigger',
  http_trigger: 'httpTrigger',
  timer_trigger: 'timerTrigger',
  queue_trigger: 'queueTrigger',
  blob_trigger: 'blobTrigger',
  service_bus_queue_trigger: 'serviceBusTrigger',
  service_bus_topic_trigger: 'serviceBusTrigger',
  event_hub_message_trigger: 'eventHubTrigger',
  cosmos_db_trigger: 'cosmosDBTrigger',
  orchestration_trigger: 'orchestrationTrigger',
  activity_trigger: 'activityTrigger',
  entity_trigger: 'entityTrigger',
};

interface PythonFile {
  path: string;
  relativePath: string;
  module: string;
  source: string;
}

interface ParsedFile {
  file: PythonFile;
  cleanSource: string;
  apps: Set<string>;
  blueprints: Set<string>;
  importedBlueprints: Map<string, string>;
}

function moduleName(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.py$/i, '');
  const segments = withoutExtension.split(/[\\/]/);
  if (segments.at(-1) === '__init__') segments.pop();
  return segments.join('.');
}

function listPythonFiles(root: string, dir = root): PythonFile[] {
  const files: PythonFile[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        files.push(...listPythonFiles(root, path));
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.py')) continue;
    const relativePath = relative(root, path);
    files.push({
      path,
      relativePath,
      module: moduleName(relativePath),
      source: readFileSync(path, 'utf-8'),
    });
  }
  return files;
}

function maskStringsAndComments(source: string): string {
  let result = '';
  let quote: "'" | '"' | "'''" | '"""' | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const nextThree = source.slice(index, index + 3);

    if (quote) {
      if (char === '\n') {
        result += '\n';
        if (quote.length === 1) quote = null;
        escaped = false;
        continue;
      }
      if (quote.length === 3 && nextThree === quote) {
        result += '   ';
        index += 2;
        quote = null;
        continue;
      }
      if (quote.length === 1 && char === quote && !escaped) {
        result += ' ';
        quote = null;
        continue;
      }
      escaped = char === '\\' && !escaped;
      if (char !== '\\') escaped = false;
      result += ' ';
      continue;
    }

    if (char === '#') {
      const newline = source.indexOf('\n', index);
      if (newline === -1) {
        result += ' '.repeat(source.length - index);
        break;
      }
      result += ' '.repeat(newline - index);
      index = newline - 1;
      continue;
    }
    if (nextThree === "'''" || nextThree === '"""') {
      quote = nextThree;
      result += '   ';
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      result += ' ';
      continue;
    }
    result += char;
  }

  return result;
}

function parseImportAliases(cleanSource: string): {
  namespaceAliases: Map<string, 'functions' | 'durable_functions'>;
  constructorAliases: Map<string, 'FunctionApp' | 'Blueprint' | 'DFApp'>;
} {
  const namespaceAliases = new Map<string, 'functions' | 'durable_functions'>();
  const constructorAliases = new Map<string, 'FunctionApp' | 'Blueprint' | 'DFApp'>();

  for (const line of cleanSource.split(/\r?\n/)) {
    const namespaceMatch = line.match(
      /^\s*import\s+azure\.(functions|durable_functions)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/,
    );
    if (namespaceMatch && namespaceMatch[2]) {
      namespaceAliases.set(
        namespaceMatch[2],
        namespaceMatch[1] as 'functions' | 'durable_functions',
      );
    }

    const fromMatch = line.match(
      /^\s*from\s+azure\.(functions|durable_functions)\s+import\s+(.+)$/,
    );
    if (!fromMatch) continue;
    for (const imported of fromMatch[2].split(',')) {
      const match = imported.trim().match(
        /^(FunctionApp|Blueprint|DFApp)(?:\s+as\s+([A-Za-z_]\w*))?$/,
      );
      if (match) {
        constructorAliases.set(
          match[2] ?? match[1],
          match[1] as 'FunctionApp' | 'Blueprint' | 'DFApp',
        );
      }
    }
  }

  return { namespaceAliases, constructorAliases };
}

function parseConstructors(cleanSource: string): { apps: Set<string>; blueprints: Set<string> } {
  const apps = new Set<string>();
  const blueprints = new Set<string>();
  const { namespaceAliases, constructorAliases } = parseImportAliases(cleanSource);

  for (const line of cleanSource.split(/\r?\n/)) {
    const assignment = line.match(
      /^\s*([A-Za-z_]\w*)\s*=\s*(?:(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*))\s*\(/,
    );
    if (!assignment) continue;
    const [, variable, namespace, constructor] = assignment;
    const namespaceKind = namespace ? namespaceAliases.get(namespace) : undefined;
    const kind = namespaceKind
      ? (
          constructor === 'FunctionApp'
          || constructor === 'Blueprint'
          || (namespaceKind === 'durable_functions' && constructor === 'DFApp')
            ? constructor
            : undefined
        )
      : constructorAliases.get(constructor);
    if (kind === 'FunctionApp' || kind === 'DFApp') apps.add(variable);
    if (kind === 'Blueprint') blueprints.add(variable);
  }

  return { apps, blueprints };
}

function blueprintIdentity(module: string, variable: string): string {
  return `${module}:${variable}`;
}

function parseImportedBlueprints(
  cleanSource: string,
  knownBlueprints: ReadonlySet<string>,
): Map<string, string> {
  const imports = new Map<string, string>();
  for (const line of cleanSource.split(/\r?\n/)) {
    const match = line.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)$/);
    if (!match || match[1] === 'azure.functions' || match[1] === 'azure.durable_functions') continue;
    const importedModule = match[1].replace(/^\.+/, '');
    for (const imported of match[2].split(',')) {
      const item = imported.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
      if (!item) continue;
      const identity = blueprintIdentity(importedModule, item[1]);
      if (knownBlueprints.has(identity)) imports.set(item[2] ?? item[1], identity);
    }
  }
  return imports;
}

function findRegisteredBlueprints(parsedFiles: ParsedFile[]): Set<string> {
  const registered = new Set<string>();
  for (const parsed of parsedFiles) {
    const lines = parsed.cleanSource.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(
        /^\s*([A-Za-z_]\w*)\.(?:register_functions|register_blueprint)\s*\(\s*([A-Za-z_]\w*)\s*\)/,
      );
      if (!match || !parsed.apps.has(match[1])) continue;
      const argument = match[2];
      if (parsed.blueprints.has(argument)) {
        registered.add(blueprintIdentity(parsed.file.module, argument));
      }
      const importedIdentity = parsed.importedBlueprints.get(argument);
      if (importedIdentity) registered.add(importedIdentity);
    }
  }
  return registered;
}

function discoverFunctionsInFile(
  parsed: ParsedFile,
  registeredBlueprints: ReadonlySet<string>,
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const lines = parsed.cleanSource.split(/\r?\n/);
  let pendingTrigger: { type: string; target: string; line: number } | undefined;

  for (let index = 0; index < lines.length; index++) {
    const decorator = lines[index].match(/^\s*@([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/);
    if (decorator) {
      const triggerType = TRIGGER_DECORATORS[decorator[2]];
      if (triggerType && (parsed.apps.has(decorator[1]) || parsed.blueprints.has(decorator[1]))) {
        pendingTrigger = { type: triggerType, target: decorator[1], line: index + 1 };
      }
      continue;
    }

    const functionDefinition = lines[index].match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    if (!functionDefinition || !pendingTrigger) continue;
    const blueprint = parsed.blueprints.has(pendingTrigger.target)
      ? pendingTrigger.target
      : undefined;
    const identity = blueprint
      ? blueprintIdentity(parsed.file.module, blueprint)
      : undefined;
    functions.push({
      name: functionDefinition[1],
      triggerType: pendingTrigger.type,
      bindingTypes: [pendingTrigger.type],
      entryPoint: parsed.file.relativePath.split(sep).join('/'),
      sourceFile: parsed.file.relativePath.split(sep).join('/'),
      line: pendingTrigger.line,
      ...(blueprint ? {
        blueprint,
        blueprintRegistered: identity ? registeredBlueprints.has(identity) : false,
      } : {}),
    });
    pendingTrigger = undefined;
  }

  return functions;
}

export interface PythonSourceInventory {
  hasV2Application: boolean;
  functions: FunctionInfo[];
}

export function discoverPythonV2Functions(dir: string): PythonSourceInventory {
  if (!existsSync(dir)) return { hasV2Application: false, functions: [] };
  const pythonFiles = listPythonFiles(dir);
  const initial = pythonFiles.map(file => {
    const cleanSource = maskStringsAndComments(file.source);
    const constructors = parseConstructors(cleanSource);
    return {
      file,
      cleanSource,
      apps: constructors.apps,
      blueprints: constructors.blueprints,
      importedBlueprints: new Map<string, string>(),
    };
  });
  const knownBlueprints = new Set(
    initial.flatMap(parsed => [...parsed.blueprints].map(name => blueprintIdentity(parsed.file.module, name))),
  );
  const parsedFiles = initial.map(parsed => ({
    ...parsed,
    importedBlueprints: parseImportedBlueprints(parsed.cleanSource, knownBlueprints),
  }));
  const registeredBlueprints = findRegisteredBlueprints(parsedFiles);

  return {
    hasV2Application: parsedFiles.some(parsed => parsed.apps.size > 0 || parsed.blueprints.size > 0),
    functions: parsedFiles.flatMap(parsed => discoverFunctionsInFile(parsed, registeredBlueprints)),
  };
}
