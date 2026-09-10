import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectResourceTypes,
  createAzureCliDeploymentQuery,
  type ArmDeploymentOperation,
  type ArmDeploymentQuery,
  type ArmDeploymentSummary,
} from '../src/telemetry/arm-deployments.js';
import {
  collectContributionWithDependencies,
  parseContributionInput,
  selectDeployment,
  type ContributionDependencies,
  type ContributionInput,
} from '../src/telemetry/contribution.js';
import {
  parseContributionEvent,
  type ApplicationInsightsClient,
  type ContributionEvent,
} from '../src/telemetry/sender.js';
import { readWorkspaceTelemetryState } from '../src/telemetry/workspace-optout.js';

function makeQuery(
  deployments: readonly ArmDeploymentSummary[],
  operations: Readonly<Record<string, readonly ArmDeploymentOperation[]>>,
): ArmDeploymentQuery {
  return {
    listSubscriptionDeployments: vi.fn(async () => deployments),
    listDeploymentOperations: vi.fn(async (id: string) => {
      if (!(id in operations)) throw new Error('not found');
      return operations[id];
    }),
  };
}

function createOp(overrides: Partial<ArmDeploymentOperation>): ArmDeploymentOperation {
  return {
    provisioningOperation: 'Create',
    provisioningState: 'Succeeded',
    ...overrides,
  };
}

const ROOT = '/subscriptions/s/providers/Microsoft.Resources/deployments/root';
const CHILD = '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Resources/deployments/child';

