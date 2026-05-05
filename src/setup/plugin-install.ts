/**
 * Plugin install module — register plugins natively with each platform.
 *
 * Instead of copying files, this registers the plugin at its npm package location,
 * so the platform manages updates and lifecycle.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { BuildTargetName } from '../types.js';

interface PluginInstallResult {
  target: BuildTargetName;
  method: string;
  path: string;
  instructions: string;
}

interface CodexMarketplacePlugin {
  name: string;
  [key: string]: unknown;
}

interface CodexMarketplace {
  plugins?: CodexMarketplacePlugin[];
  [key: string]: unknown;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');

/**
 * Get the absolute path to a built plugin directory within this package.
 * @param {'ghcp' | 'claude' | 'codex'} target
 * @returns {string}
 */
export function getPluginDir(_target: BuildTargetName): string {
  return join(PACKAGE_ROOT, 'dist', 'plugin', 'azure-functions-skills');
}

/**
 * Generate VS Code settings entries to register the GHCP plugin.
 * @param {string} pluginPath - Absolute path to the plugin directory
 * @returns {object} Settings to merge into .vscode/settings.json
 */
export function generateVscodeSettings(pluginPath: string): Record<string, unknown> {
  return {
    'chat.plugins.enabled': true,
    'chat.pluginLocations': {
      [pluginPath]: true,
    },
  };
}

/**
 * Generate a Codex marketplace entry pointing to the plugin.
 * @param {string} pluginPath - Absolute path to the plugin directory
 * @returns {object} Marketplace JSON
 */
export function generateCodexMarketplaceEntry(pluginPath: string): CodexMarketplace {
  return {
    name: 'azure-functions-local',
    interface: {
      displayName: 'Azure Functions (local)',
    },
    plugins: [
      {
        name: 'azure-functions-skills',
        source: {
          source: 'local',
          path: pluginPath,
        },
        policy: {
          installation: 'INSTALLED_BY_DEFAULT',
          authentication: 'ON_INSTALL',
        },
        category: 'Development',
      },
    ],
  };
}

/**
 * Generate Claude settings additions for plugin registration.
 * Uses --add-dir equivalent in settings to point to plugin skills directory.
 * @param {string} pluginPath - Absolute path to the Claude plugin directory
 * @returns {object} Settings to merge
 */
export function generateClaudeSettings(pluginPath: string): Record<string, unknown> {
  return {
    pluginDir: pluginPath,
  };
}

/**
 * Install plugin natively for a given platform.
 * @param {'ghcp' | 'claude' | 'codex'} target
 * @param {string} projectDir - The project directory
 * @returns {{target: string, method: string, path: string, instructions: string}}
 */
export function installPlugin(target: BuildTargetName, projectDir: string): PluginInstallResult {
  const pluginPath = getPluginDir(target);

  if (!existsSync(pluginPath)) {
    throw new Error(
      `Plugin not built for ${target}. Run 'npm run build' first, or use 'setup' without --as-plugin.`
    );
  }

  const result = { target, path: pluginPath, method: '', instructions: '' };

  switch (target) {
    case 'ghcp': {
      // Register in .vscode/settings.json
      const settingsPath = join(projectDir, '.vscode', 'settings.json');
      const settings = mergeJsonFile(settingsPath, generateVscodeSettings(pluginPath));
      mkdirSync(join(projectDir, '.vscode'), { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      result.method = 'chat.pluginLocations in .vscode/settings.json';
      result.instructions = 'Reload VS Code window (Ctrl+Shift+P → "Developer: Reload Window")';
      break;
    }
    case 'codex': {
      // Register in ~/.agents/plugins/marketplace.json
      const mpDir = join(homedir(), '.agents', 'plugins');
      const mpPath = join(mpDir, 'marketplace.json');
      mkdirSync(mpDir, { recursive: true });
      const marketplace = generateCodexMarketplaceEntry(pluginPath);
      if (existsSync(mpPath)) {
        const existing = JSON.parse(readFileSync(mpPath, 'utf-8')) as CodexMarketplace;
        // Merge: add our plugin if not already present
        const names = existing.plugins?.map(p => p.name) || [];
        if (!names.includes('azure-functions-skills')) {
          existing.plugins = [...(existing.plugins || []), ...(marketplace.plugins || [])];
          writeFileSync(mpPath, JSON.stringify(existing, null, 2));
        }
      } else {
        writeFileSync(mpPath, JSON.stringify(marketplace, null, 2));
      }
      result.method = 'marketplace.json in ~/.agents/plugins/';
      result.instructions = 'Restart Codex to discover the plugin';
      break;
    }
    case 'claude': {
      // Claude: register the self-contained plugin directory via --add-dir.
      const claudeDir = join(projectDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      const settingsPath = join(claudeDir, 'settings.local.json');
      const mcpPath = join(pluginPath, '.mcp.json');
      if (existsSync(mcpPath)) {
        const mcpSettings = JSON.parse(readFileSync(mcpPath, 'utf-8'));
        const merged = mergeJsonFile(settingsPath, mcpSettings);
        writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
      }
      result.method = '.claude/settings.local.json + --add-dir';
      result.instructions = `Run: claude --add-dir "${pluginPath}"`;
      break;
    }
    default:
      throw new Error(`Unknown target: ${target}`);
  }

  return result;
}

function mergeJsonFile(filePath: string, newEntries: Record<string, unknown>): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // corrupt file, overwrite
    }
  }
  return { ...existing, ...newEntries };
}
