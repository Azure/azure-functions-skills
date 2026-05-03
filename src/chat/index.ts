/**
 * Chat module — launch CLI coding agents with Azure Functions startup prompt.
 *
 * CLI usage: azure-functions-skills chat [--agent <name>] [--prompt <text>] [--dir <path>]
 * Library:   import { chat, buildStartupPrompt, LAUNCHERS } from '@agent-loom/azure-functions-skills/chat'
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { applySetup } from '../setup/index.js';
import { loadSkills } from '../build/loader.js';
import type { BuildTargetName, ChatOptions, ChatResult, DetectedCliAgent, Launcher, LauncherId } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', '..', 'templates', 'prompts');

// ─── Launcher configurations ───

export const LAUNCHERS: Record<LauncherId, Launcher> = {
  'github-copilot': {
    command: 'copilot',
    buildArgs: (ctx) => {
      const args = ['--agent', 'functions-guide'];
      if (ctx.startupPrompt) args.push('-i', ctx.startupPrompt);
      return args;
    },
    description: 'GitHub Copilot CLI',
  },
  'claude-code': {
    command: 'claude',
    buildArgs: (ctx) => {
      const args = [];
      if (ctx.startupPrompt) args.push(ctx.startupPrompt);
      return args;
    },
    description: 'Claude Code',
  },
  'codex': {
    command: 'codex',
    buildArgs: (ctx) => {
      const args = [];
      if (ctx.startupPrompt) args.push(ctx.startupPrompt);
      return args;
    },
    description: 'Codex CLI',
  },
};

// ─── Agent detection ───

/**
 * Detect which CLI coding agents are installed.
 * @returns {Promise<Array<{id: string, command: string, description: string}>>}
 */
export async function detectCliAgents(): Promise<DetectedCliAgent[]> {
  const found: DetectedCliAgent[] = [];
  for (const [id, launcher] of Object.entries(LAUNCHERS) as Array<[LauncherId, Launcher]>) {
    const cmd = process.platform === 'win32'
      ? `where ${launcher.command}`
      : `which ${launcher.command}`;
    try {
      execSync(cmd, { stdio: 'ignore' });
      found.push({ id, command: launcher.command, description: launcher.description });
    } catch {
      // not installed
    }
  }
  return found;
}

// ─── Project detection ───

function detectProject(dir: string): { language: string; hasHostJson: true } | null {
  const hostJsonPath = join(dir, 'host.json');
  if (!existsSync(hostJsonPath)) return null;

  let language = 'unknown';
  if (existsSync(join(dir, 'package.json'))) language = 'node';
  else if (existsSync(join(dir, 'requirements.txt')) || existsSync(join(dir, 'function_app.py'))) language = 'python';
  else if (existsSync(join(dir, '*.csproj'))) language = 'dotnet';

  return { language, hasHostJson: true };
}

// ─── Startup prompt ───

/**
 * Build the startup prompt from template + project context.
 * @param {string} dir - Project directory to analyze
 * @returns {Promise<string>}
 */
export async function buildStartupPrompt(dir: string): Promise<string> {
  const templatePath = join(PROMPTS_DIR, 'startup.md');
  let template = await readFile(templatePath, 'utf8');

  const project = detectProject(dir);

  const projectContext = project
    ? `📂 Functions project detected (${project.language})`
    : '📂 No Functions project found — ready to create one';

  const skillList = loadSkills(join(__dirname, '..', '..', 'templates', 'skills'))
    .map(skill => skill.id)
    .join(', ');

  const suggestedActions = project
    ? [
        '🚀 Suggested next steps:',
        '   → Run azure-functions-deploy to deploy your app to Azure',
        '   → Run azure-functions-create to add another function',
        '   → Ask about best practices for your project',
      ].join('\n')
    : [
        '🚀 Suggested next steps:',
        '   → Run azure-functions-setup to verify your environment',
        '   → Run azure-functions-create to scaffold a new Azure Functions project',
        '   → Ask "help me create a function"',
      ].join('\n');

  template = template.replaceAll('{{projectContext}}', projectContext);
  template = template.replaceAll('{{skillList}}', skillList);
  template = template.replaceAll('{{suggestedActions}}', suggestedActions);

  return template;
}

// ─── Chat launcher ───

/**
 * Launch a CLI coding agent with Azure Functions startup prompt.
 *
 * @param {object} options
 * @param {string} [options.agent] - Agent ID (github-copilot, claude-code, codex)
 * @param {string} [options.prompt] - Custom prompt (overrides startup template)
 * @param {string} [options.dir] - Working directory
 * @returns {Promise<{childProcess: object, agent: string, prompt: string}>}
 */
export async function chat(options: ChatOptions = {}): Promise<ChatResult> {
  const dir = options.dir || process.cwd();
  const agentId = options.agent || (await pickAgent());
  const launcher = LAUNCHERS[agentId];

  if (!launcher) {
    throw new Error(`Unknown agent: ${agentId}. Available: ${Object.keys(LAUNCHERS).join(', ')}`);
  }

  // Auto-setup: ensure skills are installed before launching the agent
  const agentToSetupTarget: Record<LauncherId, BuildTargetName> = {
    'github-copilot': 'ghcp',
    'claude-code': 'claude',
    'codex': 'codex',
  };
  const setupTarget = agentToSetupTarget[agentId];
  if (setupTarget && !isSetupDone(dir, setupTarget)) {
    const result = await applySetup(dir, { agents: [setupTarget] });
    if (result.filesWritten > 0) {
      process.stderr.write(`📦 Installed ${result.filesWritten} skill files for ${setupTarget}\n`);
    }
  }

  const startupPrompt = options.prompt || await buildStartupPrompt(dir);
  const args = launcher.buildArgs({ startupPrompt });

  const child = spawn(launcher.command, args, {
    cwd: dir,
    stdio: 'inherit',
    shell: false,
  });

  return new Promise((resolve, reject) => {
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`${launcher.command} not found. Install it first.`));
      } else {
        reject(err);
      }
    });

    child.on('spawn', () => {
      resolve({ childProcess: child, agent: agentId, prompt: startupPrompt });
    });
  });
}

async function pickAgent(): Promise<LauncherId> {
  const agents = await detectCliAgents();
  if (agents.length === 0) {
    throw new Error(
      'No CLI coding agent found. Install one of:\n' +
      '  • GitHub Copilot CLI: gh extension install github/gh-copilot\n' +
      '  • Claude Code: https://claude.ai/download\n' +
      '  • Codex: npm install -g @openai/codex'
    );
  }
  return agents[0].id;
}

/**
 * Check if skill files are already present for a given target.
 */
function isSetupDone(dir: string, target: BuildTargetName): boolean {
  const checks = {
    ghcp: [
      join(dir, '.github', 'copilot-instructions.md'),
      join(dir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'),
    ],
    claude: [
      join(dir, 'CLAUDE.md'),
      join(dir, '.claude', 'skills', 'azure-functions-setup', 'SKILL.md'),
    ],
    codex: [
      join(dir, 'AGENTS.md'),
      join(dir, '.agents', 'skills', 'azure-functions-setup', 'SKILL.md'),
    ],
  };
  const files = checks[target] || [];
  return files.every(f => existsSync(f));
}
