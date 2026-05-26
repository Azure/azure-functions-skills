import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import { loadProjectContext } from '../src/doctor/context.js';
import {
  projectExistsCheck,
  runtimeVersionCheck,
  extensionBundleCheck,
  nodeVersionCheck,
  localSettingsCheck,
  connectionStringsCheck,
  deprecatedSettingsCheck,
  functionBindingsCheck,
  entryPointCheck,
  typescriptBuildCheck,
  ALL_CHECKS,
} from '../src/doctor/checks.js';

const TEMP_DIRS: string[] = [];
function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}
afterAll(() => { for (const d of TEMP_DIRS) removeDir(d); });

// ── Helper: scaffold a minimal project ──
function scaffoldProject(dir: string, opts?: {
  hostJson?: Record<string, unknown>;
  localSettings?: Record<string, unknown>;
  packageJson?: Record<string, unknown>;
  tsconfig?: Record<string, unknown>;
  functions?: Array<{ name: string; bindings: unknown[] }>;
  v4Functions?: Array<{ name: string; content: string }>;
}) {
  if (opts?.hostJson) writeFileSync(join(dir, 'host.json'), JSON.stringify(opts.hostJson));
  if (opts?.localSettings) writeFileSync(join(dir, 'local.settings.json'), JSON.stringify(opts.localSettings));
  if (opts?.packageJson) writeFileSync(join(dir, 'package.json'), JSON.stringify(opts.packageJson));
  if (opts?.tsconfig) writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(opts.tsconfig));
  if (opts?.functions) {
    for (const fn of opts.functions) {
      const fnDir = join(dir, fn.name);
      mkdirSync(fnDir, { recursive: true });
      writeFileSync(join(fnDir, 'function.json'), JSON.stringify({ bindings: fn.bindings }));
    }
  }
  if (opts?.v4Functions) {
    const srcDir = join(dir, 'src', 'functions');
    mkdirSync(srcDir, { recursive: true });
    for (const fn of opts.v4Functions) {
      writeFileSync(join(srcDir, `${fn.name}.ts`), fn.content);
    }
  }
}

// ── project-exists ──

