import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDefinitions, HookDefinitions, McpServer, Skill } from '../types.js';

/**
 * Load all skills from the skills directory.
 * Each skill dir contains SKILL.md with YAML frontmatter and optional references/, scripts/, or assets/ subdirs.
 */
export function loadSkills(skillsDir: string): Skill[] {
  const dirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  return dirs.map(dir => {
    const base = join(skillsDir, dir);
    const skillMarkdown = readFileSync(join(base, 'SKILL.md'), 'utf-8');
    const { frontmatter, content } = parseMarkdownFrontmatter(skillMarkdown);

    const refsPath = join(base, 'references');
    const referencesDir =
      existsSync(refsPath) && statSync(refsPath).isDirectory() ? refsPath : null;

    const scriptsPath = join(base, 'scripts');
    const scriptsDir =
      existsSync(scriptsPath) && statSync(scriptsPath).isDirectory() ? scriptsPath : null;

    const assetsPath = join(base, 'assets');
    const assetsDir =
      existsSync(assetsPath) && statSync(assetsPath).isDirectory() ? assetsPath : null;

    return {
      id: frontmatter.name || dir,
      title: frontmatter.title || toTitle(frontmatter.name || dir),
      description: frontmatter.description || '',
      argumentHint: frontmatter['argument-hint'] || null,
      category: frontmatter.category || 'development',
      content,
      referencesDir,
      scriptsDir,
      assetsDir,
    };
  });
}

export interface MarkdownFrontmatterResult {
  frontmatter: Record<string, string>;
  content: string;
}

export function parseMarkdownFrontmatter(markdown: string): MarkdownFrontmatterResult {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: {}, content: markdown };
  }

  const rawFrontmatter = match[1];
  const content = markdown.slice(match[0].length);
  const frontmatter: Record<string, string> = {};

  for (const line of rawFrontmatter.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!match) continue;
    frontmatter[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }

  return { frontmatter, content };
}

function toTitle(id: string): string {
  return id
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Load MCP server definitions from servers.yaml.
 */
export function loadMcpServers(yamlPath: string): McpServer[] {
  const raw = readFileSync(yamlPath, 'utf-8');
  const servers = [];
  // Split into server blocks by "- id:"
  const blocks = raw.split(/(?=^\s*- id:)/m).filter(b => b.includes('- id:'));

  for (const block of blocks) {
    servers.push({
      id: parseYamlListItemValue(block, 'id'),
      name: parseYamlValue(block, 'name'),
      description: parseYamlValue(block, 'description'),
      type: parseYamlValue(block, 'type') || 'stdio',
      command: parseYamlValue(block, 'command'),
      args: parseYamlArray(block, 'args'),
    });
  }
  return servers;
}

/**
 * Load agent definitions from the agents directory.
 */
export function loadAgents(agentsDir: string): AgentDefinitions {
  const agentsMd = readFileSync(join(agentsDir, 'AGENTS.md'), 'utf-8');
  const copilot = readFileSync(join(agentsDir, 'functions-copilot.agent.md'), 'utf-8');
  return { agentsMd, copilot };
}

/**
 * Load hooks from the hooks directory.
 */
export function loadHooks(hooksDir: string): HookDefinitions {
  const welcome = readFileSync(join(hooksDir, 'welcome-setup.md'), 'utf-8');
  return { welcome };
}

// ─── Minimal YAML helpers (no dependencies) ───

function parseYamlValue(yaml: string, key: string): string {
  const re = new RegExp(`^\\s*${key}:\\s*["']?(.+?)["']?\\s*$`, 'm');
  const m = yaml.match(re);
  return m ? m[1].trim() : '';
}

function parseYamlListItemValue(yaml: string, key: string): string {
  // Matches "- id: value" (list item with dash prefix)
  const re = new RegExp(`^\\s*-\\s+${key}:\\s*["']?(.+?)["']?\\s*$`, 'm');
  const m = yaml.match(re);
  return m ? m[1].trim() : '';
}

function parseYamlArray(yaml: string, key: string): string[] {
  const re = new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`);
  const m = yaml.match(re);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
}
