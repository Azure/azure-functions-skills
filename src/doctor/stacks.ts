/**
 * Dynamic version resolver using Azure Resource Manager functionAppStacks metadata.
 *
 * Priority: fresh cache → Azure CLI ARM query → stale cache → hardcoded fallback.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  LanguageStackInfo,
  StackVersionInfo,
  StacksCache,
  StacksResolverOptions,
} from './stacks-types.js';
import {
  STACKS_API_VERSION,
  STACKS_RESOURCE_PATH,
  STACKS_CACHE_FILE,
  DEFAULT_TTL_HOURS,
  DEFAULT_STACKS_COMMAND_TIMEOUT_MS,
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

interface ArmFunctionAppStack {
  name?: string;
  properties?: RawStack;
}

interface ArmFunctionAppStacksResponse {
  value?: ArmFunctionAppStack[];
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

function normalizeStacksResponse(raw: unknown): RawStack[] {
  if (Array.isArray(raw)) {
    return raw as RawStack[];
  }

  const response = raw as ArmFunctionAppStacksResponse;
  if (Array.isArray(response?.value)) {
    return response.value
      .map(item => item.properties)
      .filter((stack): stack is RawStack => !!stack);
  }

  return [];
}

function getRuntimeVersion(settings: RawRuntimeSettings | null): string | null {
  return settings?.runtimeVersion ?? null;
}

function extractVersion(language: string, major: RawMajorVersion, minor: RawMinorVersion, runtimeVersion: string | null): string {
  if (language === 'python' || language === 'powershell') {
    return minor.value?.match(/^(\d+(?:\.\d+)?)/)?.[1] ?? major.value;
  }

  if (language === 'dotnet') {
    const runtimeMatch = runtimeVersion?.match(/(\d+(?:\.\d+)?)/);
    if (runtimeMatch) {
      const value = runtimeMatch[1];
      return value.includes('.') ? value : `${value}.0`;
    }

    const majorMatch = major.value.match(/(\d+)/);
    return majorMatch ? `${majorMatch[1]}.0` : major.value;
  }

  return major.value;
}

export function parseStacksResponse(raw: unknown): LanguageStackInfo[] {
  const rawStacks = normalizeStacksResponse(raw);
  const result: LanguageStackInfo[] = [];

  for (const stack of rawStacks) {
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

        const version = extractVersion(language, major, minor, getRuntimeVersion(rt));

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

export type StacksSourceFn = (options: { apiVersion: string; timeoutMs: number }) => Promise<unknown>;

function runAzureCli(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('az', args, {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Azure CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }

      const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
      reject(new Error(detail));
    });
  });
}

function joinManagementUrl(managementUrl: string, apiVersion: string): string {
  const base = managementUrl.replace(/\/+$/, '');
  return `${base}${STACKS_RESOURCE_PATH}?api-version=${encodeURIComponent(apiVersion)}`;
}

export async function fetchStacksWithAzureCli(options: { apiVersion: string; timeoutMs: number }): Promise<unknown> {
  const managementUrl = (await runAzureCli([
    'cloud',
    'show',
    '--query',
    'endpoints.resourceManager',
    '-o',
    'tsv',
  ], options.timeoutMs)).trim();

  if (!managementUrl) {
    throw new Error('Azure CLI did not return a resource manager endpoint');
  }

  const raw = await runAzureCli([
    'rest',
    '--method',
    'get',
    '--url',
    joinManagementUrl(managementUrl, options.apiVersion),
    '--only-show-errors',
    '-o',
    'json',
  ], options.timeoutMs);

  return JSON.parse(raw) as unknown;
}

export async function resolveStacks(
  options: StacksResolverOptions,
  sourceFn?: StacksSourceFn,
): Promise<LanguageStackInfo[]> {
  const {
    cacheDir,
    ttlHours = DEFAULT_TTL_HOURS,
    offline = false,
    apiVersion = STACKS_API_VERSION,
    commandTimeoutMs = DEFAULT_STACKS_COMMAND_TIMEOUT_MS,
  } = options;

  // 1. Check cache
  const cache = readCache(cacheDir);
  if (cache && isCacheValid(cache)) {
    return cache.stacks;
  }

  // 2. If offline, use stale cache or fallback
  if (offline) {
    return cache?.stacks ?? buildFallbackStacks();
  }

  // 3. Fetch from Azure Resource Manager through Azure CLI
  const loadStacks = sourceFn ?? fetchStacksWithAzureCli;
  try {
    const raw = await loadStacks({ apiVersion, timeoutMs: commandTimeoutMs });
    const stacks = parseStacksResponse(raw);
    if (stacks.length > 0) {
      writeCache(cacheDir, stacks, ttlHours);
      return stacks;
    }
  } catch {
    // Azure CLI / ARM fetch failed — fall through to stale cache or fallback
  }

  // 4. Prefer stale cache over hardcoded
  if (cache?.stacks) {
    return cache.stacks;
  }

  // 5. Hardcoded fallback
  return buildFallbackStacks();
}
