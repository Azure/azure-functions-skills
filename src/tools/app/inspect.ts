import type { Finding } from './output.js';

export type HostingPlan = 'FlexConsumption' | 'Consumption' | 'Premium' | 'Dedicated' | 'ContainerApps';

export interface Site {
  id: string;
  name: string;
  location: string;
  kind?: string;
  identity?: { type?: string; principalId?: string; userAssignedIdentities?: Record<string, { principalId?: string; clientId?: string }> };
  properties: {
    state?: string;
    defaultHostName?: string;
    httpsOnly?: boolean;
    serverFarmId?: string;
    managedEnvironmentId?: string | null;
    publicNetworkAccess?: string | null;
    virtualNetworkSubnetId?: string | null;
    hostNameSslStates?: { name: string; hostType?: string }[];
    slotSwapStatus?: { timestampUtc?: string; sourceSlotName?: string; destinationSlotName?: string } | null;
    functionAppConfig?: {
      runtime?: { name?: string; version?: string };
      scaleAndConcurrency?: { maximumInstanceCount?: number; instanceMemoryMB?: number; alwaysReady?: { name: string; instanceCount: number }[] };
      deployment?: { storage?: { type?: string; value?: string; authentication?: { type?: string } } };
    } | null;
    sku?: string;
  };
}

export interface SiteConfig {
  properties: {
    linuxFxVersion?: string;
    netFrameworkVersion?: string;
    powerShellVersion?: string;
    javaVersion?: string | null;
    minTlsVersion?: string;
    ftpsState?: string;
    http20Enabled?: boolean;
    alwaysOn?: boolean;
    healthCheckPath?: string | null;
    cors?: { allowedOrigins?: string[] | null; supportCredentials?: boolean } | null;
    functionAppScaleLimit?: number | null;
    minimumElasticInstanceCount?: number | null;
    vnetRouteAllEnabled?: boolean;
  };
}

export interface Plan {
  name: string;
  sku?: { name?: string; tier?: string; capacity?: number };
  properties?: { maximumElasticWorkerCount?: number };
}

export function detectPlan(site: Site, plan?: Plan): HostingPlan {
  if (site.properties.managedEnvironmentId) return 'ContainerApps';
  if (site.properties.functionAppConfig || plan?.sku?.name === 'FC1' || plan?.sku?.tier === 'FlexConsumption') return 'FlexConsumption';
  if (plan?.sku?.tier === 'Dynamic' || plan?.sku?.name === 'Y1') return 'Consumption';
  if (plan?.sku?.tier === 'ElasticPremium') return 'Premium';
  return 'Dedicated';
}

export function scmHost(site: Site): string | undefined {
  return site.properties.hostNameSslStates?.find(state => state.hostType === 'Repository')?.name;
}

function runtimeOf(site: Site, config: SiteConfig, settings: Record<string, string>): { stack?: string; version?: string } {
  const flex = site.properties.functionAppConfig?.runtime;
  if (flex?.name) return { stack: flex.name, version: flex.version };
  const fx = config.properties.linuxFxVersion;
  if (fx && fx.includes('|')) {
    const [stack, version] = fx.split('|');
    return { stack: stack.toLowerCase(), version };
  }
  const stack = settings.FUNCTIONS_WORKER_RUNTIME;
  if (stack === 'powershell') return { stack, version: config.properties.powerShellVersion };
  if (stack === 'node') return { stack, version: settings.WEBSITE_NODE_DEFAULT_VERSION };
  if (stack === 'java') return { stack, version: config.properties.javaVersion ?? undefined };
  return { stack, version: stack?.startsWith('dotnet') ? config.properties.netFrameworkVersion : undefined };
}

function storageMode(settings: Record<string, string>): 'identity' | 'connectionString' | 'missing' {
  if (settings.AzureWebJobsStorage__accountName || settings.AzureWebJobsStorage__blobServiceUri) return 'identity';
  if (settings.AzureWebJobsStorage) return 'connectionString';
  return 'missing';
}

