import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BuildData, BuildTargetName, McpServer, Skill } from '../types.js';

type TargetBuilder = (data: BuildData, distDir: string) => void;

interface PluginMarketplaceOptions {
  packageVersion: string;
  pluginSource: string;
}

export function buildTarget(target: BuildTargetName, data: BuildData, distDir: string): void {
  const builders: Record<BuildTargetName, TargetBuilder> = {
    ghcp: buildGhcp,
    claude: buildClaude,
    codex: buildCodex,
  };
  builders[target](data, distDir);
}

export function buildPluginPayload(data: BuildData, pluginDir: string): void {
  mkdirSync(pluginDir, { recursive: true });
  const manifest = generatePluginManifest(data);
  const claudeManifest = generateClaudePluginManifest(data);

  mkdirSync(join(pluginDir, '.plugin'), { recursive: true });
  writeJson(join(pluginDir, '.plugin', 'plugin.json'), manifest);
  writeJson(join(pluginDir, 'plugin.json'), manifest);
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
  writeJson(join(pluginDir, '.claude-plugin', 'plugin.json'), claudeManifest);
  mkdirSync(join(pluginDir, '.codex-plugin'), { recursive: true });
  writeJson(join(pluginDir, '.codex-plugin', 'plugin.json'), manifest);

  writeSkills(data.skills, join(pluginDir, 'skills'));
  writeJson(join(pluginDir, '.mcp.json'), generatePluginMcpJson(data.mcpServers));
  writePluginTelemetryAssets(data, pluginDir);
}

export function buildPluginMarketplaces(repoRoot: string, options: PluginMarketplaceOptions): void {
  const marketplace = {
    name: 'azure-functions-skills',
    owner: { name: 'Azure Functions Team' },
    metadata: {
      description: 'Azure Functions coding agent skills, MCP, and telemetry hooks',
      version: options.packageVersion,
    },
    plugins: [{
      name: 'azure-functions-skills',
      source: options.pluginSource,
      description: 'Azure Functions skills, MCP, and telemetry hooks',
      version: options.packageVersion,
      category: 'Development',
      tags: ['azure-functions', 'serverless', 'mcp', 'coding-agent'],
    }],
  };
  mkdirSync(join(repoRoot, '.plugin'), { recursive: true });
  writeJson(join(repoRoot, '.plugin', 'marketplace.json'), marketplace);
  mkdirSync(join(repoRoot, '.claude-plugin'), { recursive: true });
  writeJson(join(repoRoot, '.claude-plugin', 'marketplace.json'), marketplace);
}

function buildGhcp(data: BuildData, distDir: string): void {
  const base = join(distDir, 'ghcp');
  writeSkills(data.skills, join(base, '.github', 'skills'));
  writeJson(join(base, '.mcp.json'), generateCopilotMcpJson(data.mcpServers));
  writeWorkspaceTelemetryAssets(data, join(base, '.github', 'hooks'));
  writeJson(
    join(base, '.github', 'hooks', 'azure-functions-telemetry.json'),
    workspaceCopilotHooks(),
  );
}

function buildClaude(data: BuildData, distDir: string): void {
  const base = join(distDir, 'claude');
  writeSkills(data.skills, join(base, '.claude', 'skills'));
  const hooks = workspaceClaudeHooks();
  writeJson(join(base, '.claude', 'settings.json'), {
    ...generateClaudeSettings(data.mcpServers),
    hooks: hooks.hooks,
  });
  writeWorkspaceTelemetryAssets(data, join(base, '.claude', 'hooks'));
  writeJson(join(base, '.claude', 'hooks', 'hooks.json'), hooks);
}

function buildCodex(data: BuildData, distDir: string): void {
  const base = join(distDir, 'codex');
  writeSkills(data.skills, join(base, '.agents', 'skills'));
  mkdirSync(join(base, '.codex'), { recursive: true });
  writeFileSync(join(base, '.codex', 'config.toml'), generateCodexConfigToml(data.mcpServers));
  writeJson(join(base, '.codex', 'hooks.json'), workspaceCodexHooks());
  writeWorkspaceTelemetryAssets(data, join(base, '.codex', 'hooks'));
}

function writeSkills(skills: Skill[], root: string): void {
  for (const skill of skills) {
    const skillDir = join(root, skill.id);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), generateSkillMd(skill));
    copySkillAssets(skill, skillDir);
  }
}

function copySkillAssets(skill: Skill, skillDir: string): void {
  if (skill.referencesDir) copyDirRecursive(skill.referencesDir, join(skillDir, 'references'));
  if (skill.scriptsDir) copyDirRecursive(skill.scriptsDir, join(skillDir, 'scripts'));
  if (skill.assetsDir) copyDirRecursive(skill.assetsDir, join(skillDir, 'assets'));
}

