/**
 * Tier 1 built-in checks for Azure Functions project diagnostics.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorCheck, DoctorCheckResult } from './types.js';
import {
  RECOMMENDED_EXTENSION_BUNDLE,
  SUPPORTED_NODE_VERSIONS,
  DEPRECATED_SETTINGS,
} from './rules.js';

// ── Helper ──

function result(
  check: DoctorCheck,
  overrides: Partial<DoctorCheckResult> & { status: DoctorCheckResult['status']; title: string; message: string },
): DoctorCheckResult {
  return {
    id: check.id,
    category: check.category,
    severity: check.defaultSeverity,
    ...overrides,
  };
}

// ── Check 1: project-exists ──

export const projectExistsCheck: DoctorCheck = {
  id: 'project-exists',
  category: 'structure',
  defaultSeverity: 'critical',
  appliesTo: () => true,
  run: async (ctx) => {
    if (ctx.hostJson !== null) {
      return [result(projectExistsCheck, {
        status: 'pass',
        title: 'Functions project found',
        message: 'host.json exists',
      })];
    }
    return [result(projectExistsCheck, {
      status: 'fail',
      title: 'Functions project not found',
      message: 'host.json is missing',
      recommendation: 'Run "func init" or "azure-functions-skills create" to create a project',
    })];
  },
};

// ── Check 2: runtime-version ──

export const runtimeVersionCheck: DoctorCheck = {
  id: 'runtime-version',
  category: 'configuration',
  defaultSeverity: 'critical',
  appliesTo: (ctx) => ctx.hostJson !== null,
  run: async (ctx) => {
    const version = (ctx.hostJson as Record<string, unknown>)?.version;
    if (version === undefined) {
      return [result(runtimeVersionCheck, {
        status: 'fail',
        title: 'Runtime version not specified',
        message: 'host.json is missing the "version" field',
        file: 'host.json',
        recommendation: 'Add "version": "2.0" to host.json',
      })];
    }
    // version "2.0" corresponds to Functions runtime v4
    if (version === '2.0') {
      return [result(runtimeVersionCheck, {
        status: 'pass',
        title: 'Runtime version supported',
        message: 'host.json version "2.0" (Functions runtime v4)',
      })];
    }
    return [result(runtimeVersionCheck, {
      status: 'fail',
      title: 'Runtime version unsupported',
      message: `host.json version "${version}" is not supported`,
      file: 'host.json',
      recommendation: 'Set "version": "2.0" for Functions runtime v4',
    })];
  },
};

// ── Check 3: extension-bundle ──

function parseVersionComponent(v: string): number {
  return parseInt(v, 10) || 0;
}

export const extensionBundleCheck: DoctorCheck = {
  id: 'extension-bundle',
  category: 'configuration',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.hostJson !== null && ctx.language !== 'dotnet',
  run: async (ctx) => {
    const host = ctx.hostJson as Record<string, unknown>;
    const bundle = host?.extensionBundle as Record<string, unknown> | undefined;

    if (!bundle) {
      return [result(extensionBundleCheck, {
        status: 'warn',
        title: 'Extension bundle not configured',
        message: 'No extensionBundle in host.json',
        file: 'host.json',
        recommendation: `Add extensionBundle with version [${RECOMMENDED_EXTENSION_BUNDLE.minVersion}, ${RECOMMENDED_EXTENSION_BUNDLE.maxVersion})`,
      })];
    }

    const versionStr = bundle.version as string | undefined;
    if (!versionStr) {
      return [result(extensionBundleCheck, {
        status: 'fail',
        title: 'Extension bundle version missing',
        message: 'extensionBundle is configured but has no version range',
        file: 'host.json',
        recommendation: `Set version to "[${RECOMMENDED_EXTENSION_BUNDLE.minVersion}, ${RECOMMENDED_EXTENSION_BUNDLE.maxVersion})"`,
      })];
    }

    // Parse version range like "[4.0.0, 5.0.0)"
    const rangeMatch = versionStr.match(/\[(\d+\.\d+\.\d+),\s*(\d+\.\d+\.\d+)\)/);
    if (rangeMatch) {
      const [, minVer] = rangeMatch;
      const minMajor = parseVersionComponent(minVer.split('.')[0]);
      const recommendedMinMajor = parseVersionComponent(RECOMMENDED_EXTENSION_BUNDLE.minVersion.split('.')[0]);
      if (minMajor >= recommendedMinMajor) {
        return [result(extensionBundleCheck, {
          status: 'pass',
          title: 'Extension bundle up to date',
          message: `Version range ${versionStr} is current`,
        })];
      }
    }

    return [result(extensionBundleCheck, {
      status: 'fail',
      title: 'Extension bundle outdated',
      message: `Bundle version ${versionStr} is outdated`,
      file: 'host.json',
      recommendation: `Update to "[${RECOMMENDED_EXTENSION_BUNDLE.minVersion}, ${RECOMMENDED_EXTENSION_BUNDLE.maxVersion})"`,
    })];
  },
};

// ── Check 4: node-version ──

export const nodeVersionCheck: DoctorCheck = {
  id: 'node-version',
  category: 'configuration',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.language === 'node',
  run: async (ctx) => {
    const engines = (ctx.packageJson as Record<string, unknown>)?.engines as Record<string, string> | undefined;
    const nodeRange = engines?.node;
    if (!nodeRange) {
      return [result(nodeVersionCheck, {
        status: 'pass',
        title: 'Node.js version not constrained',
        message: 'No engines.node in package.json; will use system Node.js',
      })];
    }

    // Extract major version from common patterns like ">=18.0.0", "^20.0.0", "18", "20.x"
    const majorMatch = nodeRange.match(/(\d+)/);
    if (majorMatch) {
      const major = parseInt(majorMatch[1], 10);
      if (SUPPORTED_NODE_VERSIONS.includes(major)) {
        return [result(nodeVersionCheck, {
          status: 'pass',
          title: 'Node.js version supported',
          message: `Node.js ${major}.x is in the support range`,
        })];
      }
      return [result(nodeVersionCheck, {
        status: 'fail',
        title: 'Node.js version unsupported',
        message: `Node.js ${major}.x is not in the Azure Functions support range`,
        file: 'package.json',
        recommendation: `Use Node.js ${SUPPORTED_NODE_VERSIONS.join(' or ')}.x`,
      })];
    }

    return [result(nodeVersionCheck, {
      status: 'pass',
      title: 'Node.js version not determined',
      message: `Could not parse engines.node value: ${nodeRange}`,
    })];
  },
};

// ── Check 5–6: python-version and dotnet-version are placeholders for v1 ──
// Language version checks require runtime detection beyond file markers.
// Kept as skip-returning stubs to register the check IDs.

export const pythonVersionCheck: DoctorCheck = {
  id: 'python-version',
  category: 'configuration',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.language === 'python',
  run: async () => [
    {
      id: 'python-version',
      category: 'configuration',
      severity: 'high' as const,
      status: 'skip' as const,
      title: 'Python version check',
      message: 'Python version detection not yet implemented',
    },
  ],
};

export const dotnetVersionCheck: DoctorCheck = {
  id: 'dotnet-version',
  category: 'configuration',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.language === 'dotnet',
  run: async () => [
    {
      id: 'dotnet-version',
      category: 'configuration',
      severity: 'high' as const,
      status: 'skip' as const,
      title: '.NET version check',
      message: '.NET version detection not yet implemented',
    },
  ],
};

// ── Check 7: local-settings ──

export const localSettingsCheck: DoctorCheck = {
  id: 'local-settings',
  category: 'configuration',
  defaultSeverity: 'medium',
  appliesTo: (ctx) => ctx.hostJson !== null,
  run: async (ctx) => {
    if (!ctx.localSettings) {
      return [result(localSettingsCheck, {
        status: 'warn',
        title: 'local.settings.json not found',
        message: 'Missing local.settings.json; local development may fail',
        recommendation: 'Create local.settings.json with required settings',
      })];
    }

    const values = (ctx.localSettings as Record<string, unknown>).Values as Record<string, unknown> | undefined;
    if (!values || !values.FUNCTIONS_WORKER_RUNTIME) {
      return [result(localSettingsCheck, {
        status: 'warn',
        title: 'Worker runtime not set',
        message: 'FUNCTIONS_WORKER_RUNTIME is not set in local.settings.json',
        file: 'local.settings.json',
        recommendation: 'Add FUNCTIONS_WORKER_RUNTIME to Values (e.g. "node", "python", "dotnet")',
      })];
    }

    return [result(localSettingsCheck, {
      status: 'pass',
      title: 'Local settings valid',
      message: 'local.settings.json has required settings',
    })];
  },
};

// ── Check 8: connection-strings ──

export const connectionStringsCheck: DoctorCheck = {
  id: 'connection-strings',
  category: 'configuration',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.hostJson !== null && ctx.functions.length > 0,
  run: async (ctx) => {
    if (!ctx.localSettings) {
      return [result(connectionStringsCheck, {
        status: 'skip',
        title: 'Connection string check skipped',
        message: 'local.settings.json not available',
      })];
    }

    const values = ((ctx.localSettings as Record<string, unknown>).Values ?? {}) as Record<string, unknown>;
    const results: DoctorCheckResult[] = [];

    // Check if AzureWebJobsStorage is set when non-HTTP triggers exist
    const hasNonHttpTrigger = ctx.functions.some(f => f.triggerType !== 'httpTrigger');
    if (hasNonHttpTrigger && !values.AzureWebJobsStorage) {
      results.push(result(connectionStringsCheck, {
        status: 'fail',
        title: 'AzureWebJobsStorage missing',
        message: 'Non-HTTP triggers require AzureWebJobsStorage',
        file: 'local.settings.json',
        recommendation: 'Add "AzureWebJobsStorage": "UseDevelopmentStorage=true" for local development',
      }));
    }

    if (results.length === 0) {
      results.push(result(connectionStringsCheck, {
        status: 'pass',
        title: 'Connection settings present',
        message: 'Required connection settings are configured',
      }));
    }

    return results;
  },
};

// ── Check 9: deprecated-settings ──

export const deprecatedSettingsCheck: DoctorCheck = {
  id: 'deprecated-settings',
  category: 'configuration',
  defaultSeverity: 'medium',
  appliesTo: (ctx) => ctx.localSettings !== null,
  run: async (ctx) => {
    const values = ((ctx.localSettings as Record<string, unknown>)?.Values ?? {}) as Record<string, unknown>;
    const found: DoctorCheckResult[] = [];

    for (const [key, reason] of Object.entries(DEPRECATED_SETTINGS)) {
      if (key in values) {
        found.push(result(deprecatedSettingsCheck, {
          status: 'warn',
          title: `Deprecated setting: ${key}`,
          message: reason,
          file: 'local.settings.json',
          recommendation: `Remove ${key} from local.settings.json`,
        }));
      }
    }

    if (found.length === 0) {
      return [result(deprecatedSettingsCheck, {
        status: 'pass',
        title: 'No deprecated settings',
        message: 'No deprecated settings found',
      })];
    }

    return found;
  },
};

// ── Check 10: package-dependencies (stub) ──

export const packageDependenciesCheck: DoctorCheck = {
  id: 'package-dependencies',
  category: 'dependencies',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.language === 'node' && ctx.packageJson !== null,
  run: async () => [
    {
      id: 'package-dependencies',
      category: 'dependencies',
      severity: 'high' as const,
      status: 'skip' as const,
      title: 'Package dependency check',
      message: 'Dependency vulnerability scanning not yet implemented',
    },
  ],
};

// ── Check 11: function-bindings ──

export const functionBindingsCheck: DoctorCheck = {
  id: 'function-bindings',
  category: 'bindings',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.functions.length > 0,
  run: async (ctx) => {
    const unknownTriggers = ctx.functions.filter(f => f.triggerType === 'unknown');
    if (unknownTriggers.length > 0) {
      return [result(functionBindingsCheck, {
        status: 'warn',
        title: 'Unknown trigger types detected',
        message: `${unknownTriggers.length} function(s) have unrecognized trigger types: ${unknownTriggers.map(f => f.name).join(', ')}`,
        recommendation: 'Verify function.json bindings or v4 app.* registrations',
      })];
    }
    return [result(functionBindingsCheck, {
      status: 'pass',
      title: 'Function bindings valid',
      message: `${ctx.functions.length} function(s), all bindings recognized`,
    })];
  },
};

// ── Check 12: entry-point ──

export const entryPointCheck: DoctorCheck = {
  id: 'entry-point',
  category: 'code',
  defaultSeverity: 'critical',
  appliesTo: (ctx) => ctx.language === 'node' && ctx.hostJson !== null,
  run: async (ctx) => {
    // For v4 Node.js, check that main field in package.json points to an existing file
    const main = (ctx.packageJson as Record<string, unknown>)?.main as string | undefined;
    if (main) {
      const mainPath = join(ctx.dir, main);
      // Check .js and dist variations
      const exists = existsSync(mainPath)
        || existsSync(mainPath.replace(/\.js$/, '.ts'))
        || existsSync(join(ctx.dir, 'dist', main));
      if (!exists) {
        return [result(entryPointCheck, {
          status: 'fail',
          title: 'Entry point not found',
          message: `package.json main "${main}" does not resolve to an existing file`,
          file: 'package.json',
          recommendation: 'Verify the "main" field points to the correct entry file; run build if needed',
        })];
      }
    }

    return [result(entryPointCheck, {
      status: 'pass',
      title: 'Entry point resolved',
      message: 'Function entry points are correctly configured',
    })];
  },
};

// ── Check 13: typescript-build ──

export const typescriptBuildCheck: DoctorCheck = {
  id: 'typescript-build',
  category: 'build',
  defaultSeverity: 'medium',
  appliesTo: (ctx) => ctx.language === 'node' && existsSync(join(ctx.dir, 'tsconfig.json')),
  run: async (ctx) => {
    const tsconfig = readJsonFile(join(ctx.dir, 'tsconfig.json'));
    if (!tsconfig) {
      return [result(typescriptBuildCheck, {
        status: 'fail',
        title: 'tsconfig.json invalid',
        message: 'Could not parse tsconfig.json',
        file: 'tsconfig.json',
        recommendation: 'Fix JSON syntax in tsconfig.json',
      })];
    }

    const compilerOptions = tsconfig.compilerOptions as Record<string, unknown> | undefined;
    if (!compilerOptions?.outDir) {
      return [result(typescriptBuildCheck, {
        status: 'warn',
        title: 'No outDir in tsconfig',
        message: 'tsconfig.json has no outDir; built files may be mixed with sources',
        file: 'tsconfig.json',
        recommendation: 'Set "outDir": "dist" in compilerOptions',
      })];
    }

    return [result(typescriptBuildCheck, {
      status: 'pass',
      title: 'TypeScript build config OK',
      message: `outDir: ${compilerOptions.outDir}`,
    })];
  },
};

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── All Tier 1 checks ──

export const ALL_CHECKS: DoctorCheck[] = [
  projectExistsCheck,
  runtimeVersionCheck,
  extensionBundleCheck,
  nodeVersionCheck,
  pythonVersionCheck,
  dotnetVersionCheck,
  localSettingsCheck,
  connectionStringsCheck,
  deprecatedSettingsCheck,
  packageDependenciesCheck,
  functionBindingsCheck,
  entryPointCheck,
  typescriptBuildCheck,
];
