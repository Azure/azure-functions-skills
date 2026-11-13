import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planDeploy, type PlanOptions } from '../src/tools/deploy/plan.js';
import { inspectProject } from '../src/tools/deploy/project.js';
import { planFilePath, readPlan } from '../src/tools/deploy/plan-file.js';
import { EXIT } from '../src/tools/shared/output.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import { fakeRunner, result, signedIn, SUBSCRIPTION, writeProject } from './helpers/deploy-fixture.js';

const TEMP_DIRS: string[] = [];
const NOW = () => new Date('2026-11-12T00:00:00.000Z');

function project(options: Parameters<typeof writeProject>[1] = {}): string {
  const dir = createTempDir('af-deploy-plan-');
  TEMP_DIRS.push(dir);
  writeProject(dir, options);
  return dir;
}

function options(dir: string, overrides: Partial<PlanOptions> = {}): PlanOptions {
  return { dir, env: 'dev', location: 'japaneast', set: [], codeOnly: false, ...overrides };
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('project inspection', () => {
  it('reads the azd service, template, allowed locations, and infrastructure inputs', () => {
    const inspected = inspectProject(project());
    expect(inspected.azureYaml).toEqual({
      name: 'sample-app',
      template: 'functions-quickstart-typescript-azd@1.0.1',
      services: [{ name: 'api', project: '.', host: 'function', language: 'ts' }],
    });
    expect(inspected.infra.kind).toBe('bicep');
    expect(inspected.infra.allowedLocations).toEqual(['eastus', 'japaneast']);
    expect(inspected.infra.inputs).toEqual([
      { variable: 'AZURE_ENV_NAME', parameter: 'environmentName', hasDefault: false },
      { variable: 'AZURE_LOCATION', parameter: 'location', hasDefault: false },
      { variable: 'AZURE_PRINCIPAL_ID', parameter: 'principalId', hasDefault: true },
      { variable: 'VNET_ENABLED', parameter: 'vnetEnabled', hasDefault: false },
    ]);
    expect(inspected.hasHostJson).toBe(true);
    expect(inspected.environments).toEqual({ defaultName: null, names: [] });
  });

  it('changes the fingerprint when infrastructure changes', () => {
    const dir = project();
    const before = inspectProject(dir).fingerprint;
    writeFileSync(join(dir, 'infra', 'main.bicep'), 'param location string\n');
    expect(inspectProject(dir).fingerprint).not.toBe(before);
  });
});

describe('deploy plan', () => {
  it('writes an approvable plan for a new environment', async () => {
    const dir = project();
    const runner = signedIn();
    const planned = await planDeploy(options(dir), { run: runner.run, now: NOW });

    expect(planned.exitCode).toBe(EXIT.ok);
    expect(planned.body.ok).toBe(true);
    const plan = readPlan(planFilePath(dir));
    expect(plan).not.toBeNull();
    expect(planned.body.data.planId).toBe(plan!.planId);
    expect(plan!.steps.map(step => [step.id, step.args.join(' ')])).toEqual([
      ['env-new', `env new dev --subscription ${SUBSCRIPTION} --location japaneast --no-prompt`],
      ['env-set:VNET_ENABLED', 'env set VNET_ENABLED false -e dev --no-prompt'],
      ['provision', 'provision -e dev --no-prompt'],
      ['deploy', 'deploy -e dev --no-prompt'],
    ]);
    expect(planned.body.data.values).toEqual([{ name: 'VNET_ENABLED', value: 'false', source: 'default' }]);
    expect(planned.body.next?.command).toContain(`--approve ${plan!.planId}`);
    // Planning must not change Azure or the azd environment.
    expect(runner.calls.some(call => /^azd (env new|env set|provision|deploy|up)\b/.test(call))).toBe(false);
    expect(existsSync(join(dir, '.azure-functions-skills', '.gitignore'))).toBe(true);
  });

  it('reuses an existing environment and skips values that are already set', async () => {
    const dir = project({
      environment: {
        name: 'dev',
        values: { AZURE_SUBSCRIPTION_ID: SUBSCRIPTION, AZURE_LOCATION: 'eastus', VNET_ENABLED: 'true' },
      },
    });
    const planned = await planDeploy(options(dir, { env: undefined, location: undefined }),
      { run: signedIn().run, now: NOW });

    expect(planned.exitCode).toBe(EXIT.ok);
    expect(readPlan(planFilePath(dir))!.steps.map(step => step.id)).toEqual(['provision', 'deploy']);
    expect(planned.body.data.location).toBe('eastus');
  });

  it('plans only the code deployment when asked', async () => {
    const dir = project({
      environment: { name: 'dev', values: { AZURE_SUBSCRIPTION_ID: SUBSCRIPTION, AZURE_LOCATION: 'eastus' } },
    });
    const planned = await planDeploy(options(dir, { codeOnly: true, location: undefined }),
      { run: signedIn().run, now: NOW });
    expect(readPlan(planFilePath(dir))!.steps.map(step => step.id)).toEqual(['deploy']);
    expect(planned.body.data.mode).toBe('code-only');
  });

  it('lists the inputs it could not resolve and writes no plan', async () => {
    const dir = project({
      bicep: 'param location string\nparam sku string\n',
      parameters: JSON.stringify({ parameters: { location: { value: '${AZURE_LOCATION}' }, sku: { value: '${APP_SKU}' } } }),
    });
    const runner = fakeRunner({
      'azd version': result({ stdout: 'azd version 1.20.0' }),
      'azd config get': result({ code: 1 }),
      'az account show': result({ code: 1, stderr: 'Please run az login' }),
    });
    const planned = await planDeploy(options(dir, { env: undefined, location: undefined }), { run: runner.run, now: NOW });

    expect(planned.exitCode).toBe(EXIT.blocked);
    expect(planned.body.data.inputsNeeded?.map(input => input.option)).toEqual([
      '--env', '--subscription', '--location', '--set APP_SKU=<value>',
    ]);
    expect(existsSync(planFilePath(dir))).toBe(false);
  });

  it('rejects a location that the template does not allow', async () => {
    const planned = await planDeploy(options(project(), { location: 'mars' }), { run: signedIn().run, now: NOW });
    expect(planned.exitCode).toBe(EXIT.blocked);
    expect(planned.body.findings.map(finding => finding.id)).toContain('DEPLOY-LOCATION-NOT-ALLOWED');
  });

  it('refuses to move an existing environment to another subscription or location', async () => {
    const dir = project({
      environment: { name: 'dev', values: { AZURE_SUBSCRIPTION_ID: SUBSCRIPTION, AZURE_LOCATION: 'eastus' } },
    });
    const planned = await planDeploy(options(dir, { location: 'japaneast', subscription: 'other-subscription' }),
      { run: signedIn().run, now: NOW });
    expect(planned.exitCode).toBe(EXIT.blocked);
    expect(planned.body.findings.map(finding => finding.id)).toEqual([
      'DEPLOY-ENV-SUBSCRIPTION-MISMATCH', 'DEPLOY-ENV-LOCATION-MISMATCH',
    ]);
  });

  it.each([
    ['a project without azd files', { azureYaml: null }, 'DEPLOY-NO-AZD-PROJECT'],
    ['a project without host.json', { hostJson: false }, 'DEPLOY-NOT-FUNCTIONS-PROJECT'],
    ['a project without Bicep', { bicep: null }, 'DEPLOY-NO-AZD-PROJECT'],
    ['a service that is not a function app',
      { azureYaml: 'name: web\nservices:\n  web:\n    project: .\n    host: appservice\n' }, 'DEPLOY-NO-FUNCTION-SERVICE'],
  ] as const)('blocks %s', async (_name, projectOptions, findingId) => {
    const runner = signedIn();
    const planned = await planDeploy(options(project(projectOptions)), { run: runner.run, now: NOW });
    expect(planned.exitCode).toBe(EXIT.blocked);
    expect(planned.body.findings.map(finding => finding.id)).toContain(findingId);
    expect(runner.calls).toEqual([]);
  });

  it('hands Hosted Skills apps to their own skill', async () => {
    const dir = project();
    writeFileSync(join(dir, 'agents.config.yaml'), 'agents: []\n');
    const planned = await planDeploy(options(dir), { run: signedIn().run, now: NOW });
    expect(planned.exitCode).toBe(EXIT.blocked);
    expect(planned.body.next?.action).toBe('azure-functions-hosted-skills');
  });

  it.each([
    ['azd is missing', { 'azd version': result({ code: null, notFound: true }) }, 'DEPLOY-AZD-MISSING'],
    ['azd is signed out', { 'azd auth login --check-status': result({ code: 1, stderr: 'Not logged in' }) }, 'DEPLOY-AZD-LOGIN'],
  ])('blocks when %s', async (_name, responses, findingId) => {
    const planned = await planDeploy(options(project()), { run: signedIn(responses).run, now: NOW });
    expect(planned.exitCode).toBe(EXIT.blocked);
    expect(planned.body.findings.map(finding => finding.id)).toContain(findingId);
  });

  it('masks credential-like values in the output but keeps them in the plan', async () => {
    const dir = project();
    const planned = await planDeploy(options(dir, { set: ['VNET_ENABLED=true', 'API_SECRET=hunter2'] }),
      { run: signedIn().run, now: NOW });
    expect(JSON.stringify(planned.body)).not.toContain('hunter2');
    expect(planned.body.data.values).toContainEqual({ name: 'API_SECRET', value: '***', source: 'option' });
    expect(readFileSync(planFilePath(dir), 'utf-8')).toContain('hunter2');
    expect(planned.body.findings.map(finding => finding.id)).toContain('DEPLOY-VALUE-NOT-USED');
  });

  it.each([['lowercase=1'], ['NOVALUE'], ['A B=1']])('rejects the malformed value %j', async value => {
    await expect(planDeploy(options(project(), { set: [value] }), { run: signedIn().run, now: NOW }))
      .rejects.toThrow(/--set/);
  });
});
