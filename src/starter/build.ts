import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderSkillFiles } from '../build/build-target.js';
import type { TelemetryRuntime } from '../build/telemetry-runtime.js';
import type { Skill } from '../types.js';
import { STARTER_OSES, type StarterBundle, type StarterConfig, type ToolInstallTable } from './config.js';
import { HOOK_DESTINATIONS, STARTER_AGENTS, hookSnippet, type StarterAgent } from './hooks.js';

/** Raised when an archive needs an installer that understands a newer payload layout. */
export const STARTER_ENGINE_VERSION = 1;

export interface StarterEndpoints {
  readonly api: string;
  readonly codeload: string;
  /** Git smart HTTP host; its ref advertisement resolves the branch when the API is rate limited. */
  readonly git: string;
  readonly raw: string;
  readonly telemetry: string;
  readonly instrumentationKey: string;
  /** When true, the POSIX installer refuses non-HTTPS transfers and redirects. */
  readonly httpsOnly: boolean;
}

export const DEFAULT_STARTER_ENDPOINTS: Omit<StarterEndpoints, 'telemetry' | 'instrumentationKey'> = {
  api: 'https://api.github.com',
  codeload: 'https://codeload.github.com',
  git: 'https://github.com',
  raw: 'https://raw.githubusercontent.com',
  httpsOnly: true,
};

export interface StarterBuildInput {
  /** Repository root that holds `templates/` and the template app directories. */
  readonly root: string;
  readonly config: StarterConfig;
  readonly tools: ToolInstallTable;
  readonly skills: readonly Skill[];
  readonly runtime: TelemetryRuntime;
  readonly packageVersion: string;
  readonly endpoints: StarterEndpoints;
}

/** Generated starter files keyed by path relative to the starter root. */
export type StarterFiles = Map<string, Buffer>;

interface ManifestRow {
  readonly scope: string;
  readonly source: string;
  readonly destination: string;
}

export function buildStarterFiles(input: StarterBuildInput): StarterFiles {
  const files: StarterFiles = new Map();
  const add = (path: string, content: Buffer | string): void => {
    if (files.has(path)) throw new Error(`Duplicate starter file: ${path}`);
    files.set(path, normalize(typeof content === 'string' ? Buffer.from(content, 'utf-8') : content));
  };
  const engineDir = join(input.root, 'templates', 'starter', 'engine');
  const substitutions = installerSubstitutions(input);
  add('engine-version', `${STARTER_ENGINE_VERSION}\n`);
  for (const name of ['install.ps1', 'install.sh']) {
    add(name, substitute(readFileSync(join(engineDir, name), 'utf-8'), substitutions));
  }
  for (const name of ['bootstrap.ps1', 'bootstrap.sh']) {
    add(name, readFileSync(join(engineDir, name)));
  }

  addRuntime(input, add, files);
  const skillsById = new Map(input.skills.map(skill => [skill.id, skill]));
  for (const [name, bundle] of Object.entries(input.config.bundles)) {
    addBundle(input, name, bundle, skillsById, add, files);
  }
  return files;
}

function addRuntime(input: StarterBuildInput, add: (path: string, content: Buffer | string) => void, files: StarterFiles): void {
  const rows: ManifestRow[] = [];
  const runtimeFiles: Array<[string, string]> = [
    ['telemetry.mjs', input.runtime.code],
    ['package.json', `${JSON.stringify({ private: true, type: 'module', version: input.packageVersion }, null, 2)}\n`],
    ['THIRD-PARTY-NOTICES.txt', input.runtime.notices],
    ['vendor/applicationinsights/package.json', input.runtime.sdkPackage],
  ];
  for (const [path, content] of runtimeFiles) {
    add(`runtime/${path}`, content);
    rows.push({ scope: 'common', source: path, destination: `.azure-functions-skills/runtime/${path}` });
  }
  add('runtime/preference/enabled.json', '{\n  "enabled": true\n}\n');
  add('runtime/preference/disabled.json', '{\n  "enabled": false\n}\n');
  rows.push({ scope: 'preference-on', source: 'preference/enabled.json', destination: '.azure-functions-skills/telemetry.config.json' });
  rows.push({ scope: 'preference-off', source: 'preference/disabled.json', destination: '.azure-functions-skills/telemetry.config.json' });
  for (const agent of STARTER_AGENTS) {
    const source = `hooks/${agent}.json`;
    add(`runtime/${source}`, `${JSON.stringify(hookSnippet(agent), null, 2)}\n`);
    rows.push({ scope: `hook-${agent}`, source, destination: HOOK_DESTINATIONS[agent] });
    rows.push({ scope: `hook-${agent}`, source, destination: `.azure-functions-skills/hooks/${agent}.json` });
  }
  add('runtime/files.tsv', manifest(rows, 'runtime', files));
}

