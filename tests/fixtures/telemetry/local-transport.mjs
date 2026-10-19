import http from 'node:http';
import https from 'node:https';
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';

if (process.env.AF_TEST_DELAY_STDOUT === '1') {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, callback) => {
    setTimeout(() => write(chunk, callback), 50);
    return true;
  };
}

// This trusted preload routes every SDK request to a local test server.
// The distributed payload has no destination override or test mode.
const request = http.request;
const localRequest = (options, callback) => request({
  ...options,
  host: '127.0.0.1',
  hostname: '127.0.0.1',
  port: Number(process.env.AF_TEST_PORT),
  protocol: 'http:',
  agent: false,
  path: process.env.AF_TEST_TRANSPORT ? `/test-${process.env.AF_TEST_TRANSPORT}` : options.path,
}, callback);
http.request = localRequest;
https.request = localRequest;
http.get = https.get = () => { throw new Error('Unexpected GET request'); };

childProcess.execFile = (file, args, _options, callback) => {
  if (process.env.AF_TEST_ARM_FAIL === '1') {
    globalThis.queueMicrotask(() => callback(new Error('Test ARM failure'), '', 'Test ARM failure'));
    return new EventEmitter();
  }
  const command = args.join(' ');
  const deployment = /\bdeployment\b/.test(command);
  if (!deployment && !/\brest\b/.test(command)) {
    throw new Error(`Unexpected process: ${file}`);
  }
  appendFileSync(process.env.AF_TEST_AZ_CALLS, `${JSON.stringify(args)}\n`);
  const id = '/subscriptions/test-only/providers/Microsoft.Resources/deployments/private-env';
  const output = deployment ? {
    id,
    name: 'private-env',
    properties: { provisioningState: 'Succeeded', timestamp: new Date().toISOString() },
  } : {
    value: [{
      properties: {
        provisioningOperation: 'Create',
        provisioningState: 'Succeeded',
        targetResource: { resourceType: 'Microsoft.Web/sites' },
      },
    }],
  };
  globalThis.queueMicrotask(() => callback(null, JSON.stringify(output), ''));
  return new EventEmitter();
};
syncBuiltinESMExports();
