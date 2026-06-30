/**
 * Setup module — detects coding agents and applies Azure Functions skill files.
 * Usable as CLI (`npx @azure/functions-skills setup`) or library (VS Code extension).
 */

import { existsSync, mkdirSync, cpSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { loadSkills, loadMcpServers, loadAgents, loadHooks } from '../build/loader.js';
import { buildTarget } from '../build/build-target.js';
import { ensurePrerequisites } from './prerequisites/index.js';
import { cleanupTemplateSource, loadBuildDataFromTemplates, resolveTemplateSource } from './template-source.js';
import type { BuildData, CliAgentName, SetupOptions, SetupResult, TemplateSourceResult } from '../types.js';

/**
 * Detect which coding agents are available in the environment.
 * Returns an array of agent identifiers: 'ghcp', 'claude', 'codex'.
 */
export async function detectAgents(): Promise<CliAgentName[]> {
  const agents: CliAgentName[] = [];

  // IDE detection (file-based)
  if (existsSync('.vscode') || process.env.VSCODE_PID) {
    agents.push('ghcp');
  }

  // CLI binary detection
  const checks: Array<{ name: CliAgentName; cmd: string }> = [
    { name: 'claude', cmd: process.platform === 'win32' ? 'where claude' : 'which claude' },
    { name: 'codex', cmd: process.platform === 'win32' ? 'where codex' : 'which codex' },
  ];

  for (const { name, cmd } of checks) {
    try {
      execSync(cmd, { stdio: 'ignore' });
      agents.push(name);
    } catch {
      // not installed
    }
  }

  // Cursor detection
  if (existsSync('.cursor')) {
    agents.push('ghcp'); // Cursor uses GHCP-compatible format
  }

  // If nothing detected, default to ghcp (most common)
  if (agents.length === 0) {
    agents.push('ghcp');
  }

  return [...new Set(agents)];
}

/**
 * Apply Azure Functions skill setup to a target directory.
 *
 * @param {string} targetDir - Directory to write files to
 * @param {object} options
 * @param {string[]} options.agents - Agent identifiers to set up for
 * @returns {object} Summary with agents, filesWritten, welcomeMessage
 */
export async function applySetup(targetDir: string, options: SetupOptions = {}): Promise<SetupResult> {
  const agents = options.agents || await detectAgents();
  const prerequisiteMode = options.prerequisites || 'auto';

  const templateSource = resolveTemplateSource(options.templateSource);
  let data: BuildData | null = null;
  if (templateSource.templatesDir) {
    const templatePaths = loadBuildDataFromTemplates(templateSource.templatesDir);
    const skills = loadSkills(templatePaths.skillsDir);
    const mcpServers = loadMcpServers(templatePaths.mcpServersPath);
    const agentDefs = loadAgents(templatePaths.agentsDir);
    const hooks = loadHooks(templatePaths.hooksDir);
    data = { skills, mcpServers, agents: agentDefs, hooks };
  }
  const setupSkills = loadSetupSkills(data, templateSource, agents);

  // Build each target to a temp location, then copy to targetDir
  const tmpDir = mkdtempSync(join(tmpdir(), 'af-skills-tmp-'));
  let totalFiles = 0;

  try {
    for (const agent of agents) {
      const agentDir = templateSource.workspaceDir
        ? join(templateSource.workspaceDir, agent)
        : buildWorkspaceTarget(agent, data, tmpDir);
      totalFiles += copyWorkspaceFiles(agentDir, targetDir, agent);
    }
  } finally {
    // Cleanup temp dir (in OS temp, no lock issues)
    try {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup — OS temp dir will be cleaned eventually
    }
    cleanupTemplateSource(templateSource);
  }

  const prerequisiteResults = await ensurePrerequisites({
    targets: agents,
    projectDir: targetDir,
    mode: prerequisiteMode,
    runner: options.prerequisiteRunner,
  });

  const skillLines = setupSkills.map(skill => `    • ${skill.id} — ${skill.title}`);
  const prerequisiteLines = formatPrerequisiteLines(prerequisiteResults);
  const welcomeMessage = [
    '',
    '⚡ Azure Functions Skills installed!',
    '',
    `  Agents configured: ${agents.join(', ')}`,
    `  Files written: ${totalFiles}`,
    '',
    '  Skills available:',
    ...skillLines,
    '',
    '  External prerequisites:',
    ...prerequisiteLines,
    '',
    '  Get started: Ask your AI assistant to "set up Azure Functions"',
    '',
  ].join('\n');

  return {
    agents,
    filesWritten: totalFiles,
    welcomeMessage,
    prerequisites: prerequisiteResults,
    templateSource: {
      kind: templateSource.kind,
      templatesDir: templateSource.templatesDir,
      workspaceDir: templateSource.workspaceDir,
    },
    warnings: templateSource.warnings,
  };
}

function buildWorkspaceTarget(agent: CliAgentName, data: BuildData | null, tmpDir: string): string {
  if (!data) throw new Error('Template build data is required when generated workspace artifacts are unavailable.');
  mkdirSync(tmpDir, { recursive: true });
  buildTarget(agent, data, tmpDir);
  return join(tmpDir, agent);
}

function loadSetupSkills(
  data: BuildData | null,
  templateSource: TemplateSourceResult,
  agents: readonly CliAgentName[],
): BuildData['skills'] {
  if (data) return data.skills;
  if (!templateSource.workspaceDir) {
    throw new Error('Generated workspace artifacts are required when template build data is unavailable.');
  }
  return loadSkills(workspaceSkillsDir(templateSource.workspaceDir, agents[0] ?? 'ghcp'));
}

function workspaceSkillsDir(workspaceDir: string, agent: CliAgentName): string {
  if (agent === 'ghcp') return join(workspaceDir, agent, '.github', 'skills');
  if (agent === 'claude') return join(workspaceDir, agent, '.claude', 'skills');
  return join(workspaceDir, agent, '.agents', 'skills');
}

function formatPrerequisiteLines(results: SetupResult['prerequisites']): string[] {
  if (!results || results.length === 0) return ['    • none'];
  return results.map(result => `    • ${result.id} (${result.target}) — ${result.status}: ${result.message}`);
}

function copyWorkspaceFiles(src: string, dest: string, agent: CliAgentName): number {
  return copyRecursive(src, dest, relativePath => !isPluginOnlyArtifact(agent, relativePath));
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
 * Copy all files from src to dest recursively.
 * Returns the number of files copied.
 */
function copyRecursive(src: string, dest: string, shouldCopy: (relativePath: string) => boolean, relativePath = ''): number {
  if (!existsSync(src)) return 0;
  let count = 0;

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    const entryRelativePath = relativePath ? join(relativePath, entry.name) : entry.name;

    if (!shouldCopy(entryRelativePath)) continue;

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      count += copyRecursive(srcPath, destPath, shouldCopy, entryRelativePath);
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}
