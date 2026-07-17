import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorCheck } from './types.js';
import { makeCheckResult as result } from './check-result.js';
import {
  hasExternalPythonImports,
  loadPythonDependencies,
  type PythonDependency,
} from './python-dependencies.js';

const MINIMUM_PYTHON_V2_LIBRARY_VERSION = [1, 17, 0] as const;

const NATIVE_DEPENDENCIES = new Set([
  'cryptography',
  'grpcio',
  'lxml',
  'numpy',
  'opencv-python',
  'orjson',
  'pandas',
  'pillow',
  'psycopg2',
  'pyodbc',
  'scipy',
  'ujson',
]);

function dependencyFile(dependency: PythonDependency | undefined): string | undefined {
  return dependency?.sourceFile;
}

function dependencyVersion(dependency: PythonDependency): [number, number, number] | undefined {
  const match = dependency.specifier.match(/^==\s*(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function versionLessThan(
  actual: readonly number[],
  minimum: readonly number[],
): boolean {
  for (let index = 0; index < Math.max(actual.length, minimum.length); index++) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart !== minimumPart) return actualPart < minimumPart;
  }
  return false;
}

export const pythonProgrammingModelCheck: DoctorCheck = {
  id: 'python-programming-model',
  category: 'structure',
  defaultSeverity: 'high',
  appliesTo: ctx => ctx.language === 'python',
  run: async ctx => {
    const model = ctx.python?.programmingModel ?? 'unknown';
    if (model === 'mixed') {
      return [result(pythonProgrammingModelCheck, {
        status: 'warn',
        title: 'Mixed Python programming models detected',
        message: 'The project contains both function.json functions and Python v2 FunctionApp or Blueprint registrations. Mixed layouts can make deployment and function indexing behavior difficult to predict.',
        recommendation: 'Use one Python programming model per Function App, or verify the mixed layout against the targeted Functions host before deployment.',
      })];
    }
    if (model === 'unknown') {
      return [result(pythonProgrammingModelCheck, {
        status: 'warn',
        severity: 'medium',
        title: 'Python programming model not detected',
        message: 'Python project signals were found, but no function.json, FunctionApp, or Blueprint definition was detected.',
        recommendation: 'Verify the function entry point and programming model layout.',
      })];
    }
    return [result(pythonProgrammingModelCheck, {
      status: 'pass',
      title: `Python ${model} programming model detected`,
      message: `The project uses the Python ${model} programming model`,
    })];
  },
};

export const pythonDependencyManifestCheck: DoctorCheck = {
  id: 'python-dependency-manifest',
  category: 'dependencies',
  defaultSeverity: 'high',
  appliesTo: ctx => ctx.language === 'python',
  run: async ctx => {
    const manifest = loadPythonDependencies(ctx.dir);
    if (manifest.kind !== 'none') {
      return [result(pythonDependencyManifestCheck, {
        status: 'pass',
        title: 'Python dependency manifest found',
        message: `Using ${manifest.files[0]} as the Python dependency manifest`,
        file: manifest.files[0],
      })];
    }
    if (!hasExternalPythonImports(ctx.dir)) {
      return [result(pythonDependencyManifestCheck, {
        status: 'pass',
        title: 'No external Python dependencies detected',
        message: 'No dependency manifest is present, but source imports only local or standard-library modules',
      })];
    }
    return [result(pythonDependencyManifestCheck, {
      status: 'fail',
      title: 'Python dependency manifest missing',
      message: 'Python source imports external packages, but neither requirements.txt nor pyproject.toml was found.',
      recommendation: 'Declare deployment dependencies in requirements.txt or pyproject.toml and commit the manifest.',
    })];
  },
};

export const pythonAzureFunctionsCheck: DoctorCheck = {
  id: 'python-azure-functions',
  category: 'dependencies',
  defaultSeverity: 'high',
  appliesTo: ctx => ctx.language === 'python',
  run: async ctx => {
    const manifest = loadPythonDependencies(ctx.dir);
    if (manifest.kind === 'none') {
      return [result(pythonAzureFunctionsCheck, {
        status: 'skip',
        title: 'azure-functions dependency check skipped',
        message: 'No Python dependency manifest is available',
      })];
    }
    const dependency = manifest.dependencies.find(item => item.name === 'azure-functions');
    if (!dependency) {
      return [result(pythonAzureFunctionsCheck, {
        status: 'fail',
        title: 'azure-functions dependency missing',
        message: `${manifest.files[0]} does not declare the azure-functions package required by Python Functions applications.`,
        file: manifest.files[0],
        recommendation: 'Add a supported azure-functions package version to the application dependency manifest.',
      })];
    }
    const version = dependencyVersion(dependency);
    if (
      version
      && ctx.python?.programmingModel !== 'v1'
      && versionLessThan(version, MINIMUM_PYTHON_V2_LIBRARY_VERSION)
    ) {
      return [result(pythonAzureFunctionsCheck, {
        status: 'fail',
        title: 'azure-functions dependency is too old for Python v2',
        message: `azure-functions ${version.join('.')} is below the Python v2 minimum ${MINIMUM_PYTHON_V2_LIBRARY_VERSION.join('.')}.`,
        file: dependency.sourceFile,
        line: dependency.line,
        recommendation: `Upgrade azure-functions to ${MINIMUM_PYTHON_V2_LIBRARY_VERSION.join('.')} or later.`,
      })];
    }
    return [result(pythonAzureFunctionsCheck, {
      status: 'pass',
      title: 'azure-functions dependency present',
      message: 'The Python dependency manifest declares azure-functions',
      file: dependency.sourceFile,
    })];
  },
};

export const pythonWorkerDependencyCheck: DoctorCheck = {
  id: 'python-worker-dependency',
  category: 'dependencies',
  defaultSeverity: 'medium',
  appliesTo: ctx => ctx.language === 'python',
  run: async ctx => {
    const dependency = loadPythonDependencies(ctx.dir).dependencies
      .find(item => item.name === 'azure-functions-worker');
    if (!dependency) {
      return [result(pythonWorkerDependencyCheck, {
        status: 'pass',
        title: 'Functions worker is platform-managed',
        message: 'The application does not declare azure-functions-worker',
      })];
    }
    return [result(pythonWorkerDependencyCheck, {
      status: 'warn',
      title: 'azure-functions-worker is declared by the application',
      message: 'The Functions platform manages the Python worker. Declaring azure-functions-worker can conflict with the worker version supplied by the host.',
      file: dependency.sourceFile,
      line: dependency.line,
      recommendation: 'Remove azure-functions-worker from the application dependency manifest.',
    })];
  },
};

export const pythonBlueprintRegistrationCheck: DoctorCheck = {
  id: 'python-blueprint-registration',
  category: 'code',
  defaultSeverity: 'high',
  appliesTo: ctx => ctx.language === 'python' && ctx.functions.some(fn => fn.blueprint !== undefined),
  run: async ctx => {
    const unregistered = ctx.functions.filter(
      fn => fn.blueprint !== undefined && fn.blueprintRegistered === false,
    );
    if (unregistered.length === 0) {
      return [result(pythonBlueprintRegistrationCheck, {
        status: 'pass',
        title: 'Python Blueprints registered',
        message: 'All discovered Blueprint functions are registered with a FunctionApp',
      })];
    }
    return unregistered.map(fn => result(pythonBlueprintRegistrationCheck, {
      status: 'warn',
      title: `Blueprint function ${fn.name} is not registered`,
      message: `Function ${fn.name} uses Blueprint ${fn.blueprint}, but no matching Blueprint registration call was found.`,
      file: fn.sourceFile,
      line: fn.line,
      recommendation: `Import ${fn.blueprint} into the application entry point and register it with app.register_blueprint(${fn.blueprint}).`,
    }));
  },
};

export const pythonNativeDependenciesCheck: DoctorCheck = {
  id: 'python-native-dependencies',
  category: 'dependencies',
  defaultSeverity: 'info',
  appliesTo: ctx => ctx.language === 'python',
  run: async ctx => {
    const dependencies = loadPythonDependencies(ctx.dir).dependencies
      .filter(item => NATIVE_DEPENDENCIES.has(item.name));
    if (dependencies.length === 0) {
      return [result(pythonNativeDependenciesCheck, {
        status: 'pass',
        title: 'No known native dependency risks',
        message: 'No commonly platform-specific Python packages were found',
      })];
    }
    return [result(pythonNativeDependenciesCheck, {
      status: 'warn',
      title: 'Python dependencies may require platform-compatible wheels',
      message: `Native or compiled packages detected: ${dependencies.map(item => item.name).join(', ')}. These packages are valid dependencies, but deployment artifacts must match the Function App operating system and architecture.`,
      file: dependencyFile(dependencies[0]),
      recommendation: 'Build dependencies in a Linux environment matching Azure Functions, or use remote build, and verify compatible wheels are available.',
    })];
  },
};

function funcignorePatterns(dir: string): string[] {
  const path = join(dir, '.funcignore');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\//, ''))
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

function artifactExcluded(artifact: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    const normalized = pattern.replace(/\/$/, '');
    if (normalized === artifact.replace(/\/$/, '')) return true;
    if (artifact === '*.pyc' && (pattern === '*.pyc' || pattern === '**/*.pyc')) return true;
    return false;
  });
}

