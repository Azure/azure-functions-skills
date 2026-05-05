import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDefinitions, BuildData, BuildTargetName, HookDefinitions, McpServer, Skill } from '../types.js';

type TargetBuilder = (data: BuildData, distDir: string) => void;

interface PluginMarketplaceOptions {
  packageVersion: string;
  pluginSource: string;
}

/**
 * Build output for a specific target (ghcp, claude, codex).
 */
export function buildTarget(target: BuildTargetName, data: BuildData, distDir: string): void {
  const builders: Record<BuildTargetName, TargetBuilder> = { ghcp: buildGhcp, claude: buildClaude, codex: buildCodex };
  const builder = builders[target];
  if (!builder) throw new Error(`Unknown target: ${target}`);
  builder(data, distDir);
}

/**
 * Build the self-contained plugin payload used for GitHub repository based
 * plugin installation and release bundles. Unlike `buildTarget`, this does not
 * emit workspace-specific files such as `.github/skills` or `.agents/skills`.
 */
export function buildPluginPayload(data: BuildData, pluginDir: string): void {
  mkdirSync(pluginDir, { recursive: true });

  const manifest = generatePluginManifest(data);
  mkdirSync(join(pluginDir, '.plugin'), { recursive: true });
  writeFileSync(join(pluginDir, '.plugin', 'plugin.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2));

  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2));

  mkdirSync(join(pluginDir, '.codex-plugin'), { recursive: true });
  writeFileSync(join(pluginDir, '.codex-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2));

  for (const skill of data.skills) {
    const skillDir = join(pluginDir, 'skills', skill.id);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), generateSkillMd(skill));
    copySkillAssets(skill, skillDir);
  }

  mkdirSync(join(pluginDir, 'agents'), { recursive: true });
  writeFileSync(join(pluginDir, 'agents', 'functions-copilot.agent.md'), data.agents.copilot);

  writeFileSync(join(pluginDir, '.mcp.json'), JSON.stringify(generatePluginMcpJson(data.mcpServers), null, 2));
  writeFileSync(join(pluginDir, 'hooks.json'), JSON.stringify(generateGhcpHooks(), null, 2));
}

/**
 * Build Git-backed marketplace manifests that point to the committed plugin
 * payload directory in this repository.
 */
export function buildPluginMarketplaces(repoRoot: string, options: PluginMarketplaceOptions): void {
  const marketplace = generatePluginMarketplace(options);

  mkdirSync(join(repoRoot, '.plugin'), { recursive: true });
  writeFileSync(join(repoRoot, '.plugin', 'marketplace.json'), JSON.stringify(marketplace, null, 2));

  mkdirSync(join(repoRoot, '.claude-plugin'), { recursive: true });
  writeFileSync(join(repoRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify(marketplace, null, 2));
}

/**
 * Recursively copy a directory tree into destDir (created if missing).
 * Used for skill `references/` subdirs. Keeps implementation local to the
 * build module; `src/setup/index.js` has its own copyRecursive for install-time
 * use. Consolidating them is out of scope (see issue #8).
 */
function copyDirRecursive(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(src, dest);
    } else if (entry.isFile()) {
      copyFileSync(src, dest);
    }
  }
}

function copySkillReferences(skill: Skill, skillDestDir: string): void {
  if (!skill.referencesDir) return;
  copyDirRecursive(skill.referencesDir, join(skillDestDir, 'references'));
}

function copySkillScripts(skill: Skill, skillDestDir: string): void {
  if (!skill.scriptsDir) return;
  copyDirRecursive(skill.scriptsDir, join(skillDestDir, 'scripts'));
}

function copySkillAssets(skill: Skill, skillDestDir: string): void {
  copySkillReferences(skill, skillDestDir);
  copySkillScripts(skill, skillDestDir);
}

// ─── GHCP ───

function buildGhcp({ skills, mcpServers, agents, hooks }: BuildData, distDir: string): void {
  const base = join(distDir, 'ghcp');
  mkdirSync(join(base, '.github', 'agents'), { recursive: true });
  mkdirSync(join(base, '.github', 'hooks'), { recursive: true });
  mkdirSync(join(base, '.vscode'), { recursive: true });

  // copilot-instructions.md
  const instructions = generateInstructions(skills, hooks);
  writeFileSync(join(base, '.github', 'copilot-instructions.md'), instructions);

  // mcp.json
  const mcpJson = generateVscodeMcp(mcpServers);
  writeFileSync(join(base, '.vscode', 'mcp.json'), JSON.stringify(mcpJson, null, 2));

  // Agent definition
  writeFileSync(join(base, '.github', 'agents', 'functions-copilot.agent.md'), agents.copilot);

  // AGENTS.md
  writeFileSync(join(base, 'AGENTS.md'), agents.agentsMd);

  // .github/skills/<id>/SKILL.md — Agent Skills (agentskills.io standard)
  for (const skill of skills) {
    const skillDir = join(base, '.github', 'skills', skill.id);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), generateGhcpSkillMd(skill));
    copySkillAssets(skill, skillDir);
  }

  // .github/hooks/welcome-setup.json — SessionStart hook (workspace level)
  writeFileSync(
    join(base, '.github', 'hooks', 'welcome-setup.json'),
    JSON.stringify(generateGhcpHooks(), null, 2),
  );

}

