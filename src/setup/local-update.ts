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
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildTarget } from '../build/build-target.js';
import { loadAgents, loadHooks, loadMcpServers, loadSkills } from '../build/loader.js';
import type { BuildData, CliAgentName } from '../types.js';
import { resolveUniqueAsidePath } from './save-aside.js';

export { saveAsidePath } from './save-aside.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

const BLOCK_PATTERN = /<!-- azure-functions-skills:start[^\n]* -->[\s\S]*?<!-- azure-functions-skills:end -->/;

export type FilePromptResult = 'overwrite' | 'skip';

/**
 * A function that prompts the user for an action on a shared file.
 * Receives the relative path and new content; returns the chosen action.
 */
export type FilePrompter = (relativePath: string, newContent: string, existingContent: string) => Promise<FilePromptResult>;

export interface LocalUpdateOptions {
  agents: CliAgentName[];
  force?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  /** When provided, called for each save-aside candidate to let user choose. */
  prompter?: FilePrompter;
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
  const yes = options.yes === true;
  const prompter = (!force && !yes && !dryRun) ? options.prompter : undefined;

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
        await applyFile(file, agentDir, targetDir, result, dryRun, prompter);
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
 * Create an interactive prompter that asks the user via readline.
 * Shows file path and offers: overwrite / skip / diff.
 */
export function createInteractivePrompter(): FilePrompter {
  return async (relativePath: string, newContent: string, existingContent: string): Promise<FilePromptResult> => {
    const { createInterface } = await import('node:readline/promises');

    while (true) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        console.log(`\n  File: ${relativePath}`);
        console.log('  This file has been customized. Choose an action:');
        console.log('    1. overwrite — Replace with new version');
        console.log('    2. skip      — Keep current, save new as .azure-functions-skills-new');
        console.log('    3. diff      — Show differences');
        const answer = (await rl.question('  Choice [1/2/3] (default: 2): ')).trim();

        if (answer === '1' || answer.toLowerCase() === 'overwrite') return 'overwrite';
        if (answer === '' || answer === '2' || answer.toLowerCase() === 'skip') return 'skip';
        if (answer === '3' || answer.toLowerCase() === 'diff') {
          showSimpleDiff(relativePath, existingContent, newContent);
          continue;
        }
        console.log('  Invalid choice. Please enter 1, 2, or 3.');
      } finally {
        rl.close();
      }
    }
  };
}

function showSimpleDiff(relativePath: string, existing: string, updated: string): void {
  const existingLines = existing.split('\n');
  const updatedLines = updated.split('\n');
  console.log(`\n  --- ${relativePath} (current)`);
  console.log(`  +++ ${relativePath} (new)`);

  const maxLines = Math.max(existingLines.length, updatedLines.length);
  for (let i = 0; i < maxLines; i++) {
    const oldLine = existingLines[i];
    const newLine = updatedLines[i];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined && newLine !== undefined) {
      console.log(`  - ${oldLine}`);
      console.log(`  + ${newLine}`);
    } else if (oldLine !== undefined) {
      console.log(`  - ${oldLine}`);
    } else {
      console.log(`  + ${newLine}`);
    }
  }
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
  return normalized === '.mcp.json' ||
    normalized === '.vscode/mcp.json' ||
    normalized === '.claude/settings.json' ||
    normalized === '.codex/config.toml' ||
    normalized === '.github/copilot/settings.json' ||
    normalized === '.agents/plugins/marketplace.json';
}

function isPluginOnlyArtifact(agent: CliAgentName, relativePath: string): boolean {
  const [topLevel, secondLevel] = relativePath.split(/[\\/]/);
  if (agent === 'ghcp') {
    return ['plugin.json', 'skills', 'agents', 'hooks.json'].includes(topLevel);
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
async function applyFile(file: GeneratedFile, _agentDir: string, targetDir: string, result: LocalUpdateResult, dryRun: boolean, prompter?: FilePrompter): Promise<void> {
  const destPath = join(targetDir, file.relativePath);
  const newContent = readFileSync(file.stagedPath, 'utf-8');

  // For save-aside candidates, ask the user if a prompter is available
  if (file.action === 'save-aside' && prompter && existsSync(destPath)) {
    const existingContent = readFileSync(destPath, 'utf-8');
    const choice = await prompter(file.relativePath, newContent, existingContent);
    if (choice === 'overwrite') {
      if (!dryRun) {
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(file.stagedPath, destPath);
      }
      result.overwritten.push(file.relativePath);
      return;
    }
    // choice === 'skip' → fall through to save-aside
  }

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
