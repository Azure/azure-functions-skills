import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isReservedVariable } from './env.ts';

export const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;

export interface EvalDefinition {
  /** Directory name of the eval; it names the scenario. */
  scenario: string;
  /** Stable logical identifier: evals/<skill>/<scenario>/eval.yaml. */
  id: string;
  file: string;
  directory: string;
}

export interface PreflightDefinition {
  module: string;
  options: unknown;
}

export interface SkillDefinition {
  name: string;
  skillDir: string;
  /** Files relative to skillDir. Undefined means the whole directory. */
  files?: string[];
  evals: EvalDefinition[];
  graders: string[];
  executors: string[];
  preflight: PreflightDefinition[];
}

export interface SharedSkill {
  name: string;
  skillDir: string;
  files?: string[];
}

export interface DisplayNames {
  models: Record<string, string>;
  skills: Record<string, string>;
  scenarios: Record<string, string>;
}

export interface BenchConfig {
  configPath: string;
  baseDir: string;
  title: string;
  models: string[];
  tiers: Record<string, string[]>;
  timeout: string;
  disabledSkills: string[];
  sharedSkills: SharedSkill[];
  skills: Record<string, SkillDefinition>;
  keepValues: string[];
  /** Fixed, non-secret variables given to every cell. */
  env: Record<string, string>;
  display: DisplayNames;
}

type Json = Record<string, unknown>;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`skill-bench config: ${message}`);
}

function object(value: unknown, label: string): Json {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  return value as Json;
}

function keys(value: Json, label: string, allowed: string[]): void {
  for (const key of Object.keys(value)) {
    check(allowed.includes(key), `unknown key "${key}" in ${label}; allowed keys: ${allowed.join(', ')}.`);
  }
}

function strings(value: unknown, label: string, { empty = false } = {}): string[] {
  check(Array.isArray(value) && (empty || value.length > 0)
    && value.every(item => typeof item === 'string' && item.length > 0) && new Set(value).size === value.length,
  `${label} must be a list of unique nonempty strings.`);
  return value as string[];
}

function names(value: unknown, label: string, options?: { empty?: boolean }): string[] {
  const list = strings(value, label, options);
  check(list.every(item => identifier.test(item)), `${label} must contain identifiers such as "my-skill".`);
  return list;
}

