import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProjectContext } from '../src/doctor/context.js';
import {
  applicationInsightsCheck,
  connectionStringsCheck,
  pythonAzureFunctionsCheck,
  pythonBlueprintRegistrationCheck,
  pythonDependencyManifestCheck,
  pythonDeployArtifactsCheck,
  pythonDurableConfigurationCheck,
  pythonNativeDependenciesCheck,
  pythonProgrammingModelCheck,
  pythonWorkerDependencyCheck,
  trackedSecretFilesCheck,
} from '../src/doctor/checks.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];

function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
  return dir;
}

function writePythonApp(dir: string, source: string): void {
  writeFileSync(join(dir, 'function_app.py'), source);
}

function writeRequirements(dir: string, content: string): void {
  writeFileSync(join(dir, 'requirements.txt'), content);
}

afterAll(() => {
  for (const dir of TEMP_DIRS) removeDir(dir);
});

describe('Python programming model checks', () => {
  it('warns for a mixed v1 and v2 project', async () => {
    const dir = makeTmp('doctor-pymodel-mixed-');
    writePythonApp(dir, `
import azure.functions as func
app = func.FunctionApp()
@app.route(route="health")
def health(req):
    return "ok"
`);
    const legacy = join(dir, 'Legacy');
    mkdirSync(legacy);
    writeFileSync(join(legacy, '__init__.py'), 'def main(req): pass\n');
    writeFileSync(join(legacy, 'function.json'), JSON.stringify({
      scriptFile: '__init__.py',
      bindings: [{ type: 'httpTrigger', direction: 'in', name: 'req' }],
    }));

    const results = await pythonProgrammingModelCheck.run(await loadProjectContext(dir));

    expect(results[0]).toEqual(expect.objectContaining({
      status: 'warn',
      severity: 'high',
    }));
  });

  it('warns when a decorated Blueprint is not registered', async () => {
    const dir = makeTmp('doctor-blueprint-unregistered-');
    writeRequirements(dir, 'azure-functions==1.21.0\n');
    writePythonApp(dir, `
import azure.functions as func
app = func.FunctionApp()
jobs = func.Blueprint()
@jobs.queue_trigger(arg_name="message", queue_name="jobs", connection="Storage")
def process(message):
    pass
`);

    const results = await pythonBlueprintRegistrationCheck.run(await loadProjectContext(dir));

    expect(results[0]).toEqual(expect.objectContaining({
      status: 'warn',
      file: 'function_app.py',
    }));
  });

  it('passes when all decorated Blueprints are registered', async () => {
    const dir = makeTmp('doctor-blueprint-registered-');
    writeRequirements(dir, 'azure-functions==1.21.0\n');
    writePythonApp(dir, `
import azure.functions as func
app = func.FunctionApp()
jobs = func.Blueprint()
@jobs.queue_trigger(arg_name="message", queue_name="jobs", connection="Storage")
def process(message):
    pass
app.register_functions(jobs)
`);

    const results = await pythonBlueprintRegistrationCheck.run(await loadProjectContext(dir));

    expect(results[0].status).toBe('pass');
  });

  it('accepts the standard register_blueprint API', async () => {
    const dir = makeTmp('doctor-blueprint-api-');
    writeRequirements(dir, 'azure-functions==1.21.0\n');
    writePythonApp(dir, `
import azure.functions as func
app = func.FunctionApp()
jobs = func.Blueprint()
@jobs.queue_trigger(arg_name="message", queue_name="jobs", connection="Storage")
def process(message):
    pass
app.register_blueprint(jobs)
`);

    const results = await pythonBlueprintRegistrationCheck.run(await loadProjectContext(dir));

    expect(results[0].status).toBe('pass');
  });
});

