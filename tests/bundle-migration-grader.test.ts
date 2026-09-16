import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir, removeDir } from './helpers/fs.js';

const fixtures = resolve('evals/azure-functions-update/extension-bundles/fixtures');
let root: string;
const variants = ['bundle-v1', 'bundle-v2', 'bundle-v3'];
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const write = (path: string, value: unknown) => writeFileSync(join(root, path), JSON.stringify(value));
const grade = () => spawnSync(process.execPath, [join(fixtures, 'grade.mjs')], {
  cwd: root, encoding: 'utf8', timeout: 15000,
});

beforeEach(() => {
  root = createTempDir('bundle-contract-');
  for (const variant of variants) {
    mkdirSync(join(root, variant, 'AuditChanges'), { recursive: true });
    mkdirSync(join(root, variant, 'CaptureBatch'));
    for (const name of ['AuditChanges', 'CaptureBatch']) {
      copyFileSync(join(fixtures, `${name}.js`), join(root, variant, name, 'index.js'));
      copyFileSync(join(fixtures, `${name}.json`), join(root, variant, name, 'function.json'));
    }
    copyFileSync(join(fixtures, `${variant}.host.json`), join(root, variant, 'host.json'));
  }
});
afterEach(() => removeDir(root));

function migrate() {
  for (const variant of variants) {
    const host = read(`${variant}/host.json`);
    host.extensionBundle.version = '[4.0.0, 5.0.0)';
    host.extensions.eventHubs = {
      maxEventBatchSize: 32, prefetchCount: 64, batchCheckpointFrequency: 1,
    };
    write(`${variant}/host.json`, host);
    for (const name of ['AuditChanges', 'CaptureBatch']) {
      const config = read(`${variant}/${name}/function.json`);
      for (const binding of config.bindings) {
        if (!binding.type.toLowerCase().startsWith('cosmosdb')) continue;
        for (const [oldKey, newKey] of [
          ['collectionName', 'containerName'], ['connectionStringSetting', 'connection'],
          ['leaseCollectionName', 'leaseContainerName'], ['leaseConnectionStringSetting', 'leaseConnection'],
          ['createLeaseCollectionIfNotExists', 'createLeaseContainerIfNotExists'],
          ['leaseCollectionPrefix', 'leaseContainerPrefix'],
        ]) {
          if (oldKey in binding) { binding[newKey] = binding[oldKey]; delete binding[oldKey]; }
        }
      }
      write(`${variant}/${name}/function.json`, config);
    }
  }
}

describe('Extension Bundle offline grader', () => {
  it('rejects all original inputs without model calls', () => {
    const result = grade();
    expect(result.status, result.stderr).toBe(1);
    for (const variant of variants) expect(result.stdout).toContain(variant);
  });

  it('accepts complete migrations and preserves executable batch behavior', () => {
    migrate();
    const result = grade();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).checks).toHaveLength(variants.length);
  });

  it('accepts equivalent range syntax, binding order and function implementation', () => {
    migrate();
    const host = read('bundle-v1/host.json');
    host.extensionBundle.version = '[4.*,5.0.0)';
    write('bundle-v1/host.json', host);
    const definition = read('bundle-v1/AuditChanges/function.json');
    definition.bindings.reverse();
    write('bundle-v1/AuditChanges/function.json', definition);
    writeFileSync(join(root, 'bundle-v1', 'AuditChanges', 'index.js'), `
      module.exports = function (context, documents) {
        context.bindings.events = [];
        for (const document of documents) {
          context.bindings.events.push({ total: document.total, id: document.id });
        }
      };
    `);
    const result = grade();
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects a host-only range edit', () => {
    for (const variant of variants) {
      const host = read(`${variant}/host.json`);
      host.extensionBundle.version = '[4.0.0, 5.0.0)';
      write(`${variant}/host.json`, host);
    }
    expect(grade().status).toBe(1);
  });

  it.each([
    ['lost lease prefix', 'AuditChanges/function.json', (v: Record<string, unknown>) => {
      const bindings = v.bindings as Record<string, unknown>[];
      bindings[0].leaseContainerPrefix = 'new-prefix';
    }],
    ['old property retained', 'CaptureBatch/function.json', (v: Record<string, unknown>) => {
      const bindings = v.bindings as Record<string, unknown>[];
      bindings[1].collectionName = 'events';
    }],
    ['changed batching', 'host.json', (v: Record<string, unknown>) => {
      const extensions = v.extensions as Record<string, Record<string, unknown>>;
      extensions.eventHubs.maxEventBatchSize = 100;
    }],
    ['lost logging', 'host.json', (v: Record<string, unknown>) => { delete v.logging; }],
    ['changed consumer group', 'CaptureBatch/function.json', (v: Record<string, unknown>) => {
      const bindings = v.bindings as Record<string, unknown>[];
      bindings[0].consumerGroup = '$Default';
    }],
  ])('rejects %s in one original bundle variant', (_name, path, mutate) => {
    migrate();
    const value = read(`bundle-v2/${path}`);
    mutate(value);
    write(`bundle-v2/${path}`, value);
    expect(grade().status).toBe(1);
  });

  it('rejects changed function behavior even when all binding contracts pass', () => {
    migrate();
    writeFileSync(join(root, 'bundle-v3', 'AuditChanges', 'index.js'), 'module.exports = async () => {};');
    expect(grade().status).toBe(1);
  });

  it('rejects invalid JSON with a named failure', () => {
    migrate();
    writeFileSync(join(root, 'bundle-v1', 'host.json'), '{');
    const result = grade();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('bundle-v1');
  });

  it('rejects a missing function instead of passing the other apps', () => {
    migrate();
    unlinkSync(join(root, 'bundle-v2', 'CaptureBatch', 'index.js'));
    const result = grade();
    expect(result.status).toBe(1);
    const evidence = JSON.parse(result.stdout);
    expect(evidence.checks).toHaveLength(2);
    expect(evidence.failures).toHaveLength(1);
    expect(evidence.failures[0]).toContain('bundle-v2');
  });
});