describe('collectResourceTypes', () => {
  it('returns sorted distinct Microsoft types for successful Create operations', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' }),
        createOp({ targetResourceType: 'Microsoft.Storage/storageAccounts', targetResourceId: '/r/2' }),
        createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/3' }),
      ],
    });

    const result = await collectResourceTypes(ROOT, query);

    expect(result).toEqual({
      status: 'ok',
      resourceTypes: ['microsoft.storage/storageaccounts', 'microsoft.web/sites'],
    });
  });

  it('excludes Read, Delete, EvaluateDeploymentOutput and non-succeeded operations', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' }),
        createOp({ provisioningOperation: 'Read', targetResourceType: 'Microsoft.Web/sites/config' }),
        createOp({ provisioningOperation: 'Delete', targetResourceType: 'Microsoft.Web/sites/slots' }),
        createOp({ provisioningOperation: 'EvaluateDeploymentOutput', targetResourceType: 'Microsoft.Web/x' }),
        createOp({ provisioningState: 'Running', targetResourceType: 'Microsoft.Insights/components' }),
        createOp({ provisioningState: 'Failed', targetResourceType: 'Microsoft.KeyVault/vaults' }),
      ],
    });

    const result = await collectResourceTypes(ROOT, query);

    expect(result).toEqual({ status: 'ok', resourceTypes: ['microsoft.web/sites'] });
  });

  it('traverses nested Microsoft.Resources/deployments and omits the wrapper type', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: 'Microsoft.Resources/deployments', targetResourceId: CHILD }),
        createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' }),
      ],
      [CHILD]: [
        createOp({ targetResourceType: 'Microsoft.Storage/storageAccounts', targetResourceId: '/r/2' }),
      ],
    });

    const result = await collectResourceTypes(ROOT, query);

    expect(result).toEqual({
      status: 'ok',
      resourceTypes: ['microsoft.storage/storageaccounts', 'microsoft.web/sites'],
    });
  });

  it('skips when a nested deployment child is not confirmed successful', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({
          provisioningState: 'Failed',
          targetResourceType: 'Microsoft.Resources/deployments',
          targetResourceId: CHILD,
        }),
      ],
    });

    const result = await collectResourceTypes(ROOT, query);

    expect(result).toEqual({ status: 'skip', reason: 'incomplete-child' });
  });

  it('excludes syntactically valid non-Microsoft provider types', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: 'Custom.Provider/things', targetResourceId: '/r/1' }),
      ],
    });

    const result = await collectResourceTypes(ROOT, query);

    expect(result).toEqual({ status: 'skip', reason: 'no-types' });
  });

  it('fails closed on a Succeeded Create with a malformed resource type', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: '/subscriptions/s/resourceGroups/rg', targetResourceId: '/r/1' }),
      ],
    });

    const result = await collectResourceTypes(ROOT, query);

    expect(result).toEqual({ status: 'skip', reason: 'malformed-operation' });
  });

  it('fails closed on a Succeeded Create with a missing resource type', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' }),
        createOp({ targetResourceId: '/r/2' }),
      ],
    });

    const result = await collectResourceTypes(ROOT, query);

    expect(result).toEqual({ status: 'skip', reason: 'malformed-operation' });
  });

  it('skips with no-types when nothing qualifies', async () => {
    const query = makeQuery([], { [ROOT]: [] });
    const result = await collectResourceTypes(ROOT, query);
    expect(result).toEqual({ status: 'skip', reason: 'no-types' });
  });

  it('skips when the ARM query fails', async () => {
    const query: ArmDeploymentQuery = {
      listSubscriptionDeployments: async () => [],
      listDeploymentOperations: async () => {
        throw new Error('access denied');
      },
    };
    const result = await collectResourceTypes(ROOT, query);
    expect(result).toEqual({ status: 'skip', reason: 'query-failed' });
  });

  it('enforces the overall deadline', async () => {
    const query = makeQuery([], {
      [ROOT]: [createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' })],
    });
    const values = [0, 60_000];
    const now = () => (values.length > 1 ? (values.shift() as number) : values[0]);
    const result = await collectResourceTypes(ROOT, query, { now });
    expect(result).toEqual({ status: 'skip', reason: 'deadline-exceeded' });
  });

  it('enforces the ARM request limit', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: 'Microsoft.Resources/deployments', targetResourceId: CHILD }),
      ],
      [CHILD]: [createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' })],
    });
    const result = await collectResourceTypes(ROOT, query, { maxRequests: 1 });
    expect(result).toEqual({ status: 'skip', reason: 'request-limit-exceeded' });
  });

  it('enforces the nesting depth limit', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: 'Microsoft.Resources/deployments', targetResourceId: CHILD }),
      ],
      [CHILD]: [createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' })],
    });
    const result = await collectResourceTypes(ROOT, query, { maxDepth: 0 });
    expect(result).toEqual({ status: 'skip', reason: 'depth-limit-exceeded' });
  });

  it('enforces the distinct type limit', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' }),
        createOp({ targetResourceType: 'Microsoft.Storage/storageAccounts', targetResourceId: '/r/2' }),
      ],
    });
    const result = await collectResourceTypes(ROOT, query, { maxTypes: 1 });
    expect(result).toEqual({ status: 'skip', reason: 'type-limit-exceeded' });
  });

  it('terminates on cycles using a visited set', async () => {
    const query = makeQuery([], {
      [ROOT]: [
        createOp({ targetResourceType: 'Microsoft.Resources/deployments', targetResourceId: CHILD }),
        createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' }),
      ],
      [CHILD]: [
        createOp({ targetResourceType: 'Microsoft.Resources/deployments', targetResourceId: ROOT }),
        createOp({ targetResourceType: 'Microsoft.Storage/storageAccounts', targetResourceId: '/r/2' }),
      ],
    });
    const result = await collectResourceTypes(ROOT, query);
    expect(result).toEqual({
      status: 'ok',
      resourceTypes: ['microsoft.storage/storageaccounts', 'microsoft.web/sites'],
    });
  });

  it('skips when a single in-flight request exceeds the remaining budget', async () => {
    const query: ArmDeploymentQuery = {
      listSubscriptionDeployments: async () => [],
      listDeploymentOperations: () => new Promise(resolve => {
        setTimeout(() => resolve([
          createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' }),
        ]), 200);
      }),
    };
    const result = await collectResourceTypes(ROOT, query, { deadlineMs: 20 });
    expect(result).toEqual({ status: 'skip', reason: 'deadline-exceeded' });
  });

  it('skips when pagination exhausts the shared request budget', async () => {
    const runner = vi.fn(async () => JSON.stringify({
      value: [{ properties: { provisioningOperation: 'Create', provisioningState: 'Succeeded', targetResource: { resourceType: 'Microsoft.Web/sites', id: '/r/1' } } }],
      nextLink: 'https://management.azure.com/subscriptions/s/operations?$skiptoken=more',
    }));
    const query = createAzureCliDeploymentQuery(runner);

    const result = await collectResourceTypes(ROOT, query, { maxRequests: 3 });

    expect(result).toEqual({ status: 'skip', reason: 'request-limit-exceeded' });
  });
});

