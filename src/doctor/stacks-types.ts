/**
 * Stack version info resolved from the Azure Functions Stacks API.
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
}

export const STACKS_API_URL =
  'https://functions-next.azure.com/stacks/functionAppStacks/?api-version=2023-01-01';

export const STACKS_CACHE_FILE = 'stacks-cache.json';
export const DEFAULT_TTL_HOURS = 24;