function addBundle(
  input: StarterBuildInput,
  name: string,
  bundle: StarterBundle,
  skillsById: ReadonlyMap<string, Skill>,
  add: (path: string, content: Buffer | string) => void,
  files: StarterFiles,
): void {
  if (name === 'runtime') throw new Error('A bundle cannot be named runtime.');
  const rows: ManifestRow[] = [];
  for (const id of bundle.skills) {
    const skill = skillsById.get(id);
    if (!skill) throw new Error(`Bundle ${name} lists unknown skill ${id}.`);
    for (const file of renderSkillFiles(skill)) {
      const source = `skills/${id}/${file.path}`;
      add(`${name}/${source}`, file.content);
      rows.push({ scope: 'agents', source, destination: `.agents/skills/${id}/${file.path}` });
      rows.push({ scope: 'claude', source, destination: `.claude/skills/${id}/${file.path}` });
    }
  }
  add(`${name}/files.tsv`, manifest(rows, name, files));
  add(`${name}/tools.tsv`, toolsTable(input.tools, bundle.tools, name));

  if (bundle.templates === undefined) {
    add(`${name}/start.md`, renderStart(input, name, bundle, null));
    return;
  }
  for (const [templateName, template] of Object.entries(bundle.templates)) {
    const base = `${name}/templates/${templateName}`;
    const templateRows: ManifestRow[] = [];
    for (const path of listFiles(join(input.root, ...template.appDir.split('/')))) {
      const source = `app/${path}`;
      add(`${base}/${source}`, readFileSync(join(input.root, ...template.appDir.split('/'), ...path.split('/'))));
      templateRows.push({ scope: 'common', source, destination: appDestination(path) });
      if (path === 'local.settings.json.sample' || path.endsWith('/local.settings.json.sample')) {
        templateRows.push({ scope: 'common', source, destination: path.replace(/\.sample$/, '') });
      }
    }
    add(`${base}/files.tsv`, manifest(templateRows, base, files));
    add(`${base}/start.md`, renderStart(input, name, bundle, templateName));
  }
}

/** Cached files that git or a host would treat specially are stored under another name. */
function appDestination(path: string): string {
  return path === 'gitignore.template' ? '.gitignore' : path;
}

function manifest(rows: readonly ManifestRow[], base: string, files: StarterFiles): string {
  return rows.map(row => {
    const content = files.get(`${base}/${row.source}`);
    if (!content) throw new Error(`Manifest source is missing: ${base}/${row.source}`);
    for (const path of [row.source, row.destination]) {
      if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path) || path.split('/').some(part => part === '.' || part === '..')) {
        throw new Error(`Unsafe manifest path: ${path}`);
      }
    }
    return `${row.scope}\t${sha256(content)}\t${row.source}\t${row.destination}\n`;
  }).join('');
}

function toolsTable(table: ToolInstallTable, tools: readonly string[], bundle: string): string {
  const lines: string[] = [];
  for (const tool of tools) {
    const entry = table.tools[tool];
    if (!entry) throw new Error(`Bundle ${bundle} lists tool ${tool}, which has no entry in tool-install.json.`);
    for (const os of STARTER_OSES) {
      const fields = [tool, entry.probes.join(','), os, entry.reason, entry.docs, entry.commands[os] ?? '-'];
      if (fields.some(field => field.includes('\t'))) throw new Error(`Tool ${tool} has a tab in a field.`);
      lines.push(`${fields.join('\t')}\n`);
    }
  }
  return lines.join('');
}