/** Builds the `app inspect` summary from ARM documents. Settings are only used for well-known non-secret checks. */
export function summarizeApp(site: Site, config: SiteConfig, plan: Plan | undefined, settings: Record<string, string>): { data: Record<string, unknown>; findings: Finding[] } {
  const hostingPlan = detectPlan(site, plan);
  const runtime = runtimeOf(site, config, settings);
  const storage = storageMode(settings);
  const appInsights = Boolean(settings.APPLICATIONINSIGHTS_CONNECTION_STRING || settings.APPINSIGHTS_INSTRUMENTATIONKEY);
  const findings: Finding[] = [];
  const p = site.properties;
  const c = config.properties;

  if (p.state && p.state !== 'Running') findings.push({ severity: 'warning', code: 'AppNotRunning', message: `The app state is ${p.state}.`, fix: 'Start the app if it should serve traffic.' });
  if (p.httpsOnly === false) findings.push({ severity: 'warning', code: 'HttpsNotEnforced', message: 'HTTPS Only is off.', fix: 'Set httpsOnly to true (R1).' });
  if (c.minTlsVersion && c.minTlsVersion < '1.2') findings.push({ severity: 'warning', code: 'WeakTls', message: `Minimum TLS version is ${c.minTlsVersion}.`, fix: 'Set minTlsVersion to 1.2 (R1).' });
  if (c.ftpsState === 'AllAllowed') findings.push({ severity: 'warning', code: 'FtpAllowed', message: 'Plain FTP is allowed.', fix: 'Set ftpsState to Disabled or FtpsOnly (R1).' });
  if (!appInsights) findings.push({ severity: 'warning', code: 'NoAppInsights', message: 'Application Insights is not configured, so `logs query` has no data.', fix: 'Add APPLICATIONINSIGHTS_CONNECTION_STRING (R1).' });
  if (storage === 'missing') findings.push({ severity: 'error', code: 'NoHostStorage', message: 'AzureWebJobsStorage is not configured; the host cannot start.', fix: 'Configure AzureWebJobsStorage or AzureWebJobsStorage__accountName with a managed identity.' });
  if (storage === 'connectionString') findings.push({ severity: 'info', code: 'StorageKeyAuth', message: 'Host storage uses a connection string (shared key).', fix: 'Prefer identity-based AzureWebJobsStorage__accountName with a managed identity.' });
  const extension = settings.FUNCTIONS_EXTENSION_VERSION;
  if (extension && /^~[123]$/.test(extension)) findings.push({ severity: 'error', code: 'UnsupportedHostVersion', message: `FUNCTIONS_EXTENSION_VERSION is ${extension}, which is out of support.`, fix: 'Migrate to ~4.' });
  if (hostingPlan === 'FlexConsumption') {
    for (const name of ['FUNCTIONS_WORKER_RUNTIME', 'FUNCTIONS_EXTENSION_VERSION', 'WEBSITE_RUN_FROM_PACKAGE', 'WEBSITE_CONTENTSHARE', 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING']) {
      if (name in settings) findings.push({ severity: 'warning', code: 'FlexUnsupportedSetting', message: `${name} is not used on Flex Consumption and can break deployments.`, fix: `Remove ${name} (R1).` });
    }
  }

  const identity = site.identity?.type && site.identity.type !== 'None'
    ? {
        type: site.identity.type,
        systemAssignedPrincipalId: site.identity.principalId,
        userAssigned: Object.entries(site.identity.userAssignedIdentities ?? {}).map(([id, value]) => ({ id, clientId: value.clientId, principalId: value.principalId })),
      }
    : undefined;

  const flex = p.functionAppConfig;
  const data: Record<string, unknown> = {
    name: site.name,
    id: site.id,
    location: site.location,
    kind: site.kind,
    state: p.state,
    defaultHostName: p.defaultHostName,
    scmHost: scmHost(site),
    hostingPlan,
    plan: plan ? { name: plan.name, sku: plan.sku?.name, tier: plan.sku?.tier, maximumElasticWorkerCount: hostingPlan === 'Premium' ? plan.properties?.maximumElasticWorkerCount : undefined } : undefined,
    runtime,
    functionsExtensionVersion: extension,
    scale: flex?.scaleAndConcurrency
      ? { maximumInstanceCount: flex.scaleAndConcurrency.maximumInstanceCount, instanceMemoryMB: flex.scaleAndConcurrency.instanceMemoryMB, alwaysReady: flex.scaleAndConcurrency.alwaysReady ?? [] }
      : { functionAppScaleLimit: c.functionAppScaleLimit ?? undefined, minimumElasticInstanceCount: c.minimumElasticInstanceCount ?? undefined, alwaysOn: c.alwaysOn },
    deploymentStorage: flex?.deployment?.storage ? { type: flex.deployment.storage.type, container: flex.deployment.storage.value, authentication: flex.deployment.storage.authentication?.type } : undefined,
    hostStorage: storage,
    appInsights,
    identity,
    security: { httpsOnly: p.httpsOnly, minTlsVersion: c.minTlsVersion, ftpsState: c.ftpsState, http20Enabled: c.http20Enabled },
    network: { publicNetworkAccess: p.publicNetworkAccess ?? 'Enabled', virtualNetworkSubnetId: p.virtualNetworkSubnetId ?? undefined, vnetRouteAllEnabled: c.vnetRouteAllEnabled },
    cors: c.cors?.allowedOrigins?.length ? { allowedOrigins: c.cors.allowedOrigins, supportCredentials: c.cors.supportCredentials } : undefined,
    healthCheckPath: c.healthCheckPath ?? undefined,
    settingCount: Object.keys(settings).length,
  };
  return { data, findings };
}
