import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMcpServers, loadSkills } from '../build/loader.js';
import { applySetup, detectAgents } from './index.js';
import type { CliAgentName, McpServer, MergeStrategy, WorkspaceApplyOptions, WorkspaceApplyResult, WorkspaceMode } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');
const BLOCK_START = '<!-- azure-functions-skills:start';
const BLOCK_END = '<!-- azure-functions-skills:end -->';
const BLOCK_PATTERN = /<!-- azure-functions-skills:start[^\n]* -->[\s\S]*?<!-- azure-functions-skills:end -->/;

type PlannedFile = {
  path: string;
  content: string;
  merge?: boolean;
};

type WorkspaceFileAction = 'overwrite' | 'managed-block' | 'save-aside' | 'deep-merge-json' | 'include-file' | 'append-block';

export async function applyWorkspace(targetDir: string, options: WorkspaceApplyOptions = {}): Promise<WorkspaceApplyResult> {
  const agents = options.agents || await detectAgents();
  const mode = options.mode || 'copy';
  const mergeStrategy = options.mergeStrategy || 'managed-block';
  const dryRun = options.dryRun === true;

  if (mode === 'copy') {
    if (dryRun) {
      return {
        agents,
        mode,
        filesWritten: 0,
        plannedFiles: agents.flatMap(agent => plannedCopyFiles(agent)),
        dryRun,
        overwritten: [],
        managedBlockUpdated: [],
        savedAside: [],
      };
    }
    const setupResult = await applySetup(targetDir, { agents, prerequisites: 'skip' });
    return {
      agents,
      mode,
      filesWritten: setupResult.filesWritten,
      plannedFiles: [],
      dryRun,
      overwritten: [],
      managedBlockUpdated: [],
      savedAside: [],
    };
  }

  const plannedFiles = coalescePlannedFiles(agents.flatMap(agent => activationFiles(agent, mode, options)));
  const result: WorkspaceApplyResult = {
    agents,
    mode,
    filesWritten: 0,
    plannedFiles: plannedFiles.flatMap(file => plannedWorkspacePaths(file, mergeStrategy)),
    dryRun,
    overwritten: [],
    managedBlockUpdated: [],
    savedAside: [],
  };

  for (const file of plannedFiles) {
    await applyPlannedFile(targetDir, file, mergeStrategy, options, result);
  }

  return result;
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
    if (options.includeAgent) files.push({ path: '.github/agents/functions-copilot.agent.md', content: ghcpAgentDefinition() });
    if (mode === 'plugin-reference') files.push({ path: '.github/copilot/settings.json', content: JSON.stringify(ghcpPluginSettings(), null, 2) });
    if (options.includeMcp) files.push({ path: '.mcp.json', content: JSON.stringify(ghcpMcpSettings(), null, 2) });
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

async function applyPlannedFile(
  targetDir: string,
  file: PlannedFile,
  mergeStrategy: MergeStrategy,
  options: WorkspaceApplyOptions,
  result: WorkspaceApplyResult,
): Promise<void> {
  const fullPath = join(targetDir, file.path);
  let action = resolveWorkspaceAction(fullPath, file, mergeStrategy, options.force === true);

  if (action === 'save-aside' && options.prompter && existsSync(fullPath)) {
    const choice = await options.prompter(file.path, file.content, readFileSync(fullPath, 'utf-8'));
    if (choice === 'overwrite') action = 'overwrite';
  }

  switch (action) {
    case 'overwrite':
      if (!options.dryRun) writeGeneratedFile(fullPath, file.content);
      result.overwritten.push(file.path);
      if (!options.dryRun) result.filesWritten++;
      return;
    case 'managed-block':
      if (!options.dryRun) writeGeneratedFile(fullPath, mergeInstructionFile(fullPath, file.content));
      result.managedBlockUpdated.push(file.path);
      if (!options.dryRun) result.filesWritten++;
      return;
    case 'deep-merge-json':
      if (!options.dryRun) writeGeneratedFile(fullPath, deepMergeJsonFile(fullPath, file.content));
      result.managedBlockUpdated.push(file.path);
      if (!options.dryRun) result.filesWritten++;
      return;
    case 'include-file':
      await applyIncludeFileStrategy(targetDir, fullPath, file, options, result);
      return;
    case 'append-block':
      if (!options.dryRun) writeGeneratedFile(fullPath, appendManagedBlock(fullPath, file.content));
      result.managedBlockUpdated.push(file.path);
      if (!options.dryRun) result.filesWritten++;
      return;
    case 'save-aside': {
      const asideRelative = resolveUniqueAsidePath(targetDir, file.path);
      if (!options.dryRun) writeGeneratedFile(join(targetDir, asideRelative), file.content);
      result.savedAside.push({ original: file.path, aside: asideRelative });
      if (!options.dryRun) result.filesWritten++;
      return;
    }
  }
}

function resolveWorkspaceAction(filePath: string, file: PlannedFile, strategy: MergeStrategy, force: boolean): WorkspaceFileAction {
  if (force) return 'overwrite';
  if (!existsSync(filePath)) return 'overwrite';

  if (file.merge) {
    const existing = readFileSync(filePath, 'utf-8');
    if (BLOCK_PATTERN.test(existing)) return 'managed-block';
    if (strategy === 'include-file') return 'include-file';
    if (strategy === 'append') return 'append-block';
    if (strategy === 'fail-if-exists') {
      throw new Error(`Refusing to modify existing customer-owned file: ${filePath}`);
    }
    return 'save-aside';
  }

  if (canDeepMergeJson(filePath, file.content)) return 'deep-merge-json';
  if (isSettingsFile(file.path)) return 'save-aside';
  return 'overwrite';
}

function mergeInstructionFile(filePath: string, generatedContent: string): string {
  const block = managedBlock(generatedContent);
  const existing = readFileSync(filePath, 'utf-8');
  const blockPattern = /<!-- azure-functions-skills:start[^\n]* -->[\s\S]*?<!-- azure-functions-skills:end -->/;
  return ensureTrailingNewline(existing.replace(blockPattern, block));
}

function appendManagedBlock(filePath: string, generatedContent: string): string {
  const existing = readFileSync(filePath, 'utf-8');
  return `${existing.trimEnd()}\n\n${managedBlock(generatedContent)}\n`;
}

async function applyIncludeFileStrategy(targetDir: string, fullPath: string, file: PlannedFile, options: WorkspaceApplyOptions, result: WorkspaceApplyResult): Promise<void> {
  const includePath = includeInstructionPath(file.path);
  const includeLine = `See ${includePath} for Azure Functions routing.`;
  if (!options.dryRun) {
    const existing = readFileSync(fullPath, 'utf-8');
    const next = existing.includes(includeLine) ? ensureTrailingNewline(existing) : `${existing.trimEnd()}\n\n${includeLine}\n`;
    writeGeneratedFile(fullPath, next);
    writeGeneratedFile(join(targetDir, includePath), file.content);
  }
  result.managedBlockUpdated.push(file.path);
  result.overwritten.push(includePath);
  if (!options.dryRun) result.filesWritten += 2;
}

function deepMergeJsonFile(filePath: string, generatedContent: string): string {
  const existing = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  const generated = JSON.parse(generatedContent) as Record<string, unknown>;
  return `${JSON.stringify(deepMerge(existing, generated), null, 2)}\n`;
}

function canDeepMergeJson(filePath: string, generatedContent: string): boolean {
  if (!filePath.endsWith('.json')) return false;
  try {
    JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    JSON.parse(generatedContent) as Record<string, unknown>;
    return true;
  } catch {
    return false;
  }
}

function writeGeneratedFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, ensureTrailingNewline(content));
}

