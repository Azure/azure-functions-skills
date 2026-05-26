/**
 * Version rules for Tier 1 checks — hardcoded fallback.
 * Used only when the Stacks API (stacks.ts) is unreachable and no cache exists.
 * Keep in sync with https://functions-next.azure.com/stacks/functionAppStacks/?api-version=2023-01-01
 * Last synced: 2026-05-26
 */

export const SUPPORTED_RUNTIME_VERSIONS = ['4'];

export const RECOMMENDED_EXTENSION_BUNDLE = {
  id: 'Microsoft.Azure.Functions.ExtensionBundle',
  minVersion: '4.0.0',
  maxVersion: '5.0.0',
};

export const SUPPORTED_NODE_VERSIONS = [22, 24];
export const SUPPORTED_PYTHON_VERSIONS = ['3.10', '3.11', '3.12', '3.13'];
export const SUPPORTED_DOTNET_VERSIONS = ['8.0', '9.0', '10.0'];

/** Settings that are deprecated and should be replaced. */
export const DEPRECATED_SETTINGS: Record<string, string> = {
  WEBSITE_NODE_DEFAULT_VERSION: 'Use FUNCTIONS_WORKER_RUNTIME instead',
  AzureWebJobsDashboard: 'Deprecated since Functions v2; remove this setting',
};