describe('Python dependency checks', () => {
  it('fails when external imports exist without a dependency manifest', async () => {
    const dir = makeTmp('doctor-pymanifest-missing-');
    writePythonApp(dir, `
import azure.functions as func
import requests
app = func.FunctionApp()
`);

    const results = await pythonDependencyManifestCheck.run(await loadProjectContext(dir));

    expect(results[0].status).toBe('fail');
  });

  it('accepts pyproject.toml as the authoritative manifest', async () => {
    const dir = makeTmp('doctor-pymanifest-pyproject-');
    writePythonApp(dir, 'import azure.functions as func\napp = func.FunctionApp()\n');
    writeFileSync(join(dir, 'pyproject.toml'), `
[project]
dependencies = ["azure-functions==1.21.0"]
`);
    const ctx = await loadProjectContext(dir);

    expect((await pythonDependencyManifestCheck.run(ctx))[0].status).toBe('pass');
    expect((await pythonAzureFunctionsCheck.run(ctx))[0].status).toBe('pass');
  });

  it('fails when azure-functions is missing or older than the v2 minimum', async () => {
    const missingDir = makeTmp('doctor-azurefunctions-missing-');
    writePythonApp(missingDir, 'import azure.functions as func\napp = func.FunctionApp()\n');
    writeRequirements(missingDir, 'requests==2.32.0\n');
    const oldDir = makeTmp('doctor-azurefunctions-old-');
    writePythonApp(oldDir, 'import azure.functions as func\napp = func.FunctionApp()\n');
    writeRequirements(oldDir, 'azure-functions==1.16.0\n');

    expect((await pythonAzureFunctionsCheck.run(await loadProjectContext(missingDir)))[0].status).toBe('fail');
    expect((await pythonAzureFunctionsCheck.run(await loadProjectContext(oldDir)))[0].status).toBe('fail');
  });

  it('warns when the platform-managed worker is declared', async () => {
    const dir = makeTmp('doctor-pyworker-');
    writePythonApp(dir, 'import azure.functions as func\napp = func.FunctionApp()\n');
    writeRequirements(dir, 'azure-functions==1.21.0\nazure-functions-worker==1.0.0\n');

    const results = await pythonWorkerDependencyCheck.run(await loadProjectContext(dir));

    expect(results[0].status).toBe('warn');
    expect(results[0].recommendation).toMatch(/remove/i);
  });

  it('reports native dependencies as informational compatibility risks', async () => {
    const dir = makeTmp('doctor-pynative-');
    writePythonApp(dir, 'import azure.functions as func\napp = func.FunctionApp()\n');
    writeRequirements(dir, 'azure-functions==1.21.0\norjson==3.10.0\nnumpy==2.0.0\n');

    const results = await pythonNativeDependenciesCheck.run(await loadProjectContext(dir));

    expect(results[0]).toEqual(expect.objectContaining({
      status: 'warn',
      severity: 'info',
    }));
    expect(results[0].message).toContain('numpy');
  });
});

describe('Python configuration and packaging checks', () => {
  it('makes existing storage validation fail for a Python v2 queue trigger', async () => {
    const dir = makeTmp('doctor-pystorage-');
    writeFileSync(join(dir, 'local.settings.json'), JSON.stringify({
      Values: { FUNCTIONS_WORKER_RUNTIME: 'python' },
    }));
    writePythonApp(dir, `
import azure.functions as func
app = func.FunctionApp()
@app.queue_trigger(arg_name="message", queue_name="jobs", connection="Storage")
def process(message):
    pass
`);

    const results = await connectionStringsCheck.run(await loadProjectContext(dir));

    expect(results[0].status).toBe('fail');
  });

  it('fails when local.settings.json is tracked even if it is gitignored', async () => {
    const dir = makeTmp('doctor-localsettings-tracked-');
    writeFileSync(join(dir, 'local.settings.json'), JSON.stringify({ Values: {} }));
    spawnSync('git', ['init', '--quiet'], { cwd: dir, shell: process.platform === 'win32' });
    spawnSync('git', ['add', 'local.settings.json'], { cwd: dir, shell: process.platform === 'win32' });
    writeFileSync(join(dir, '.gitignore'), 'local.settings.json\n');

    const results = await trackedSecretFilesCheck.run(await loadProjectContext(dir));

    expect(results[0].status).toBe('fail');
    expect(results[0].message).toContain('local.settings.json');
  });

  it('warns when test and cache artifacts are not excluded from deployment', async () => {
    const dir = makeTmp('doctor-pyartifacts-');
    writePythonApp(dir, 'import azure.functions as func\napp = func.FunctionApp()\n');
    writeRequirements(dir, 'azure-functions==1.21.0\n');
    mkdirSync(join(dir, 'tests'));
    mkdirSync(join(dir, '__pycache__'));

    const results = await pythonDeployArtifactsCheck.run(await loadProjectContext(dir));

    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('tests/');
  });

  it('passes deployment artifact checks when .funcignore excludes them', async () => {
    const dir = makeTmp('doctor-pyartifacts-ignored-');
    writePythonApp(dir, 'import azure.functions as func\napp = func.FunctionApp()\n');
    writeRequirements(dir, 'azure-functions==1.21.0\n');
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, '.funcignore'), 'tests/\n__pycache__/\n*.pyc\n.venv/\n');

    const results = await pythonDeployArtifactsCheck.run(await loadProjectContext(dir));

    expect(results[0].status).toBe('pass');
  });

  it('warns when Durable functions use only implicit host defaults', async () => {
    const dir = makeTmp('doctor-pydurable-');
    writePythonApp(dir, `
import azure.functions as func
app = func.FunctionApp()
@app.orchestration_trigger(context_name="context")
def orchestrator(context):
    yield context.call_activity("work")
`);

    const results = await pythonDurableConfigurationCheck.run(await loadProjectContext(dir));

    expect(results[0]).toEqual(expect.objectContaining({
      status: 'warn',
      severity: 'low',
    }));
  });

  it('limits missing Application Insights to local informational guidance', async () => {
    const dir = makeTmp('doctor-appinsights-local-');
    writePythonApp(dir, 'import azure.functions as func\napp = func.FunctionApp()\n');
    writeFileSync(join(dir, 'local.settings.json'), JSON.stringify({
      Values: { FUNCTIONS_WORKER_RUNTIME: 'python' },
    }));

    const results = await applicationInsightsCheck.run(await loadProjectContext(dir));

    expect(results[0]).toEqual(expect.objectContaining({
      status: 'warn',
      severity: 'info',
    }));
    expect(results[0].message).toMatch(/local/i);
  });
});
