/**
 * Setup module — detects coding agents and applies Azure Functions skill files.
 * Usable as CLI (`npx @agent-loom/azure-functions-skills setup`) or library (VS Code extension).
 */

import { existsSync, mkdirSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { loadSkills, loadMcpServers, loadAgents, loadHooks } from '../build/loader.js';
import { buildTarget } from '../build/build-target.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..');

/**
 * Detect which coding agents are available in the environment.
 * Returns an array of agent identifiers: 'ghcp', 'claude', 'codex'.
 */
export async function detectAgents() {
  const agents = [];

  // IDE detection (file-based)
  if (existsSync('.vscode') || process.env.VSCODE_PID) {
    agents.push('ghcp');
  }

  // CLI binary detection
  const checks = [
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
export async function applySetup(targetDir, options = {}) {
  const agents = options.agents || await detectAgents();

  // Load canonical sources
  const skills = loadSkills(join(SRC_DIR, 'skills'));
  const mcpServers = loadMcpServers(join(SRC_DIR, 'mcp', 'servers.yaml'));
  const agentDefs = loadAgents(join(SRC_DIR, 'agents'));
  const hooks = loadHooks(join(SRC_DIR, 'hooks'));
  const data = { skills, mcpServers, agents: agentDefs, hooks };

  // Build each target to a temp location, then copy to targetDir
  const tmpDir = join(tmpdir(), `af-skills-tmp-${Date.now()}`);
  let totalFiles = 0;

  try {
    for (const agent of agents) {
      mkdirSync(tmpDir, { recursive: true });
      buildTarget(agent, data, tmpDir);

      // Copy from tmpDir/<agent>/ to targetDir/
      const agentDir = join(tmpDir, agent);
      totalFiles += copyRecursive(agentDir, targetDir);
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
  }

  const welcomeMessage = [
    '',
    '⚡ Azure Functions Skills installed!',
    '',
    `  Agents configured: ${agents.join(', ')}`,
    `  Files written: ${totalFiles}`,
    '',
    '  Skills available:',
    '    • azure-functions-setup  — Verify prerequisites',
    '    • azure-functions-create — Scaffold a new project',
    '    • azure-functions-deploy — Deploy to Azure',
    '',
    '  Get started: Ask your AI assistant to "set up Azure Functions"',
    '',
  ].join('\n');

  return {
    agents,
    filesWritten: totalFiles,
    welcomeMessage,
  };
}

/**
 * Copy all files from src to dest recursively.
 * Returns the number of files copied.
 */
function copyRecursive(src, dest) {
  if (!existsSync(src)) return 0;
  let count = 0;

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      count += copyRecursive(srcPath, destPath);
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}
