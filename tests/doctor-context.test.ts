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

  it('detects go language from go.mod', async () => {
    const dir = makeTmp('doctor-ctx-go-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'go.mod'), 'module myapp\n\ngo 1.24.0\n');
    const ctx = await loadProjectContext(dir);
    expect(ctx.language).toBe('go');
  });

  it('prefers go over node when a Go project also carries a package.json', async () => {
    const dir = makeTmp('doctor-ctx-go-pkg-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'go.mod'), 'module myapp\n\ngo 1.24.0\n');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tooling-only' }));
    const ctx = await loadProjectContext(dir);
    expect(ctx.language).toBe('go');
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

  it('discovers Go worker-indexed functions from app registrations', async () => {
    const dir = makeTmp('doctor-ctx-go-funcs-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'go.mod'), 'module myapp\n\ngo 1.24.0\n');
    writeFileSync(join(dir, 'main.go'), `package main

import (
	"net/http"

	"github.com/azure/azure-functions-golang-worker/sdk"
	"github.com/azure/azure-functions-golang-worker/worker"
)

func main() {
	app := sdk.FunctionApp()
	app.HTTP("hello", hello, sdk.WithMethods("GET"))
	app.Timer("cleanup", cleanup, sdk.WithSchedule("0 */5 * * * *"))
	worker.Start(app)
}

func hello(w http.ResponseWriter, r *http.Request) {}
func cleanup() {}
`);
    const ctx = await loadProjectContext(dir);
    const names = ctx.functions.map(f => f.name).sort();
    expect(names).toEqual(['cleanup', 'hello']);
    const hello = ctx.functions.find(f => f.name === 'hello');
    expect(hello?.triggerType).toBe('httpTrigger');
    const cleanup = ctx.functions.find(f => f.name === 'cleanup');
    expect(cleanup?.triggerType).toBe('timerTrigger');
  });

  it('discovers Go functions declared in nested packages', async () => {
    const dir = makeTmp('doctor-ctx-go-nested-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'go.mod'), 'module myapp\n\ngo 1.24.0\n');
    const pkgDir = join(dir, 'internal', 'handlers');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'register.go'), `package handlers

func Register(app *sdk.App) {
	app.ServiceBusQueue("orders", handleOrders, sdk.WithQueue("orders"))
	app.Blob("thumbnails", handleBlob, sdk.WithPath("images/{name}"))
}
`);
    const ctx = await loadProjectContext(dir);
    const byName = Object.fromEntries(ctx.functions.map(f => [f.name, f.triggerType]));
    expect(byName.orders).toBe('serviceBusTrigger');
    expect(byName.thumbnails).toBe('blobTrigger');
  });

  it('ignores Go registration-like calls inside vendor and test files', async () => {
    const dir = makeTmp('doctor-ctx-go-ignore-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'go.mod'), 'module myapp\n\ngo 1.24.0\n');
    writeFileSync(join(dir, 'main.go'), 'package main\n\nfunc main() { app.HTTP("real", h) }\n');
    writeFileSync(join(dir, 'main_test.go'), 'package main\n\nfunc TestX(t *testing.T) { app.HTTP("fromTest", h) }\n');
    const vendorDir = join(dir, 'vendor', 'example.com', 'dep');
    mkdirSync(vendorDir, { recursive: true });
    writeFileSync(join(vendorDir, 'dep.go'), 'package dep\n\nfunc f() { app.HTTP("fromVendor", h) }\n');
    const ctx = await loadProjectContext(dir);
    expect(ctx.functions.map(f => f.name)).toEqual(['real']);
  });

  it('does not run Go discovery for non-Go projects', async () => {
    const dir = makeTmp('doctor-ctx-go-notgo-');
    writeFileSync(join(dir, 'host.json'), JSON.stringify({ version: '2.0' }));
    writeFileSync(join(dir, 'requirements.txt'), 'azure-functions\n');
    writeFileSync(join(dir, 'notes.go'), 'package main\n\nfunc main() { app.HTTP("ghost", h) }\n');
    const ctx = await loadProjectContext(dir);
    expect(ctx.language).toBe('python');
    expect(ctx.functions).toHaveLength(0);
  });

  it('handles malformed host.json gracefully', async () => {
    const dir = makeTmp('doctor-ctx-bad-host-');
    writeFileSync(join(dir, 'host.json'), '{ bad json');
    const ctx = await loadProjectContext(dir);
    expect(ctx.hostJson).toBeNull();
  });
});
