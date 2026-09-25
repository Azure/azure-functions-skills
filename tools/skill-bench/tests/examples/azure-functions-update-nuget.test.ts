import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nugetConfig, parseOptions, preflight, sourceUrl } from '../../examples/azure-functions-update/plugins/nuget-preflight.ts';
import { removeDirectory, temporaryDirectory } from '../helpers.ts';

const options = { targetFramework: 'net8.0', sdk: 'Azure.Functions.Sdk/1.0.0', packages: { 'Microsoft.Azure.Functions.Worker': '2.50.0' } };
let root: string;
beforeEach(() => { root = temporaryDirectory('skill-bench-nuget-'); });
afterEach(() => removeDirectory(root));

describe('nuget-preflight example plugin', () => {
  it('accepts explicit versions and refuses loose options', () => {
    expect(parseOptions(options).packages).toEqual(options.packages);
    expect(() => parseOptions({ ...options, targetFramework: 'latest' })).toThrow(/targetFramework/);
    expect(() => parseOptions({ ...options, sdk: 'Azure.Functions.Sdk' })).toThrow(/sdk/);
    expect(() => parseOptions({ ...options, packages: { 'Microsoft.Azure.Functions.Worker': '*' } })).toThrow(/packages/);
    expect(() => parseOptions({ ...options, extra: true })).toThrow(/unknown option/);
  });

  it('uses only a credential-free HTTPS feed', () => {
    expect(sourceUrl(parseOptions(options), {}).href).toBe('https://api.nuget.org/v3/index.json');
    expect(sourceUrl(parseOptions(options), { SKILL_BENCH_NUGET_SOURCE: 'https://mirror.example/v3/index.json' }).host).toBe('mirror.example');
    expect(() => sourceUrl(parseOptions(options), { SKILL_BENCH_NUGET_SOURCE: 'https://user:pw@mirror.example/v3' })).toThrow(/credentials/);
    expect(() => sourceUrl(parseOptions({ ...options, source: 'http://mirror.example/v3' }), {})).toThrow(/HTTPS/);
  });

  it('writes one isolated NuGet.Config with a package folder inside the cell', () => {
    preflight.prepareCell?.({ options, cellRoot: root, home: join(root, 'home'), appData: join(root, 'appdata') });
    const first = readFileSync(join(root, 'appdata', 'NuGet', 'NuGet.Config'), 'utf8');
    expect(readFileSync(join(root, 'home', '.nuget', 'NuGet', 'NuGet.Config'), 'utf8')).toBe(first);
    expect(first).toContain('<clear />');
    expect(first).toContain(join(root, 'cache', 'nuget'));
    expect(nugetConfig(new URL('https://a.example/v3?x"'.replace('?x"', '')), 'C:\\p&q')).toContain('C:\\p&amp;q');
  });
});
