import { readFileSync } from 'node:fs';

export type StarterOs = 'windows' | 'macos' | 'linux';
export const STARTER_OSES: readonly StarterOs[] = ['windows', 'macos', 'linux'];

export interface StarterSource {
  readonly repository: string;
  readonly branch: string;
  readonly path: string;
}

export interface StarterTemplate {
  readonly akaLink: string;
  readonly prompt: string;
  /** Repository-relative directory that holds the cached app files. */
  readonly appDir: string;
}

export interface StarterBundle {
  readonly title: string;
  readonly skills: readonly string[];
  readonly tools: readonly string[];
  readonly handoff: string;
  /** Repository-relative directory of instruction files (AGENTS.md, CLAUDE.md, copilot-instructions.md). */
  readonly agentFiles?: string;
  readonly akaLink?: string;
  readonly prompt?: string;
  readonly templates?: Readonly<Record<string, StarterTemplate>>;
}

export interface StarterConfig {
  readonly schemaVersion: 1;
  readonly source: StarterSource;
  readonly bundles: Readonly<Record<string, StarterBundle>>;
}

export interface ToolInstallEntry {
  readonly probes: readonly string[];
  readonly reason: string;
  readonly docs: string;
  readonly commands: Readonly<Record<StarterOs, string | null>>;
}

export interface ToolInstallTable {
  readonly schemaVersion: 1;
  readonly tools: Readonly<Record<string, ToolInstallEntry>>;
}

const NAME = /^[a-z][a-z0-9-]{0,40}$/;
const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const SAFE_RELATIVE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const AKA_LINK = /^https:\/\/aka\.ms\/[A-Za-z0-9-]+$/;

export function loadStarterConfig(path: string): StarterConfig {
  return parseStarterConfig(JSON.parse(readFileSync(path, 'utf-8')));
}

export function loadToolInstallTable(path: string): ToolInstallTable {
  return parseToolInstallTable(JSON.parse(readFileSync(path, 'utf-8')));
}

export function parseStarterConfig(value: unknown): StarterConfig {
  const root = record(value, 'starter config');
  if (root.schemaVersion !== 1) throw new Error('starter config: schemaVersion must be 1.');
  const source = record(root.source, 'source');
  const repository = text(source.repository, 'source.repository');
  const branch = text(source.branch, 'source.branch');
  const path = text(source.path, 'source.path');
  if (!REPOSITORY.test(repository)) throw new Error(`Invalid source.repository: ${repository}`);
  if (!BRANCH.test(branch) || branch.includes('..')) throw new Error(`Invalid source.branch: ${branch}`);
  if (!SAFE_RELATIVE.test(path) || path.split('/').some(part => part === '.' || part === '..')) {
    throw new Error(`Invalid source.path: ${path}`);
  }
  const bundlesValue = record(root.bundles, 'bundles');
  const bundles: Record<string, StarterBundle> = {};
  const owners = new Map<string, string>();
  for (const [name, bundleValue] of Object.entries(bundlesValue)) {
    if (!NAME.test(name)) throw new Error(`Invalid bundle name: ${name}`);
    const bundle = parseBundle(name, bundleValue);
    for (const skill of bundle.skills) {
      const owner = owners.get(skill);
      if (owner !== undefined) throw new Error(`Skill ${skill} is listed in bundles ${owner} and ${name}.`);
      owners.set(skill, name);
    }
    bundles[name] = bundle;
  }
  if (Object.keys(bundles).length === 0) throw new Error('starter config: no bundles.');
  return { schemaVersion: 1, source: { repository, branch, path }, bundles };
}

