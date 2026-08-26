import { describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import applicationInsights from 'applicationinsights';
import {
  BUNDLED_SKILL_NAMES,
  parseTelemetryEvent,
  sendTelemetryEventWithDependencies,
  type ApplicationInsightsClient,
  type TelemetryEvent,
} from '../src/telemetry/sender.js';

const EVENT: TelemetryEvent = {
  timestamp: '2026-07-17T20:00:00Z',
  eventType: 'skill_invocation',
  clientName: 'copilot-cli',
  pluginName: 'azure-functions-skills',
  correlationId: '11111111-1111-4111-8111-111111111111',
  pluginVersion: '1.2.3',
  sessionId: 'session-123',
  skillName: 'azure-functions-help',
};

function makeClient(
  flush: ApplicationInsightsClient['flush'] = ({ callback }) => callback(),
): ApplicationInsightsClient {
  return {
    trackEvent: vi.fn(),
    flush: vi.fn(flush),
  };
}

describe('parseTelemetryEvent', () => {
  it('keeps the telemetry allowlist aligned with bundled skills', () => {
    const skillNames = readdirSync(join(import.meta.dirname, '..', 'templates', 'skills'))
      .sort();
    expect([...BUNDLED_SKILL_NAMES].sort()).toEqual(skillNames);
  });

  it('accepts the sanitized telemetry contract', () => {
    expect(parseTelemetryEvent(EVENT)).toEqual(EVENT);
  });

  it('rejects raw or unknown properties', () => {
    expect(() => parseTelemetryEvent({
      ...EVENT,
      toolInput: { path: 'customer-secret.txt' },
    })).toThrow('Unsupported telemetry property: toolInput');
  });

  it('rejects non-bundled skill names and unsafe file references', () => {
    expect(() => parseTelemetryEvent({
      ...EVENT,
      skillName: 'azure-functions-internal-customer-runbook',
    })).toThrow('Unsupported skill name');
    expect(() => parseTelemetryEvent({
      ...EVENT,
      skillName: undefined,
      eventType: 'reference_file_read',
      fileReference: '../customer-secret.txt',
    })).toThrow('Unsupported file reference');
    expect(() => parseTelemetryEvent({
      ...EVENT,
      skillName: undefined,
      eventType: 'reference_file_read',
      fileReference: 'azure-functions-help/customer-secret.txt',
    })).toThrow('Unsupported file reference');
  });
});

describe('sendTelemetryEventWithDependencies', () => {
  it('sends one custom event and flushes it', async () => {
    const client = makeClient();
    const createClient = vi.fn(() => client);

    const result = await sendTelemetryEventWithDependencies(EVENT, {
      connectionString: 'InstrumentationKey=test-key',
      createClient,
      environment: {},
      packageVersion: '1.2.3',
      timeoutMs: 100,
    });

    expect(result).toEqual({ status: 'sent' });
    expect(createClient).toHaveBeenCalledWith('InstrumentationKey=test-key');
    expect(client.trackEvent).toHaveBeenCalledOnce();
    expect(client.trackEvent).toHaveBeenCalledWith({
      name: 'AzureFunctionsSkillsPluginExecuted',
      properties: {
        Plugin_ClientName: 'copilot-cli',
        Plugin_CorrelationId: '11111111-1111-4111-8111-111111111111',
        Plugin_EventType: 'skill_invocation',
        Plugin_PackageVersion: '1.2.3',
        Plugin_PluginName: 'azure-functions-skills',
        Plugin_PluginVersion: '1.2.3',
        Plugin_SessionId: 'session-123',
        Plugin_SkillName: 'azure-functions-help',
        Plugin_Timestamp: '2026-07-17T20:00:00Z',
      },
    });
    expect(client.flush).toHaveBeenCalledOnce();
  });

  it('does not send when telemetry is opted out or not configured', async () => {
    const createClient = vi.fn(() => makeClient());

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: 'InstrumentationKey=test-key',
      createClient,
      environment: { AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY: 'false' },
      packageVersion: '1.2.3',
      timeoutMs: 100,
    })).resolves.toEqual({ status: 'disabled' });

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: '__APPLICATIONINSIGHTS_CONNECTION_STRING__',
      createClient,
      environment: {},
      packageVersion: '1.2.3',
      timeoutMs: 100,
    })).resolves.toEqual({ status: 'not-configured' });

    expect(createClient).not.toHaveBeenCalled();
  });

  it('times out after the configured deadline without retrying', async () => {
    const client = makeClient(() => undefined);
    const createClient = vi.fn(() => client);

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: 'InstrumentationKey=test-key',
      createClient,
      environment: {},
      packageVersion: '1.2.3',
      timeoutMs: 10,
    })).rejects.toThrow('Telemetry delivery timed out after 10ms');

    expect(client.trackEvent).toHaveBeenCalledOnce();
    expect(client.flush).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('surfaces SDK delivery failures without retrying', async () => {
    const client = makeClient(({ callback }) => callback('network unavailable'));
    const createClient = vi.fn(() => client);

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: 'InstrumentationKey=test-key',
      createClient,
      environment: {},
      packageVersion: '1.2.3',
      timeoutMs: 100,
    })).rejects.toThrow('Telemetry delivery failed.');

    expect(client.trackEvent).toHaveBeenCalledOnce();
    expect(client.flush).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('treats a structured all-items-accepted SDK response as success', async () => {
    const response = JSON.stringify({
      itemsReceived: 1,
      itemsAccepted: 1,
      appId: null,
      errors: [],
    });
    const client = makeClient(({ callback }) => callback(response));

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: 'InstrumentationKey=test-key',
      createClient: () => client,
      environment: {},
      packageVersion: '1.2.3',
      timeoutMs: 100,
    })).resolves.toEqual({ status: 'sent' });
  });

  it('rejects partial ingestion without logging the raw SDK response', async () => {
    const response = JSON.stringify({
      itemsReceived: 2,
      itemsAccepted: 1,
      errors: [{ index: 1, statusCode: 400, message: 'secret backend detail' }],
    });
    const client = makeClient(({ callback }) => callback(response));

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: 'InstrumentationKey=test-key',
      createClient: () => client,
      environment: {},
      packageVersion: '1.2.3',
      timeoutMs: 100,
    })).rejects.toThrow('Telemetry ingestion rejected 1 of 2 item(s)');
  });

  it('retries once for transient ingestion failures', async () => {
    const first = makeClient(({ callback }) => callback(JSON.stringify({
      itemsReceived: 1,
      itemsAccepted: 0,
      errors: [{ index: 0, statusCode: 503, message: 'temporarily unavailable' }],
    })));
    const second = makeClient(({ callback }) => callback(JSON.stringify({
      itemsReceived: 1,
      itemsAccepted: 1,
      errors: [],
    })));
    const createClient = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: 'InstrumentationKey=test-key',
      createClient,
      environment: {},
      packageVersion: '1.2.3',
      timeoutMs: 100,
    })).resolves.toEqual({ status: 'sent' });
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it('delivers through the isolated Application Insights client', async () => {
    let receivedBytes = 0;
    let requestPath = '';
    const server = createServer((request, response) => {
      requestPath = request.url || '';
      request.on('data', chunk => {
        receivedBytes += Buffer.byteLength(chunk);
      });
      request.on('end', () => {
        response.writeHead(200);
        response.end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const connectionString = [
      'InstrumentationKey=00000000-0000-4000-8000-000000000001',
      `IngestionEndpoint=http://127.0.0.1:${address.port}`,
    ].join(';');

    try {
      await expect(sendTelemetryEventWithDependencies(EVENT, {
        connectionString,
        createClient: value => new applicationInsights.TelemetryClient(value),
        environment: {},
        packageVersion: '1.2.3',
        timeoutMs: 1_000,
      })).resolves.toEqual({ status: 'sent' });
    } finally {
      server.close();
      await once(server, 'close');
    }

    expect(requestPath).toBe('/v2/track');
    expect(receivedBytes).toBeGreaterThan(0);
  });
});
