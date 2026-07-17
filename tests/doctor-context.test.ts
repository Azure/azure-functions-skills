import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectContext } from '../src/doctor/context.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];

function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of TEMP_DIRS) removeDir(d);
});

describe('loadProjectContext', () => {
  it('returns null hostJson when host.json is missing', async () => {
    const dir = makeTmp('doctor-ctx-empty-');
    const ctx = await loadProjectContext(dir);
    expect(ctx.dir).toBe(dir);
    expect(ctx.hostJson).toBeNull();
    expect(ctx.language).toBe('unknown');
  });

  it('loads host.json when present', async () => {
    const dir = makeTmp('doctor-ctx-host-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const ctx = await loadProjectContext(dir);
    expect(ctx.hostJson).toEqual({ version: '2.0' });
  });

  it('detects node language from package.json', async () => {
    const dir = makeTmp('doctor-ctx-node-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', dependencies: {} }));
    const ctx = await loadProjectContext(dir);
    expect(ctx.language).toBe('node');
    expect(ctx.packageJson).not.toBeNull();
  });

  it('detects python language from requirements.txt', async () => {
    const dir = makeTmp('doctor-ctx-python-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'requirements.txt'), 'azure-functions\n');
    const ctx = await loadProjectContext(dir);
    expect(ctx.language).toBe('python');
  });

  it('detects python from function_app.py when the dependency manifest is missing', async () => {
    const dir = makeTmp('doctor-ctx-python-source-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'function_app.py'), 'import azure.functions as func\napp = func.FunctionApp()\n');

    const ctx = await loadProjectContext(dir);

    expect(ctx.language).toBe('python');
    expect(ctx.python?.programmingModel).toBe('v2');
  });

  it('uses the explicit worker runtime when package.json is only project tooling', async () => {
    const dir = makeTmp('doctor-ctx-python-worker-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true }));
    writeFileSync(join(dir, 'local.settings.json'), JSON.stringify({
      Values: { FUNCTIONS_WORKER_RUNTIME: 'python' },
    }));

    const ctx = await loadProjectContext(dir);

    expect(ctx.language).toBe('python');
  });

  it('detects dotnet language from .csproj', async () => {
    const dir = makeTmp('doctor-ctx-dotnet-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'MyFunc.csproj'), '<Project></Project>');
    const ctx = await loadProjectContext(dir);
    expect(ctx.language).toBe('dotnet');
  });

  it('detects java language from pom.xml', async () => {
    const dir = makeTmp('doctor-ctx-java-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'pom.xml'), '<project></project>');
    const ctx = await loadProjectContext(dir);
    expect(ctx.language).toBe('java');
  });

  it('loads local.settings.json when present', async () => {
    const dir = makeTmp('doctor-ctx-settings-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const settings = { IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'node' } };
    writeFileSync(join(dir, 'local.settings.json'), JSON.stringify(settings));
    const ctx = await loadProjectContext(dir);
    expect(ctx.localSettings).toEqual(settings);
  });

  it('discovers v4 programming model functions (src/functions/*.ts)', async () => {
    const dir = makeTmp('doctor-ctx-v4-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const funcDir = join(dir, 'src', 'functions');
    mkdirSync(funcDir, { recursive: true });
    writeFileSync(join(funcDir, 'httpTrigger1.ts'), `
import { app } from '@azure/functions';
app.http('httpTrigger1', { methods: ['GET'], handler: async (req, ctx) => ({ body: 'ok' }) });
`);
    const ctx = await loadProjectContext(dir);
    expect(ctx.functions.length).toBeGreaterThanOrEqual(1);
  });

  it('discovers v3 function.json based functions', async () => {
    const dir = makeTmp('doctor-ctx-v3-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    const funcDir = join(dir, 'HttpTrigger1');
    mkdirSync(funcDir, { recursive: true });
    writeFileSync(join(funcDir, 'function.json'), JSON.stringify({
      bindings: [
        { type: 'httpTrigger', direction: 'in', name: 'req' },
        { type: 'http', direction: 'out', name: 'res' },
      ],
    }));
    const ctx = await loadProjectContext(dir);
    expect(ctx.functions).toHaveLength(1);
    expect(ctx.functions[0].name).toBe('HttpTrigger1');
    expect(ctx.functions[0].triggerType).toBe('httpTrigger');
  });

  it('discovers Python v2 FunctionApp and Blueprint triggers with aliases', async () => {
    const dir = makeTmp('doctor-ctx-pyv2-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'requirements.txt'), 'azure-functions==1.21.0\n');
    writeFileSync(join(dir, 'function_app.py'), `
import azure.functions as func
from jobs import jobs_blueprint as jobs

application = func.FunctionApp()
application.register_functions(jobs)

@application.route(route="health")
def health(req):
    return "ok"
`);
    writeFileSync(join(dir, 'jobs.py'), `
from azure.functions import Blueprint as FunctionsBlueprint

jobs_blueprint = FunctionsBlueprint()

@jobs_blueprint.queue_trigger(arg_name="message", queue_name="jobs", connection="Storage")
def process_job(message):
    pass
`);

    const ctx = await loadProjectContext(dir);

    expect(ctx.python?.programmingModel).toBe('v2');
    expect(ctx.functions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'health', triggerType: 'httpTrigger' }),
      expect.objectContaining({
        name: 'process_job',
        triggerType: 'queueTrigger',
        blueprint: 'jobs_blueprint',
        blueprintRegistered: true,
      }),
    ]));
  });

  it('classifies projects containing function.json and FunctionApp as mixed', async () => {
    const dir = makeTmp('doctor-ctx-pymixed-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'function_app.py'), `
import azure.functions as func
app = func.FunctionApp()
@app.timer_trigger(schedule="0 */5 * * * *", arg_name="timer")
def scheduled(timer):
    pass
`);
    const legacyDir = join(dir, 'Legacy');
    mkdirSync(legacyDir);
    writeFileSync(join(legacyDir, 'function.json'), JSON.stringify({
      bindings: [{ type: 'httpTrigger', direction: 'in', name: 'req' }],
    }));

    const ctx = await loadProjectContext(dir);

    expect(ctx.python?.programmingModel).toBe('mixed');
    expect(ctx.functions.map(fn => fn.name)).toEqual(expect.arrayContaining(['scheduled', 'Legacy']));
  });

  it('lets existing storage checks see Python v2 non-HTTP triggers', async () => {
    const dir = makeTmp('doctor-ctx-pyqueue-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'local.settings.json'), JSON.stringify({
      Values: { FUNCTIONS_WORKER_RUNTIME: 'python' },
    }));
    writeFileSync(join(dir, 'function_app.py'), `
from azure.functions import FunctionApp
app = FunctionApp()
@app.service_bus_queue_trigger(arg_name="message", queue_name="orders", connection="ServiceBus")
def consume(message):
    pass
`);

    const ctx = await loadProjectContext(dir);

    expect(ctx.functions).toEqual([
      expect.objectContaining({ name: 'consume', triggerType: 'serviceBusTrigger' }),
    ]);
  });

  it('discovers Durable Python v2 functions registered through DFApp aliases', async () => {
    const dir = makeTmp('doctor-ctx-pydurable-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'function_app.py'), `
import azure.durable_functions as durable
durable_app = durable.DFApp()
@durable_app.orchestration_trigger(context_name="context")
def orchestrator(context):
    return []
`);

    const ctx = await loadProjectContext(dir);

    expect(ctx.language).toBe('python');
    expect(ctx.functions).toEqual([
      expect.objectContaining({ name: 'orchestrator', triggerType: 'orchestrationTrigger' }),
    ]);
  });

  it('handles malformed host.json gracefully', async () => {
    const dir = makeTmp('doctor-ctx-bad-host-');
    writeFileSync(join(dir, 'host.json'), '{ bad json');
    const ctx = await loadProjectContext(dir);
    expect(ctx.hostJson).toBeNull();
  });
});