function coalescePlannedFiles(files: PlannedFile[]): PlannedFile[] {
  const coalesced: PlannedFile[] = [];
  for (const file of files) {
    const existing = coalesced.find(candidate => candidate.path === file.path);
    if (!existing) {
      coalesced.push({ ...file });
      continue;
    }
    existing.content = mergeGeneratedContent(existing.content, file.content);
    existing.merge = existing.merge || file.merge;
  }
  return coalesced;
}

function mergeGeneratedContent(left: string, right: string): string {
  try {
    const leftJson = JSON.parse(left) as Record<string, unknown>;
    const rightJson = JSON.parse(right) as Record<string, unknown>;
    return JSON.stringify(deepMerge(leftJson, rightJson), null, 2);
  } catch {
    return right;
  }
}

function resolveUniqueAsidePath(targetDir: string, originalRelativePath: string): string {
  let aside = saveAsidePath(originalRelativePath);
  let counter = 2;
  while (existsSync(join(targetDir, aside))) {
    aside = saveAsidePathWithSuffix(originalRelativePath, counter);
    counter++;
  }
  return aside;
}

function saveAsidePath(filePath: string): string {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const aside = ext
    ? `${base}.azure-functions-skills-new${ext}`
    : `${base}.azure-functions-skills-new`;
  return dir === '.' ? aside : join(dir, aside);
}

function saveAsidePathWithSuffix(filePath: string, suffix: number): string {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const aside = ext
    ? `${base}.azure-functions-skills-new-${suffix}${ext}`
    : `${base}.azure-functions-skills-new-${suffix}`;
  return dir === '.' ? aside : join(dir, aside);
}

function isSettingsFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return normalized === '.vscode/mcp.json' ||
    normalized === '.claude/settings.json' ||
    normalized === '.codex/config.toml' ||
    normalized === '.github/copilot/settings.json' ||
    normalized === '.agents/plugins/marketplace.json';
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

function ghcpAgentDefinition(): string {
  return readFileSync(join(TEMPLATES_DIR, 'agents', 'functions-copilot.agent.md'), 'utf-8').trimEnd();
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
  const servers: Record<string, { type: string; command: string; args: string[]; tools: string[] }> = {};
  for (const server of mcpServers()) {
    servers[server.id] = {
      type: server.type || 'stdio',
      command: server.command,
      args: server.args,
      tools: ['*'],
    };
  }
  return { mcpServers: servers };
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