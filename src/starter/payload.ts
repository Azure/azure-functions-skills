import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { loadSkills } from '../build/loader.js';
import { buildTelemetryRuntime } from '../build/telemetry-runtime.js';
import { buildFunctionsTools } from '../build/tools-runtime.js';
import {
  PUBLIC_TELEMETRY_INGESTION_ENDPOINT,
  PUBLIC_TELEMETRY_INSTRUMENTATION_KEY,
} from '../telemetry/public-config.js';
import { buildStarterFiles, DEFAULT_STARTER_ENDPOINTS, type StarterEndpoints, type StarterFiles } from './build.js';
import { loadStarterConfig, loadToolInstallTable, type StarterConfig } from './config.js';
import { loadStarterLock, verifyTemplateCache } from './template-lock.js';

export interface StarterPayloadOptions {
  readonly root: string;
  readonly config?: StarterConfig;
  readonly endpoints?: Partial<StarterEndpoints>;
}

/** Builds the starter payload from the repository's canonical sources. */
export function buildRepositoryStarter(options: StarterPayloadOptions): { files: StarterFiles; config: StarterConfig } {
  const { root } = options;
  const config = options.config ?? loadStarterConfig(join(root, 'starter.config.json'));
  const skillsDir = join(root, 'templates', 'skills');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { version: string };
  const lock = loadStarterLock(join(root, 'starter.lock.json'));
  const cacheErrors = verifyTemplateCache(root, config, lock);
  if (cacheErrors.length > 0) {
    throw new Error(['App template cache differs from starter.lock.json. Run the template refresh.', ...cacheErrors].join('\n  '));
  }
  const files = buildStarterFiles({
    root,
    lock,
    config,
    tools: loadToolInstallTable(join(root, 'templates', 'starter', 'tool-install.json')),
    skills: loadSkills(skillsDir),
    runtime: buildTelemetryRuntime(skillsDir),
    functionsTools: buildFunctionsTools(),
    packageVersion: pkg.version,
    endpoints: {
      ...DEFAULT_STARTER_ENDPOINTS,
      telemetry: PUBLIC_TELEMETRY_INGESTION_ENDPOINT,
      instrumentationKey: PUBLIC_TELEMETRY_INSTRUMENTATION_KEY,
      ...options.endpoints,
    },
  });
  return { files, config };
}

export function writeStarterFiles(files: StarterFiles, outputDir: string): void {
  rmSync(outputDir, { recursive: true, force: true });
  for (const [path, content] of files) {
    const destination = join(outputDir, ...path.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

/** Byte comparison of a generated payload with a directory. */
export function compareStarterFiles(files: StarterFiles, outputDir: string): string[] {
  const errors: string[] = [];
  const actual = new Set(listTree(outputDir));
  for (const [path, content] of files) {
    if (!actual.has(path)) {
      errors.push(`Missing generated file: ${path}`);
      continue;
    }
    if (!readFileSync(join(outputDir, ...path.split('/'))).equals(content)) errors.push(`Changed generated file: ${path}`);
    actual.delete(path);
  }
  for (const path of actual) errors.push(`Unexpected file: ${path}`);
  return errors.sort();
}

function listTree(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(relative(root, path).replaceAll('\\', '/'));
    }
  };
  walk(root);
  return files;
}
