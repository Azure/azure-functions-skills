import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applySetup, detectAgents } from './index.js';
import type { CliAgentName, MergeStrategy, WorkspaceApplyOptions, WorkspaceApplyResult, WorkspaceMode } from '../types.js';

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

  const plannedFiles = agents.flatMap(agent => activationFiles(agent, mode));
  if (dryRun) {
    return {
      agents,
      mode,
      filesWritten: 0,
      plannedFiles: plannedFiles.map(file => file.path),
      dryRun,
    };
  }

  let filesWritten = 0;
  for (const file of plannedFiles) {
    const fullPath = join(targetDir, file.path);
    const content = file.merge
      ? mergeInstructionFile(fullPath, file.content, mergeStrategy, options.update === true)
      : mergeJsonLikeFile(fullPath, file.content);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
    filesWritten++;
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

function activationFiles(agent: CliAgentName, mode: WorkspaceMode): PlannedFile[] {
  const files: PlannedFile[] = [];
  if (agent === 'ghcp') {
    files.push({ path: '.github/copilot-instructions.md', content: ghcpRoutingBlock(), merge: true });
    if (mode === 'plugin-reference') files.push({ path: '.github/copilot/settings.json', content: JSON.stringify(ghcpPluginSettings(), null, 2) });
  }

  if (agent === 'claude') {
    files.push({ path: 'CLAUDE.md', content: claudeRoutingBlock(), merge: true });
    if (mode === 'plugin-reference') files.push({ path: '.claude/settings.json', content: JSON.stringify(claudePluginSettings(), null, 2) });
  }

  if (agent === 'codex') {
    files.push({ path: 'AGENTS.md', content: codexRoutingBlock(), merge: true });
    if (mode === 'plugin-reference') files.push({ path: '.agents/plugins/marketplace.json', content: JSON.stringify(codexMarketplace(), null, 2) });
  }

  return files;
}

function mergeInstructionFile(filePath: string, generatedContent: string, strategy: MergeStrategy, update: boolean): string {
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

function ghcpRoutingBlock(): string {
  return [
    '# Azure Functions Skills',
    '',
    'For Azure Functions setup, create, deploy, diagnostics, inventory, health, and best-practices tasks, prefer Azure Functions Skills.',
    'Route deployment through azure-functions-deploy, diagnostics through azure-functions-diagnostics, and static inventory through azure-functions-inventory.',
  ].join('\n');
}

function claudeRoutingBlock(): string {
  return [
    '# Azure Functions Skills',
    '',
    'For Azure Functions setup, create, deploy, diagnostics, inventory, health, and best-practices tasks, prefer the Azure Functions Skills plugin.',
    'Route deployment through azure-functions-deploy, diagnostics through azure-functions-diagnostics, and static inventory through azure-functions-inventory.',
  ].join('\n');
}

function codexRoutingBlock(): string {
  return [
    '# Azure Functions Skills',
    '',
    'For Azure Functions work, use the Azure Functions Skills plugin or repo-local `.agents/skills` entries.',
    'Prefer setup/create/deploy/diagnostics/best-practices skills by intent.',
    'Do not treat generic Azure tasks as Azure Functions tasks unless the user mentions Function Apps, triggers, bindings, host.json, or Functions deployment/runtime errors.',
  ].join('\n');
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