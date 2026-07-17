/**
 * Tier 1 built-in checks for Azure Functions project diagnostics.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DoctorCheck, DoctorCheckResult } from './types.js';
import {
  RECOMMENDED_EXTENSION_BUNDLE,
  SUPPORTED_NODE_VERSIONS,
  DEPRECATED_SETTINGS,
} from './rules.js';
import { checkVersionStatus, getLanguageVersions } from './stacks.js';
import { makeCheckResult as result } from './check-result.js';
import {
  PYTHON_CHECKS,
  applicationInsightsCheck,
  pythonAzureFunctionsCheck,
  pythonBlueprintRegistrationCheck,
  pythonDependencyManifestCheck,
  pythonDeployArtifactsCheck,
  pythonDurableConfigurationCheck,
  pythonMissingLockfileCheck,
  pythonNativeDependenciesCheck,
  pythonProgrammingModelCheck,
  pythonUnpinnedRequirementsCheck,
  pythonWorkerDependencyCheck,
} from './python-checks.js';

export {
  applicationInsightsCheck,
  pythonAzureFunctionsCheck,
  pythonBlueprintRegistrationCheck,
  pythonDependencyManifestCheck,
  pythonDeployArtifactsCheck,
  pythonDurableConfigurationCheck,
  pythonMissingLockfileCheck,
  pythonNativeDependenciesCheck,
  pythonProgrammingModelCheck,
  pythonUnpinnedRequirementsCheck,
  pythonWorkerDependencyCheck,
};

// ── Helper ──

function buildVersionResult(
  check: DoctorCheck,
  vStatus: import('./stacks.js').VersionStatus,
  version: string,
): DoctorCheckResult {
  switch (vStatus.status) {
    case 'supported':
      return result(check, { status: 'pass', title: `Version ${version} supported`, message: vStatus.message });
    case 'eol-soon':
      return result(check, {
        status: 'warn', severity: 'medium',
        title: `Version ${version} nearing end of life`, message: vStatus.message,
        recommendation: `Upgrade before ${vStatus.endOfLifeDate?.split('T')[0]}`,
      });
    case 'eol':
    case 'deprecated':
      return result(check, {
        status: 'fail',
        title: `Version ${version} ${vStatus.status === 'eol' ? 'end of life' : 'deprecated'}`,
        message: vStatus.message, recommendation: 'Upgrade to a supported version',
      });
    case 'preview':
      return result(check, { status: 'pass', severity: 'info', title: `Version ${version} is preview`, message: vStatus.message });
    default:
      return result(check, { status: 'fail', title: `Version ${version} unsupported`, message: vStatus.message });
  }
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

    const majorMatch = nodeRange.match(/(\d+)/);
    if (!majorMatch) {
      return [result(nodeVersionCheck, {
        status: 'pass',
        title: 'Node.js version not determined',
        message: `Could not parse engines.node value: ${nodeRange}`,
      })];
    }

    const major = majorMatch[1];

    // Use stacks API data when available, fallback to hardcoded
    if (ctx.stacks.length > 0) {
      const vStatus = checkVersionStatus(ctx.stacks, 'node', major);
      switch (vStatus.status) {
        case 'supported':
          return [result(nodeVersionCheck, {
            status: 'pass',
            title: 'Node.js version supported',
            message: vStatus.message,
          })];
        case 'eol-soon':
          return [result(nodeVersionCheck, {
            status: 'warn',
            severity: 'medium',
            title: 'Node.js version nearing end of life',
            message: vStatus.message,
            file: 'package.json',
            recommendation: `Upgrade to a newer LTS version before ${vStatus.endOfLifeDate?.split('T')[0]}`,
          })];
        case 'eol':
        case 'deprecated':
          return [result(nodeVersionCheck, {
            status: 'fail',
            title: `Node.js ${major} ${vStatus.status === 'eol' ? 'end of life' : 'deprecated'}`,
            message: vStatus.message,
            file: 'package.json',
            recommendation: `Upgrade to a supported Node.js version`,
          })];
        case 'preview':
          return [result(nodeVersionCheck, {
            status: 'pass',
            severity: 'info',
            title: 'Node.js version is in preview',
            message: vStatus.message,
          })];
        case 'unknown':
        default:
          return [result(nodeVersionCheck, {
            status: 'fail',
            title: 'Node.js version unsupported',
            message: vStatus.message,
            file: 'package.json',
            recommendation: `Use a supported Node.js version`,
          })];
      }
    }

    // Fallback to hardcoded
    const majorNum = parseInt(major, 10);
    if (SUPPORTED_NODE_VERSIONS.includes(majorNum)) {
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
  },
};

// ── Check 5: python-version ──

export const pythonVersionCheck: DoctorCheck = {
  id: 'python-version',
  category: 'configuration',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.language === 'python',
  run: async (ctx) => {
    // Detect python version from local.settings.json PYTHON_VERSION or
    // from .python-version file, or FUNCTIONS_WORKER_RUNTIME_VERSION
    const values = ((ctx.localSettings as Record<string, unknown>)?.Values ?? {}) as Record<string, unknown>;
    const pythonVersion = (values.PYTHON_VERSION as string) ?? null;

    if (!pythonVersion && ctx.stacks.length === 0) {
      return [result(pythonVersionCheck, {
        status: 'skip',
        title: 'Python version check',
        message: 'Python version not specified and stacks API not available',
      })];
    }

    if (!pythonVersion) {
      // List supported versions from stacks API
      const supported = getLanguageVersions(ctx.stacks, 'python')
        .filter(v => !v.isDeprecated && !v.isPreview);
      return [result(pythonVersionCheck, {
        status: 'pass',
        title: 'Python version not specified',
        message: `Supported versions: ${supported.map(v => v.version).join(', ')}`,
      })];
    }

    if (ctx.stacks.length > 0) {
      const vStatus = checkVersionStatus(ctx.stacks, 'python', pythonVersion);
      return [buildVersionResult(pythonVersionCheck, vStatus, pythonVersion)];
    }

    return [result(pythonVersionCheck, {
      status: 'skip',
      title: 'Python version check',
      message: 'Stacks API not available for version validation',
    })];
  },
};

// ── Check 6: dotnet-version ──

export const dotnetVersionCheck: DoctorCheck = {
  id: 'dotnet-version',
  category: 'configuration',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.language === 'dotnet',
  run: async (ctx) => {
    if (ctx.stacks.length === 0) {
      return [result(dotnetVersionCheck, {
        status: 'skip',
        title: '.NET version check',
        message: 'Stacks API not available for version validation',
      })];
    }

    const supported = getLanguageVersions(ctx.stacks, 'dotnet')
      .filter(v => !v.isDeprecated && !v.isPreview);
    return [result(dotnetVersionCheck, {
      status: 'pass',
      title: '.NET versions available',
      message: `Supported: ${supported.map(v => v.version).join(', ')}`,
    })];
  },
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

// ── Check 14: lifecycle-scripts (supply-chain) ──

const FORBIDDEN_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'postpack', 'prepublish', 'prepublishOnly'];

export const lifecycleScriptsCheck: DoctorCheck = {
  id: 'lifecycle-scripts',
  category: 'security',
  defaultSeverity: 'high',
  appliesTo: (ctx) => ctx.language === 'node' && ctx.packageJson !== null,
  run: async (ctx) => {
    const scripts = (ctx.packageJson?.scripts ?? {}) as Record<string, unknown>;
    const present = FORBIDDEN_LIFECYCLE_SCRIPTS.filter(name => typeof scripts[name] === 'string');
    if (present.length === 0) {
      return [result(lifecycleScriptsCheck, {
        status: 'pass',
        title: 'No risky lifecycle scripts',
        message: 'package.json does not define preinstall/install/postinstall/postpack/prepublish/prepublishOnly',
      })];
    }
    return [result(lifecycleScriptsCheck, {
      status: 'fail',
      title: 'Risky npm lifecycle script defined',
      message: `package.json defines: ${present.join(', ')}. These run on every npm install and are a common supply-chain attack surface.`,
      file: 'package.json',
      recommendation: 'Remove these scripts, or convert to a manually-invoked npm run target. Functions runtime does not require any install-time scripts.',
    })];
  },
};

// ── Check 15: unpinned-prod-deps (supply-chain) ──

function looksFloating(versionSpec: string): boolean {
  if (!versionSpec) return false;
  const s = versionSpec.trim();
  if (s === '*' || s === 'latest' || s === 'next') return true;
  if (/^[\^~]/.test(s)) return true;
  if (/^>=?/.test(s)) return true;
  return false;
}

export const unpinnedProdDepsCheck: DoctorCheck = {
  id: 'unpinned-prod-deps',
  category: 'security',
  defaultSeverity: 'medium',
  appliesTo: (ctx) => ctx.language === 'node' && ctx.packageJson !== null,
  run: async (ctx) => {
    const deps = (ctx.packageJson?.dependencies ?? {}) as Record<string, string>;
    const unpinned = Object.entries(deps).filter(([, spec]) => looksFloating(spec));
    if (unpinned.length === 0) {
      return [result(unpinnedProdDepsCheck, {
        status: 'pass',
        title: 'Production dependencies are pinned',
        message: 'All production dependency versions are exact',
      })];
    }
    const names = unpinned.map(([name, spec]) => `${name}@${spec}`).slice(0, 5).join(', ');
    const more = unpinned.length > 5 ? `, +${unpinned.length - 5} more` : '';
    return [result(unpinnedProdDepsCheck, {
      status: 'warn',
      title: 'Production dependencies use floating version ranges',
      message: `${unpinned.length} production dependencies allow newer versions to be installed automatically: ${names}${more}. This expands the supply-chain attack window.`,
      file: 'package.json',
      recommendation: 'Pin direct production dependencies to exact versions and rely on package-lock.json + npm ci for reproducibility. Use Dependabot or manual review for upgrades.',
    })];
  },
};

// ── Check 16: missing-lockfile (supply-chain) ──

export const missingLockfileCheck: DoctorCheck = {
  id: 'missing-lockfile',
  category: 'security',
  defaultSeverity: 'medium',
  appliesTo: (ctx) => ctx.language === 'node' && ctx.packageJson !== null,
  run: async (ctx) => {
    const hasNpmLock = existsSync(join(ctx.dir, 'package-lock.json'));
    const hasShrinkwrap = existsSync(join(ctx.dir, 'npm-shrinkwrap.json'));
    const hasYarnLock = existsSync(join(ctx.dir, 'yarn.lock'));
    const hasPnpmLock = existsSync(join(ctx.dir, 'pnpm-lock.yaml'));
    if (hasNpmLock || hasShrinkwrap || hasYarnLock || hasPnpmLock) {
      return [result(missingLockfileCheck, {
        status: 'pass',
        title: 'Lockfile present',
        message: 'A package manager lockfile (npm/yarn/pnpm/shrinkwrap) is committed',
      })];
    }
    return [result(missingLockfileCheck, {
      status: 'warn',
      title: 'No lockfile present',
      message: 'No package-lock.json, yarn.lock, pnpm-lock.yaml, or npm-shrinkwrap.json found. Without a lockfile, each install can resolve to different transitive dependency versions.',
      recommendation: 'Commit a lockfile (run `npm install` and commit the resulting package-lock.json). Use `npm ci` in CI for reproducible builds.',
    })];
  },
};

// ── Check 17: tracked-secret-files (supply-chain) ──

const SECRET_FILE_NAMES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.staging',
  'local.settings.json',
];

export const trackedSecretFilesCheck: DoctorCheck = {
  id: 'tracked-secret-files',
  category: 'security',
  defaultSeverity: 'high',
  appliesTo: (ctx) => existsSync(join(ctx.dir, '.gitignore')) || existsSync(join(ctx.dir, '.git')),
  run: async (ctx) => {
    const found: string[] = [];
    for (const name of SECRET_FILE_NAMES) {
      if (existsSync(join(ctx.dir, name))) found.push(name);
    }
    if (found.length === 0) {
      return [result(trackedSecretFilesCheck, {
        status: 'pass',
        title: 'No local secret files in workspace',
        message: 'No .env-style files or local.settings.json were found',
      })];
    }

    // Highest-risk case: file is tracked by git (committed) even if it now
    // appears in .gitignore. Consult the git index, not just .gitignore text.
    const tracked = gitListTrackedFromCandidates(ctx.dir, found);
    if (tracked.length > 0) {
      return [result(trackedSecretFilesCheck, {
        status: 'fail',
        title: 'Local secret files are tracked by git',
        message: `${tracked.join(', ')} ${tracked.length === 1 ? 'is' : 'are'} committed to the git index. Adding to .gitignore later does not remove the secrets from history. The files are tracked even if .gitignore covers them now.`,
        recommendation: 'Run `git rm --cached <file>` to stop tracking, then `git commit`. Rotate any secrets that may have been pushed to a shared remote. Use `git filter-repo` or BFG to scrub history if required.',
      })];
    }

    const ignored = readGitignoreLines(ctx.dir);
    const unignored = found.filter(name => !isIgnored(name, ignored));
    if (unignored.length === 0) {
      return [result(trackedSecretFilesCheck, {
        status: 'pass',
        title: 'Local secret files are gitignored',
        message: `${found.length} local secret file(s) found and all are listed in .gitignore`,
      })];
    }
    return [result(trackedSecretFilesCheck, {
      status: 'fail',
      title: 'Local secret files are not gitignored',
      message: `Found ${unignored.join(', ')} but they are not covered by .gitignore. These files often contain secrets.`,
      recommendation: 'Add the file(s) to .gitignore and rotate any secrets that may have been committed. Verify with `git ls-files` that the files are not tracked.',
    })];
  },
};

/**
 * Return the subset of candidate filenames that are tracked in the git index.
 * Returns empty array when there is no git repository or git is unavailable.
 */
