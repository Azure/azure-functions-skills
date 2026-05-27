/**
 * Stack version info resolved from Azure Resource Manager functionAppStacks metadata.
 */

export interface StackVersionInfo {
  version: string;
  displayText: string;
  endOfLifeDate: string | null;
  isDefault: boolean;
  isDeprecated: boolean;
  isPreview: boolean;
  isHidden: boolean;
  supportedExtensionVersions: string[];
}

export interface LanguageStackInfo {
  language: string;
  versions: StackVersionInfo[];
}

export interface StacksCache {
  fetchedAt: string;
  ttlHours: number;
  stacks: LanguageStackInfo[];
}

export interface StacksResolverOptions {
  cacheDir: string;
  ttlHours?: number;
  offline?: boolean;
  apiVersion?: string;
  commandTimeoutMs?: number;
}

export const STACKS_API_VERSION = '2025-05-01';
export const STACKS_RESOURCE_PATH = '/providers/Microsoft.Web/functionAppStacks';

export const STACKS_CACHE_FILE = 'stacks-cache.json';
export const DEFAULT_TTL_HOURS = 24;
export const DEFAULT_STACKS_COMMAND_TIMEOUT_MS = 15_000;