describe('createAzureCliDeploymentQuery', () => {
  it('follows same-origin ARM pagination and merges operations', async () => {
    const runner = vi.fn(async (args: readonly string[]) => {
      const url = args[args.indexOf('--url') + 1] ?? '';
      if (url.includes('$skiptoken=page2')) {
        return JSON.stringify({
          value: [{ properties: { provisioningOperation: 'Create', provisioningState: 'Succeeded', targetResource: { resourceType: 'Microsoft.Storage/storageAccounts', id: '/r/2' } } }],
        });
      }
      return JSON.stringify({
        value: [{ properties: { provisioningOperation: 'Create', provisioningState: 'Succeeded', targetResource: { resourceType: 'Microsoft.Web/sites', id: '/r/1' } } }],
        nextLink: 'https://management.azure.com/subscriptions/s/operations?$skiptoken=page2',
      });
    });

    const query = createAzureCliDeploymentQuery(runner);
    const operations = await query.listDeploymentOperations(ROOT);

    expect(operations).toHaveLength(2);
    expect(operations[0]?.targetResourceType).toBe('Microsoft.Web/sites');
    expect(operations[1]?.targetResourceType).toBe('Microsoft.Storage/storageAccounts');
  });

  it('rejects cross-origin pagination links', async () => {
    const runner = vi.fn(async () => JSON.stringify({
      value: [],
      nextLink: 'https://evil.example.com/steal',
    }));

    const query = createAzureCliDeploymentQuery(runner);

    await expect(query.listDeploymentOperations(ROOT)).rejects.toThrow();
  });

  it('rejects when pagination never terminates within the page limit', async () => {
    const runner = vi.fn(async () => JSON.stringify({
      value: [],
      nextLink: 'https://management.azure.com/subscriptions/s/operations?$skiptoken=next',
    }));

    const query = createAzureCliDeploymentQuery(runner);

    await expect(query.listDeploymentOperations(ROOT)).rejects.toThrow();
  });

  it('parses subscription deployment summaries', async () => {
    const runner = vi.fn(async () => JSON.stringify([
      { id: ROOT, name: 'root', properties: { provisioningState: 'Succeeded', timestamp: '2026-09-09T10:00:00Z' } },
    ]));

    const query = createAzureCliDeploymentQuery(runner);
    const deployments = await query.listSubscriptionDeployments();

    expect(deployments).toEqual([
      { id: ROOT, name: 'root', provisioningState: 'Succeeded', timestamp: '2026-09-09T10:00:00Z' },
    ]);
  });
});

