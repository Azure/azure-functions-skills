#!/usr/bin/env node

/**
 * Build script — generates GHCP, Claude, and Codex plugin artifacts from canonical sources.
 *
 * Usage:
 *   node src/build/build.js              # build all targets
 *   node src/build/build.js --target ghcp # build one target
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, mkdirSync } from 'node:fs';
import { loadSkills, loadMcpServers, loadAgents, loadHooks } from './loader.js';
import { buildTarget } from './build-target.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEMPLATES_DIR = join(ROOT, 'templates');
const DIST_DIR = join(ROOT, 'dist');

const TARGETS = ['ghcp', 'claude', 'codex'];

// Parse args
const args = process.argv.slice(2);
const targetFlag = args.indexOf('--target');
const selectedTargets = targetFlag >= 0 && args[targetFlag + 1]
  ? [args[targetFlag + 1]]
  : TARGETS;

// Load canonical sources
console.log('Loading canonical sources...');
const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));

console.log(`  ${skills.length} skills loaded`);
console.log(`  ${mcpServers.length} MCP servers loaded`);

// Clean dist
for (const target of selectedTargets) {
  const targetDir = join(DIST_DIR, target);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
}

// Build each target
const data = { skills, mcpServers, agents, hooks };
for (const target of selectedTargets) {
  console.log(`\nBuilding ${target}...`);
  buildTarget(target, data, DIST_DIR);
  console.log(`  ✅ ${target} → dist/${target}/`);
}

console.log('\nDone.');