// ─── Claude Code ───

function buildClaude({ skills, mcpServers, agents, hooks }: BuildData, distDir: string): void {
  const base = join(distDir, 'claude');
  mkdirSync(join(base, '.claude', 'skills'), { recursive: true });

  // CLAUDE.md (instructions + skills inline)
  const claudeMd = generateClaudeMd(skills, hooks, agents);
  writeFileSync(join(base, 'CLAUDE.md'), claudeMd);

  // .claude/settings.json (MCP servers)
  const settings = generateClaudeSettings(mcpServers);
  writeFileSync(join(base, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));

  // .claude/skills/<id>/SKILL.md — Agent Skills (agentskills.io standard, directory format)
  for (const skill of skills) {
    const skillDir = join(base, '.claude', 'skills', skill.id);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), generateClaudeSkillMd(skill));
    copySkillAssets(skill, skillDir);
  }
}

// ─── Codex ───

function buildCodex({ skills, mcpServers, agents, hooks }: BuildData, distDir: string): void {
  const base = join(distDir, 'codex');
  mkdirSync(base, { recursive: true });
  mkdirSync(join(base, '.codex'), { recursive: true });

  // AGENTS.md — Codex reads this for workspace instructions
  const agentsMd = generateCodexAgents(skills, hooks, agents);
  writeFileSync(join(base, 'AGENTS.md'), agentsMd);

  // .agents/skills/<id>/SKILL.md — workspace-level skills
  for (const skill of skills) {
    const skillDir = join(base, '.agents', 'skills', skill.id);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), generateCodexSkillMd(skill));
    copySkillAssets(skill, skillDir);
  }

  // .codex/config.toml — MCP server configuration
  writeFileSync(join(base, '.codex', 'config.toml'), generateCodexConfigToml(mcpServers));

  // .codex/hooks.json — SessionStart hook
  writeFileSync(join(base, '.codex', 'hooks.json'), JSON.stringify(generateCodexHooks(), null, 2));
}

// ─── Generators ───