describe('parseContributionInput', () => {
  const VALID: ContributionInput = {
    skill: 'azure-functions-deploy',
    operation: 'deploy',
    agent: 'copilot-cli',
    skillsVersion: '1.2.3',
    environmentName: 'my-env',
  };

  it('accepts the bounded contribution contract', () => {
    expect(parseContributionInput(VALID)).toEqual(VALID);
  });

  it('accepts a minimal input without optional fields', () => {
    expect(parseContributionInput({
      skill: 'azure-functions-hosted-skills',
      operation: 'provision',
      agent: 'codex',
    })).toEqual({ skill: 'azure-functions-hosted-skills', operation: 'provision', agent: 'codex' });
  });

  it('rejects unknown fields', () => {
    expect(() => parseContributionInput({ ...VALID, transcript: 'secret' }))
      .toThrow('Unsupported contribution property: transcript');
  });

  it('rejects unsupported skill and operation values', () => {
    expect(() => parseContributionInput({ ...VALID, skill: 'azure-functions-create' })).toThrow();
    expect(() => parseContributionInput({ ...VALID, operation: 'delete' })).toThrow();
  });

  it('rejects control characters and oversized strings', () => {
    expect(() => parseContributionInput({ ...VALID, agent: 'copilot\ncli' })).toThrow();
    expect(() => parseContributionInput({ ...VALID, environmentName: 'x'.repeat(300) })).toThrow();
  });
});

describe('selectDeployment', () => {
  const NOW = Date.parse('2026-09-09T10:30:00Z');

  it('selects the most recent successful deployment inside the window', () => {
    const deployments: ArmDeploymentSummary[] = [
      { id: '/d/old', name: 'old', provisioningState: 'Succeeded', timestamp: '2026-09-09T10:10:00Z' },
      { id: '/d/new', name: 'new', provisioningState: 'Succeeded', timestamp: '2026-09-09T10:25:00Z' },
    ];
    expect(selectDeployment(deployments, undefined, NOW)?.id).toBe('/d/new');
  });

  it('ignores failed and stale deployments', () => {
    const deployments: ArmDeploymentSummary[] = [
      { id: '/d/failed', name: 'f', provisioningState: 'Failed', timestamp: '2026-09-09T10:25:00Z' },
      { id: '/d/stale', name: 's', provisioningState: 'Succeeded', timestamp: '2026-09-09T09:00:00Z' },
    ];
    expect(selectDeployment(deployments, undefined, NOW)).toBeUndefined();
  });

  it('prefers deployments whose name contains the environment name', () => {
    const deployments: ArmDeploymentSummary[] = [
      { id: '/d/other', name: 'other', provisioningState: 'Succeeded', timestamp: '2026-09-09T10:29:00Z' },
      { id: '/d/env', name: 'prefix-my-env', provisioningState: 'Succeeded', timestamp: '2026-09-09T10:20:00Z' },
    ];
    expect(selectDeployment(deployments, 'my-env', NOW)?.id).toBe('/d/env');
  });
});

function makeClient(
  flush: ApplicationInsightsClient['flush'] = ({ callback }) => callback(),
): ApplicationInsightsClient {
  return { trackEvent: vi.fn(), flush: vi.fn(flush) };
}

function baseDeps(overrides: Partial<ContributionDependencies>): ContributionDependencies {
  return {
    connectionString: 'InstrumentationKey=test-key',
    createClient: () => makeClient(),
    environment: {},
    timeoutMs: 100,
    query: makeQuery([], {}),
    now: () => Date.parse('2026-09-09T10:30:00Z'),
    workspaceTelemetryEnabled: undefined,
    ...overrides,
  };
}

const RECENT_DEPLOYMENT: ArmDeploymentSummary = {
  id: ROOT,
  name: 'root',
  provisioningState: 'Succeeded',
  timestamp: '2026-09-09T10:25:00Z',
};

const DEPLOY_INPUT: ContributionInput = {
  skill: 'azure-functions-deploy',
  operation: 'deploy',
  agent: 'copilot-cli',
  skillsVersion: '1.0.0',
  environmentName: 'my-env',
};