function gitListTrackedFromCandidates(dir: string, candidates: string[]): string[] {
  if (!existsSync(join(dir, '.git'))) return [];
  const tracked: string[] = [];
  for (const name of candidates) {
    const r = spawnSync('git', ['ls-files', '--error-unmatch', '--', name], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
      encoding: 'utf-8',
    });
    if (r.status === 0 && (r.stdout?.trim().length ?? 0) > 0) {
      tracked.push(name);
    }
  }
  return tracked;
}

function readGitignoreLines(dir: string): string[] {
  const path = join(dir, '.gitignore');
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

function isIgnored(filename: string, patterns: string[]): boolean {
  return patterns.some(p => {
    if (p === filename) return true;
    if (p === `/${filename}`) return true;
    if (p === '.env*' && filename.startsWith('.env')) return true;
    if (p === '*.env' && filename.endsWith('.env')) return true;
    if (p === 'local.settings.json' && filename === 'local.settings.json') return true;
    return false;
  });
}

// ── Check 18: install-script-deps (supply-chain) ──
// Detect direct prod deps that historically run install scripts (heuristic list).
// This is informational — not all listed packages are malicious, but they
// expand the install-time execution surface.

const PROD_DEP_INSTALL_SCRIPT_ALLOWLIST = new Set([
  // Common legitimate native modules that need install scripts; expand as needed.
  'sharp', 'bcrypt', 'sqlite3', 'better-sqlite3', 'node-sass', 'sass',
  'esbuild', 'puppeteer', 'playwright', '@parcel/watcher',
]);

export const installScriptDepsCheck: DoctorCheck = {
  id: 'install-script-deps',
  category: 'security',
  defaultSeverity: 'info',
  appliesTo: (ctx) => ctx.language === 'node' && ctx.packageJson !== null,
  run: async (ctx) => {
    const deps = (ctx.packageJson?.dependencies ?? {}) as Record<string, string>;
    const nodeModules = join(ctx.dir, 'node_modules');
    if (!existsSync(nodeModules)) {
      return [result(installScriptDepsCheck, {
        status: 'skip',
        title: 'Install-script audit skipped',
        message: 'node_modules not present; run `npm install` first to audit install scripts',
      })];
    }
    const offenders: string[] = [];
    for (const name of Object.keys(deps)) {
      if (PROD_DEP_INSTALL_SCRIPT_ALLOWLIST.has(name)) continue;
      const depPkgPath = join(nodeModules, name, 'package.json');
      if (!existsSync(depPkgPath)) continue;
      try {
        const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf-8'));
        const scripts = (depPkg.scripts ?? {}) as Record<string, unknown>;
        if (typeof scripts.preinstall === 'string'
          || typeof scripts.postinstall === 'string'
          || typeof scripts.install === 'string') {
          offenders.push(name);
        }
      } catch {
        // ignore unreadable dep
      }
    }
    if (offenders.length === 0) {
      return [result(installScriptDepsCheck, {
        status: 'pass',
        title: 'No production deps with install scripts',
        message: 'No direct production dependency runs preinstall/install/postinstall scripts (allowlisted natives excluded)',
      })];
    }
    const list = offenders.slice(0, 5).join(', ') + (offenders.length > 5 ? `, +${offenders.length - 5} more` : '');
    return [result(installScriptDepsCheck, {
      status: 'warn',
      title: 'Production deps run install scripts',
      message: `${offenders.length} direct production dependencies run install-time scripts: ${list}. Each one runs on every install and is a potential supply-chain surface.`,
      recommendation: 'Audit each dependency. Pin versions, use `npm ci --ignore-scripts` in CI where feasible, and watch for unexpected post-install activity.',
    })];
  },
};

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
  // Supply-chain security checks
  lifecycleScriptsCheck,
  unpinnedProdDepsCheck,
  missingLockfileCheck,
  trackedSecretFilesCheck,
  installScriptDepsCheck,
  ...PYTHON_CHECKS,
];
