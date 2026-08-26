import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const packageName = '@azure/functions-skills';
const publishTag = process.env.NPM_PUBLISH_TAG || 'latest';
const appId = requiredEnvironment('APPLICATIONINSIGHTS_APP_ID');
const apiKey = requiredEnvironment('APPLICATIONINSIGHTS_API_KEY');
const workDir = mkdtempSync(join(tmpdir(), 'azure-functions-skills-canary-'));

try {
  const expectedVersion = expectedPackageVersion();
  const version = await waitForPublishedVersion(expectedVersion);

  const packOutput = execFileSync(
    npmCommand(),
    ['pack', `${packageName}@${version}`, '--json', '--ignore-scripts', '--registry', 'https://registry.npmjs.org'],
    { encoding: 'utf-8', cwd: workDir },
  );
  const packResult = JSON.parse(packOutput);
  if (!Array.isArray(packResult) || typeof packResult[0]?.filename !== 'string') {
    throw new Error('npm pack did not return a published tarball.');
  }
  const tarball = join(workDir, packResult[0].filename);

  const diagnostic = spawnSync(
    npmCommand(),
    ['exec', '--silent', '--yes', '--package', tarball, '--', 'azure-functions-skills', 'telemetry', 'doctor', '--json'],
    {
      cwd: workDir,
      encoding: 'utf-8',
      env: {
        ...canaryChildEnvironment(),
        AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG: 'false',
      },
      timeout: 30_000,
    },
  );
  if (diagnostic.status !== 0) {
    throw new Error(`Published package telemetry diagnostic exited ${diagnostic.status ?? 'without a status'}.`);
  }
  const report = JSON.parse(diagnostic.stdout);
  if (report.ingestionAccepted !== true || typeof report.correlationId !== 'string') {
    throw new Error('Published package did not report accepted telemetry ingestion.');
  }

  await waitForIngestion(appId, apiKey, report.correlationId);
  console.log(`Telemetry canary accepted for ${packageName}@${version} (${report.correlationId}).`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

async function waitForIngestion(appId, apiKey, correlationId) {
  const deadline = Date.now() + 5 * 60_000;
  const query = [
    'customEvents',
    "| where name == 'AzureFunctionsSkillsPluginExecuted'",
    `| where tostring(customDimensions.Plugin_CorrelationId) == '${correlationId}'`,
    '| take 1',
  ].join('\n');
  const endpoint = new URL(`https://api.applicationinsights.io/v1/apps/${encodeURIComponent(appId)}/query`);
  endpoint.searchParams.set('query', query);

  while (Date.now() < deadline) {
    const response = await globalThis.fetch(endpoint, {
      headers: { 'x-api-key': apiKey },
      signal: globalThis.AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Application Insights query failed with HTTP ${response.status}.`);
    }

    const body = await response.json();
    if (hasQueryRow(body)) return;
    await delay(10_000);
  }
  throw new Error('Telemetry canary was not queryable within 5 minutes.');
}

async function waitForPublishedVersion(expectedVersion) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    try {
      const visibleVersion = execFileSync(
        npmCommand(),
        ['view', `${packageName}@${publishTag}`, 'version', '--registry', 'https://registry.npmjs.org'],
        { encoding: 'utf-8', cwd: workDir },
      ).trim();
      if (visibleVersion === expectedVersion) return visibleVersion;
    } catch {
      // Registry propagation can briefly return a missing tag or package.
    }
    await delay(10_000);
  }
  throw new Error(`${packageName}@${expectedVersion} was not visible on the ${publishTag} tag within 5 minutes.`);
}

function hasQueryRow(value) {
  return typeof value === 'object'
    && value !== null
    && Array.isArray(value.tables)
    && value.tables.some(table => typeof table === 'object'
      && table !== null
      && Array.isArray(table.rows)
      && table.rows.length > 0);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value || value.startsWith('$(')) {
    throw new Error(`${name} must be configured for the telemetry canary.`);
  }

  return value;
}

function expectedPackageVersion() {
  const configured = process.env.EXPECTED_PACKAGE_VERSION;
  if (configured) return configured;
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
  );
  if (typeof packageJson.version !== 'string'
    || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(packageJson.version)) {
    throw new Error('package.json contains an invalid expected package version.');
  }
  return packageJson.version;
}

function canaryChildEnvironment() {
  const environment = { ...process.env };
  delete environment.APPLICATIONINSIGHTS_APP_ID;
  delete environment.APPLICATIONINSIGHTS_API_KEY;
  return environment;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
