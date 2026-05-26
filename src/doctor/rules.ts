/**
 * Version rules for Tier 1 checks.
 * v1: code constants; extracted to JSON when update frequency warrants it.
 */

export const SUPPORTED_RUNTIME_VERSIONS = ['4'];

export const RECOMMENDED_EXTENSION_BUNDLE = {
  id: 'Microsoft.Azure.Functions.ExtensionBundle',
  minVersion: '4.0.0',
  maxVersion: '5.0.0',
};

export const SUPPORTED_NODE_VERSIONS = [18, 20, 22];
export const SUPPORTED_PYTHON_VERSIONS = ['3.9', '3.10', '3.11', '3.12'];
export const SUPPORTED_DOTNET_VERSIONS = ['6.0', '8.0', '9.0'];

/** Settings that are deprecated and should be replaced. */
export const DEPRECATED_SETTINGS: Record<string, string> = {
  WEBSITE_NODE_DEFAULT_VERSION: 'Use FUNCTIONS_WORKER_RUNTIME instead',
  AzureWebJobsDashboard: 'Deprecated since Functions v2; remove this setting',
};
