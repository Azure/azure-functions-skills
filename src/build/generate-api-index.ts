#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOperations, type IndexedOperation, type SwaggerSpec } from './api-index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT = join(ROOT, 'templates', 'skills', 'azure-functions-app', 'references', 'api-index.json');
const REPO = 'Azure/azure-rest-api-specs';
const WEB_API_VERSION = '2024-11-01';
const WEB_SPEC_DIR = `specification/web/resource-manager/Microsoft.Web/AppService/stable/${WEB_API_VERSION}`;
const WEB_SPEC_FILES = ['WebApps.json', 'AppServicePlans.json', 'Diagnostics.json'];

/** Hand-picked non-Microsoft.Web operations the skill relies on, with verified api-versions. */
const CURATED: IndexedOperation[] = [
  { id: 'ResourceGraph_Resources', method: 'POST', path: '/providers/Microsoft.ResourceGraph/resources', apiVersion: '2022-10-01', summary: 'Queries resources with KQL across subscriptions.', body: true },
  { id: 'AvailabilityStatuses_GetByResource', method: 'GET', path: '{resourceUri}/providers/Microsoft.ResourceHealth/availabilityStatuses/current', apiVersion: '2022-10-01', summary: 'Gets the current Resource Health availability status.' },
  { id: 'Metrics_List', method: 'GET', path: '{resourceUri}/providers/Microsoft.Insights/metrics', apiVersion: '2023-10-01', summary: 'Lists metric values (metricnames, timespan, interval, aggregation).' },
  { id: 'MetricDefinitions_List', method: 'GET', path: '{resourceUri}/providers/Microsoft.Insights/metricDefinitions', apiVersion: '2021-05-01', summary: 'Lists the metric names a resource emits.' },
  { id: 'ActivityLogs_List', method: 'GET', path: '/subscriptions/{subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values', apiVersion: '2015-04-01', summary: 'Lists Activity Log events ($filter by eventTimestamp and resourceUri).' },
  { id: 'Components_Get', method: 'GET', path: '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Insights/components/{resourceName}', apiVersion: '2020-02-02', summary: 'Gets an Application Insights component.' },
  { id: 'LogAnalytics_Query', method: 'POST', host: 'https://api.loganalytics.io', path: '/v1{applicationInsightsResourceId}/query', apiVersion: 'v1', summary: 'Runs KQL against Application Insights tables (requests, traces, exceptions); token resource https://api.loganalytics.io.', body: true },
  { id: 'RoleAssignments_ListForScope', method: 'GET', path: '{scope}/providers/Microsoft.Authorization/roleAssignments', apiVersion: '2022-04-01', summary: 'Lists role assignments at a scope.' },
  { id: 'RoleAssignments_Create', method: 'PUT', path: '{scope}/providers/Microsoft.Authorization/roleAssignments/{roleAssignmentName}', apiVersion: '2022-04-01', summary: 'Creates a role assignment (name is a new GUID).', body: true },
  { id: 'RoleAssignments_Delete', method: 'DELETE', path: '{scope}/providers/Microsoft.Authorization/roleAssignments/{roleAssignmentName}', apiVersion: '2022-04-01', summary: 'Deletes a role assignment.' },
  { id: 'RoleDefinitions_List', method: 'GET', path: '{scope}/providers/Microsoft.Authorization/roleDefinitions', apiVersion: '2022-04-01', summary: "Lists role definitions ($filter=roleName eq '<name>')." },
  { id: 'Deployments_CreateOrUpdate', method: 'PUT', path: '/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/{deploymentName}', apiVersion: '2024-03-01', summary: 'Deploys an ARM template to a resource group.', lro: true, body: true },
  { id: 'Vaults_Get', method: 'GET', path: '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.KeyVault/vaults/{vaultName}', apiVersion: '2023-07-01', summary: 'Gets a Key Vault (RBAC mode, network rules).' },
  { id: 'UserAssignedIdentities_Get', method: 'GET', path: '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{resourceName}', apiVersion: '2023-01-31', summary: 'Gets a user-assigned managed identity (clientId, principalId).' },
  { id: 'Scm_ListDeployments', method: 'GET', host: 'https://{scmHost}', path: '/api/deployments', apiVersion: 'none', summary: 'Lists code deployments from Kudu; token resource https://appservice.azure.com.' },
  { id: 'Scm_GetDeploymentLog', method: 'GET', host: 'https://{scmHost}', path: '/api/deployments/{id}/log', apiVersion: 'none', summary: 'Gets the log entries of one deployment.' },
];

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': 'azure-functions-skills' } });
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
  return response.text();
}

async function main(): Promise<void> {
  const commit = JSON.parse(await fetchText(`https://api.github.com/repos/${REPO}/commits?path=${WEB_SPEC_DIR}&per_page=1`)) as { sha: string }[];
  const sha = commit[0]?.sha;
  if (!sha) throw new Error(`Could not resolve a commit for ${WEB_SPEC_DIR}`);

  const operations: IndexedOperation[] = [];
  for (const file of WEB_SPEC_FILES) {
    const spec = JSON.parse(await fetchText(`https://raw.githubusercontent.com/${REPO}/${sha}/${WEB_SPEC_DIR}/${file}`)) as SwaggerSpec;
    operations.push(...extractOperations(spec, WEB_API_VERSION));
  }
  const unique = [...new Map(operations.map(operation => [`${operation.method} ${operation.path}`, operation])).values()];
  const index = {
    schemaVersion: 1,
    sources: [{ name: `${REPO}/${WEB_SPEC_DIR}`, ref: sha }, { name: 'curated', ref: 'src/build/generate-api-index.ts' }],
    operations: [...unique, ...CURATED],
  };
  writeFileSync(OUTPUT, `${JSON.stringify(index)}\n`);
  console.log(`Wrote ${index.operations.length} operations to ${OUTPUT}`);
}

await main();
