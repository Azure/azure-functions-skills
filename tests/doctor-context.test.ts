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

  it('handles malformed host.json gracefully', async () => {
    const dir = makeTmp('doctor-ctx-bad-host-');
    writeFileSync(join(dir, 'host.json'), '{ bad json');
    const ctx = await loadProjectContext(dir);
    expect(ctx.hostJson).toBeNull();
  });
});
