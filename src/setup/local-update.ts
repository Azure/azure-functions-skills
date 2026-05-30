/**
 * Local update module — updates a locally-installed workspace with file-type-aware strategies.
 *
 * Unlike `applySetup()` which overwrites everything via cpSync, this module:
 * - Overwrites managed content (skills, agent definitions, hooks)
 * - Uses managed-block replacement for routing files (preserves user customizations)
 * - Saves aside settings files for user to merge manually
 * - Supports --force to overwrite everything
 */

import { existsSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildTarget } from '../build/build-target.js';
import { loadAgents, loadHooks, loadMcpServers, loadSkills } from '../build/loader.js';
import type { BuildData, CliAgentName } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

const BLOCK_PATTERN = /<!-- azure-functions-skills:start[^\n]* -->[\s\S]*?<!-- azure-functions-skills:end -->/;

export interface LocalUpdateOptions {
  agents: CliAgentName[];
  force?: boolean;
  dryRun?: boolean;
}

export interface LocalUpdateResult {
  agents: CliAgentName[];
  overwritten: string[];
  managedBlockUpdated: string[];
  savedAside: Array<{ original: string; aside: string }>;
  dryRun: boolean;
}

type FileAction = 'overwrite' | 'managed-block' | 'save-aside';

interface GeneratedFile {
  /** Relative path within the workspace (e.g., '.github/copilot-instructions.md') */
  relativePath: string;
  /** Full path in the staged temp directory */
  stagedPath: string;
  /** How this file should be applied */
  action: FileAction;
}

/**
 * Apply a local update to a workspace, using file-type-aware strategies.
 */
export async function applyLocalUpdate(targetDir: string, options: LocalUpdateOptions): Promise<LocalUpdateResult> {
  const agents = options.agents;
  const force = options.force === true;
  const dryRun = options.dryRun === true;

  const data = loadBuildData();
  const tmpDir = join(tmpdir(), `af-skills-update-${Date.now()}`);

  const result: LocalUpdateResult = {
    agents,
    overwritten: [],
    managedBlockUpdated: [],
    savedAside: [],
    dryRun,
  };

  try {
    for (const agent of agents) {
      mkdirSync(tmpDir, { recursive: true });
      buildTarget(agent, data, tmpDir);

      const agentDir = join(tmpDir, agent);
      const files = classifyFiles(agentDir, targetDir, agent, force);

      for (const file of files) {
        applyFile(file, agentDir, targetDir, result, dryRun);
      }
    }
  } finally {
    try {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best-effort cleanup */ }
  }

  return result;
}

/**
 * Generate the save-aside path for a file, preserving the original extension.
 * Example: `CLAUDE.md` → `CLAUDE.azure-functions-skills-new.md`
 */
export function saveAsidePath(filePath: string): string {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const aside = ext
    ? `${base}.azure-functions-skills-new${ext}`
    : `${base}.azure-functions-skills-new`;
  return dir === '.' ? aside : join(dir, aside);
}

// ── Internal helpers ──

function loadBuildData(): BuildData {
  return {
    skills: loadSkills(join(TEMPLATES_DIR, 'skills')),
    mcpServers: loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml')),
    agents: loadAgents(join(TEMPLATES_DIR, 'agents')),
    hooks: loadHooks(join(TEMPLATES_DIR, 'hooks')),
  };
}

/**
 * Classify all generated files into overwrite / managed-block / save-aside actions.
 */
function classifyFiles(agentDir: string, targetDir: string, agent: CliAgentName, force: boolean): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  collectFiles(agentDir, '', files);

  // Filter out plugin-only artifacts (same logic as copyWorkspaceFiles in index.ts)
  const workspaceFiles = files.filter(f => !isPluginOnlyArtifact(agent, f.relativePath));

  return workspaceFiles.map(file => ({
    ...file,
    action: resolveAction(file.relativePath, targetDir, force),
  }));
}

function collectFiles(dir: string, relativePath: string, result: GeneratedFile[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryRelative = relativePath ? join(relativePath, entry.name) : entry.name;
    const entryFull = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(entryFull, entryRelative, result);
    } else {
      result.push({ relativePath: entryRelative, stagedPath: entryFull, action: 'overwrite' });
    }
  }
}

/**
 * Determine the update action for a file based on its type and existing state.
 */
function resolveAction(relativePath: string, targetDir: string, force: boolean): FileAction {
  if (force) return 'overwrite';
  if (isSkillFile(relativePath)) return 'overwrite';
  if (isAgentDefinition(relativePath)) return 'overwrite';
  if (isHookFile(relativePath)) return 'overwrite';

  if (isRoutingFile(relativePath)) {
    const existing = join(targetDir, relativePath);
    if (!existsSync(existing)) return 'overwrite';
    const content = readFileSync(existing, 'utf-8');
    if (BLOCK_PATTERN.test(content)) return 'managed-block';
    return 'save-aside';
  }

  if (isSettingsFile(relativePath)) {
    const existing = join(targetDir, relativePath);
    if (!existsSync(existing)) return 'overwrite';
    return 'save-aside';
  }

  return 'overwrite';
}

function isSkillFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return normalized.includes('/skills/') || normalized.startsWith('.github/skills/') ||
    normalized.startsWith('.claude/skills/') || normalized.startsWith('.agents/skills/');
}

function isAgentDefinition(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return normalized.includes('/agents/') && normalized.endsWith('.agent.md');
}

function isHookFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return (normalized.includes('/hooks/') || normalized === '.codex/hooks.json') &&
    (normalized.endsWith('.json') || normalized.endsWith('.md'));
}

function isRoutingFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return normalized === '.github/copilot-instructions.md' ||
    normalized === 'CLAUDE.md' ||
    normalized === 'AGENTS.md';
}

function isSettingsFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return normalized === '.vscode/mcp.json' ||
    normalized === '.claude/settings.json' ||
    normalized === '.codex/config.toml' ||
    normalized === '.github/copilot/settings.json' ||
    normalized === '.agents/plugins/marketplace.json';
}

function isPluginOnlyArtifact(agent: CliAgentName, relativePath: string): boolean {
  const [topLevel, secondLevel] = relativePath.split(/[\\/]/);
  if (agent === 'ghcp') {
    return ['plugin.json', 'skills', 'agents', 'hooks.json', '.mcp.json'].includes(topLevel);
  }
  if (agent === 'codex') {
    if (['.codex-plugin', 'skills', '.mcp.json'].includes(topLevel)) return true;
    return topLevel === '.agents' && secondLevel === 'plugins';
  }
  return false;
}

/**
 * Apply a single file with the appropriate strategy.
 */
function applyFile(file: GeneratedFile, _agentDir: string, targetDir: string, result: LocalUpdateResult, dryRun: boolean): void {
  const destPath = join(targetDir, file.relativePath);
  const newContent = readFileSync(file.stagedPath, 'utf-8');

  switch (file.action) {
    case 'overwrite': {
      if (!dryRun) {
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(file.stagedPath, destPath);
      }
      result.overwritten.push(file.relativePath);
      break;
    }

    case 'managed-block': {
      if (!dryRun) {
        const existing = readFileSync(destPath, 'utf-8');
        const updated = existing.replace(BLOCK_PATTERN, buildManagedBlock(newContent));
        writeFileSync(destPath, updated);
      }
      result.managedBlockUpdated.push(file.relativePath);
      break;
    }

    case 'save-aside': {
      const asideRelative = resolveUniqueAsidePath(targetDir, file.relativePath);
      if (!dryRun) {
        const asideFull = join(targetDir, asideRelative);
        mkdirSync(dirname(asideFull), { recursive: true });
        writeFileSync(asideFull, newContent);
      }
      result.savedAside.push({ original: file.relativePath, aside: asideRelative });
      break;
    }
  }
}

/**
 * Build a managed block from generated routing content.
 * The content from buildTarget for routing files includes the full file content;
 * we extract the routing section for the managed block.
 */
function buildManagedBlock(generatedContent: string): string {
  // If the generated content already has a managed block, extract just the block
  const blockMatch = generatedContent.match(BLOCK_PATTERN);
  if (blockMatch) return blockMatch[0];

  // Otherwise wrap the content in a managed block
  return `<!-- azure-functions-skills:start version=0.12.1 -->\n${generatedContent.trimEnd()}\n<!-- azure-functions-skills:end -->`;
}

/**
 * Find a unique save-aside path, appending numeric suffixes if needed.
 */
function resolveUniqueAsidePath(targetDir: string, relativePath: string): string {
  const candidate = saveAsidePath(relativePath);
  if (!existsSync(join(targetDir, candidate))) return candidate;

  const dir = dirname(candidate);
  // Remove the .azure-functions-skills-new part to get base + original ext
  const originalExt = extname(relativePath);
  const originalBase = basename(relativePath, originalExt);

  for (let i = 1; i < 100; i++) {
    const numbered = originalExt
      ? `${originalBase}.azure-functions-skills-new.${i}${originalExt}`
      : `${originalBase}.azure-functions-skills-new.${i}`;
    const numberedPath = dir === '.' ? numbered : join(dir, numbered);
    if (!existsSync(join(targetDir, numberedPath))) return numberedPath;
  }

  // Fallback with timestamp
  const ts = Date.now();
  const fallback = originalExt
    ? `${originalBase}.azure-functions-skills-new.${ts}${originalExt}`
    : `${originalBase}.azure-functions-skills-new.${ts}`;
  return dir === '.' ? fallback : join(dir, fallback);
}
