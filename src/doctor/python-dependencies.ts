import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

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

const STANDARD_LIBRARY_MODULES = new Set([
  '__future__', 'abc', 'argparse', 'array', 'asyncio', 'base64', 'bisect',
  'builtins', 'calendar', 'collections', 'concurrent', 'contextlib', 'copy',
  'csv', 'dataclasses', 'datetime', 'decimal', 'email', 'enum', 'functools',
  'glob', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'importlib', 'inspect',
  'io', 'itertools', 'json', 'logging', 'math', 'multiprocessing', 'operator',
  'os', 'pathlib', 'pickle', 'platform', 'queue', 'random', 're', 'secrets',
  'shlex', 'shutil', 'signal', 'socket', 'sqlite3', 'statistics', 'string',
  'subprocess', 'sys', 'tempfile', 'textwrap', 'threading', 'time', 'traceback',
  'typing', 'unittest', 'urllib', 'uuid', 'warnings', 'xml', 'zipfile',
]);

export type PythonManifestKind = 'requirements' | 'pyproject' | 'none';

export interface PythonDependency {
  name: string;
  specifier: string;
  pinned: boolean;
  hashes: string[];
  directUrl: boolean;
  sourceFile: string;
  line: number;
}

export interface PythonDependencyManifest {
  kind: PythonManifestKind;
  files: string[];
  dependencies: PythonDependency[];
  warnings: string[];
}

function normalizePackageName(name: string): string {
  return name.trim().toLowerCase().replace(/[._]+/g, '-');
}

function isWithinWorkspace(root: string, candidate: string): boolean {
  const workspaceRelative = relative(root, candidate);
  return workspaceRelative !== ''
    && !workspaceRelative.startsWith('..')
    && !isAbsolute(workspaceRelative);
}

function logicalRequirementLines(content: string): Array<{ text: string; line: number }> {
  const logical: Array<{ text: string; line: number }> = [];
  let current = '';
  let startLine = 1;
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (current.length === 0) startLine = index + 1;
    const continuation = raw.trimEnd().endsWith('\\');
    current += continuation ? `${raw.trimEnd().slice(0, -1)} ` : raw;
    if (!continuation) {
      logical.push({ text: current, line: startLine });
      current = '';
    }
  }
  if (current.length > 0) logical.push({ text: current, line: startLine });
  return logical;
}

function stripRequirementComment(line: string): string {
  for (let index = 0; index < line.length; index++) {
    if (line[index] !== '#') continue;
    if (line.slice(index).startsWith('#egg=')) continue;
    if (index === 0 || /\s/.test(line[index - 1])) return line.slice(0, index);
  }
  return line;
}

function isExactPin(specifier: string): boolean {
  const withoutMarker = specifier.split(';', 1)[0].trim();
  const operators = withoutMarker.match(/[<>=!~]{1,2}/g);
  return operators?.length === 1
    && operators[0] === '=='
    && !withoutMarker.includes('*');
}

function parseRequirement(
  raw: string,
  sourceFile: string,
  line: number,
): PythonDependency | undefined {
  const egg = raw.match(/#egg=([A-Za-z0-9_.-]+)/i);
  const hashes = [...raw.matchAll(/--hash=([^\s]+)/g)].map(match => match[1]);
  const requirement = stripRequirementComment(raw)
    .replace(/\s+--hash=[^\s]+/g, '')
    .trim();
  if (requirement.startsWith('-e ') || requirement.startsWith('--editable ')) {
    if (!egg) return undefined;
    return {
      name: normalizePackageName(egg[1]),
      specifier: requirement,
      pinned: false,
      hashes,
      directUrl: true,
      sourceFile,
      line,
    };
  }
  if (requirement.length === 0 || requirement.startsWith('-')) return undefined;

  const directUrl = requirement.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*@\s*(.+)$/);
  if (directUrl) {
    return {
      name: normalizePackageName(directUrl[1]),
      specifier: `@ ${directUrl[2].trim()}`,
      pinned: false,
      hashes,
      directUrl: true,
      sourceFile,
      line,
    };
  }

  const packageMatch = requirement.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?(.*)$/);
  if (!packageMatch) return undefined;
  const specifier = packageMatch[2].trim();
  return {
    name: normalizePackageName(packageMatch[1]),
    specifier,
    pinned: isExactPin(specifier),
    hashes,
    directUrl: false,
    sourceFile,
    line,
  };
}

