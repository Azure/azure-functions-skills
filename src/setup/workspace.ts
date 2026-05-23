import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMcpServers, loadSkills } from '../build/loader.js';
import { applySetup, detectAgents } from './index.js';
import type { CliAgentName, McpServer, MergeStrategy, WorkspaceApplyOptions, WorkspaceApplyResult, WorkspaceMode } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');
const BLOCK_START = '<!-- azure-functions-skills:start';
const BLOCK_END = '<!-- azure-functions-skills:end -->';

type PlannedFile = {
  path: string;
  content: string;
  merge?: boolean;
};

export async function applyWorkspace(targetDir: string, options: WorkspaceApplyOptions = {}): Promise<WorkspaceApplyResult> {
  const agents = options.agents || await detectAgents();
  const mode = options.mode || 'copy';
  const mergeStrategy = options.mergeStrategy || 'managed-block';
  const dryRun = options.dryRun === true;
  const approved = options.yes === true;

  if (mode === 'copy') {
    if (dryRun) {
      return {
        agents,
        mode,
        filesWritten: 0,
        plannedFiles: agents.flatMap(agent => plannedCopyFiles(agent)),
        dryRun,
      };
    }
    const setupResult = await applySetup(targetDir, { agents, prerequisites: 'skip' });
    return {
      agents,
      mode,
      filesWritten: setupResult.filesWritten,
      plannedFiles: [],
      dryRun,
    };
  }

  const plannedFiles = agents.flatMap(agent => activationFiles(agent, mode, options));
  if (dryRun) {
    return {
      agents,
      mode,
      filesWritten: 0,
      plannedFiles: plannedFiles.flatMap(file => plannedWorkspacePaths(file, mergeStrategy)),
      dryRun,
    };
  }

  let filesWritten = 0;
  for (const file of plannedFiles) {
    const fullPath = join(targetDir, file.path);
    const content = file.merge
      ? mergeInstructionFile(fullPath, file.content, mergeStrategy, options.update === true, approved)
      : mergeJsonLikeFile(fullPath, file.content);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
    filesWritten++;

    if (file.merge && mergeStrategy === 'include-file') {
      const includeFullPath = join(targetDir, includeInstructionPath(file.path));
      mkdirSync(dirname(includeFullPath), { recursive: true });
      writeFileSync(includeFullPath, ensureTrailingNewline(file.content));
      filesWritten++;
    }
  }

  return {
    agents,
    mode,
    filesWritten,
    plannedFiles: plannedFiles.map(file => file.path),
    dryRun,
  };
}

function plannedCopyFiles(agent: CliAgentName): string[] {
  if (agent === 'ghcp') return ['.github/copilot-instructions.md', '.github/skills/<skill-id>/SKILL.md'];
  if (agent === 'claude') return ['CLAUDE.md', '.claude/skills/<skill-id>/SKILL.md'];
  return ['AGENTS.md', '.agents/skills/<skill-id>/SKILL.md'];
}

function activationFiles(agent: CliAgentName, mode: WorkspaceMode, options: WorkspaceApplyOptions): PlannedFile[] {
  const files: PlannedFile[] = [];
  if (agent === 'ghcp') {
    files.push({ path: '.github/copilot-instructions.md', content: routingBlock(agent), merge: true });
    if (mode === 'plugin-reference') files.push({ path: '.github/copilot/settings.json', content: JSON.stringify(ghcpPluginSettings(), null, 2) });
    if (options.includeMcp) files.push({ path: '.vscode/mcp.json', content: JSON.stringify(ghcpMcpSettings(), null, 2) });
    if (options.includeHooks) files.push({ path: '.github/hooks/welcome-setup.json', content: JSON.stringify(crossPlatformHooks(), null, 2) });
  }

  if (agent === 'claude') {
    files.push({ path: 'CLAUDE.md', content: routingBlock(agent), merge: true });
    if (mode === 'plugin-reference') files.push({ path: '.claude/settings.json', content: JSON.stringify(claudePluginSettings(), null, 2) });
    if (options.includeMcp) files.push({ path: '.claude/settings.json', content: JSON.stringify(claudeMcpSettings(), null, 2) });
  }

  if (agent === 'codex') {
    files.push({ path: 'AGENTS.md', content: routingBlock(agent), merge: true });
    if (mode === 'plugin-reference') files.push({ path: '.agents/plugins/marketplace.json', content: JSON.stringify(codexMarketplace(), null, 2) });
    if (options.includeMcp) files.push({ path: '.codex/config.toml', content: codexMcpConfigToml() });
    if (options.includeHooks) files.push({ path: '.codex/hooks.json', content: JSON.stringify(crossPlatformHooks(), null, 2) });
  }

  return files;
}

function plannedWorkspacePaths(file: PlannedFile, strategy: MergeStrategy): string[] {
  if (file.merge && strategy === 'include-file') return [file.path, includeInstructionPath(file.path)];
  return [file.path];
}