function copyDirRecursive(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) copyDirRecursive(sourcePath, destinationPath);
    else if (entry.isFile()) copyFileSync(sourcePath, destinationPath);
  }
}

function writePluginTelemetryAssets(data: BuildData, pluginDir: string): void {
  const hooksDir = join(pluginDir, 'hooks');
  writeTelemetryScripts(data, hooksDir);
  writeFileSync(join(hooksDir, 'copilot-hooks.json'), data.hooks.copilotTelemetry);
  writeFileSync(join(hooksDir, 'hooks.json'), data.hooks.claudeTelemetry);
  writeFileSync(join(hooksDir, 'cursor-hooks.json'), data.hooks.cursorTelemetry);
}

function writeWorkspaceTelemetryAssets(data: BuildData, hooksDir: string): void {
  writeTelemetryScripts(data, hooksDir);
}

function writeTelemetryScripts(data: BuildData, hooksDir: string): void {
  const scriptsDir = join(hooksDir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(hooksDir, 'telemetry.config.json'), data.hooks.telemetryConfig);
  writeFileSync(join(scriptsDir, 'track-telemetry.ps1'), data.hooks.trackTelemetryPowerShell);
  writeFileSync(join(scriptsDir, 'track-telemetry.sh'), data.hooks.trackTelemetryShell);
}

function workspaceCopilotHooks() {
  return {
    hooks: {
      PostToolUse: [{
        hooks: [{
          type: 'command',
          bash: '.github/hooks/scripts/track-telemetry.sh',
          powershell: '.github/hooks/scripts/track-telemetry.ps1',
        }],
      }],
    },
  };
}

function workspaceClaudeHooks() {
  return {
    hooks: {
      PostToolUse: [{
        hooks: [{
          type: 'command',
          command: 'bash .claude/hooks/scripts/track-telemetry.sh',
        }],
      }],
    },
  };
}

function workspaceCodexHooks() {
  return {
    hooks: {
      PostToolUse: [{
        type: 'command',
        command: 'bash .codex/hooks/scripts/track-telemetry.sh',
      }],
    },
  };
}

function generatePluginManifest(data: BuildData) {
  return {
    name: 'azure-functions-skills',
    version: data.packageVersion || '0.0.0-dev',
    description: 'Azure Functions skills, MCP, and telemetry hooks',
    skills: './skills/',
    hooks: { paths: ['./hooks/copilot-hooks.json'], exclusive: true },
    mcpServers: './.mcp.json',
    interface: {
      displayName: 'Azure Functions Skills',
      shortDescription: 'Azure Functions guidance for coding agents',
      developerName: 'Azure Functions Team',
      category: 'Development',
      capabilities: ['Read', 'Write'],
    },
  };
}

function generateClaudePluginManifest(data: BuildData) {
  return {
    name: 'azure-functions-skills',
    version: data.packageVersion || '0.0.0-dev',
    description: 'Azure Functions skills, MCP, and telemetry hooks',
    skills: './skills/',
    hooks: './hooks/hooks.json',
    mcpServers: './.mcp.json',
  };
}

function generateCopilotMcpJson(servers: McpServer[]) {
  const mcpServers: Record<string, { type: string; command: string; args: string[]; tools: string[] }> = {};
  for (const server of servers) {
    mcpServers[server.id] = {
      type: server.type || 'stdio',
      command: server.command,
      args: server.args,
      tools: ['*'],
    };
  }
  return { mcpServers };
}

function generatePluginMcpJson(servers: McpServer[]) {
  const mcpServers: Record<string, { command: string; args: string[] }> = {};
  for (const server of servers) {
    mcpServers[server.id] = { command: server.command, args: server.args };
  }
  return { mcpServers };
}

function generateClaudeSettings(servers: McpServer[]) {
  return generatePluginMcpJson(servers);
}

function generateCodexConfigToml(servers: McpServer[]): string {
  const lines = ['# Azure Functions MCP Servers', ''];
  for (const server of servers) {
    lines.push(`[mcp_servers.${server.id}]`);
    lines.push(`command = "${server.command}"`);
    if (server.args.length > 0) {
      lines.push(`args = [${server.args.map(argument => `"${argument}"`).join(', ')}]`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function generateSkillMd(skill: Skill): string {
  const frontmatter = ['---', `name: ${skill.id}`, `description: "${skill.description}"`];
  if (skill.argumentHint) frontmatter.push(`argument-hint: "${skill.argumentHint}"`);
  frontmatter.push('---', '', skill.content.trimEnd());
  return frontmatter.join('\n');
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