export const pythonDeployArtifactsCheck: DoctorCheck = {
  id: 'python-deploy-artifacts',
  category: 'build',
  defaultSeverity: 'low',
  appliesTo: ctx => ctx.language === 'python',
  run: async ctx => {
    const candidates = [
      { label: 'tests/', exists: existsSync(join(ctx.dir, 'tests')) },
      { label: '.venv/', exists: existsSync(join(ctx.dir, '.venv')) },
      { label: 'venv/', exists: existsSync(join(ctx.dir, 'venv')) },
      { label: '__pycache__/', exists: existsSync(join(ctx.dir, '__pycache__')) },
    ];
    const patterns = funcignorePatterns(ctx.dir);
    const included = candidates
      .filter(candidate => candidate.exists && !artifactExcluded(candidate.label, patterns))
      .map(candidate => candidate.label);
    if (included.length === 0) {
      return [result(pythonDeployArtifactsCheck, {
        status: 'pass',
        title: 'Python deployment artifacts filtered',
        message: 'No unexcluded test, virtual-environment, or cache directories were found',
      })];
    }
    return [result(pythonDeployArtifactsCheck, {
      status: 'warn',
      title: 'Development artifacts may enter the deployment package',
      message: `The following workspace artifacts exist without matching .funcignore entries: ${included.join(', ')}`,
      file: existsSync(join(ctx.dir, '.funcignore')) ? '.funcignore' : undefined,
      recommendation: 'Exclude tests, virtual environments, caches, and bytecode from the Functions deployment package.',
    })];
  },
};

