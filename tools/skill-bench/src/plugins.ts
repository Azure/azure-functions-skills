import { pathToFileURL } from 'node:url';
import {
  createDefaultGraderRegistry, createExecutorRegistry, loadEvalSpec, loadExecutorPlugin, loadGraderPlugin,
  resolveExecutorName, validateEvalSpec,
} from '@microsoft/vally';
import type { ExecutorRegistry, GraderRegistry } from '@microsoft/vally';
import { CopilotSdkExecutor } from '@microsoft/vally/executor';
import type { PreflightDefinition } from './config.ts';
import type { Environment } from './env.ts';

/** Context for writing per-cell configuration, such as a package feed file. No network use. */
export interface PreflightCellContext {
  options: unknown;
  cellRoot: string;
  home: string;
  appData: string;
}

/** Context for a paid run check before the first model call. */
export interface PreflightRunContext {
  options: unknown;
  workDir: string;
  env: Environment;
}

/**
 * Context for work after a paid cell, for example to stop build servers that
 * keep files open. `workspace` is null after the preflight `run`.
 */
export interface PreflightTeardownContext {
  options: unknown;
  cellRoot: string;
  workspace: string | null;
  env: Environment;
}

/**
 * What a preflight `run` can report. skill-bench records it in the manifest,
 * and the dashboard shows it. Use it for the versions of the tools that the
 * scenario needs, so that two runs can be compared.
 */
export interface PreflightRunReport {
  /** Tool name to installed version, for example `{ "func": "4.15.1" }`. */
  tools?: Record<string, string>;
  /** Short messages for the operator, for example a version that differs from the pin. */
  warnings?: string[];
}

/**
 * A scenario plugin that prepares or checks the environment. A module exports
 * it as the named export `preflight`. `validate` and `prepareCell` also run in
 * a dry-run; `run` runs only in a paid run, before any model call.
 * `teardownCell` runs only in a paid run, after each cell and after `run`.
 * A teardown error is a warning; it does not stop the run.
 */
export interface PreflightPlugin {
  name: string;
  validate?(options: unknown): void;
  prepareCell?(context: PreflightCellContext): void;
  run?(context: PreflightRunContext): void | PreflightRunReport | Promise<void | PreflightRunReport>;
  teardownCell?(context: PreflightTeardownContext): void | Promise<void>;
}

const toolName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const toolVersion = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;

/** Check the value that a preflight `run` returned. Only short, safe strings are kept. */
export function parsePreflightReport(plugin: string, value: unknown): Required<PreflightRunReport> {
  const fail = (message: string): never => { throw new Error(`skill-bench plugins: preflight ${plugin} ${message}`); };
  if (value === undefined || value === null) return { tools: {}, warnings: [] };
  if (typeof value !== 'object' || Array.isArray(value)) fail('must return nothing or an object with tools and warnings.');
  const { tools = {}, warnings = [], ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) fail(`returned an unknown field ${Object.keys(rest)[0]}.`);
  if (tools === null || typeof tools !== 'object' || Array.isArray(tools)) fail('must return tools as an object.');
  const entries = Object.entries(tools as Record<string, unknown>);
  if (entries.length > 50) fail('returned too many tools.');
  for (const [name, version] of entries) {
    if (!toolName.test(name)) fail(`returned an unsafe tool name ${JSON.stringify(name.slice(0, 40))}.`);
    if (typeof version !== 'string' || !toolVersion.test(version)) fail(`returned an unsafe version for ${name}.`);
  }
  if (!Array.isArray(warnings) || warnings.length > 50
    || !warnings.every(item => typeof item === 'string' && item.length > 0 && item.length <= 500)) {
    fail('must return warnings as a list of short strings.');
  }
  return { tools: Object.fromEntries(entries) as Record<string, string>, warnings: warnings as string[] };
}

export interface LoadedPreflight {
  plugin: PreflightPlugin;
  options: unknown;
  module: string;
}

export interface Registries {
  graders: GraderRegistry;
  executors: ExecutorRegistry;
}

export interface SpecValidation {
  file: string;
  valid: boolean;
  errors: string[];
}

export async function withRegistries<T>(root: string, graderPlugins: string[], executorPlugins: string[],
  operation: (registries: Registries) => Promise<T>): Promise<T> {
  const graders = createDefaultGraderRegistry();
  const executors = createExecutorRegistry();
  executors.register(new CopilotSdkExecutor());
  try {
    for (const plugin of graderPlugins) await loadGraderPlugin(plugin, graders, { cwd: root });
    for (const plugin of executorPlugins) await loadExecutorPlugin(plugin, executors, { cwd: root });
    return await operation({ graders, executors });
  } finally {
    await Promise.all(executors.getAll().map(executor => executor.shutdown()));
  }
}

/** Validate the exact cell specifications Vally will read, with every plugin registered. No executor runs. */
export async function validateSpecs(files: string[], registries: Registries): Promise<SpecValidation[]> {
  const results: SpecValidation[] = [];
  for (const file of files) {
    const spec = await loadEvalSpec(file);
    const result = validateEvalSpec(spec, { registry: registries.graders, executorRegistry: registries.executors, evalFilePath: file });
    const errors = result.diagnostics.filter(item => item.severity === 'error').map(item => `${item.code}: ${item.message}`);
    const executor = resolveExecutorName(spec.defaults?.executor) ?? 'copilot-sdk';
    if (!registries.executors.get(executor)) errors.push(`executor-not-registered: load the executor plugin for '${executor}'.`);
    results.push({ file, valid: result.valid && errors.length === 0, errors });
  }
  return results;
}

function isPreflight(value: unknown): value is PreflightPlugin {
  if (value === null || typeof value !== 'object') return false;
  const plugin = value as Record<string, unknown>;
  return typeof plugin.name === 'string' && plugin.name.length > 0
    && ['validate', 'prepareCell', 'run', 'teardownCell'].every(key => plugin[key] === undefined || typeof plugin[key] === 'function');
}

export async function loadPreflights(definitions: PreflightDefinition[]): Promise<LoadedPreflight[]> {
  const loaded: LoadedPreflight[] = [];
  for (const definition of definitions) {
    let module: Record<string, unknown>;
    try {
      module = await import(pathToFileURL(definition.module).href) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`skill-bench plugins: cannot load preflight ${definition.module}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const plugin = module.preflight;
    if (!isPreflight(plugin)) {
      throw new Error(`skill-bench plugins: ${definition.module} must export a named "preflight" object with a name.`);
    }
    plugin.validate?.(definition.options);
    loaded.push({ plugin, options: definition.options, module: definition.module });
  }
  return loaded;
}
