#!/usr/bin/env node

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPluginMarketplaces, buildPluginPayload, buildTarget } from './build-target.js';
import { loadAgents, loadHooks, loadMcpServers, loadSkills } from './loader.js';
import type { BuildData } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEMPLATES_DIR = join(ROOT, 'templates');
const COMMITTED_PLUGIN_DIR = join(ROOT, '.github', 'plugins', 'azure-functions-skills');
const COMMITTED_WORKSPACE_DIR = join(ROOT, '.github', 'generated', 'workspace');
const TARGETS = ['ghcp', 'claude', 'codex'] as const;

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string };
  return pkg.version;
}

function loadBuildData(): BuildData {
  return {
    skills: loadSkills(join(TEMPLATES_DIR, 'skills')),
    mcpServers: loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml')),
    agents: loadAgents(join(TEMPLATES_DIR, 'agents')),
    hooks: loadHooks(join(TEMPLATES_DIR, 'hooks')),
    packageVersion: readPackageVersion(),
  };
}

function listFiles(root: string): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) files.push(relative(root, fullPath).replaceAll('\\', '/'));
    }
  }

  walk(root);
  return files.sort();
}

function assertSameFile(expectedRoot: string, actualRoot: string, relativePath: string, errors: string[]): void {
  const expectedPath = join(expectedRoot, relativePath);
  const actualPath = join(actualRoot, relativePath);
  try {
    const expected = readFileSync(expectedPath, 'utf-8');
    const actual = readFileSync(actualPath, 'utf-8');
    if (expected !== actual) errors.push(`Changed generated artifact: ${relativePath}`);
  } catch {
    errors.push(`Missing generated artifact: ${relativePath}`);
  }
}

function compareTrees(expectedRoot: string, actualRoot: string, label: string, errors: string[]): void {
  const expectedFiles = listFiles(expectedRoot);
  const actualFiles = statSync(actualRoot).isDirectory() ? listFiles(actualRoot) : [];
  const expectedSet = new Set(expectedFiles);
  const actualSet = new Set(actualFiles);

  for (const file of expectedFiles) {
    if (!actualSet.has(file)) errors.push(`Missing generated artifact: ${label}/${file}`);
    else assertSameFile(expectedRoot, actualRoot, file, errors);
  }

  for (const file of actualFiles) {
    if (!expectedSet.has(file)) errors.push(`Unexpected generated artifact: ${label}/${file}`);
  }
}

function main(): void {
  const tempRoot = mkdtempSync(join(tmpdir(), 'af-skills-plugin-verify-'));
  const errors: string[] = [];

  try {
    const data = loadBuildData();
    buildPluginPayload(data, join(tempRoot, '.github', 'plugins', 'azure-functions-skills'));
    for (const target of TARGETS) buildTarget(target, data, join(tempRoot, '.github', 'generated', 'workspace'));
    const generatedWorkspaceDir = join(tempRoot, '.github', 'generated', 'workspace');
    writeFileSync(join(generatedWorkspaceDir, 'manifest.json'), JSON.stringify({
      package: '@azure/functions-skills',
      version: data.packageVersion || '0.0.0-dev',
      generatedAt: new Date(0).toISOString(),
      targets: TARGETS,
    }, null, 2));
    buildPluginMarketplaces(tempRoot, {
      packageVersion: data.packageVersion || '0.0.0-dev',
      pluginSource: './.github/plugins/azure-functions-skills',
    });

    compareTrees(
      join(tempRoot, '.github', 'plugins', 'azure-functions-skills'),
      COMMITTED_PLUGIN_DIR,
      '.github/plugins/azure-functions-skills',
      errors,
    );
    compareTrees(
      generatedWorkspaceDir,
      COMMITTED_WORKSPACE_DIR,
      '.github/generated/workspace',
      errors,
    );

    for (const relativePath of [join('.plugin', 'marketplace.json'), join('.claude-plugin', 'marketplace.json')]) {
      const normalized = relativePath.replaceAll('\\', '/');
      assertSameFile(tempRoot, ROOT, normalized, errors);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  if (errors.length > 0) {
    console.error('Generated plugin payload is out of date. Run `npm run build:plugin-payload`.');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log('✅ Plugin payload is up to date.');
}

main();