export const pythonDurableConfigurationCheck: DoctorCheck = {
  id: 'python-durable-configuration',
  category: 'configuration',
  defaultSeverity: 'low',
  appliesTo: ctx => ctx.language === 'python'
    && ctx.functions.some(fn => [
      'orchestrationTrigger',
      'activityTrigger',
      'entityTrigger',
    ].includes(fn.triggerType)),
  run: async ctx => {
    const extensions = ctx.hostJson?.extensions;
    const durableTask = typeof extensions === 'object' && extensions !== null
      ? (extensions as Record<string, unknown>).durableTask
      : undefined;
    if (typeof durableTask === 'object' && durableTask !== null) {
      return [result(pythonDurableConfigurationCheck, {
        status: 'pass',
        title: 'Durable Functions host configuration present',
        message: 'host.json contains extensions.durableTask settings',
      })];
    }
    return [result(pythonDurableConfigurationCheck, {
      status: 'warn',
      title: 'Durable Functions uses implicit host defaults',
      message: 'Durable triggers were detected, but host.json does not contain extensions.durableTask. The app will rely entirely on host defaults, including the default task hub name.',
      file: 'host.json',
      recommendation: 'Review Durable host settings and define a task hub name when multiple apps may share the same storage account.',
    })];
  },
};

export const applicationInsightsCheck: DoctorCheck = {
  id: 'application-insights',
  category: 'configuration',
  defaultSeverity: 'info',
  appliesTo: ctx => ctx.language === 'python'
    && ctx.hostJson !== null
    && ctx.localSettings !== null,
  run: async ctx => {
    const values = (ctx.localSettings?.Values ?? {}) as Record<string, unknown>;
    const configured = typeof values.APPLICATIONINSIGHTS_CONNECTION_STRING === 'string'
      || typeof values.APPINSIGHTS_INSTRUMENTATIONKEY === 'string';
    if (configured) {
      return [result(applicationInsightsCheck, {
        status: 'pass',
        title: 'Local Application Insights setting present',
        message: 'local.settings.json contains an Application Insights setting',
      })];
    }
    return [result(applicationInsightsCheck, {
      status: 'warn',
      title: 'Application Insights is not represented in local settings',
      message: 'No Application Insights connection string or instrumentation key is present in local.settings.json. This does not prove that the deployed Azure resource is unconfigured.',
      file: 'local.settings.json',
      recommendation: 'Confirm observability is configured in deployed app settings or infrastructure as code.',
    })];
  },
};

