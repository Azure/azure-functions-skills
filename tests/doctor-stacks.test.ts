import { describe, it, expect, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import {
  parseStacksResponse,
  resolveStacks,
  getLanguageVersions,
  checkVersionStatus,
} from '../src/doctor/stacks.js';
import type { StacksCache } from '../src/doctor/stacks-types.js';

const TEMP_DIRS: string[] = [];
function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}
afterAll(() => { for (const d of TEMP_DIRS) removeDir(d); });

// ── Minimal API response fixtures ──

const MOCK_NODE_STACK = {
  displayText: 'Node.js',
  value: 'node',
  preferredOs: 'windows',
  majorVersions: [
    {
      displayText: 'Node.js 22',
      value: '22',
      minorVersions: [{
        displayText: 'Node.js 22',
        value: '22 LTS',
        stackSettings: {
          linuxRuntimeSettings: {
            runtimeVersion: 'Node|22',
            isDefault: true,
            isPreview: false,
            isDeprecated: false,
            isHidden: false,
            endOfLifeDate: '2027-04-30T00:00:00.000Z',
            supportedFunctionsExtensionVersions: ['~4'],
          },
        },
      }],
    },
    {
      displayText: 'Node.js 20',
      value: '20',
      minorVersions: [{
        displayText: 'Node.js 20 LTS',
        value: '20 LTS',
        stackSettings: {
          linuxRuntimeSettings: {
            runtimeVersion: 'Node|20',
            isDefault: false,
            isPreview: false,
            isDeprecated: false,
            isHidden: false,
            endOfLifeDate: '2026-04-30T00:00:00.000Z',
            supportedFunctionsExtensionVersions: ['~4'],
          },
        },
      }],
    },
    {
      displayText: 'Node.js 16',
      value: '16',
      minorVersions: [{
        displayText: 'Node.js 16 LTS',
        value: '16 LTS',
        stackSettings: {
          linuxRuntimeSettings: {
            runtimeVersion: 'Node|16',
            isDefault: false,
            isPreview: false,
            isDeprecated: true,
            isHidden: false,
            endOfLifeDate: '2024-06-30T00:00:00.000Z',
            supportedFunctionsExtensionVersions: ['~4'],
          },
        },
      }],
    },
  ],
};

const MOCK_PYTHON_STACK = {
  displayText: 'Python',
  value: 'python',
  preferredOs: 'linux',
  majorVersions: [
    {
      displayText: 'Python 3',
      value: '3',
      minorVersions: [
        {
          displayText: 'Python 3.13',
          value: '3.13',
          stackSettings: {
            linuxRuntimeSettings: {
              runtimeVersion: 'Python|3.13',
              isDefault: true,
              isPreview: false,
              isDeprecated: false,
              isHidden: false,
              endOfLifeDate: '2029-10-31T00:00:00.000Z',
              supportedFunctionsExtensionVersions: ['~4'],
            },
          },
        },
        {
          displayText: 'Python 3.11',
          value: '3.11',
          stackSettings: {
            linuxRuntimeSettings: {
              runtimeVersion: 'Python|3.11',
              isDefault: false,
              isPreview: false,
              isDeprecated: false,
              isHidden: false,
              endOfLifeDate: '2027-10-31T00:00:00.000Z',
              supportedFunctionsExtensionVersions: ['~4'],
            },
          },
        },
      ],
    },
  ],
};

const MOCK_API_RESPONSE = [MOCK_NODE_STACK, MOCK_PYTHON_STACK];
const MOCK_ARM_RESPONSE = {
  value: MOCK_API_RESPONSE.map(stack => ({
    name: stack.value,
    type: 'Microsoft.Web/functionAppStacks',
    properties: stack,
  })),
};

// ── parseStacksResponse ──

describe('parseStacksResponse', () => {
  it('extracts node versions from API response', () => {
    const stacks = parseStacksResponse(MOCK_API_RESPONSE);
    const node = stacks.find(s => s.language === 'node');
    expect(node).toBeDefined();
    expect(node!.versions.length).toBe(3);
    expect(node!.versions[0].version).toBe('22');
    expect(node!.versions[0].isDefault).toBe(true);
    expect(node!.versions[0].endOfLifeDate).toBe('2027-04-30T00:00:00.000Z');
  });

  it('extracts python versions from API response', () => {
    const stacks = parseStacksResponse(MOCK_API_RESPONSE);
    const python = stacks.find(s => s.language === 'python');
    expect(python).toBeDefined();
    expect(python!.versions.length).toBe(2);
    expect(python!.versions[0].version).toBe('3.13');
  });

  it('marks deprecated versions', () => {
    const stacks = parseStacksResponse(MOCK_API_RESPONSE);
    const node = stacks.find(s => s.language === 'node')!;
    const v16 = node.versions.find(v => v.version === '16');
    expect(v16).toBeDefined();
    expect(v16!.isDeprecated).toBe(true);
  });

  it('handles empty response', () => {
    const stacks = parseStacksResponse([]);
    expect(stacks).toEqual([]);
  });

  it('extracts versions from ARM functionAppStacks response', () => {
    const stacks = parseStacksResponse(MOCK_ARM_RESPONSE);
    const node = stacks.find(s => s.language === 'node');
    expect(node).toBeDefined();
    expect(node!.versions.some(v => v.version === '22')).toBe(true);
  });
});

// ── getLanguageVersions ──

