#!/usr/bin/env node

/**
 * Build script — generates GHCP, Claude, and Codex plugin artifacts from canonical sources.
 *
 * Usage:
 *   node src/build/build.js              # build all targets
 *   node src/build/build.js --target ghcp # build one target
 */

import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadSkills, loadMcpServers, loadAgents, loadHooks } from './loader.js';
import { buildPluginMarketplaces, buildPluginPayload, buildTarget } from './build-target.js';
import type { BuildData, BuildTargetName } from '../types.js';
import type { PluginPayloadOptions } from './build-target.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEMPLATES_DIR = join(ROOT, 'templates');

const TARGETS: BuildTargetName[] = ['ghcp', 'claude', 'codex'];

// Parse args
const args = process.argv.slice(2);
const targetFlag = args.indexOf('--target');
const selectedTargets: BuildTargetName[] = targetFlag >= 0 && args[targetFlag + 1]
  ? [parseTarget(args[targetFlag + 1])]
  : TARGETS;
const distDirFlag = args.indexOf('--dist-dir');
const distDir = distDirFlag >= 0 && args[distDirFlag + 1]
  ? args[distDirFlag + 1]
  : join(ROOT, 'dist');
const pluginOnly = args.includes('--plugin-only');
const repoPluginDirFlag = args.indexOf('--repo-plugin-dir');
const repoPluginDir = repoPluginDirFlag >= 0 && args[repoPluginDirFlag + 1]
  ? args[repoPluginDirFlag + 1]
  : null;
const marketplaceRootFlag = args.indexOf('--marketplace-root');
const marketplaceRoot = marketplaceRootFlag >= 0 && args[marketplaceRootFlag + 1]
  ? args[marketplaceRootFlag + 1]
  : null;
const pluginProfileFlag = args.indexOf('--plugin-profile');
const pluginProfile: PluginPayloadOptions['profile'] = pluginProfileFlag >= 0 && args[pluginProfileFlag + 1]
  ? parsePluginProfile(args[pluginProfileFlag + 1])
  : 'skills-only';
const repoWorkspaceDirFlag = args.indexOf('--repo-workspace-dir');
const repoWorkspaceDir = repoWorkspaceDirFlag >= 0 && args[repoWorkspaceDirFlag + 1]
  ? args[repoWorkspaceDirFlag + 1]
  : null;

function parseTarget(value: string): BuildTargetName {
  if (value === 'ghcp' || value === 'claude' || value === 'codex') return value;
  throw new Error(`Unknown target: ${value}`);
}

function resolveFromRoot(path: string): string {
  return isAbsolute(path) ? path : join(ROOT, path);
}

function parsePluginProfile(value: string): PluginPayloadOptions['profile'] {
  if (value === 'skills-only' || value === 'full') return value;
  throw new Error(`Unknown plugin profile: ${value}`);
}

// Load canonical sources
console.log('Loading canonical sources...');
const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string };

console.log(`  ${skills.length} skills loaded`);
console.log(`  ${mcpServers.length} MCP servers loaded`);

// Build each target
const data: BuildData = { skills, mcpServers, agents, hooks, packageVersion: pkg.version };
if (!pluginOnly) {
  for (const target of selectedTargets) {
    const targetDir = join(distDir, 'workspace', target);
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });
  }

  for (const target of selectedTargets) {
    console.log(`\nBuilding workspace ${target}...`);
    buildTarget(target, data, join(distDir, 'workspace'));
    console.log(`  ✅ ${target} → ${join(distDir, 'workspace', target)}/`);
  }

  const pluginDir = join(distDir, 'plugin', 'azure-functions-skills');
  rmSync(pluginDir, { recursive: true, force: true });
  console.log('\nBuilding plugin payload...');
  buildPluginPayload(data, pluginDir, { profile: pluginProfile });
  console.log(`  ✅ plugin → ${pluginDir}/`);
}

if (repoPluginDir) {
  const outputDir = resolveFromRoot(repoPluginDir);
  rmSync(outputDir, { recursive: true, force: true });
  console.log('\nBuilding repository plugin payload...');
  buildPluginPayload(data, outputDir, { profile: pluginProfile });
  console.log(`  ✅ repository plugin → ${outputDir}/`);
}

if (repoWorkspaceDir) {
  const outputDir = resolveFromRoot(repoWorkspaceDir);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  console.log('\nBuilding repository workspace artifacts...');
  for (const target of TARGETS) {
    buildTarget(target, data, outputDir);
    console.log(`  ✅ ${target} → ${join(outputDir, target)}/`);
  }
  writeFileSync(join(outputDir, 'manifest.json'), JSON.stringify({
    package: '@azure/functions-skills',
    version: data.packageVersion || '0.0.0-dev',
    generatedAt: new Date(0).toISOString(),
    targets: TARGETS,
  }, null, 2));
  console.log(`  ✅ workspace manifest → ${join(outputDir, 'manifest.json')}`);
}

if (marketplaceRoot) {
  const outputDir = resolveFromRoot(marketplaceRoot);
  console.log('\nBuilding plugin marketplaces...');
  buildPluginMarketplaces(outputDir, {
    packageVersion: pkg.version,
    pluginSource: './.github/plugins/azure-functions-skills',
  });
  console.log(`  ✅ marketplaces → ${outputDir}/`);
}

console.log('\nDone.');