export const pythonUnpinnedRequirementsCheck: DoctorCheck = {
  id: 'python-unpinned-requirements',
  category: 'security',
  defaultSeverity: 'medium',
  appliesTo: ctx => ctx.language === 'python' && loadPythonDependencies(ctx.dir).kind !== 'none',
  run: async ctx => {
    const manifest = loadPythonDependencies(ctx.dir);
    if (ctx.language !== 'python' || manifest.kind === 'none') {
      return [result(pythonUnpinnedRequirementsCheck, {
        status: 'skip',
        title: 'Python unpinned-requirements audit skipped',
        message: 'Not a Python Functions project or dependency manifest not found',
      })];
    }
    const unpinned = manifest.dependencies.filter(dependency => !dependency.pinned);
    if (unpinned.length === 0) {
      return [result(pythonUnpinnedRequirementsCheck, {
        status: 'pass',
        title: 'Python requirements are pinned',
        message: 'Every declared Python dependency is pinned to an exact version',
      })];
    }
    const list = unpinned.slice(0, 5).map(item => item.name).join(', ')
      + (unpinned.length > 5 ? `, +${unpinned.length - 5} more` : '');
    return [result(pythonUnpinnedRequirementsCheck, {
      status: 'warn',
      title: 'Python requirements are not pinned',
      message: `${unpinned.length} Python dependencies are not pinned to exact versions: ${list}. Each install can resolve to a newer release.`,
      file: manifest.files[0],
      recommendation: 'Pin every direct dependency and generate a reviewed lockfile with hashes.',
    })];
  },
};

export const pythonMissingLockfileCheck: DoctorCheck = {
  id: 'python-missing-lockfile',
  category: 'security',
  defaultSeverity: 'medium',
  appliesTo: ctx => ctx.language === 'python' && loadPythonDependencies(ctx.dir).kind !== 'none',
  run: async ctx => {
    const manifest = loadPythonDependencies(ctx.dir);
    if (ctx.language !== 'python' || manifest.kind === 'none') {
      return [result(pythonMissingLockfileCheck, {
        status: 'skip',
        title: 'Python lockfile audit skipped',
        message: 'Not a Python Functions project or dependency manifest not found',
      })];
    }
    const lockCandidates = [
      'requirements.lock',
      'requirements.txt.lock',
      'poetry.lock',
      'Pipfile.lock',
      'uv.lock',
      'pdm.lock',
    ];
    if (lockCandidates.some(name => existsSync(join(ctx.dir, name)))) {
      return [result(pythonMissingLockfileCheck, {
        status: 'pass',
        title: 'Python lockfile present',
        message: 'A Python dependency lockfile is committed',
      })];
    }
    if (
      manifest.dependencies.length > 0
      && manifest.dependencies.every(dependency => dependency.hashes.length > 0)
    ) {
      return [result(pythonMissingLockfileCheck, {
        status: 'pass',
        title: 'Python requirements are hash-locked',
        message: 'Every declared dependency has an integrity hash',
      })];
    }
    return [result(pythonMissingLockfileCheck, {
      status: 'warn',
      title: 'No Python lockfile present',
      message: 'No supported Python lockfile or fully hash-pinned dependency manifest was found.',
      recommendation: 'Generate and commit a lockfile or a fully resolved requirements file with hashes.',
    })];
  },
};

export const PYTHON_CHECKS: DoctorCheck[] = [
  pythonProgrammingModelCheck,
  pythonDependencyManifestCheck,
  pythonAzureFunctionsCheck,
  pythonWorkerDependencyCheck,
  pythonBlueprintRegistrationCheck,
  pythonNativeDependenciesCheck,
  pythonDeployArtifactsCheck,
  pythonDurableConfigurationCheck,
  applicationInsightsCheck,
  pythonUnpinnedRequirementsCheck,
  pythonMissingLockfileCheck,
];