describe('collectContributionWithDependencies', () => {
  it('short-circuits on environment opt-out before any ARM query', async () => {
    const query = makeQuery([RECENT_DEPLOYMENT], {});
    const result = await collectContributionWithDependencies(DEPLOY_INPUT, baseDeps({
      query,
      environment: { AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY: 'false' },
    }));
    expect(result).toEqual({ status: 'disabled' });
    expect(query.listSubscriptionDeployments).not.toHaveBeenCalled();
  });

  it('short-circuits on workspace opt-out before any ARM query', async () => {
    const query = makeQuery([RECENT_DEPLOYMENT], {});
    const result = await collectContributionWithDependencies(DEPLOY_INPUT, baseDeps({
      query,
      workspaceTelemetryEnabled: false,
    }));
    expect(result).toEqual({ status: 'disabled' });
    expect(query.listSubscriptionDeployments).not.toHaveBeenCalled();
  });

  it('returns not-configured for the placeholder connection string without querying ARM', async () => {
    const query = makeQuery([RECENT_DEPLOYMENT], {});
    const result = await collectContributionWithDependencies(DEPLOY_INPUT, baseDeps({
      query,
      connectionString: '__APPLICATIONINSIGHTS_CONNECTION_STRING__',
    }));
    expect(result).toEqual({ status: 'not-configured' });
    expect(query.listSubscriptionDeployments).not.toHaveBeenCalled();
  });

  it('skips when there is no recent successful deployment', async () => {
    const result = await collectContributionWithDependencies(DEPLOY_INPUT, baseDeps({
      query: makeQuery([], {}),
    }));
    expect(result).toEqual({ status: 'skipped', reason: 'no-recent-deployment' });
  });

  it('skips when the selected deployment has no qualifying resource types', async () => {
    const query = makeQuery([RECENT_DEPLOYMENT], {
      [ROOT]: [createOp({ provisioningOperation: 'Read', targetResourceType: 'Microsoft.Web/sites' })],
    });
    const result = await collectContributionWithDependencies(DEPLOY_INPUT, baseDeps({ query }));
    expect(result).toEqual({ status: 'skipped', reason: 'no-types' });
  });

  it('sends the exact seven-property event and omits environmentName', async () => {
    const client = makeClient();
    const query = makeQuery([RECENT_DEPLOYMENT], {
      [ROOT]: [
        createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' }),
        createOp({ targetResourceType: 'Microsoft.Storage/storageAccounts', targetResourceId: '/r/2' }),
      ],
    });

    const result = await collectContributionWithDependencies(DEPLOY_INPUT, baseDeps({
      query,
      createClient: () => client,
    }));

    expect(result).toEqual({ status: 'sent' });
    expect(client.trackEvent).toHaveBeenCalledOnce();
    const call = (client.trackEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.name).toBe('azure_contribution');
    expect(call.properties).toEqual({
      skill: 'azure-functions-deploy',
      operation: 'deploy',
      result: 'success',
      resourceTypes: '["microsoft.storage/storageaccounts","microsoft.web/sites"]',
      deploymentKind: 'function-app',
      agent: 'copilot-cli',
      skillsVersion: '1.0.0',
    });
    expect(JSON.stringify(call)).not.toContain('my-env');
  });

  it('maps the agents skill to hosted-agent and accepts codex agents', async () => {
    const client = makeClient();
    const query = makeQuery([RECENT_DEPLOYMENT], {
      [ROOT]: [createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' })],
    });

    await collectContributionWithDependencies({
      skill: 'azure-functions-hosted-skills',
      operation: 'provision',
      agent: 'codex',
    }, baseDeps({ query, createClient: () => client }));

    const call = (client.trackEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.properties.deploymentKind).toBe('hosted-agent');
    expect(call.properties.agent).toBe('codex');
    expect(call.properties.skillsVersion).toBe('unknown');
  });

  it('normalizes unknown agents to unknown', async () => {
    const client = makeClient();
    const query = makeQuery([RECENT_DEPLOYMENT], {
      [ROOT]: [createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' })],
    });

    await collectContributionWithDependencies({
      skill: 'azure-functions-deploy',
      operation: 'deploy',
      agent: 'some-unlisted-agent',
    }, baseDeps({ query, createClient: () => client }));

    const call = (client.trackEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.properties.agent).toBe('unknown');
  });

  it('normalizes an out-of-shape skillsVersion to unknown', async () => {
    const client = makeClient();
    const query = makeQuery([RECENT_DEPLOYMENT], {
      [ROOT]: [createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' })],
    });

    await collectContributionWithDependencies({
      skill: 'azure-functions-deploy',
      operation: 'deploy',
      agent: 'copilot-cli',
      skillsVersion: '/etc/passwd',
    }, baseDeps({ query, createClient: () => client }));

    const call = (client.trackEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.properties.skillsVersion).toBe('unknown');
  });

  it('reports failed without throwing when delivery fails', async () => {
    const client = makeClient(({ callback }) => callback('network down'));
    const query = makeQuery([RECENT_DEPLOYMENT], {
      [ROOT]: [createOp({ targetResourceType: 'Microsoft.Web/sites', targetResourceId: '/r/1' })],
    });

    const result = await collectContributionWithDependencies(DEPLOY_INPUT, baseDeps({
      query,
      createClient: () => client,
    }));

    expect(result).toEqual({ status: 'failed', reason: 'delivery-failed' });
  });
});

describe('parseContributionEvent', () => {
  const EVENT: ContributionEvent = {
    skill: 'azure-functions-deploy',
    operation: 'deploy',
    result: 'success',
    resourceTypes: ['microsoft.web/sites'],
    deploymentKind: 'function-app',
    agent: 'copilot-cli',
    skillsVersion: 'unknown',
  };

  it('accepts a well-formed contribution event', () => {
    expect(parseContributionEvent(EVENT)).toEqual(EVENT);
  });

  it('rejects a non-success result and invalid resource types', () => {
    expect(() => parseContributionEvent({ ...EVENT, result: 'failure' })).toThrow();
    expect(() => parseContributionEvent({ ...EVENT, resourceTypes: ['/subscriptions/s'] })).toThrow();
    expect(() => parseContributionEvent({ ...EVENT, resourceTypes: [] })).toThrow();
  });

  it('rejects a skill and deploymentKind mismatch', () => {
    expect(() => parseContributionEvent({ ...EVENT, deploymentKind: 'hosted-agent' })).toThrow();
    expect(() => parseContributionEvent({
      ...EVENT,
      skill: 'azure-functions-hosted-skills',
      operation: 'provision',
      deploymentKind: 'function-app',
    })).toThrow();
  });

  it('coerces an out-of-shape skillsVersion to unknown', () => {
    expect(parseContributionEvent({ ...EVENT, skillsVersion: '/etc/passwd' }).skillsVersion).toBe('unknown');
    expect(parseContributionEvent({ ...EVENT, skillsVersion: '1.2.3' }).skillsVersion).toBe('1.2.3');
  });
});

describe('readWorkspaceTelemetryState', () => {
  function tempWorkspace(): string {
    return mkdtempSync(join(tmpdir(), 'afs-optout-'));
  }

  function writeConfig(root: string, contents: string): string {
    const dir = join(root, '.github', 'hooks');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'telemetry.config.json');
    writeFileSync(path, contents);
    return path;
  }

  it('returns active when no config files exist', () => {
    const root = tempWorkspace();
    const path = join(root, '.github', 'hooks', 'telemetry.config.json');
    expect(readWorkspaceTelemetryState([path])).toBe('active');
  });

  it('returns disabled when a config disables telemetry', () => {
    const root = tempWorkspace();
    const path = writeConfig(root, JSON.stringify({ enabled: false }));
    expect(readWorkspaceTelemetryState([path])).toBe('disabled');
  });

  it('returns active when a config enables telemetry', () => {
    const root = tempWorkspace();
    const path = writeConfig(root, JSON.stringify({ enabled: true }));
    expect(readWorkspaceTelemetryState([path])).toBe('active');
  });

  it('fails closed as unreadable when a config cannot be parsed', () => {
    const root = tempWorkspace();
    const path = writeConfig(root, '{ this is not valid json');
    expect(readWorkspaceTelemetryState([path])).toBe('unreadable');
  });
});
