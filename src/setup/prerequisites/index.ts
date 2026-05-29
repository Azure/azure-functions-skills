import type { BuildTargetName } from '../../types.js';
import { azureSkillsProvider } from './azure-skills.js';
import type { EnsurePrerequisitesOptions, PrerequisiteProvider, PrerequisiteResult } from './types.js';

const DEFAULT_PROVIDERS: PrerequisiteProvider[] = [azureSkillsProvider];

export async function ensurePrerequisites(options: EnsurePrerequisitesOptions): Promise<PrerequisiteResult[]> {
  const providers = options.providers || DEFAULT_PROVIDERS;
  const targets = [...new Set(options.targets)];

  if (options.mode === 'skip') {
    return targets.map(target => skippedResult(target));
  }

  const results: PrerequisiteResult[] = [];
  for (const target of targets) {
    for (const provider of providers) {
      if (!provider.supports(target)) {
        results.push(unsupportedResult(provider.id, target));
        continue;
      }

      const context = {
        target,
        projectDir: options.projectDir,
        mode: options.mode,
        runner: options.runner,
      };
      const check = await provider.check(context);
      if (check.status === 'present' || options.mode === 'check-only') {
        results.push(check);
        continue;
      }

      results.push(await provider.install(context));
    }
  }

  return results;
}

function skippedResult(target: BuildTargetName): PrerequisiteResult {
  return {
    id: 'azure-skills',
    target,
    status: 'skipped',
    message: 'Azure Skills prerequisite check skipped.',
  };
}

function unsupportedResult(id: string, target: BuildTargetName): PrerequisiteResult {
  return {
    id,
    target,
    status: 'unsupported',
    message: `Automatic Azure Skills prerequisite handling is not implemented for ${target}.`,
  };
}

export type {
  CommandResult,
  CommandRunner,
  EnsurePrerequisitesOptions,
  PrerequisiteContext,
  PrerequisiteMode,
  PrerequisiteProvider,
  PrerequisiteResult,
  PrerequisiteStatus,
} from './types.js';
