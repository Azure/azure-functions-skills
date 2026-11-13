import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDotenv } from '../shared/dotenv.js';

export interface AzdService {
  readonly name: string;
  readonly project: string;
  readonly host: string;
  readonly language: string;
}

export interface AzureYaml {
  readonly name: string;
  readonly template: string;
  readonly services: readonly AzdService[];
}

/** An environment variable that `infra/main.parameters.json` feeds into a Bicep parameter. */
export interface InfraInput {
  readonly variable: string;
  readonly parameter: string;
  /** True when the placeholder or the Bicep parameter supplies a default. */
  readonly hasDefault: boolean;
}

export interface DeployProject {
  readonly dir: string;
  readonly hasHostJson: boolean;
  readonly isHostedSkills: boolean;
  readonly azureYaml: AzureYaml | null;
  readonly infra: {
    readonly kind: 'bicep' | 'terraform' | null;
    readonly allowedLocations: readonly string[] | null;
    readonly inputs: readonly InfraInput[];
  };
  readonly environments: { readonly defaultName: string | null; readonly names: readonly string[] };
  /** Hash of `azure.yaml` and `infra/`. A plan is stale when this changes. */
  readonly fingerprint: string;
}

export function inspectProject(dir: string): DeployProject {
  const root = resolve(dir);
  const azureYaml = readAzureYaml(join(root, 'azure.yaml'));
  const functionProjects = (azureYaml?.services ?? [])
    .filter(service => service.host === 'function')
    .map(service => join(root, service.project));
  return {
    dir: root,
    hasHostJson: [root, ...functionProjects].some(folder => isFile(join(folder, 'host.json'))),
    isHostedSkills: isFile(join(root, 'agents.config.yaml')) || hasAgentFile(root),
    azureYaml,
    infra: readInfra(join(root, 'infra')),
    environments: readEnvironments(join(root, '.azure')),
    fingerprint: fingerprint(root),
  };
}

export function readEnvironmentValues(dir: string, environment: string): Record<string, string> | null {
  const path = join(resolve(dir), '.azure', environment, '.env');
  return isFile(path) ? parseDotenv(readFileSync(path, 'utf-8')) : null;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function hasAgentFile(root: string): boolean {
  return [root, join(root, 'src')].some(folder =>
    isDirectory(folder) && readdirSync(folder).some(name => name.endsWith('.agent.md')));
}

/** Reads the small part of `azure.yaml` that deployment needs. Not a general YAML parser. */
function readAzureYaml(path: string): AzureYaml | null {
  if (!isFile(path)) return null;
  let name = '';
  let template = '';
  const services: Array<{ -readonly [K in keyof AzdService]: AzdService[K] }> = [];
  let section = '';
  let serviceIndent = -1;
  for (const rawLine of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    const match = line.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match || line.trimStart().startsWith('#')) continue;
    const indent = match[1].length;
    const key = match[2];
    const value = match[3].replace(/^['"]|['"]$/g, '');
    if (indent === 0) {
      section = key;
      serviceIndent = -1;
      if (key === 'name') name = value;
    } else if (section === 'metadata' && key === 'template') {
      template = value;
    } else if (section === 'services') {
      if (serviceIndent < 0 || indent <= serviceIndent) {
        serviceIndent = indent;
        services.push({ name: key, project: '.', host: '', language: '' });
      } else if (key === 'project' || key === 'host' || key === 'language') {
        services[services.length - 1][key] = value;
      }
    }
  }
  return { name, template, services };
}

function readInfra(infraDir: string): DeployProject['infra'] {
  const bicepPath = join(infraDir, 'main.bicep');
  if (!isFile(bicepPath)) {
    const hasTerraform = isDirectory(infraDir) && readdirSync(infraDir).some(name => name.endsWith('.tf'));
    return { kind: hasTerraform ? 'terraform' : null, allowedLocations: null, inputs: [] };
  }
  const bicep = parseBicepParameters(readFileSync(bicepPath, 'utf-8'));
  return {
    kind: 'bicep',
    allowedLocations: bicep.get('location')?.allowed ?? null,
    inputs: readInputs(join(infraDir, 'main.parameters.json'), bicep),
  };
}

interface BicepParameter {
  readonly hasDefault: boolean;
  readonly allowed: string[] | null;
}

/** A declaration keyword followed by a name. A decorator property such as `type: 'location'` does not match. */
const OTHER_DECLARATION = /^(?:var|resource|module|output|type|func)\s+[A-Za-z_]|^targetScope\s*=/;

function parseBicepParameters(text: string): Map<string, BicepParameter> {
  const parameters = new Map<string, BicepParameter>();
  let allowed: string[] | null = null;
  let inAllowed = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inAllowed) {
      if (trimmed.startsWith('])')) inAllowed = false;
      else allowed?.push(...[...trimmed.matchAll(/'([^']*)'/g)].map(match => match[1]));
      continue;
    }
    if (trimmed.startsWith('@allowed([')) {
      allowed = [...trimmed.matchAll(/'([^']*)'/g)].map(match => match[1]);
      inAllowed = !trimmed.includes('])');
      continue;
    }
    const parameter = trimmed.match(/^param\s+([A-Za-z_][A-Za-z0-9_]*)\s+[^=]+?(=.*)?$/);
    if (parameter) {
      parameters.set(parameter[1], { hasDefault: Boolean(parameter[2]), allowed });
      allowed = null;
    } else if (OTHER_DECLARATION.test(trimmed)) {
      // Decorators such as @metadata can span lines, so only another declaration ends the list.
      allowed = null;
    }
  }
  return parameters;
}

function readInputs(path: string, bicep: Map<string, BicepParameter>): InfraInput[] {
  if (!isFile(path)) return [];
  let parsed: { parameters?: Record<string, { value?: unknown }> };
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as typeof parsed;
  } catch {
    return [];
  }
  const inputs = new Map<string, InfraInput>();
  for (const [parameter, entry] of Object.entries(parsed.parameters ?? {})) {
    for (const match of JSON.stringify(entry?.value ?? '').matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(=[^}]*)?\}/g)) {
      if (inputs.has(match[1])) continue;
      inputs.set(match[1], {
        variable: match[1],
        parameter,
        hasDefault: match[2] !== undefined || (bicep.get(parameter)?.hasDefault ?? false),
      });
    }
  }
  return [...inputs.values()].sort((a, b) => a.variable.localeCompare(b.variable));
}

function readEnvironments(azureDir: string): DeployProject['environments'] {
  if (!isDirectory(azureDir)) return { defaultName: null, names: [] };
  const names = readdirSync(azureDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && isFile(join(azureDir, entry.name, '.env')))
    .map(entry => entry.name)
    .sort();
  let defaultName: string | null = null;
  try {
    const config = JSON.parse(readFileSync(join(azureDir, 'config.json'), 'utf-8')) as { defaultEnvironment?: unknown };
    if (typeof config.defaultEnvironment === 'string' && names.includes(config.defaultEnvironment)) {
      defaultName = config.defaultEnvironment;
    }
  } catch {
    // No default environment is recorded.
  }
  return { defaultName, names };
}

function fingerprint(root: string): string {
  const hash = createHash('sha256');
  const files = [join(root, 'azure.yaml'), ...listFiles(join(root, 'infra'))].filter(isFile).sort();
  for (const file of files) {
    hash.update(file.slice(root.length).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function listFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