function includeTarget(line: string): string | undefined {
  const match = line.match(
    /^(?:-r|--requirement|-c|--constraint)(?:\s+|=)(.+)$/,
  );
  return match?.[1].trim().replace(/^['"]|['"]$/g, '');
}

function loadRequirementFile(
  root: string,
  filePath: string,
  visited: Set<string>,
  manifest: PythonDependencyManifest,
): void {
  const absolutePath = resolve(filePath);
  if (visited.has(absolutePath) || !existsSync(absolutePath)) return;
  visited.add(absolutePath);
  const sourceFile = relative(root, absolutePath).replaceAll('\\', '/');
  manifest.files.push(sourceFile);
  const content = readFileSync(absolutePath, 'utf-8');

  for (const logical of logicalRequirementLines(content)) {
    const trimmed = logical.text.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const include = includeTarget(trimmed);
    if (include) {
      const candidate = resolve(dirname(absolutePath), include);
      if (!isWithinWorkspace(root, candidate)) {
        manifest.warnings.push(
          `Ignored requirement include outside the workspace: ${include}`,
        );
        continue;
      }
      loadRequirementFile(root, candidate, visited, manifest);
      continue;
    }
    const dependency = parseRequirement(trimmed, sourceFile, logical.line);
    if (dependency && !manifest.dependencies.some(existing => existing.name === dependency.name)) {
      manifest.dependencies.push(dependency);
    }
  }
}

function quotedValues(value: string): string[] {
  return [...value.matchAll(/["']([^"']+)["']/g)].map(match => match[1]);
}

function loadPyproject(root: string, manifest: PythonDependencyManifest): void {
  const path = join(root, 'pyproject.toml');
  const content = readFileSync(path, 'utf-8');
  manifest.files.push('pyproject.toml');

  const projectSection = content.match(
    /^\[project\]\s*$([\s\S]*?)(?=^\[[^\]]+\]\s*$|(?![\s\S]))/m,
  )?.[1];
  const dependencyArray = projectSection?.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1];
  if (dependencyArray) {
    for (const raw of quotedValues(dependencyArray)) {
      const line = content.slice(0, content.indexOf(raw)).split(/\r?\n/).length;
      const dependency = parseRequirement(raw, 'pyproject.toml', line);
      if (dependency && !manifest.dependencies.some(existing => existing.name === dependency.name)) {
        manifest.dependencies.push(dependency);
      }
    }
  }

  const poetrySection = content.match(
    /^\[tool\.poetry\.dependencies\]\s*$([\s\S]*?)(?=^\[[^\]]+\]\s*$|(?![\s\S]))/m,
  )?.[1];
  if (!poetrySection) return;
  for (const [index, line] of poetrySection.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/);
    if (!match || normalizePackageName(match[1]) === 'python') continue;
    const dependency = parseRequirement(
      `${match[1]}${match[2]}`,
      'pyproject.toml',
      index + 1,
    );
    if (dependency && !manifest.dependencies.some(existing => existing.name === dependency.name)) {
      manifest.dependencies.push(dependency);
    }
  }
}

export function loadPythonDependencies(dir: string): PythonDependencyManifest {
  const manifest: PythonDependencyManifest = {
    kind: 'none',
    files: [],
    dependencies: [],
    warnings: [],
  };
  const requirements = join(dir, 'requirements.txt');
  if (existsSync(requirements)) {
    manifest.kind = 'requirements';
    loadRequirementFile(resolve(dir), requirements, new Set(), manifest);
    return manifest;
  }
  if (existsSync(join(dir, 'pyproject.toml'))) {
    manifest.kind = 'pyproject';
    loadPyproject(dir, manifest);
  }
  return manifest;
}

function listPythonSourceFiles(root: string, dir = root): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) {
      files.push(...listPythonSourceFiles(root, path));
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      files.push(path);
    }
  }
  return files;
}

export function hasExternalPythonImports(dir: string): boolean {
  const sourceFiles = listPythonSourceFiles(dir);
  const localModules = new Set(
    sourceFiles.map(path => relative(dir, path).split(/[\\/]/)[0].replace(/\.py$/, '')),
  );
  for (const path of sourceFiles) {
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:import|from)\s+([A-Za-z_]\w*)/);
      if (!match) continue;
      const rootModule = match[1];
      if (!STANDARD_LIBRARY_MODULES.has(rootModule) && !localModules.has(rootModule)) {
        return true;
      }
    }
  }
  return false;
}
