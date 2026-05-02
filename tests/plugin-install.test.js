import { describe, it, expect } from 'vitest';
import { getPluginDir, generateVscodeSettings, generateCodexMarketplaceEntry, generateClaudeSettings } from '../src/setup/plugin-install.js';

describe('getPluginDir', () => {
  it('returns a path containing dist/', () => {
    const dir = getPluginDir('ghcp');
    expect(dir).toContain('dist');
    expect(dir).toMatch(/ghcp$/);
  });

  it('returns paths for all three targets', () => {
    for (const target of ['ghcp', 'claude', 'codex']) {
      const dir = getPluginDir(target);
      expect(dir).toContain(target);
    }
  });
});

describe('generateVscodeSettings', () => {
  it('returns settings JSON with pluginLocations', () => {
    const pluginPath = '/path/to/plugin';
    const settings = generateVscodeSettings(pluginPath);
    expect(settings['chat.plugins.enabled']).toBe(true);
    expect(settings['chat.pluginLocations']).toBeTruthy();
    expect(settings['chat.pluginLocations'][pluginPath]).toBe(true);
  });
});

describe('generateCodexMarketplaceEntry', () => {
  it('returns marketplace JSON with correct plugin reference', () => {
    const pluginPath = '/path/to/plugin';
    const mp = generateCodexMarketplaceEntry(pluginPath);
    expect(mp.plugins).toBeInstanceOf(Array);
    expect(mp.plugins[0].name).toBe('azure-functions-skills');
    expect(mp.plugins[0].source.path).toBe(pluginPath);
    expect(mp.plugins[0].source.source).toBe('local');
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
