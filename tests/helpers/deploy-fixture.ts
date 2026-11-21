import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunResult, Runner } from '../../src/tools/shared/exec.js';

export const SUBSCRIPTION = '00000000-0000-0000-0000-000000000001';

export interface ProjectOptions {
  readonly azureYaml?: string | null;
  readonly bicep?: string | null;
  readonly parameters?: string | null;
  readonly hostJson?: boolean;
  readonly environment?: { name: string; values: Record<string, string> };
}

const AZURE_YAML = `# yaml-language-server: $schema=https://example.invalid/azure.yaml.json

name: sample-app
metadata:
  template: functions-quickstart-typescript-azd@1.0.1
services:
  api:
    project: .
    language: ts
    host: function
    remoteBuild: true
`;

const BICEP = `targetScope = 'subscription'

@minLength(1)
param environmentName string

@minLength(1)
@allowed([
  'eastus'
  'japaneast'
])
@metadata({
  azd: {
    type: 'location'
  }
})
param location string
param vnetEnabled bool
param apiServiceName string = ''
param principalId string = deployer().objectId
`;

const PARAMETERS = JSON.stringify({
  parameters: {
    environmentName: { value: '${AZURE_ENV_NAME}' },
    location: { value: '${AZURE_LOCATION}' },
    principalId: { value: '${AZURE_PRINCIPAL_ID}' },
    vnetEnabled: { value: '${VNET_ENABLED}' },
  },
});

/** Writes an azd Functions project shaped like the official quickstart templates. */
export function writeProject(dir: string, options: ProjectOptions = {}): void {
  mkdirSync(join(dir, 'infra'), { recursive: true });
  if (options.hostJson !== false) writeFileSync(join(dir, 'host.json'), '{"version":"2.0"}');
  if (options.azureYaml !== null) writeFileSync(join(dir, 'azure.yaml'), options.azureYaml ?? AZURE_YAML);
  if (options.bicep !== null) writeFileSync(join(dir, 'infra', 'main.bicep'), options.bicep ?? BICEP);
  if (options.parameters !== null) {
    writeFileSync(join(dir, 'infra', 'main.parameters.json'), options.parameters ?? PARAMETERS);
  }
  if (options.environment) {
    const environmentDir = join(dir, '.azure', options.environment.name);
    mkdirSync(environmentDir, { recursive: true });
    writeFileSync(join(dir, '.azure', 'config.json'),
      JSON.stringify({ version: 1, defaultEnvironment: options.environment.name }));
    writeFileSync(join(environmentDir, '.env'), Object.entries(options.environment.values)
      .map(([key, value]) => `${key}="${value}"`).join('\n'));
  }
}

export interface FakeRunner {
  readonly run: Runner;
  readonly calls: string[];
}

const OK: RunResult = { code: 0, stdout: '', stderr: '', notFound: false, timedOut: false };

export function result(overrides: Partial<RunResult> = {}): RunResult {
  return { ...OK, ...overrides };
}

/**
 * Answers a command by the longest matching prefix of `command arg arg ...`.
 * Unmatched commands succeed with empty output.
 */
export function fakeRunner(responses: Record<string, RunResult | (() => RunResult)> = {}): FakeRunner {
  const calls: string[] = [];
  const prefixes = Object.keys(responses).sort((a, b) => b.length - a.length);
  return {
    calls,
    run: async (command, args) => {
      const line = [command, ...args].join(' ');
      calls.push(line);
      const prefix = prefixes.find(candidate => line === candidate || line.startsWith(`${candidate} `));
      if (!prefix) return OK;
      const response = responses[prefix];
      return typeof response === 'function' ? response() : response;
    },
  };
}

/** A signed-in machine with `azd` and `az` available. */
export function signedIn(extra: Record<string, RunResult | (() => RunResult)> = {}): FakeRunner {
  return fakeRunner({
    'azd version': result({ stdout: 'azd version 1.20.0 (commit abc)' }),
    'azd auth login --check-status': result({ stdout: 'Logged in to Azure.' }),
    'azd config get defaults.subscription': result({ code: 1, stderr: 'no value' }),
    'azd config get defaults.location': result({ code: 1, stderr: 'no value' }),
    'az account show': result({ stdout: JSON.stringify({ id: SUBSCRIPTION, name: 'Dev Subscription' }) }),
    ...extra,
  });
}
