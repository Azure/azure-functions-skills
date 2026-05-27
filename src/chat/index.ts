/**
 * Chat module — launch CLI coding agents with Azure Functions startup prompt.
 *
 * CLI usage: azure-functions-skills chat [--agent <name>] [--prompt <text>] [--dir <path>]
 * Library:   import { chat, buildStartupPrompt, LAUNCHERS } from '@azure/functions-skills/chat'
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { loadSkills } from '../build/loader.js';
import type { ChatOptions, ChatResult, DetectedCliAgent, Launcher, LauncherId } from '../types.js';

type ResolvedLauncherCommand = {
  command: string;
  argsPrefix: string[];
  shell: boolean;
};

type ResolveLauncherOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

type StartupPromptOptions = {
  setupSkillPending?: boolean;
  setupCompleteCommand?: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', '..', 'templates', 'prompts');

// ─── Launcher configurations ───

export const LAUNCHERS: Record<LauncherId, Launcher> = {
  'github-copilot': {
    command: 'copilot',
    buildArgs: (ctx) => {
      const passthroughArgs = ctx.passthroughArgs || [];
      const args = ['--experimental', '--agent', 'functions-copilot', ...passthroughArgs];
      if (ctx.startupPrompt && !hasCopilotPromptArg(passthroughArgs)) args.push('-i', ctx.startupPrompt);
      return args;
    },
    description: 'GitHub Copilot CLI',
  },
  'claude-code': {
    command: 'claude',
    buildArgs: (ctx) => {
      const args = [...(ctx.passthroughArgs || [])];
      if (ctx.startupPrompt) insertClaudePrompt(args, ctx.startupPrompt);
      return args;
    },
    description: 'Claude Code',
  },
  'codex': {
    command: 'codex',
    buildArgs: (ctx) => {
      const args = [...(ctx.passthroughArgs || [])];
      if (ctx.startupPrompt) args.push(ctx.startupPrompt);
      return args;
    },
    description: 'Codex CLI',
  },
};

function hasCopilotPromptArg(args: string[]): boolean {
  return args.some(arg => arg === '-p' || arg === '--prompt' || arg === '-i' || arg === '--interactive');
}

function insertClaudePrompt(args: string[], startupPrompt: string): void {
  const printIndex = args.findIndex(arg => arg === '-p' || arg === '--print');
  if (printIndex >= 0) {
    const nextArg = args[printIndex + 1];
    if (nextArg && !nextArg.startsWith('-')) return;
    args.splice(printIndex + 1, 0, startupPrompt);
    return;
  }
  args.push(startupPrompt);
}

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
export async function buildStartupPrompt(dir: string, options: StartupPromptOptions = {}): Promise<string> {
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
        '   → Run azure-functions-deploy to deploy your app to Azure through the Azure Skills plugin',
        '   → Ensure the Azure Skills plugin is installed for prepare/validate/deploy workflows',
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

  if (options.setupSkillPending) {
    return `${setupInstruction(options.setupCompleteCommand)}\n\n${template}`;
  }

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

  const basePrompt = options.prompt || await buildStartupPrompt(dir);
  const startupPrompt = options.setupSkillPending
    ? `${setupInstruction(options.setupCompleteCommand)} ${basePrompt}`
    : basePrompt;
  const args = launcher.buildArgs({ startupPrompt, passthroughArgs: options.passthroughArgs });
  const resolvedLauncher = resolveLauncherCommand(launcher.command);

  const child = spawn(resolvedLauncher.command, [...resolvedLauncher.argsPrefix, ...args], {
    cwd: dir,
    stdio: 'inherit',
    shell: resolvedLauncher.shell,
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

function setupInstruction(setupCompleteCommand: string | undefined): string {
  const completeCommand = setupCompleteCommand || 'azure-functions-skills state setup-complete --dir .';
  return [
    'First run azure-functions-setup before other Azure Functions Skills workflows in this workspace.',
    `After azure-functions-setup completes, run: ${completeCommand}.`,
    'If that command is unavailable, update .azure-functions-skills/state.local.json directly: set setupSkill to { "status": "completed", "completedAt": the current ISO-8601 time, "completedBy": the active agent }, preserve the rest of the file, and update workspace.updatedAt.',
  ].join(' ');
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

export function resolveLauncherCommand(command: string, options: ResolveLauncherOptions = {}): ResolvedLauncherCommand {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') {
    return { command, argsPrefix: [], shell: false };
  }

  try {
    const candidates = findWindowsLauncherCandidates(command, options.env || process.env);
    const resolved = pickWindowsLauncherCandidate(candidates);
    if (!resolved) return { command, argsPrefix: [], shell: false };
    if (/\.(cmd|bat)$/i.test(resolved)) {
      return {
        command: 'cmd.exe',
        argsPrefix: ['/d', '/s', '/c', resolved],
        shell: false,
      };
    }
    if (/\.ps1$/i.test(resolved)) {
      return {
        command: 'powershell.exe',
        argsPrefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolved],
        shell: false,
      };
    }
    return { command: resolved, argsPrefix: [], shell: false };
  } catch {
    return { command, argsPrefix: [], shell: false };
  }
}

function findWindowsLauncherCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
  const pathValue = env.Path || env.PATH || '';
  const pathExtValue = env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.PS1';
  const extensions = pathExtValue
    .split(';')
    .map(extension => extension.trim())
    .filter(Boolean);
  const commandHasExtension = /\.[^\\/]+$/.test(command);
  const commandNames = commandHasExtension ? [command] : [...extensions.map(extension => `${command}${extension.toLowerCase()}`), command];
  const candidates: string[] = [];

  for (const directory of pathValue.split(';').map(entry => entry.trim()).filter(Boolean)) {
    for (const commandName of commandNames) {
      const candidate = join(directory, commandName);
      if (existsSync(candidate)) candidates.push(candidate);
    }
  }

  return candidates;
}

function pickWindowsLauncherCandidate(candidates: string[]): string | undefined {
  return candidates[0];
}
