import { describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname, release, type } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  BUNDLED_SKILL_NAMES,
  createApplicationInsightsClient,
  parseTelemetryEvent,
  sendTelemetryEventWithDependencies,
  type ApplicationInsightsClient,
  type TelemetryEvent,
} from '../src/telemetry/sender.js';

interface InspectableContext {
  readonly context: {
    readonly tags: Record<string, string>;
    readonly keys: Record<string, string>;
  };
}

const EVENT: TelemetryEvent = {
  timestamp: '2026-07-17T20:00:00Z',
  eventType: 'skill_invocation',
  clientName: 'copilot-cli',
  pluginName: 'azure-functions-skills',
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
      timeoutMs: 100,
    });

    expect(result).toEqual({ status: 'sent' });
    expect(createClient).toHaveBeenCalledWith('InstrumentationKey=test-key');
    expect(client.trackEvent).toHaveBeenCalledOnce();
    expect(client.trackEvent).toHaveBeenCalledWith({
      name: 'AzureFunctionsSkillsPluginExecuted',
      properties: {
        Plugin_ClientName: 'copilot-cli',
        Plugin_EventType: 'skill_invocation',
        Plugin_PluginName: 'azure-functions-skills',
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
      timeoutMs: 100,
    })).resolves.toEqual({ status: 'disabled' });

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: '__APPLICATIONINSIGHTS_CONNECTION_STRING__',
      createClient,
      environment: {},
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
      timeoutMs: 100,
    })).rejects.toThrow('Telemetry delivery failed: network unavailable');

    expect(client.trackEvent).toHaveBeenCalledOnce();
    expect(client.flush).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('treats a full-acceptance ingestion response body as success', async () => {
    const client = makeClient(({ callback }) =>
      callback('{"itemsReceived":1,"itemsAccepted":1,"appId":null,"errors":[]}'));

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: 'InstrumentationKey=test-key',
      createClient: () => client,
      environment: {},
      timeoutMs: 100,
    })).resolves.toEqual({ status: 'sent' });
  });

  it('rejects a partial-acceptance ingestion response body', async () => {
    const client = makeClient(({ callback }) =>
      callback('{"itemsReceived":2,"itemsAccepted":1,"errors":[{"index":1,"statusCode":400}]}'));

    await expect(sendTelemetryEventWithDependencies(EVENT, {
      connectionString: 'InstrumentationKey=test-key',
      createClient: () => client,
      environment: {},
      timeoutMs: 100,
    })).rejects.toThrow('Telemetry delivery failed');
  });

  it('delivers through the isolated Application Insights client', async () => {
    let receivedBytes = 0;
    let requestPath = '';
    const bodyChunks: Buffer[] = [];
    const server = createServer((request, response) => {
      requestPath = request.url || '';
      request.on('data', chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        bodyChunks.push(buffer);
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
        createClient: createApplicationInsightsClient,
        environment: {},
        timeoutMs: 1_000,
      })).resolves.toEqual({ status: 'sent' });
    } finally {
      server.close();
      await once(server, 'close');
    }

    expect(requestPath).toBe('/v2/track');
    expect(receivedBytes).toBeGreaterThan(0);

    const envelope = decodeEnvelope(Buffer.concat(bodyChunks));
    expect(envelope).not.toContain(hostname());
    expect(envelope).not.toContain(`${type()} ${release()}`);
    expect(envelope).not.toContain('ai.cloud.roleInstance');
    expect(envelope).not.toContain('ai.device.osVersion');

    for (const line of envelope.trim().split('\n')) {
      const parsed = JSON.parse(line) as { tags?: Record<string, string> };
      for (const key of Object.keys(parsed.tags ?? {})) {
        expect(key).toBe('ai.internal.sdkVersion');
      }
      expect(parsed.tags?.['ai.application.ver']).toBeUndefined();
      expect(parsed.tags?.['ai.operation.id']).toBeUndefined();
    }
  });
});

function decodeEnvelope(body: Buffer): string {
  try {
    return gunzipSync(body).toString('utf-8');
  } catch {
    return body.toString('utf-8');
  }
}

describe('createApplicationInsightsClient', () => {
  it('clears host-derived envelope context tags', () => {
    const client = createApplicationInsightsClient(
      'InstrumentationKey=00000000-0000-4000-8000-000000000002',
    ) as unknown as InspectableContext;
    const { tags, keys } = client.context;

    expect(tags[keys.cloudRoleInstance]).toBeUndefined();
    expect(tags[keys.deviceOSVersion]).toBeUndefined();
    expect(tags['ai.device.osArchitecture']).toBeUndefined();
    expect(tags['ai.device.osPlatform']).toBeUndefined();
  });
});
