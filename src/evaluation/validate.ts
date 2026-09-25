import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createDefaultGraderRegistry, createExecutorRegistry, discoverAndLoadEvals, loadExecutorPlugin,
  loadGraderPlugin, ProjectContext, resolveExecutorName, validateEvalSpec,
} from '@microsoft/vally';
import type { ExecutorRegistry, GraderRegistry } from '@microsoft/vally';
import { CopilotSdkExecutor } from '@microsoft/vally/executor';

export async function withPluginRegistries<T>(
  root: string,
  graderPlugins: string[],
  executorPlugins: string[],
  operation: (registries: { graders: GraderRegistry; executors: ExecutorRegistry }) => Promise<T>,
): Promise<T> {
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

export async function validatePluginEvals(root: string, graderPlugins: string[], executorPlugins: string[]) {
  return withPluginRegistries(root, graderPlugins, executorPlugins, async ({ graders, executors }) => {
    const project = await ProjectContext.load(root);
    const discovered = await discoverAndLoadEvals(project, { fallbackDir: root });
    if (discovered.errors.length) {
      throw new Error(discovered.errors.map(error => `${error.path}: ${error.reason}`).join('\n'));
    }
    if (discovered.evals.length === 0) throw new Error('No eval specifications were found.');
    return discovered.evals.map(({ filePath, spec }) => {
      const result = validateEvalSpec(spec, {
        registry: graders, executorRegistry: executors, evalFilePath: filePath,
        environments: project.config.environments,
      });
      const executor = resolveExecutorName(spec.defaults?.executor) ?? 'copilot-sdk';
      if (!executors.get(executor)) {
        result.valid = false;
        result.diagnostics.push({
          severity: 'error', code: 'executor-not-registered', path: 'defaults.executor',
          message: `Load the executor plugin for '${executor}' before execution.`,
        });
      }
      return { filePath, ...result };
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      root: { type: 'string' },
      'grader-plugin': { type: 'string', multiple: true },
      'executor-plugin': { type: 'string', multiple: true },
    }, strict: true });
    const checks = await validatePluginEvals(resolve(values.root ?? '.'),
      values['grader-plugin'] ?? [], values['executor-plugin'] ?? []);
    for (const result of checks) {
      console.log(`${result.valid ? 'Valid' : 'Invalid'}: ${result.filePath}`);
      for (const diagnostic of result.diagnostics) {
        console.log(`  ${diagnostic.severity} [${diagnostic.code}]: ${diagnostic.message}`);
      }
    }
    process.exitCode = checks.every(result => result.valid) ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
