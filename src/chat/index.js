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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

// ─── Launcher configurations ───

export const LAUNCHERS = {
  'github-copilot': {
    command: 'copilot',
    buildArgs: (ctx) => {
      const args = [];
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
export async function detectCliAgents() {
  const found = [];
  for (const [id, launcher] of Object.entries(LAUNCHERS)) {
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

function detectProject(dir) {
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
export async function buildStartupPrompt(dir) {
  const templatePath = join(PROMPTS_DIR, 'startup.md');
  let template = await readFile(templatePath, 'utf8');

  const project = detectProject(dir);

  const projectContext = project
    ? `📂 Functions project detected (${project.language})`
    : '📂 No Functions project found — ready to create one';

  const skillList = 'azure-functions-setup, azure-functions-create, azure-functions-deploy';

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
export async function chat(options = {}) {
  const dir = options.dir || process.cwd();
  const agentId = options.agent || (await pickAgent());
  const launcher = LAUNCHERS[agentId];

  if (!launcher) {
    throw new Error(`Unknown agent: ${agentId}. Available: ${Object.keys(LAUNCHERS).join(', ')}`);
  }

  const startupPrompt = options.prompt || await buildStartupPrompt(dir);
  const args = launcher.buildArgs({ startupPrompt });

  const child = spawn(launcher.command, args, {
    cwd: dir,
    stdio: 'inherit',
    shell: false,
  });

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      throw new Error(`${launcher.command} not found. Install it first.`);
    }
    throw err;
  });

  return { childProcess: child, agent: agentId, prompt: startupPrompt };
}

async function pickAgent() {
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