function generateInstructions(skills: Skill[], hooks: HookDefinitions): string {
  const lines = [
    '# Azure Functions Development',
    '',
    '> These instructions help your AI assistant guide you through Azure Functions development.',
    '',
    '## First-Time Setup',
    '',
    hooks.welcome,
    '',
    '## Available Skills',
    '',
    '| Skill | Description |',
    '|-------|-------------|',
  ];

  for (const s of skills) {
    lines.push(`| ${s.id} | ${s.description} |`);
  }

  lines.push('');
  lines.push('## Skill Details');
  lines.push('');

  for (const s of skills) {
    lines.push(`### ${s.id} — ${s.title}`);
    lines.push('');
    lines.push(s.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function generateVscodeMcp(mcpServers: McpServer[]) {
  const servers: Record<string, { type: string; command: string; args: string[] }> = {};
  for (const s of mcpServers) {
    servers[s.id] = {
      type: s.type || 'stdio',
      command: s.command,
      args: s.args,
    };
  }
  return { servers };
}

function generateGhcpSkillMd(skill: Skill): string {
  return generateSkillMd(skill);
}

function generateGhcpHooks() {
  return {
    hooks: {
      SessionStart: [
        {
          type: 'command',
          command: 'node -e "const r=require(\'child_process\').execSync;let o=\'⚡ Welcome to Azure Functions!\\n\';try{r(\'az --version\',{stdio:\'ignore\'});o+=\'✅ Azure CLI\\n\'}catch{o+=\'❌ Azure CLI — install: https://aka.ms/installazurecli\\n\'};try{r(\'func --version\',{stdio:\'ignore\'});o+=\'✅ Core Tools\\n\'}catch{o+=\'❌ Core Tools — install: npm i -g azure-functions-core-tools@4\\n\'};try{r(\'node --version\',{stdio:\'ignore\'});o+=\'✅ Node.js\\n\'}catch{o+=\'❌ Node.js\\n\'};console.log(JSON.stringify({hookSpecificOutput:{hookEventName:\'SessionStart\',additionalContext:o}}))"',
          timeout: 15,
        },
      ],
    },
  };
}
function generatePluginManifest(data: BuildData) {
  return {
    name: 'azure-functions-skills',
    version: data.packageVersion || '0.0.0-dev',
    description: 'Azure Functions skills for setup, create, and deploy workflows',
    skills: './skills/',
    agents: './agents/',
    hooks: './hooks.json',
    mcpServers: './.mcp.json',
    interface: {
      displayName: 'Azure Functions Skills',
      shortDescription: 'Guided setup → create → deploy workflow for Azure Functions',
      developerName: 'Azure Functions Team',
      category: 'Development',
      capabilities: ['Read', 'Write'],
    },
  };
}

function generatePluginMarketplace({ packageVersion, pluginSource }: PluginMarketplaceOptions) {
  return {
    name: 'azure-functions-skills',
    owner: {
      name: 'Azure Functions Team',
    },
    metadata: {
      description: 'Azure Functions coding agent skills and MCP guidance',
      version: packageVersion,
    },
    plugins: [
      {
        name: 'azure-functions-skills',
        source: pluginSource,
        description: 'Azure Functions skills for setup, create, and deploy workflows',
        version: packageVersion,
        category: 'Development',
        tags: ['azure-functions', 'serverless', 'mcp', 'coding-agent'],
      },
    ],
  };
}

function generatePluginMcpJson(mcpServers: McpServer[]) {
  const result: Record<string, { command: string; args: string[] }> = {};
  for (const s of mcpServers) {
    result[s.id] = {
      command: s.command,
      args: s.args,
    };
  }
  return { mcpServers: result };
}

function generateClaudeMd(skills: Skill[], hooks: HookDefinitions, agents: AgentDefinitions): string {
  return generateAgentMd(skills, hooks, agents, '## Available Skills');
}

function generateCodexAgents(skills: Skill[], hooks: HookDefinitions, agents: AgentDefinitions): string {
  return generateAgentMd(skills, hooks, agents, '## Skills Reference');
}

function generateAgentMd(
  skills: Skill[],
  hooks: HookDefinitions,
  agents: AgentDefinitions,
  skillsHeading: string,
): string {
  const lines = [
    '# Azure Functions Development',
    '',
    agents.agentsMd,
    '',
    '## First-Time Setup',
    '',
    hooks.welcome,
    '',
    skillsHeading,
    '',
  ];

  for (const s of skills) {
    lines.push(`### ${s.id} — ${s.title}`);
    lines.push('');
    lines.push(s.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function generateClaudeSettings(mcpServers: McpServer[]) {
  const mcpEntries: Record<string, { command: string; args: string[] }> = {};
  for (const s of mcpServers) {
    mcpEntries[s.id] = {
      command: s.command,
      args: s.args,
    };
  }
  return { mcpServers: mcpEntries };
}

function generateClaudeSkillMd(skill: Skill): string {
  return generateSkillMd(skill);
}

function generateCodexSkillMd(skill: Skill): string {
  return generateSkillMd(skill);
}

function generateSkillMd(skill: Skill): string {
  return [
    '---',
    `name: ${skill.id}`,
    `description: "${skill.description}"`,
    '---',
    '',
    skill.content.trimEnd(),
  ].join('\n');
}

function generateCodexConfigToml(mcpServers: McpServer[]): string {
  const lines = [
    '# Azure Functions MCP Servers',
    '# Generated by azure-functions-skills build system',
    '',
  ];

  for (const s of mcpServers) {
    lines.push(`[mcp_servers.${s.id}]`);
    lines.push(`command = "${s.command}"`);
    if (s.args && s.args.length > 0) {
      const argsStr = s.args.map(a => `"${a}"`).join(', ');
      lines.push(`args = [${argsStr}]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateCodexHooks() {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: 'bash -c \'echo "⚡ Welcome to Azure Functions! Checking prerequisites..."; az --version > /dev/null 2>&1 && echo "✅ Azure CLI" || echo "❌ Azure CLI — install: https://aka.ms/installazurecli"; func --version > /dev/null 2>&1 && echo "✅ Core Tools" || echo "❌ Core Tools — install: npm i -g azure-functions-core-tools@4"; node --version > /dev/null 2>&1 && echo "✅ Node.js" || echo "❌ Node.js — install: https://nodejs.org"\'',
              statusMessage: 'Checking Azure Functions prerequisites',
            },
          ],
        },
      ],
    },
  };
}
