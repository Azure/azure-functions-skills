/**
 * Dynamic version resolver using the Azure Functions Stacks API.
 *
 * Priority: fresh cache → API fetch → stale cache → hardcoded fallback.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  LanguageStackInfo,
  StackVersionInfo,
  StacksCache,
  StacksResolverOptions,
} from './stacks-types.js';
import {
  STACKS_API_URL,
  STACKS_CACHE_FILE,
  DEFAULT_TTL_HOURS,
} from './stacks-types.js';
import {
  SUPPORTED_NODE_VERSIONS,
  SUPPORTED_PYTHON_VERSIONS,
  SUPPORTED_DOTNET_VERSIONS,
} from './rules.js';

// ── Types for the raw API response ──

interface RawRuntimeSettings {
  runtimeVersion?: string;
  isDefault?: boolean;
  isPreview?: boolean;
  isDeprecated?: boolean;
  isHidden?: boolean;
  endOfLifeDate?: string;
  supportedFunctionsExtensionVersions?: string[];
}

interface RawStackSettings {
  windowsRuntimeSettings?: RawRuntimeSettings;
  linuxRuntimeSettings?: RawRuntimeSettings;
}

interface RawMinorVersion {
  displayText: string;
  value: string;
  stackSettings: RawStackSettings;
}

interface RawMajorVersion {
  displayText: string;
  value: string;
  minorVersions: RawMinorVersion[];
}

interface RawStack {
  displayText: string;
  value: string;
  preferredOs: string;
  majorVersions: RawMajorVersion[];
}

// ── Version status for check results ──

export type VersionStatusKind = 'supported' | 'eol-soon' | 'eol' | 'deprecated' | 'preview' | 'unknown';

export interface VersionStatus {
  status: VersionStatusKind;
  version: string;
  isDefault: boolean;
  endOfLifeDate: string | null;
  message: string;
}

// ── Constants ──

const EOL_SOON_MONTHS = 6;

const LANGUAGE_MAP: Record<string, string> = {
  dotnet: 'dotnet',
  node: 'node',
  python: 'python',
  java: 'java',
  powershell: 'powershell',
  custom: 'custom',
  go: 'go',
};

// ── Parse API response ──

function pickRuntimeSettings(settings: RawStackSettings): RawRuntimeSettings | null {
  // Prefer linux settings (more common for non-.NET), fall back to windows
  return settings.linuxRuntimeSettings ?? settings.windowsRuntimeSettings ?? null;
}

export function parseStacksResponse(raw: RawStack[]): LanguageStackInfo[] {
  const result: LanguageStackInfo[] = [];

  for (const stack of raw) {
    const language = LANGUAGE_MAP[stack.value] ?? stack.value;
    const versions: StackVersionInfo[] = [];

    for (const major of stack.majorVersions) {
      // Some languages (Python) put all versions under a single majorVersion;
      // others (Node, Java) use one majorVersion per version.
      // Process every minorVersion entry.
      for (const minor of major.minorVersions) {
        const rt = pickRuntimeSettings(minor.stackSettings);
        if (!rt) continue;
        if (rt.isHidden) continue;

        let version: string;
        if (language === 'python') {
          version = minor.value?.match(/^(\d+\.\d+)/)?.[1] ?? major.value;
        } else if (language === 'dotnet') {
          const match = major.value.match(/(\d+)/);
          version = match ? `${match[1]}.0` : major.value;
        } else {
          version = major.value;
        }

        // Avoid duplicate versions (e.g. dotnet8 in-process + isolated)
        if (versions.some(v => v.version === version)) continue;

        versions.push({
          version,
          displayText: major.displayText,
          endOfLifeDate: rt.endOfLifeDate ?? null,
          isDefault: rt.isDefault ?? false,
          isDeprecated: rt.isDeprecated ?? false,
          isPreview: rt.isPreview ?? false,
          isHidden: rt.isHidden ?? false,
          supportedExtensionVersions: rt.supportedFunctionsExtensionVersions ?? [],
        });
      }
    }

    if (versions.length > 0) {
      result.push({ language, versions });
    }
  }

  return result;
}

// ── Query helpers ──

export function getLanguageVersions(
  stacks: LanguageStackInfo[],
  language: string,
): StackVersionInfo[] {
  return stacks.find(s => s.language === language)?.versions ?? [];
}

export function checkVersionStatus(
  stacks: LanguageStackInfo[],
  language: string,
  version: string,
): VersionStatus {
  const versions = getLanguageVersions(stacks, language);
  const info = versions.find(v => v.version === version);

  if (!info) {
    return {
      status: 'unknown',
      version,
      isDefault: false,
      endOfLifeDate: null,
      message: `Version ${version} not found in Azure Functions supported stacks`,
    };
  }

  if (info.isDeprecated) {
    return {
      status: 'deprecated',
      version,
      isDefault: info.isDefault,
      endOfLifeDate: info.endOfLifeDate,
      message: `${info.displayText} is deprecated`,
    };
  }

  if (info.endOfLifeDate) {
    const eolDate = new Date(info.endOfLifeDate);
    const now = new Date();

    if (now > eolDate) {
      return {
        status: 'eol',
        version,
        isDefault: info.isDefault,
        endOfLifeDate: info.endOfLifeDate,
        message: `${info.displayText} reached end of life on ${eolDate.toISOString().split('T')[0]}`,
      };
    }

    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + EOL_SOON_MONTHS);
    if (eolDate <= sixMonthsFromNow) {
      return {
        status: 'eol-soon',
        version,
        isDefault: info.isDefault,
        endOfLifeDate: info.endOfLifeDate,
        message: `${info.displayText} reaches end of life on ${eolDate.toISOString().split('T')[0]}`,
      };
    }
  }

  if (info.isPreview) {
    return {
      status: 'preview',
      version,
      isDefault: info.isDefault,
      endOfLifeDate: info.endOfLifeDate,
      message: `${info.displayText} is in preview`,
    };
  }

  return {
    status: 'supported',
    version,
    isDefault: info.isDefault,
    endOfLifeDate: info.endOfLifeDate,
    message: `${info.displayText} is supported`,
  };
}

// ── Cache ──

function readCache(cacheDir: string): StacksCache | null {
  try {
    const cachePath = join(cacheDir, STACKS_CACHE_FILE);
    if (!existsSync(cachePath)) return null;
    return JSON.parse(readFileSync(cachePath, 'utf-8')) as StacksCache;
  } catch {
    return null;
  }
}

function writeCache(cacheDir: string, stacks: LanguageStackInfo[], ttlHours: number): void {
  try {
    mkdirSync(cacheDir, { recursive: true });
    const cache: StacksCache = {
      fetchedAt: new Date().toISOString(),
      ttlHours,
      stacks,
    };
    writeFileSync(join(cacheDir, STACKS_CACHE_FILE), JSON.stringify(cache, null, 2));
  } catch {
    // Cache write failure is non-fatal
  }
}

function isCacheValid(cache: StacksCache): boolean {
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  const ttlMs = (cache.ttlHours ?? DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
  return Date.now() - fetchedAt < ttlMs;
}

// ── Hardcoded fallback ──

function buildFallbackStacks(): LanguageStackInfo[] {
  return [
    {
      language: 'node',
      versions: SUPPORTED_NODE_VERSIONS.map(v => ({
        version: String(v),
        displayText: `Node.js ${v}`,
        endOfLifeDate: null,
        isDefault: false,
        isDeprecated: false,
        isPreview: false,
        isHidden: false,
        supportedExtensionVersions: ['~4'],
      })),
    },
    {
      language: 'python',
      versions: SUPPORTED_PYTHON_VERSIONS.map(v => ({
        version: v,
        displayText: `Python ${v}`,
        endOfLifeDate: null,
        isDefault: false,
        isDeprecated: false,
        isPreview: false,
        isHidden: false,
        supportedExtensionVersions: ['~4'],
      })),
    },
    {
      language: 'dotnet',
      versions: SUPPORTED_DOTNET_VERSIONS.map(v => ({
        version: v,
        displayText: `.NET ${v}`,
        endOfLifeDate: null,
        isDefault: false,
        isDeprecated: false,
        isPreview: false,
        isHidden: false,
        supportedExtensionVersions: ['~4'],
      })),
    },
  ];
}

// ── Main resolver ──

type FetchFn = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function resolveStacks(
  options: StacksResolverOptions,
  fetchFn?: FetchFn,
): Promise<LanguageStackInfo[]> {
  const { cacheDir, ttlHours = DEFAULT_TTL_HOURS, offline = false } = options;

  // 1. Check cache
  const cache = readCache(cacheDir);
  if (cache && isCacheValid(cache)) {
    return cache.stacks;
  }

  // 2. If offline, use stale cache or fallback
  if (offline) {
    return cache?.stacks ?? buildFallbackStacks();
  }

  // 3. Fetch from API
  const doFetch = fetchFn ?? globalThis.fetch;
  try {
    const response = await doFetch(STACKS_API_URL);
    if (response.ok) {
      const raw = (await response.json()) as RawStack[];
      const stacks = parseStacksResponse(raw);
      writeCache(cacheDir, stacks, ttlHours);
      return stacks;
    }
  } catch {
    // Fetch failed — fall through to fallback
  }

  // 4. Prefer stale cache over hardcoded
  if (cache?.stacks) {
    return cache.stacks;
  }

  // 5. Hardcoded fallback
  return buildFallbackStacks();
}