function labels(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  const map = object(value, label);
  check(Object.entries(map).every(([key, text]) => identifier.test(key) && typeof text === 'string'
    && text.length > 0 && text.length <= 120), `${label} must map identifiers to short labels.`);
  return map as Record<string, string>;
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function noLinks(path: string, label: string): void {
  // Staging refuses links inside a copied tree; this refuses a linked entry point.
  check(!lstatSync(path).isSymbolicLink(), `${label} must not be a symbolic link (${path}).`);
}

function existing(base: string, value: unknown, label: string, kind: 'file' | 'directory'): string {
  check(typeof value === 'string' && value.length > 0, `${label} must be a nonempty path.`);
  const path = resolve(base, value);
  check(existsSync(path), `${label} does not exist: ${path}.`);
  noLinks(path, label);
  const real = realpathSync(path);
  const stat = lstatSync(real);
  check(kind === 'file' ? stat.isFile() : stat.isDirectory(), `${label} must be a ${kind}: ${path}.`);
  return real;
}

function skillFiles(value: unknown, skillDir: string, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  const files = strings(value, label);
  for (const file of files) {
    check(!isAbsolute(file) && file.split('/').every(part => part !== '' && part !== '.' && part !== '..')
      && !file.includes('\\'), `${label} must use relative forward-slash paths inside the skill directory.`);
    existing(skillDir, file, `${label} entry ${file}`, 'file');
  }
  check(files.includes('SKILL.md'), `${label} must include SKILL.md.`);
  return files;
}

function frontmatterName(skillDir: string): string | undefined {
  const text = readFileSync(join(skillDir, 'SKILL.md'), 'utf8').replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const line = match?.[1].split(/\r?\n/).find(item => /^name\s*:/.test(item));
  return line?.replace(/^name\s*:\s*/, '').trim().replace(/^['"]|['"]$/g, '');
}

function skillDirectory(base: string, entry: Json, name: string, label: string): string {
  const skillDir = existing(base, entry.skillDir, `${label}.skillDir`, 'directory');
  existing(skillDir, 'SKILL.md', `${label}.skillDir/SKILL.md`, 'file');
  const declared = frontmatterName(skillDir);
  check(declared === name, `${label}: SKILL.md declares name "${declared ?? ''}", but the config key is "${name}".`);
  return skillDir;
}

function timeout(value: unknown): string {
  if (value === undefined) return '10m';
  check(typeof value === 'string' && /^[1-9]\d{0,3}[smh]$/.test(value), 'timeout must be a duration such as "10m".');
  return value;
}

export function parseConfig(value: unknown, configPath: string): BenchConfig {
  const baseDir = dirname(configPath);
  const config = object(value, 'the configuration');
  keys(config, 'the configuration', ['$schema', 'title', 'models', 'tiers', 'timeout', 'disabledSkills',
    'sharedSkills', 'skills', 'redaction', 'display', 'env']);
  const title = config.title === undefined ? 'Skill benchmark' : config.title;
  check(typeof title === 'string' && title.length > 0 && title.length <= 120, 'title must be a short string.');
  const models = names(config.models, 'models');
  const tiers: Record<string, string[]> = {};
  if (config.tiers !== undefined) {
    for (const [tier, list] of Object.entries(object(config.tiers, 'tiers'))) {
      check(identifier.test(tier), 'tier names must be identifiers.');
      tiers[tier] = names(list, `tiers.${tier}`).map(model => {
        check(models.includes(model), `tiers.${tier} must name registered models; "${model}" is not in models.`);
        return model;
      });
    }
    // A tier map is a partition: `--tier` never omits a model and never measures one twice.
    const tiered = Object.values(tiers).flat();
    check(Object.keys(tiers).length === 0 || (new Set(tiered).size === tiered.length
      && models.every(model => tiered.includes(model))), 'tiers must place every registered model in exactly one tier.');
  }
  const disabledSkills = config.disabledSkills === undefined ? [] : names(config.disabledSkills, 'disabledSkills', { empty: true });

  const sharedSkills: SharedSkill[] = [];
  for (const [name, raw] of Object.entries(config.sharedSkills === undefined ? {} : object(config.sharedSkills, 'sharedSkills'))) {
    check(identifier.test(name), 'sharedSkills keys must be identifiers.');
    const entry = object(raw, `sharedSkills.${name}`);
    keys(entry, `sharedSkills.${name}`, ['skillDir', 'files']);
    const skillDir = skillDirectory(baseDir, entry, name, `sharedSkills.${name}`);
    const files = skillFiles(entry.files, skillDir, `sharedSkills.${name}.files`);
    sharedSkills.push({ name, skillDir, ...(files ? { files } : {}) });
  }

  const skills: Record<string, SkillDefinition> = {};
  const rawSkills = object(config.skills, 'skills');
  check(Object.keys(rawSkills).length > 0, 'skills must register at least one skill.');
  for (const [name, raw] of Object.entries(rawSkills)) {
    check(identifier.test(name), 'skills keys must be identifiers.');
    check(!sharedSkills.some(shared => shared.name === name), `"${name}" is both measured and shared; a skill can be only one.`);
    check(!disabledSkills.includes(name), `disabledSkills must not name the measured skill "${name}".`);
    const entry = object(raw, `skills.${name}`);
    keys(entry, `skills.${name}`, ['skillDir', 'files', 'evals', 'plugins']);
    const skillDir = skillDirectory(baseDir, entry, name, `skills.${name}`);
    const files = skillFiles(entry.files, skillDir, `skills.${name}.files`);
    const evals = strings(entry.evals, `skills.${name}.evals`).map(path => {
      check(basename(path) === 'eval.yaml', `skills.${name}.evals entries must point to <scenario>/eval.yaml.`);
      const file = existing(baseDir, path, `skills.${name}.evals entry ${path}`, 'file');
      const scenario = basename(dirname(file));
      check(identifier.test(scenario), `skills.${name}.evals scenario directory "${scenario}" must be an identifier.`);
      return { scenario, id: `evals/${name}/${scenario}/eval.yaml`, file, directory: dirname(file) };
    });
    const scenarios = evals.map(item => item.scenario);
    check(new Set(scenarios).size === scenarios.length, `skills.${name}.evals has a duplicate scenario directory name.`);
    const plugins = entry.plugins === undefined ? {} : object(entry.plugins, `skills.${name}.plugins`);
    keys(plugins, `skills.${name}.plugins`, ['graders', 'executors', 'preflight']);
    const modules = (list: unknown, label: string) => list === undefined ? []
      : strings(list, label).map(path => existing(baseDir, path, `${label} entry ${path}`, 'file'));
    const preflight = (plugins.preflight === undefined ? [] : (() => {
      check(Array.isArray(plugins.preflight), `skills.${name}.plugins.preflight must be a list.`);
      return plugins.preflight as unknown[];
    })()).map((item, index) => {
      const definition = object(item, `skills.${name}.plugins.preflight[${index}]`);
      keys(definition, `skills.${name}.plugins.preflight[${index}]`, ['module', 'options']);
      return {
        module: existing(baseDir, definition.module, `skills.${name}.plugins.preflight[${index}].module`, 'file'),
        options: definition.options ?? {},
      };
    });
    skills[name] = {
      name, skillDir, ...(files ? { files } : {}), evals,
      graders: modules(plugins.graders, `skills.${name}.plugins.graders`),
      executors: modules(plugins.executors, `skills.${name}.plugins.executors`),
      preflight,
    };
  }
  for (const shared of sharedSkills) {
    check(!disabledSkills.includes(shared.name), `disabledSkills must not name the shared skill "${shared.name}".`);
  }

  const redaction = config.redaction === undefined ? {} : object(config.redaction, 'redaction');
  keys(redaction, 'redaction', ['keepValues']);
  const keepValues = redaction.keepValues === undefined ? [] : strings(redaction.keepValues, 'redaction.keepValues', { empty: true });
  check(keepValues.every(item => item.length <= 80), 'redaction.keepValues entries must be short literal values.');
  const env = config.env === undefined ? {} : object(config.env, 'env');
  for (const [name, text] of Object.entries(env)) {
    check(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) && typeof text === 'string' && text.length <= 200,
      'env must map variable names to short literal values.');
    check(!isReservedVariable(name), `env.${name} is reserved or looks like a secret; secrets never go in the configuration.`);
  }
  const display = config.display === undefined ? {} : object(config.display, 'display');
  keys(display, 'display', ['models', 'skills', 'scenarios']);
  return {
    configPath, baseDir, title, models, tiers, timeout: timeout(config.timeout), disabledSkills, sharedSkills, skills,
    keepValues, env: env as Record<string, string>,
    display: {
      models: labels(display.models, 'display.models'),
      skills: labels(display.skills, 'display.skills'),
      scenarios: labels(display.scenarios, 'display.scenarios'),
    },
  };
}

export function loadConfig(path: string): BenchConfig {
  const configPath = existing(process.cwd(), path, 'the configuration file', 'file');
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`skill-bench config: invalid JSON in ${configPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return parseConfig(value, configPath);
}

export function isInside(parent: string, child: string): boolean {
  return inside(parent, child);
}