function mergeInstructionFile(filePath: string, generatedContent: string, strategy: MergeStrategy, update: boolean, approved: boolean): string {
  const block = managedBlock(generatedContent);
  if (!existsSync(filePath)) return `${block}\n`;

  const existing = readFileSync(filePath, 'utf-8');
  const blockPattern = /<!-- azure-functions-skills:start[^\n]* -->[\s\S]*?<!-- azure-functions-skills:end -->/;
  if (blockPattern.test(existing)) {
    if (!update) return existing;
    return ensureTrailingNewline(existing.replace(blockPattern, block));
  }

  if (strategy === 'fail-if-exists') {
    throw new Error(`Refusing to modify existing customer-owned file: ${filePath}`);
  }

  if (!approved) {
    throw new Error(`Refusing to modify existing customer-owned file without approval: ${filePath}. Re-run with --yes or use --merge-strategy fail-if-exists.`);
  }

  if (strategy === 'append' || strategy === 'managed-block') {
    return `${existing.trimEnd()}\n\n${block}\n`;
  }

  if (strategy === 'include-file') {
    const includePath = includeInstructionPath(filePath);
    const includeLine = `See ${includePath} for Azure Functions routing.`;
    return existing.includes(includeLine) ? ensureTrailingNewline(existing) : `${existing.trimEnd()}\n\n${includeLine}\n`;
  }

  return `${existing.trimEnd()}\n\n${block}\n`;
}

function mergeJsonLikeFile(filePath: string, generatedContent: string): string {
  if (!existsSync(filePath)) return `${generatedContent}\n`;
  try {
    const existing = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const generated = JSON.parse(generatedContent) as Record<string, unknown>;
    return `${JSON.stringify(deepMerge(existing, generated), null, 2)}\n`;
  } catch {
    return `${generatedContent}\n`;
  }
}

function deepMerge(existing: Record<string, unknown>, generated: Record<string, unknown>): Record<string, unknown> {
  const result = { ...existing };
  for (const [key, value] of Object.entries(generated)) {
    if (isRecord(result[key]) && isRecord(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function managedBlock(content: string): string {
  return `${BLOCK_START} version=0.12.1 -->\n${content.trimEnd()}\n${BLOCK_END}`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function includeInstructionPath(filePath: string): string {
  const fileName = filePath.endsWith('CLAUDE.md') ? 'CLAUDE.azure-functions.md' : 'AGENTS.azure-functions.md';
  return `.azure-functions-skills/${fileName}`;
}

function routingBlock(agent: CliAgentName): string {
  const template = readFileSync(join(TEMPLATES_DIR, 'routing', `${agent}.md`), 'utf-8');
  return template.replace('{{skills}}', skillRoutingList()).trimEnd();
}

function skillRoutingList(): string {
  return loadSkills(join(TEMPLATES_DIR, 'skills'))
    .filter(skill => skill.category !== 'reference')
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(skill => `- ${skill.id}: ${skill.description || skill.title}`)
    .join('\n');
}

function mcpServers(): McpServer[] {
  return loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
}

function ghcpMcpSettings() {
  const servers: Record<string, { type: string; command: string; args: string[] }> = {};
  for (const server of mcpServers()) {
    servers[server.id] = {
      type: server.type || 'stdio',
      command: server.command,
      args: server.args,
    };
  }
  return { servers };
}

function claudeMcpSettings() {
  const servers: Record<string, { command: string; args: string[] }> = {};
  for (const server of mcpServers()) {
    servers[server.id] = {
      command: server.command,
      args: server.args,
    };
  }
  return { mcpServers: servers };
}

function codexMcpConfigToml(): string {
  const lines = [
    '# Azure Functions MCP Servers',
    '# Generated by azure-functions-skills workspace apply',
    '',
  ];

  for (const server of mcpServers()) {
    lines.push(`[mcp_servers.${server.id}]`);
    lines.push(`command = "${server.command}"`);
    if (server.args.length > 0) lines.push(`args = [${server.args.map(arg => `"${arg}"`).join(', ')}]`);
    lines.push('');
  }

  return lines.join('\n');
}

function crossPlatformHooks() {
  return {
    hooks: {
      SessionStart: [
        {
          type: 'command',
          command: 'node -e "const r=require(\'child_process\').execSync;let o=\'⚡ Welcome to Azure Functions!\\n\';for(const [n,c,u] of [[\'Azure CLI\',\'az --version\',\'https://aka.ms/installazurecli\'],[\'Core Tools\',\'func --version\',\'npm i -g azure-functions-core-tools@4\'],[\'Node.js\',\'node --version\',\'https://nodejs.org\']]){try{r(c,{stdio:\'ignore\'});o+=`✅ ${n}\\n`}catch{o+=`❌ ${n} — install: ${u}\\n`}};console.log(JSON.stringify({hookSpecificOutput:{hookEventName:\'SessionStart\',additionalContext:o}}))"',
          timeout: 15,
        },
      ],
    },
  };
}

function ghcpPluginSettings() {
  return {
    extraKnownMarketplaces: {
      'azure-functions-skills': {
        source: {
          source: 'github',
          repo: 'Azure/azure-functions-skills',
        },
      },
    },
    enabledPlugins: {
      'azure-functions-skills@azure-functions-skills': true,
    },
  };
}

function claudePluginSettings() {
  return ghcpPluginSettings();
}

function codexMarketplace() {
  return {
    name: 'azure-functions-skills',
    interface: {
      displayName: 'Azure Functions Skills',
    },
    plugins: [
      {
        name: 'azure-functions-skills',
        source: {
          source: 'git-subdir',
          url: 'https://github.com/Azure/azure-functions-skills.git',
          path: './.github/plugins/azure-functions-skills',
          ref: 'v0.12.1',
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Development',
      },
    ],
  };
}