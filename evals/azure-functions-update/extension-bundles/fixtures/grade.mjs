import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const variants = ['bundle-v1', 'bundle-v2', 'bundle-v3'];
const result = { passed: true, checks: [], failures: [], scope: 'offline contracts; no Functions host or service execution' };
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const expectedBindings = {
  AuditChanges: [
    {
      type: 'cosmosDBTrigger', direction: 'in', name: 'documents',
      databaseName: 'sales', containerName: 'orders', connection: 'OrdersConnection',
      leaseConnection: 'LeasesConnection', leaseDatabaseName: 'operations',
      leaseContainerName: 'leases', leaseContainerPrefix: 'audit',
      createLeaseContainerIfNotExists: false, startFromBeginning: false,
    },
    { type: 'eventHub', direction: 'out', name: 'events', eventHubName: 'order-events', connection: 'EventsConnection' },
  ],
  CaptureBatch: [
    {
      type: 'eventHubTrigger', direction: 'in', name: 'messages', eventHubName: 'order-events',
      connection: 'EventsConnection', consumerGroup: 'audit-reader', cardinality: 'many', dataType: 'json',
    },
    {
      type: 'cosmosDB', direction: 'out', name: 'records', databaseName: 'sales',
      containerName: 'processed', connection: 'OrdersConnection', createIfNotExists: false,
    },
  ],
};
const removed = ['collectionName', 'connectionStringSetting', 'leaseCollectionName',
  'leaseConnectionStringSetting', 'createLeaseCollectionIfNotExists', 'leaseCollectionPrefix'];

for (const variant of variants) {
  try {
    const host = json(join(variant, 'host.json'));
    assert.equal(host.version, '2.0', 'Keep the host schema version');
    assert.equal(host.extensionBundle.id, 'Microsoft.Azure.Functions.ExtensionBundle');
    assert.match(host.extensionBundle.version, /^\[\s*4\.(?:0\.0|\*)\s*,\s*5\.0\.0\s*\)$/, 'Select the supported v4 bundle range');
    assert.deepEqual(host.logging, { logLevel: { default: 'Warning' } }, 'Keep logging');
    assert.equal(host.functionTimeout, '00:05:00', 'Keep function timeout');
    const hubs = host.extensions.eventHubs;
    assert.equal(hubs.maxEventBatchSize, 32, 'Keep the maximum batch size');
    assert.equal(hubs.prefetchCount, 64, 'Keep prefetch count');
    assert.equal(hubs.batchCheckpointFrequency, 1, 'Keep checkpoint frequency');
    assert.equal(hubs.eventProcessorOptions, undefined, 'Remove legacy Event Hubs settings');
    assert.equal(hubs.maxBatchSize, undefined, 'Use maxEventBatchSize');
    for (const [name, expected] of Object.entries(expectedBindings)) {
      const definition = json(join(variant, name, 'function.json'));
      assert.equal(definition.disabled ?? false, false, `${name} must stay enabled`);
      assert.equal(definition.bindings.length, expected.length, `${name} must keep both bindings`);
      for (const binding of expected) {
        const actual = definition.bindings.find(item => item.name === binding.name);
        assert.ok(actual, `Missing binding ${binding.name}`);
        for (const [key, value] of Object.entries(binding)) {
          assert.deepEqual(actual[key], value, `${name}.${binding.name}.${key}`);
        }
        for (const key of removed) assert.equal(actual[key], undefined, `Remove ${key}`);
      }
      assert.ok(!definition.scriptFile || definition.scriptFile === 'index.js', 'Keep the existing script entry');
      for (const input of [[], [{ id: 'a', total: 12 }, { id: 'b', total: 0 }]]) {
        const context = { bindings: {} };
        const source = readFileSync(join(variant, name, 'index.js'), 'utf8');
        // This executes the fixture's model-v3 function without a Functions host.
        const pending = runInNewContext(`${source}\nmodule.exports(context, input);`, {
          module: { exports: {} }, context, input: JSON.parse(JSON.stringify(input)),
        }, { timeout: 1000 });
        await pending;
        const expectedOutput = name === 'AuditChanges'
          ? { events: input } : { records: input.map(item => ({ ...item, processed: true })) };
        assert.deepEqual(JSON.parse(JSON.stringify(context.bindings)), expectedOutput, `${name} batch behavior`);
      }
    }
    result.checks.push(`${variant}: bundle, binding, lease, batch, logging and JavaScript contracts passed`);
  } catch (error) {
    result.passed = false;
    result.failures.push(`${variant}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const output = JSON.stringify(result, null, 2);
if (process.argv.includes('--evidence')) writeFileSync('grading-evidence/execution.json', output);
console.log(output);
process.exitCode = result.passed ? 0 : 1;