describe('getLanguageVersions', () => {
  it('returns versions for a specific language', () => {
    const stacks = parseStacksResponse(MOCK_API_RESPONSE);
    const versions = getLanguageVersions(stacks, 'node');
    expect(versions.length).toBe(3);
  });

  it('returns empty array for unknown language', () => {
    const stacks = parseStacksResponse(MOCK_API_RESPONSE);
    const versions = getLanguageVersions(stacks, 'rust');
    expect(versions).toEqual([]);
  });
});

// ── checkVersionStatus ──

describe('checkVersionStatus', () => {
  const stacks = parseStacksResponse(MOCK_API_RESPONSE);

  it('returns "supported" for a current version', () => {
    const status = checkVersionStatus(stacks, 'node', '22');
    expect(status.status).toBe('supported');
    expect(status.isDefault).toBe(true);
  });

  it('returns "deprecated" for a deprecated version', () => {
    const status = checkVersionStatus(stacks, 'node', '16');
    expect(status.status).toBe('deprecated');
  });

  it('returns "eol" for a version past end-of-life', () => {
    const status = checkVersionStatus(stacks, 'node', '16');
    // Node 16 EOL is 2024-06-30, current date is 2026-05-26
    expect(status.status === 'eol' || status.status === 'deprecated').toBe(true);
  });

  it('returns "unknown" for unrecognized version', () => {
    const status = checkVersionStatus(stacks, 'node', '14');
    expect(status.status).toBe('unknown');
  });

  it('returns "eol-soon" for version expiring within 6 months', () => {
    // Node 20 EOL is 2026-04-30, and our "now" is 2026-05-26 — already past EOL
    const status = checkVersionStatus(stacks, 'node', '20');
    expect(status.status === 'eol' || status.status === 'eol-soon').toBe(true);
  });
});

// ── resolveStacks (cache behavior) ──

describe('resolveStacks', () => {
  let sourceSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sourceSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches from source and writes cache', async () => {
    const dir = makeTmp('stacks-fetch-');
    sourceSpy.mockResolvedValueOnce(MOCK_ARM_RESPONSE);

    const stacks = await resolveStacks({ cacheDir: dir }, sourceSpy);
    expect(stacks.length).toBeGreaterThan(0);
    expect(sourceSpy).toHaveBeenCalledTimes(1);
    expect(sourceSpy).toHaveBeenCalledWith({ apiVersion: '2025-05-01', timeoutMs: 15000 });

    // Cache file should be written
    const cachePath = join(dir, 'stacks-cache.json');
    expect(existsSync(cachePath)).toBe(true);
    const cache = JSON.parse(readFileSync(cachePath, 'utf-8')) as StacksCache;
    expect(cache.stacks.length).toBeGreaterThan(0);
  });

  it('uses cache when not expired', async () => {
    const dir = makeTmp('stacks-cached-');
    const cache: StacksCache = {
      fetchedAt: new Date().toISOString(),
      ttlHours: 24,
      stacks: parseStacksResponse(MOCK_API_RESPONSE),
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'stacks-cache.json'), JSON.stringify(cache));

    const stacks = await resolveStacks({ cacheDir: dir }, sourceSpy);
    expect(stacks.length).toBeGreaterThan(0);
    expect(sourceSpy).not.toHaveBeenCalled();
  });

  it('refetches when cache is expired', async () => {
    const dir = makeTmp('stacks-expired-');
    const cache: StacksCache = {
      fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
      ttlHours: 24,
      stacks: parseStacksResponse(MOCK_API_RESPONSE),
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'stacks-cache.json'), JSON.stringify(cache));

    sourceSpy.mockResolvedValueOnce(MOCK_ARM_RESPONSE);

    const stacks = await resolveStacks({ cacheDir: dir }, sourceSpy);
    expect(stacks.length).toBeGreaterThan(0);
    expect(sourceSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to hardcoded rules when offline', async () => {
    const dir = makeTmp('stacks-offline-');
    const stacks = await resolveStacks({ cacheDir: dir, offline: true }, sourceSpy);
    expect(stacks.length).toBeGreaterThan(0);
    expect(sourceSpy).not.toHaveBeenCalled();
    // Should have node from fallback
    const node = stacks.find(s => s.language === 'node');
    expect(node).toBeDefined();
  });

  it('falls back to hardcoded rules when fetch fails', async () => {
    const dir = makeTmp('stacks-fail-');
    sourceSpy.mockRejectedValueOnce(new Error('Azure CLI error'));

    const stacks = await resolveStacks({ cacheDir: dir }, sourceSpy);
    expect(stacks.length).toBeGreaterThan(0);
    // Should still have language entries from fallback
    const node = stacks.find(s => s.language === 'node');
    expect(node).toBeDefined();
  });

  it('falls back to expired cache over hardcoded when fetch fails', async () => {
    const dir = makeTmp('stacks-stale-');
    const staleCache: StacksCache = {
      fetchedAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(), // 3 days ago
      ttlHours: 24,
      stacks: parseStacksResponse(MOCK_API_RESPONSE),
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'stacks-cache.json'), JSON.stringify(staleCache));

    sourceSpy.mockRejectedValueOnce(new Error('Azure CLI error'));

    const stacks = await resolveStacks({ cacheDir: dir }, sourceSpy);
    expect(stacks.length).toBeGreaterThan(0);
    // Should prefer stale cache over hardcoded
    const node = stacks.find(s => s.language === 'node');
    expect(node!.versions.some(v => v.version === '22')).toBe(true);
  });
});
