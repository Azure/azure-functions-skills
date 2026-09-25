import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellEnvironment, saveWorkspaceSnapshot } from '../src/env.ts';
import { put, removeDirectory, temporaryDirectory } from './helpers.ts';

let root: string;
beforeEach(() => { root = temporaryDirectory('skill-bench-env-'); });
afterEach(() => removeDirectory(root));

const source = {
  PATH: '/usr/bin', Path: '/ignored-duplicate-case', HOME: '/home/real', GITHUB_TOKEN: 'ghs_secret',
  AWS_SECRET_ACCESS_KEY: 'aws', AZURE_CLIENT_SECRET: 'azure', NODE_OPTIONS: '--require evil.js',
};

describe('cellEnvironment', () => {
  it('copies only the operating system allowlist and isolates every home and cache', () => {
    const env = cellEnvironment(root, source, { paid: false, settings: '{}' });
    expect(env.PATH).toBeDefined();
    expect(env.HOME).toBe(join(root, 'home'));
    expect(env.USERPROFILE).toBe(join(root, 'home'));
    expect(env.COPILOT_HOME).toBe(join(root, 'config'));
    expect(env.npm_config_userconfig).toBe(join(root, 'home', '.npmrc'));
    expect(env.COPILOT_HOME_SETTINGS_JSON).toBe('{}');
    for (const secret of ['GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'AZURE_CLIENT_SECRET', 'NODE_OPTIONS']) {
      expect(env[secret]).toBeUndefined();
    }
  });

  it('passes the model token only for paid runs, and requires it there', () => {
    expect(cellEnvironment(root, source, { paid: true, settings: '{}' }).COPILOT_GITHUB_TOKEN).toBe('ghs_secret');
    expect(() => cellEnvironment(root, { PATH: '/usr/bin' }, { paid: true, settings: '{}' })).toThrow(/COPILOT_GITHUB_TOKEN/);
  });

  it('accepts only a credential-free HTTPS npm registry', () => {
    expect(cellEnvironment(root, source, { paid: false, settings: '{}', registry: 'https://example.test/npm/' })
      .npm_config_registry).toBe('https://example.test/npm/');
    for (const registry of ['http://example.test/', 'https://user:pass@example.test/', 'https://example.test/?token=1', 'not a url']) {
      expect(() => cellEnvironment(root, source, { paid: false, settings: '{}', registry })).toThrow(/registry/);
    }
  });
});

describe('saveWorkspaceSnapshot', () => {
  it('copies source, redacts local settings and .env, and excludes secrets, links, logs and build output', () => {
    const workspace = join(root, 'workspace');
    put(workspace, 'Program.cs', 'class Program {}');
    put(workspace, '.gitignore', 'bin/');
    put(workspace, 'local.settings.json', JSON.stringify({ IsEncrypted: false,
      Values: { AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountKey=abc', FUNCTIONS_WORKER_RUNTIME: 'dotnet-isolated' } }));
    put(workspace, '.env', 'TOKEN=abc\n# comment\n');
    put(workspace, 'secret.pem', 'key');
    put(workspace, 'config.txt', 'AccountKey=abc');
    put(workspace, 'host.log', 'log');
    put(workspace, 'bin/app.dll', 'binary');
    put(workspace, '.copilot/session.json', '{}');
    put(workspace, 'big.txt', 'x'.repeat(1_000_001));
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const destination = join(root, 'snapshot');
    saveWorkspaceSnapshot(workspace, destination, { keepValues: ['dotnet-isolated'] });
    const manifest = JSON.parse(readFileSync(join(destination, 'snapshot-manifest.json'), 'utf8'));
    expect(manifest.copied.sort()).toEqual(['.gitignore', 'Program.cs']);
    expect(manifest.redacted.sort()).toEqual(['.env', 'local.settings.json']);
    expect(manifest.excluded).toEqual(expect.arrayContaining(['.copilot/', 'bin/', 'big.txt:size-limit',
      'config.txt:credential-like-content', 'host.log', 'linked:symlink', 'secret.pem:sensitive-name']));
    const settings = JSON.parse(readFileSync(join(destination, 'local.settings.redacted.json'), 'utf8'));
    expect(settings).toEqual({ IsEncrypted: false, Values: { AzureWebJobsStorage: '[REDACTED]', FUNCTIONS_WORKER_RUNTIME: 'dotnet-isolated' } });
    expect(readFileSync(join(destination, '.env.redacted'), 'utf8')).toBe('TOKEN=[REDACTED]\n# comment\n');
    expect(existsSync(join(destination, 'local.settings.json'))).toBe(false);
  });

  it('never overwrites an existing destination', () => {
    const workspace = join(root, 'workspace');
    mkdirSync(workspace);
    mkdirSync(join(root, 'snapshot'));
    writeFileSync(join(workspace, 'a.txt'), 'a');
    expect(() => saveWorkspaceSnapshot(workspace, join(root, 'snapshot'), { keepValues: [] })).toThrow(/already exists/);
  });
});