export function rawBase(input: Pick<StarterBuildInput, 'config' | 'endpoints'>): string {
  const { repository, branch, path } = input.config.source;
  return `${input.endpoints.raw}/${repository}/${branch}/${path}`;
}

export function powerShellCommand(input: Pick<StarterBuildInput, 'config' | 'endpoints'>, bundle: string, template: string | null, agent: StarterAgent | '<agent>'): string {
  const templateArgument = template ? ` -Template ${template}` : '';
  return `& ([scriptblock]::Create((Invoke-RestMethod '${rawBase(input)}/install.ps1'))) -Bundle ${bundle}${templateArgument} -Agent ${agent} -Json`;
}

export function posixCommand(input: Pick<StarterBuildInput, 'config' | 'endpoints'>, bundle: string, template: string | null, agent: StarterAgent | '<agent>'): string {
  const templateArgument = template ? ` --template ${template}` : '';
  return `(set -eu; installer=$(mktemp); trap 'rm -f "$installer"' EXIT; curl -fsSL --proto '=https' --proto-redir '=https' '${rawBase(input)}/install.sh' -o "$installer"; sh "$installer" --bundle ${bundle}${templateArgument} --agent ${agent} --json)`;
}

function renderStart(input: StarterBuildInput, name: string, bundle: StarterBundle, template: string | null): string {
  const startTemplate = readFileSync(join(input.root, 'templates', 'starter', 'start.md'), 'utf-8');
  const handoffPath = join(input.root, 'templates', 'starter', 'handoff', `${name}.md`);
  const handoff = existsSync(handoffPath)
    ? readFileSync(handoffPath, 'utf-8').trim()
    : `When the user answers, use the installed \`${bundle.handoff}\` skill.`;
  return substitute(startTemplate, {
    '{{TITLE}}': bundle.title,
    '{{BRANCH}}': input.config.source.branch,
    '{{POWERSHELL_COMMAND}}': powerShellCommand(input, name, template, '<agent>'),
    '{{POSIX_COMMAND}}': posixCommand(input, name, template, '<agent>'),
    '{{HANDOFF}}': handoff,
  });
}

function installerSubstitutions(input: StarterBuildInput): Record<string, string> {
  const { repository, branch, path } = input.config.source;
  const values: Record<string, string> = {
    __AFS_ENGINE__: String(STARTER_ENGINE_VERSION),
    __AFS_REPOSITORY__: repository,
    __AFS_ARCHIVE_PREFIX__: `${repository.split('/')[1]}-`,
    __AFS_BRANCH__: branch,
    __AFS_PATH__: path,
    __AFS_API_BASE__: input.endpoints.api,
    __AFS_CODELOAD_BASE__: input.endpoints.codeload,
    __AFS_GIT_BASE__: input.endpoints.git,
    __AFS_TELEMETRY_ENDPOINT__: input.endpoints.telemetry.replace(/\/+$/, ''),
    __AFS_INSTRUMENTATION_KEY__: input.endpoints.instrumentationKey,
    __AFS_SKILLS_VERSION__: input.packageVersion,
    __AFS_CURL_PROTOCOLS__: input.endpoints.httpsOnly ? "--proto =https --proto-redir =https" : '',
  };
  for (const [key, value] of Object.entries(values)) {
    if (/['\r\n]/.test(value)) throw new Error(`Installer value ${key} must not contain quotes or newlines.`);
  }
  return values;
}

function substitute(text: string, values: Readonly<Record<string, string>>): string {
  let result = text;
  for (const [key, value] of Object.entries(values)) result = result.split(key).join(value);
  const leftover = result.match(/__AFS_[A-Z_]+__|\{\{[A-Z_]+\}\}/);
  if (leftover) throw new Error(`Unreplaced placeholder: ${leftover[0]}`);
  return result;
}

/** Text files are stored with LF line endings so that hashes match on every OS. */
function normalize(content: Buffer): Buffer {
  if (content.includes(0)) return content;
  const text = content.toString('utf-8');
  if (!Buffer.from(text, 'utf-8').equals(content) || !text.includes('\r\n')) return content;
  return Buffer.from(text.replaceAll('\r\n', '\n'), 'utf-8');
}

export function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(directory, entry.name), path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk(root, '');
  return files;
}
