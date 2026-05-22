import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getPluginDir,
  generateVscodeSettings,
  generateCodexMarketplaceEntry,
  generateClaudeSettings,
  planPluginOperation,
} from '../src/setup/plugin-install.js';

describe('getPluginDir', () => {
  it('returns the common plugin payload path under dist/', () => {
    const dir = getPluginDir('ghcp');
    expect(dir).toContain('dist');
    expect(dir).toMatch(/dist[\\/]plugin[\\/]azure-functions-skills$/);
  });

  it('returns the same self-contained plugin payload for all targets', () => {
    const dirs = (['ghcp', 'claude', 'codex'] as const).map(target => getPluginDir(target));

    expect(new Set(dirs).size).toBe(1);
  });
});

describe('generateVscodeSettings', () => {
  it('returns settings JSON with pluginLocations', () => {
    const pluginPath = '/path/to/plugin';
    const settings = generateVscodeSettings(pluginPath);
    const locations = settings['chat.pluginLocations'] as Record<string, boolean>;
    expect(settings['chat.plugins.enabled']).toBe(true);
    expect(locations).toBeTruthy();
    expect(locations[pluginPath]).toBe(true);
  });
});

describe('generateCodexMarketplaceEntry', () => {
  it('returns marketplace JSON with correct plugin reference', () => {
    const pluginPath = '/path/to/plugin';
    const mp = generateCodexMarketplaceEntry(pluginPath);
    const plugin = mp.plugins?.[0] as { name: string; source: { path: string; source: string } };
    expect(mp.plugins).toBeInstanceOf(Array);
    expect(plugin.name).toBe('azure-functions-skills');
    expect(plugin.source.path).toBe(pluginPath);
    expect(plugin.source.source).toBe('local');
  });
});

describe('generateClaudeSettings', () => {
  it('returns settings with add_dirs pointing to plugin', () => {
    const pluginPath = '/path/to/plugin';
    const settings = generateClaudeSettings(pluginPath);
    // Claude uses the plugin dir as an additional directory for skill discovery
    expect(settings).toBeTruthy();
  });
});

describe('planPluginOperation', () => {
  it('uses the package version when no version is specified', () => {
    const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8')) as { version: string };

    const plan = planPluginOperation({
      action: 'install',
      agents: ['ghcp'],
      projectDir: '/workspace/project',
      dryRun: true,
    });

    expect(plan.version).toBe(packageJson.version);
    expect(plan.steps.map(step => step.description).join('\n')).toContain(packageJson.version);
  });

  it('plans plugin install with workspace activation without writing files', () => {
    const plan = planPluginOperation({
      action: 'install',
      agents: ['ghcp'],
      projectDir: '/workspace/project',
      dryRun: true,
      scope: 'workspace',
      source: 'marketplace',
      version: '0.12.1',
      workspace: true,
    });

    expect(plan.action).toBe('install');
    expect(plan.dryRun).toBe(true);
    expect(plan.steps).toContainEqual(expect.objectContaining({ target: 'ghcp', kind: 'plugin-registration' }));
    expect(plan.steps).toContainEqual(expect.objectContaining({ target: 'ghcp', kind: 'workspace-activation' }));
    expect(plan.steps.map(step => step.description).join('\n')).toContain('0.12.1');
  });

  it('plans plugin update without workspace activation when disabled', () => {
    const plan = planPluginOperation({
      action: 'update',
      agents: ['claude', 'codex'],
      projectDir: '/workspace/project',
      dryRun: true,
      scope: 'user',
      source: 'local',
      workspace: false,
    });

    expect(plan.action).toBe('update');
    expect(plan.steps.filter(step => step.kind === 'plugin-registration')).toHaveLength(2);
    expect(plan.steps.some(step => step.kind === 'workspace-activation')).toBe(false);
    expect(plan.steps.map(step => step.target)).toEqual(['claude', 'codex']);
  });
});