function parseBundle(name: string, value: unknown): StarterBundle {
  const bundle = record(value, `bundle ${name}`);
  const skills = names(bundle.skills, `bundle ${name}.skills`);
  const tools = names(bundle.tools, `bundle ${name}.tools`);
  if (skills.length === 0) throw new Error(`bundle ${name}: no skills.`);
  const handoff = text(bundle.handoff, `bundle ${name}.handoff`);
  if (!skills.includes(handoff)) throw new Error(`bundle ${name}: handoff ${handoff} is not in the bundle.`);
  const title = text(bundle.title, `bundle ${name}.title`);
  let agentFiles: string | undefined;
  if (bundle.agentFiles !== undefined) {
    agentFiles = text(bundle.agentFiles, `bundle ${name}.agentFiles`);
    if (!SAFE_RELATIVE.test(agentFiles) || agentFiles.split('/').some(part => part === '.' || part === '..')) {
      throw new Error(`Invalid bundle ${name}.agentFiles: ${agentFiles}`);
    }
  }
  const shared = { title, skills, tools, handoff, ...(agentFiles ? { agentFiles } : {}) };
  if (bundle.templates === undefined) {
    return {
      ...shared,
      akaLink: akaLink(bundle.akaLink, `bundle ${name}.akaLink`),
      prompt: prompt(bundle.prompt, bundle.akaLink as string, `bundle ${name}.prompt`),
    };
  }
  if (bundle.akaLink !== undefined || bundle.prompt !== undefined) {
    throw new Error(`bundle ${name}: a bundle with templates has one link and prompt per template.`);
  }
  const templatesValue = record(bundle.templates, `bundle ${name}.templates`);
  const templates: Record<string, StarterTemplate> = {};
  for (const [templateName, templateValue] of Object.entries(templatesValue)) {
    if (!NAME.test(templateName)) throw new Error(`Invalid template name: ${templateName}`);
    const template = record(templateValue, `template ${templateName}`);
    const link = akaLink(template.akaLink, `template ${templateName}.akaLink`);
    const appDir = text(template.appDir, `template ${templateName}.appDir`);
    if (!SAFE_RELATIVE.test(appDir)) throw new Error(`Invalid template ${templateName}.appDir: ${appDir}`);
    templates[templateName] = {
      akaLink: link,
      prompt: prompt(template.prompt, link, `template ${templateName}.prompt`),
      appDir,
    };
  }
  if (Object.keys(templates).length === 0) throw new Error(`bundle ${name}: templates is empty.`);
  return { ...shared, templates };
}

export function parseToolInstallTable(value: unknown): ToolInstallTable {
  const root = record(value, 'tool-install table');
  if (root.schemaVersion !== 1) throw new Error('tool-install table: schemaVersion must be 1.');
  const toolsValue = record(root.tools, 'tools');
  const tools: Record<string, ToolInstallEntry> = {};
  for (const [name, entryValue] of Object.entries(toolsValue)) {
    if (!NAME.test(name)) throw new Error(`Invalid tool name: ${name}`);
    const entry = record(entryValue, `tool ${name}`);
    const probes = names(entry.probes, `tool ${name}.probes`);
    if (probes.length === 0) throw new Error(`tool ${name}: no probes.`);
    const commandsValue = record(entry.commands, `tool ${name}.commands`);
    const commands = {} as Record<StarterOs, string | null>;
    for (const os of STARTER_OSES) {
      const command = commandsValue[os];
      if (command !== null && (typeof command !== 'string' || !isSingleLine(command) || command.length === 0)) {
        throw new Error(`tool ${name}.commands.${os} must be a single-line string or null.`);
      }
      commands[os] = command;
    }
    const docs = text(entry.docs, `tool ${name}.docs`);
    if (!/^https:\/\/[^\s]+$/.test(docs)) throw new Error(`tool ${name}.docs must be an https URL.`);
    tools[name] = { probes, reason: text(entry.reason, `tool ${name}.reason`), docs, commands };
  }
  return { schemaVersion: 1, tools };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || !isSingleLine(value)) {
    throw new Error(`${label} must be a non-empty single-line string.`);
  }
  return value;
}

function names(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !NAME.test(item))) {
    throw new Error(`${label} must be an array of names.`);
  }
  const list = value as string[];
  if (new Set(list).size !== list.length) throw new Error(`${label} has duplicates.`);
  return list;
}

function akaLink(value: unknown, label: string): string {
  const link = text(value, label);
  if (!AKA_LINK.test(link)) throw new Error(`${label} must be an https://aka.ms/ link.`);
  return link;
}

function prompt(value: unknown, link: string, label: string): string {
  const result = text(value, label);
  if (!result.includes(link)) throw new Error(`${label} must name ${link}.`);
  return result;
}

function isSingleLine(value: string): boolean {
  return ![...value].some(character => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}
