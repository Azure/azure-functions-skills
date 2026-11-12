import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyDeploy } from '../src/tools/deploy/apply.js';
import { planDeploy } from '../src/tools/deploy/plan.js';
import { logFilePath, planFilePath, readPlan } from '../src/tools/deploy/plan-file.js';
import { verifyDeploy, type VerifyDependencies } from '../src/tools/deploy/verify.js';
import { EXIT } from '../src/tools/shared/output.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import { fakeRunner, result, signedIn, SUBSCRIPTION, writeProject, type FakeRunner } from './helpers/deploy-fixture.js';

const TEMP_DIRS: string[] = [];
const NOW = () => new Date('2026-11-12T00:00:00.000Z');

async function plannedProject(): Promise<{ dir: string; planId: string }> {
  const dir = createTempDir('af-deploy-apply-');
  TEMP_DIRS.push(dir);
  writeProject(dir);
  const planned = await planDeploy({ dir, env: 'dev', location: 'japaneast', set: [], codeOnly: false },
    { run: signedIn().run, now: NOW });
  return { dir, planId: planned.body.data.planId! };
}

/** Simulates azd writing the environment file when the environment is created and provisioned. */
function azd(dir: string, responses: Parameters<typeof fakeRunner>[0] = {}): FakeRunner {
  const environmentDir = join(dir, '.azure', 'dev');
  return fakeRunner({
    'azd env new': () => {
      mkdirSync(environmentDir, { recursive: true });
      writeFileSync(join(environmentDir, '.env'), `AZURE_SUBSCRIPTION_ID="${SUBSCRIPTION}"\nAZURE_LOCATION="japaneast"\n`);
      return result();
    },
    'azd provision': () => {
      appendFileSync(join(environmentDir, '.env'), 'AZURE_FUNCTION_NAME="func-api-abc123"\n');
      return result({ stdout: 'SUCCESS: Your application was provisioned in Azure.' });
    },
    ...responses,
  });
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

describe('deploy apply', () => {
  it('runs the approved steps in order and reports the function app', async () => {
    const { dir, planId } = await plannedProject();
    const runner = azd(dir);
    const applied = await applyDeploy({ dir, approve: planId, preview: false }, { run: runner.run });

    expect(applied.exitCode).toBe(EXIT.ok);
    expect(runner.calls).toEqual([
      `azd env new dev --subscription ${SUBSCRIPTION} --location japaneast --no-prompt`,
      'azd env set VNET_ENABLED false -e dev --no-prompt',
      'azd provision -e dev --no-prompt',
      'azd deploy -e dev --no-prompt',
    ]);
    expect(applied.body.data).toMatchObject({
      planId,
      environment: 'dev',
      completed: ['env-new', 'env-set:VNET_ENABLED', 'provision', 'deploy'],
      functionApp: 'func-api-abc123',
      telemetry: { operation: 'deploy', environmentName: 'dev' },
    });
    expect(applied.body.next?.command).toContain('deploy verify');
  });

  it.each([
    ['a different plan id', 'ffffffffffffffff', 'DEPLOY-PLAN-NOT-APPROVED'],
    ['an empty approval', '', 'DEPLOY-PLAN-NOT-APPROVED'],
  ])('runs nothing with %s', async (_name, approve, findingId) => {
    const { dir } = await plannedProject();
    const runner = azd(dir);
    const applied = await applyDeploy({ dir, approve, preview: false }, { run: runner.run });
    expect(applied.exitCode).toBe(EXIT.blocked);
    expect(applied.body.findings.map(finding => finding.id)).toEqual([findingId]);
    expect(runner.calls).toEqual([]);
  });

  it('runs nothing when no plan exists', async () => {
    const dir = createTempDir('af-deploy-apply-');
    TEMP_DIRS.push(dir);
    const runner = azd(dir);
    const applied = await applyDeploy({ dir, approve: 'abc', preview: false }, { run: runner.run });
    expect(applied.body.findings.map(finding => finding.id)).toEqual(['DEPLOY-PLAN-MISSING']);
    expect(runner.calls).toEqual([]);
  });

  it('runs nothing when the plan file was edited after approval', async () => {
    const { dir, planId } = await plannedProject();
    const path = planFilePath(dir);
    writeFileSync(path, readFileSync(path, 'utf-8').replace('japaneast', 'eastus'));
    const runner = azd(dir);
    const applied = await applyDeploy({ dir, approve: planId, preview: false }, { run: runner.run });
    expect(applied.body.findings.map(finding => finding.id)).toEqual(['DEPLOY-PLAN-MISSING']);
    expect(runner.calls).toEqual([]);
  });

  it('runs nothing when the infrastructure changed after planning', async () => {
    const { dir, planId } = await plannedProject();
    appendFileSync(join(dir, 'infra', 'main.bicep'), '\nparam extra string = \'\'\n');
    const runner = azd(dir);
    const applied = await applyDeploy({ dir, approve: planId, preview: false }, { run: runner.run });
    expect(applied.exitCode).toBe(EXIT.blocked);
    expect(applied.body.findings.map(finding => finding.id)).toEqual(['DEPLOY-PLAN-STALE']);
    expect(runner.calls).toEqual([]);
  });

  it('stops at the failed step, redacts the output, and resumes without repeating finished steps', async () => {
    const { dir, planId } = await plannedProject();
    const failing = azd(dir, {
      'azd provision': result({ code: 1, stderr: 'ERROR: deployment failed: AccountKey=abc123== quota exceeded' }),
    });
    const failed = await applyDeploy({ dir, approve: planId, preview: false }, { run: failing.run });

    expect(failed.exitCode).toBe(EXIT.stepFailed);
    expect(failed.body.data).toMatchObject({ completed: ['env-new', 'env-set:VNET_ENABLED'], failedStep: 'provision' });
    expect(failing.calls).not.toContain('azd deploy -e dev --no-prompt');
    expect(JSON.stringify(failed.body)).not.toContain('abc123');
    expect(readFileSync(logFilePath(dir), 'utf-8')).not.toContain('abc123');
    expect(failed.body.findings[0]).toMatchObject({ id: 'DEPLOY-STEP-FAILED', severity: 'error' });

    const retry = azd(dir);
    const resumed = await applyDeploy({ dir, approve: planId, preview: false }, { run: retry.run });
    expect(resumed.exitCode).toBe(EXIT.ok);
    expect(retry.calls).toEqual(['azd provision -e dev --no-prompt', 'azd deploy -e dev --no-prompt']);
  });

  it('reports a timeout as a failed step', async () => {
    const { dir, planId } = await plannedProject();
    const runner = azd(dir, { 'azd provision': result({ code: null, timedOut: true }) });
    const applied = await applyDeploy({ dir, approve: planId, preview: false }, { run: runner.run });
    expect(applied.exitCode).toBe(EXIT.stepFailed);
    expect(applied.body.findings[0].title).toMatch(/timed out/i);
  });

  it('names the sign-in fix when azd reports an authentication failure', async () => {
    const { dir, planId } = await plannedProject();
    const runner = azd(dir, { 'azd provision': result({ code: 1, stderr: 'ERROR: not logged in, run `azd auth login` to login' }) });
    const applied = await applyDeploy({ dir, approve: planId, preview: false }, { run: runner.run });
    expect(applied.body.findings[0].fix).toBe('azd auth login');
  });

  it('previews the infrastructure change without provisioning or deploying', async () => {
    const { dir, planId } = await plannedProject();
    const runner = azd(dir, { 'azd provision -e dev --no-prompt --preview': result({ stdout: 'Resources:\n  Create : Function App' }) });
    const preview = await applyDeploy({ dir, approve: planId, preview: true }, { run: runner.run });

    expect(preview.exitCode).toBe(EXIT.ok);
    expect(runner.calls.slice(-1)).toEqual(['azd provision -e dev --no-prompt --preview']);
    expect(runner.calls).not.toContain('azd deploy -e dev --no-prompt');
    expect(preview.body.data.preview).toContain('Create : Function App');
    expect(preview.body.data.completed).toEqual(['env-new', 'env-set:VNET_ENABLED']);
  });

  it('refuses a plan step that does not belong to the deployment sequence', async () => {
    const { dir } = await plannedProject();
    const path = planFilePath(dir);
    const { planId: _old, ...content } = readPlan(path)!;
    const { writePlan } = await import('../src/tools/deploy/plan-file.js');
    const tampered = writePlan(dir, {
      ...content, steps: [{ id: 'deploy', args: ['down', '--force', '--purge'], changes: 'application-code', timeoutSeconds: 60 }],
    });
    const runner = azd(dir);
    const applied = await applyDeploy({ dir, approve: tampered.planId, preview: false }, { run: runner.run });
    expect(applied.exitCode).toBe(EXIT.blocked);
    expect(applied.body.findings.map(finding => finding.id)).toEqual(['DEPLOY-PLAN-INVALID']);
    expect(runner.calls).toEqual([]);
  });
});

describe('deploy verify', () => {
  const RESOURCE = JSON.stringify([{ name: 'func-api-abc123', resourceGroup: 'rg-dev', type: 'Microsoft.Web/sites' }]);
  const APP = JSON.stringify({ state: 'Running', defaultHostName: 'func-api-abc123.azurewebsites.net' });
  const FUNCTIONS = JSON.stringify([
    {
      name: 'func-api-abc123/httpget',
      invokeUrlTemplate: 'https://func-api-abc123.azurewebsites.net/api/httpget',
      config: { bindings: [{ type: 'httpTrigger', authLevel: 'anonymous', methods: ['get'] }] },
    },
    {
      name: 'func-api-abc123/secure',
      invokeUrlTemplate: 'https://func-api-abc123.azurewebsites.net/api/secure',
      config: { bindings: [{ type: 'httpTrigger', authLevel: 'function', methods: ['post'] }] },
    },
    { name: 'func-api-abc123/nightly', config: { bindings: [{ type: 'timerTrigger' }] } },
  ]);

  function deployed(): string {
    const dir = createTempDir('af-deploy-verify-');
    TEMP_DIRS.push(dir);
    writeProject(dir, {
      environment: {
        name: 'dev',
        values: { AZURE_SUBSCRIPTION_ID: SUBSCRIPTION, AZURE_LOCATION: 'japaneast', AZURE_FUNCTION_NAME: 'func-api-abc123' },
      },
    });
    return dir;
  }

  function dependencies(runner: FakeRunner, status = 200): VerifyDependencies & { urls: string[]; sleeps: number[] } {
    const urls: string[] = [];
    const sleeps: number[] = [];
    return {
      run: runner.run,
      urls,
      sleeps,
      fetchStatus: async url => { urls.push(url); return status; },
      sleep: async milliseconds => { sleeps.push(milliseconds); },
    };
  }

  const azure = (functions = FUNCTIONS) => fakeRunner({
    'az resource list': result({ stdout: RESOURCE }),
    'az functionapp show': result({ stdout: APP }),
    'az functionapp function list': result({ stdout: functions }),
  });

  it('lists the functions and sends one GET to each anonymous HTTP trigger', async () => {
    const deps = dependencies(azure());
    const verified = await verifyDeploy({ dir: deployed() }, deps);

    expect(verified.exitCode).toBe(EXIT.ok);
    expect(verified.body.ok).toBe(true);
    expect(deps.urls).toEqual(['https://func-api-abc123.azurewebsites.net/api/httpget']);
    expect(verified.body.data).toMatchObject({
      functionApp: 'func-api-abc123',
      resourceGroup: 'rg-dev',
      state: 'Running',
      functions: [
        { name: 'httpget', trigger: 'httpTrigger', authLevel: 'anonymous' },
        { name: 'secure', trigger: 'httpTrigger', authLevel: 'function' },
        { name: 'nightly', trigger: 'timerTrigger' },
      ],
      http: [{ function: 'httpget', status: 200, reachable: true }],
    });
    expect(verified.body.gaps.map(gap => gap.check)).toEqual(['http:secure']);
    expect(JSON.stringify(verified.body)).not.toMatch(/[?&]code=/);
  });

  it('waits for the function list and reports an app with no functions', async () => {
    const deps = dependencies(azure('[]'));
    const verified = await verifyDeploy({ dir: deployed() }, deps);
    expect(verified.body.ok).toBe(false);
    expect(verified.body.findings.map(finding => finding.id)).toEqual(['VERIFY-NO-FUNCTIONS']);
    expect(deps.sleeps).toHaveLength(5);
  });

  it('reports a failing HTTP trigger', async () => {
    const verified = await verifyDeploy({ dir: deployed() }, dependencies(azure(), 503));
    expect(verified.body.ok).toBe(false);
    expect(verified.body.findings.map(finding => finding.id)).toEqual(['VERIFY-HTTP-FAILED']);
  });

  it('is blocked when the Azure CLI is missing', async () => {
    const runner = fakeRunner({ 'az resource list': result({ code: null, notFound: true }) });
    const verified = await verifyDeploy({ dir: deployed() }, dependencies(runner));
    expect(verified.exitCode).toBe(EXIT.blocked);
    expect(verified.body.findings.map(finding => finding.id)).toEqual(['VERIFY-AZ-MISSING']);
  });

  it('is blocked when the environment has no function app name', async () => {
    const dir = createTempDir('af-deploy-verify-');
    TEMP_DIRS.push(dir);
    writeProject(dir, { environment: { name: 'dev', values: { AZURE_SUBSCRIPTION_ID: SUBSCRIPTION } } });
    const verified = await verifyDeploy({ dir }, dependencies(azure()));
    expect(verified.exitCode).toBe(EXIT.blocked);
    expect(verified.body.findings.map(finding => finding.id)).toEqual(['VERIFY-APP-UNKNOWN']);
  });
});
