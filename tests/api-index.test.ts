import { describe, expect, it } from 'vitest';
import { extractOperations, shortSummary } from '../src/build/api-index.js';

describe('extractOperations', () => {
  it('indexes operations, marks LRO and required bodies, and skips slot paths', () => {
    const operations = extractOperations(
      {
        paths: {
          '/subscriptions/{s}/providers/Microsoft.Web/sites/{name}/config/appsettings': {
            parameters: [],
            put: { operationId: 'WebApps_UpdateApplicationSettings', description: 'Replaces the application settings of an app. Extra detail.', parameters: [{ in: 'body', required: true }] },
          },
          '/subscriptions/{s}/providers/Microsoft.Web/sites/{name}': {
            put: { operationId: 'WebApps_CreateOrUpdate', summary: 'Creates a new web, mobile, or API app.', 'x-ms-long-running-operation': true, parameters: [{ $ref: '#/parameters/x' }] },
          },
          '/subscriptions/{s}/providers/Microsoft.Web/sites/{name}/slots/{slot}': {
            get: { operationId: 'WebApps_GetSlot', description: 'Gets a slot.' },
          },
        },
      },
      '2024-11-01',
    );
    expect(operations).toEqual([
      { id: 'WebApps_CreateOrUpdate', method: 'PUT', path: '/subscriptions/{s}/providers/Microsoft.Web/sites/{name}', apiVersion: '2024-11-01', summary: 'Creates a new web, mobile, or API app.', lro: true },
      { id: 'WebApps_UpdateApplicationSettings', method: 'PUT', path: '/subscriptions/{s}/providers/Microsoft.Web/sites/{name}/config/appsettings', apiVersion: '2024-11-01', summary: 'Replaces the application settings of an app.', body: true },
    ]);
  });

  it('keeps summaries to one short sentence', () => {
    expect(shortSummary({ description: `Description for ${'x'.repeat(200)}.` })).toHaveLength(140);
  });
});