describe('project-exists check', () => {
  it('passes when host.json exists', async () => {
    const dir = makeTmp('chk-proj-exist-');
    scaffoldProject(dir, { hostJson: { version: '2.0' } });
    const ctx = await loadProjectContext(dir);
    const results = await projectExistsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('fails when host.json is missing', async () => {
    const dir = makeTmp('chk-proj-missing-');
    const ctx = await loadProjectContext(dir);
    const results = await projectExistsCheck.run(ctx);
    expect(results[0].status).toBe('fail');
    expect(results[0].severity).toBe('critical');
  });
});

// ── runtime-version ──

describe('runtime-version check', () => {
  it('passes with version "2.0"', async () => {
    const dir = makeTmp('chk-rt-ok-');
    scaffoldProject(dir, { hostJson: { version: '2.0' } });
    const ctx = await loadProjectContext(dir);
    const results = await runtimeVersionCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('fails with unsupported version', async () => {
    const dir = makeTmp('chk-rt-bad-');
    scaffoldProject(dir, { hostJson: { version: '1.0' } });
    const ctx = await loadProjectContext(dir);
    const results = await runtimeVersionCheck.run(ctx);
    expect(results[0].status).toBe('fail');
  });

  it('fails when version field is missing', async () => {
    const dir = makeTmp('chk-rt-no-ver-');
    scaffoldProject(dir, { hostJson: {} });
    const ctx = await loadProjectContext(dir);
    const results = await runtimeVersionCheck.run(ctx);
    expect(results[0].status).toBe('fail');
  });
});

// ── extension-bundle ──

describe('extension-bundle check', () => {
  it('passes with current version range', async () => {
    const dir = makeTmp('chk-ext-ok-');
    scaffoldProject(dir, {
      hostJson: {
        version: '2.0',
        extensionBundle: {
          id: 'Microsoft.Azure.Functions.ExtensionBundle',
          version: '[4.0.0, 5.0.0)',
        },
      },
      packageJson: { name: 'test' },
    });
    const ctx = await loadProjectContext(dir);
    const results = await extensionBundleCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('fails with outdated version range', async () => {
    const dir = makeTmp('chk-ext-old-');
    scaffoldProject(dir, {
      hostJson: {
        version: '2.0',
        extensionBundle: {
          id: 'Microsoft.Azure.Functions.ExtensionBundle',
          version: '[3.0.0, 4.0.0)',
        },
      },
      packageJson: { name: 'test' },
    });
    const ctx = await loadProjectContext(dir);
    const results = await extensionBundleCheck.run(ctx);
    expect(results[0].status).toBe('fail');
  });

  it('warns when extension bundle is not configured', async () => {
    const dir = makeTmp('chk-ext-none-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test' },
    });
    const ctx = await loadProjectContext(dir);
    const results = await extensionBundleCheck.run(ctx);
    expect(results[0].status).toBe('warn');
  });

  it('skips for dotnet projects', async () => {
    const dir = makeTmp('chk-ext-dotnet-');
    scaffoldProject(dir, { hostJson: { version: '2.0' } });
    writeFileSync(join(dir, 'MyFunc.csproj'), '<Project></Project>');
    const ctx = await loadProjectContext(dir);
    expect(extensionBundleCheck.appliesTo(ctx)).toBe(false);
  });
});

// ── node-version ──

describe('node-version check', () => {
  it('passes with supported version', async () => {
    const dir = makeTmp('chk-node-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', engines: { node: '>=22.0.0' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await nodeVersionCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('fails with unsupported version', async () => {
    const dir = makeTmp('chk-node-bad-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', engines: { node: '>=14.0.0' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await nodeVersionCheck.run(ctx);
    expect(results[0].status).toBe('fail');
  });

  it('passes when engines.node is not specified', async () => {
    const dir = makeTmp('chk-node-noeng-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test' },
    });
    const ctx = await loadProjectContext(dir);
    const results = await nodeVersionCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });
});

// ── local-settings ──

describe('local-settings check', () => {
  it('passes with valid settings', async () => {
    const dir = makeTmp('chk-ls-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      localSettings: { IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'node' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await localSettingsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('warns when local.settings.json is missing', async () => {
    const dir = makeTmp('chk-ls-missing-');
    scaffoldProject(dir, { hostJson: { version: '2.0' } });
    const ctx = await loadProjectContext(dir);
    const results = await localSettingsCheck.run(ctx);
    expect(results[0].status).toBe('warn');
  });

  it('warns when FUNCTIONS_WORKER_RUNTIME is not set', async () => {
    const dir = makeTmp('chk-ls-no-runtime-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      localSettings: { IsEncrypted: false, Values: {} },
    });
    const ctx = await loadProjectContext(dir);
    const results = await localSettingsCheck.run(ctx);
    expect(results[0].status).toBe('warn');
  });
});

// ── connection-strings ──

describe('connection-strings check', () => {
  it('passes when no non-HTTP triggers and storage is not needed', async () => {
    const dir = makeTmp('chk-conn-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      localSettings: { IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'node' } },
      functions: [{ name: 'HttpFunc', bindings: [{ type: 'httpTrigger', direction: 'in' }] }],
    });
    const ctx = await loadProjectContext(dir);
    const results = await connectionStringsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('fails when non-HTTP trigger exists but AzureWebJobsStorage is missing', async () => {
    const dir = makeTmp('chk-conn-fail-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      localSettings: { IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'node' } },
      functions: [{ name: 'TimerFunc', bindings: [{ type: 'timerTrigger', direction: 'in' }] }],
    });
    const ctx = await loadProjectContext(dir);
    const results = await connectionStringsCheck.run(ctx);
    expect(results[0].status).toBe('fail');
    expect(results[0].message).toContain('AzureWebJobsStorage');
  });
});

// ── deprecated-settings ──

describe('deprecated-settings check', () => {
  it('passes when no deprecated settings', async () => {
    const dir = makeTmp('chk-dep-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      localSettings: { IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'node' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await deprecatedSettingsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('warns when deprecated setting is present', async () => {
    const dir = makeTmp('chk-dep-warn-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      localSettings: {
        IsEncrypted: false,
        Values: {
          FUNCTIONS_WORKER_RUNTIME: 'node',
          AzureWebJobsDashboard: 'somevalue',
        },
      },
    });
    const ctx = await loadProjectContext(dir);
    const results = await deprecatedSettingsCheck.run(ctx);
    expect(results.some(r => r.status === 'warn')).toBe(true);
    expect(results[0].title).toContain('AzureWebJobsDashboard');
  });
});

// ── function-bindings ──

describe('function-bindings check', () => {
  it('passes when all bindings are recognized', async () => {
    const dir = makeTmp('chk-bind-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      functions: [{ name: 'HttpFunc', bindings: [{ type: 'httpTrigger', direction: 'in' }] }],
    });
    const ctx = await loadProjectContext(dir);
    const results = await functionBindingsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });
});

// ── entry-point ──

describe('entry-point check', () => {
  it('passes when main field resolves', async () => {
    const dir = makeTmp('chk-entry-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', main: 'index.js' },
    });
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    const ctx = await loadProjectContext(dir);
    const results = await entryPointCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('fails when main field does not resolve', async () => {
    const dir = makeTmp('chk-entry-fail-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', main: 'dist/src/index.js' },
    });
    const ctx = await loadProjectContext(dir);
    const results = await entryPointCheck.run(ctx);
    expect(results[0].status).toBe('fail');
  });
});

// ── typescript-build ──

describe('typescript-build check', () => {
  it('passes with outDir set', async () => {
    const dir = makeTmp('chk-ts-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test' },
      tsconfig: { compilerOptions: { outDir: 'dist', target: 'ES2022' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await typescriptBuildCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('warns without outDir', async () => {
    const dir = makeTmp('chk-ts-noout-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test' },
      tsconfig: { compilerOptions: { target: 'ES2022' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await typescriptBuildCheck.run(ctx);
    expect(results[0].status).toBe('warn');
  });
});

// ── ALL_CHECKS ──

describe('ALL_CHECKS registry', () => {
  it('contains 13 checks', () => {
    expect(ALL_CHECKS).toHaveLength(13);
  });

  it('has unique IDs', () => {
    const ids = ALL_CHECKS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
