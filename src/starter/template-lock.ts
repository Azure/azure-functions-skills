import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listFiles, normalize, sha256 } from './build.js';
import type { StarterConfig } from './config.js';

/** One cached app template: where it came from and the hash of every cached file. */
export interface TemplateLockEntry {
  /** Template id in the templates manifest the cache came from. */
  readonly manifestId?: string;
  readonly repository: string;
  /** Folder inside the repository; `.` is the repository root. */
  readonly path?: string;
  readonly ref: string;
  readonly commit: string;
  /** Cache path (relative to the template's appDir) to SHA-256 of its LF-normalized bytes. */
  readonly files: Readonly<Record<string, string>>;
}

export interface StarterLock {
  readonly schemaVersion: 1;
  /** Keyed by `<bundle>/<template>`. */
  readonly templates: Readonly<Record<string, TemplateLockEntry>>;
}

const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REF = /^[A-Za-z0-9._/-]+$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MANIFEST_ID = /^[a-z0-9][a-z0-9-]{0,100}$/;

export function loadStarterLock(path: string): StarterLock {
  if (!existsSync(path)) return { schemaVersion: 1, templates: {} };
  return parseStarterLock(JSON.parse(readFileSync(path, 'utf-8')));
}

export function parseStarterLock(value: unknown): StarterLock {
  const root = value as { schemaVersion?: unknown; templates?: unknown };
  if (root?.schemaVersion !== 1 || typeof root.templates !== 'object' || root.templates === null) {
    throw new Error('starter.lock.json: expected { "schemaVersion": 1, "templates": { ... } }.');
  }
  const templates: Record<string, TemplateLockEntry> = {};
  for (const [key, raw] of Object.entries(root.templates as Record<string, unknown>)) {
    const entry = raw as Partial<TemplateLockEntry>;
    if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(key)) throw new Error(`starter.lock.json: invalid key ${key}.`);
    if (typeof entry.repository !== 'string' || !REPOSITORY.test(entry.repository)) throw new Error(`starter.lock.json: ${key}.repository is invalid.`);
    if (typeof entry.ref !== 'string' || !REF.test(entry.ref)) throw new Error(`starter.lock.json: ${key}.ref is invalid.`);
    if (typeof entry.commit !== 'string' || !COMMIT.test(entry.commit)) throw new Error(`starter.lock.json: ${key}.commit is invalid.`);
    if (typeof entry.files !== 'object' || entry.files === null) throw new Error(`starter.lock.json: ${key}.files is invalid.`);
    for (const [path, digest] of Object.entries(entry.files)) {
      if (typeof digest !== 'string' || !DIGEST.test(digest)) throw new Error(`starter.lock.json: ${key}.files.${path} is not a SHA-256.`);
    }
    if (entry.manifestId !== undefined && (typeof entry.manifestId !== 'string' || !MANIFEST_ID.test(entry.manifestId))) {
      throw new Error(`starter.lock.json: ${key}.manifestId is invalid.`);
    }
    if (entry.path !== undefined && !isFolderPath(entry.path)) throw new Error(`starter.lock.json: ${key}.path is invalid.`);
    templates[key] = {
      ...(entry.manifestId !== undefined ? { manifestId: entry.manifestId } : {}),
      repository: entry.repository,
      ...(entry.path !== undefined ? { path: entry.path } : {}),
      ref: entry.ref,
      commit: entry.commit,
      files: { ...entry.files },
    };
  }
  return { schemaVersion: 1, templates };
}

/** One template of the Azure Functions templates manifest, reduced to what the starter cache needs. */
export interface ManifestTemplate {
  readonly id: string;
  readonly repository: string;
  /** Folder inside the repository; `.` is the repository root. */
  readonly path: string;
  /** Tag, branch, or commit, without a `refs/tags/` or `refs/heads/` prefix. */
  readonly ref: string;
  readonly categories: readonly string[];
}

export interface TemplateManifest {
  readonly version: string;
  readonly templates: readonly ManifestTemplate[];
  /** Entries the starter cannot use, by id, with the reason. Other entries stay usable. */
  readonly rejected: Readonly<Record<string, string>>;
}

export const DEFAULT_TEMPLATE_MANIFEST_URL = 'https://cdn.functions.azure.com/public/templates-manifest/manifest.json';

export function parseTemplateManifest(value: unknown): TemplateManifest {
  const root = value as { version?: unknown; templates?: unknown };
  if (typeof root?.version !== 'string' || !Array.isArray(root.templates)) {
    throw new Error('Templates manifest: expected { "version": "...", "templates": [ ... ] }.');
  }
  const templates: ManifestTemplate[] = [];
  const rejected: Record<string, string> = {};
  for (const raw of root.templates as unknown[]) {
    const item = raw as { id?: unknown; repositoryUrl?: unknown; folderPath?: unknown; gitRef?: unknown; categories?: unknown };
    if (typeof item?.id !== 'string' || !MANIFEST_ID.test(item.id)) continue;
    const repository = typeof item.repositoryUrl === 'string'
      ? /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(item.repositoryUrl)?.[1]
      : undefined;
    // An empty folderPath means the repository root.
    const folder = item.folderPath === '' ? '.' : item.folderPath;
    const ref = typeof item.gitRef === 'string' ? item.gitRef.replace(/^refs\/(?:tags|heads)\//, '') : '';
    if (!repository || !REPOSITORY.test(repository)) rejected[item.id] = 'unsupported repositoryUrl (only https://github.com/<owner>/<repo>)';
    else if (!isFolderPath(folder)) rejected[item.id] = 'unsafe folderPath';
    else if (!REF.test(ref) || ref.split('/').includes('..')) rejected[item.id] = 'invalid gitRef';
    else {
      const categories = Array.isArray(item.categories) ? item.categories.filter((c): c is string => typeof c === 'string') : [];
      templates.push({ id: item.id, repository, path: folder.replace(/\/+$/, ''), ref, categories });
    }
  }
  return { version: root.version, templates, rejected };
}

export async function fetchTemplateManifest(url = DEFAULT_TEMPLATE_MANIFEST_URL): Promise<TemplateManifest> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot download the templates manifest ${url} (HTTP ${response.status}).`);
  return parseTemplateManifest(await response.json());
}

/**
 * Compares the cached templates with the manifest. Reports a cached template whose manifest
 * entry is gone or points elsewhere, and a manifest starter (all of a bundle's
 * `manifestCategories`) that no template of that bundle caches.
 */
export function checkTemplateManifest(config: StarterConfig, lock: StarterLock, manifest: TemplateManifest): string[] {
  const messages: string[] = [];
  const byId = new Map(manifest.templates.map(template => [template.id, template]));
  for (const [bundleName, bundle] of Object.entries(config.bundles)) {
    const cached = new Set<string>();
    for (const [templateName, template] of Object.entries(bundle.templates ?? {})) {
      if (!template.manifestId) continue;
      cached.add(template.manifestId);
      const key = `${bundleName}/${templateName}`;
      const upstream = byId.get(template.manifestId);
      if (!upstream) {
        const reason = manifest.rejected[template.manifestId];
        messages.push(reason
          ? `${key}: manifest template ${template.manifestId} cannot be used: ${reason}.`
          : `${key}: manifest template ${template.manifestId} is missing.`);
        continue;
      }
      const entry = lock.templates[key];
      const want = `${upstream.repository}/${upstream.path}@${upstream.ref}`;
      const have = entry ? `${entry.repository}/${entry.path ?? '.'}@${entry.ref}` : 'nothing';
      if (want !== have) messages.push(`${key}: the manifest has ${want}; the cache has ${have}.`);
    }
    const categories = bundle.manifestCategories ?? [];
    if (categories.length === 0) continue;
    for (const upstream of manifest.templates) {
      if (categories.every(category => upstream.categories.includes(category)) && !cached.has(upstream.id)) {
        messages.push(`${bundleName}: manifest starter ${upstream.id} is not cached.`);
      }
    }
  }
  return messages;
}

function isFolderPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const path = value.replace(/\/+$/, '');
  return path === '.' || (/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path) && !path.split('/').some(part => part === '.' || part === '..'));
}

/** Hashes every file of a cached template directory, as the lock records them. */
export function templateLockEntry(appDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of listFiles(appDir)) files[path] = sha256(normalize(readFileSync(join(appDir, ...path.split('/')))));
  return files;
}

/** Offline check that every template cache equals its lock entry. Returns one message per difference. */
export function verifyTemplateCache(root: string, config: StarterConfig, lock: StarterLock): string[] {
  const errors: string[] = [];
  for (const [bundleName, bundle] of Object.entries(config.bundles)) {
    for (const [templateName, template] of Object.entries(bundle.templates ?? {})) {
      const key = `${bundleName}/${templateName}`;
      const entry = lock.templates[key];
      if (!entry) {
        errors.push(`${key}: no entry in starter.lock.json. Run the template refresh.`);
        continue;
      }
      const actual = templateLockEntry(join(root, ...template.appDir.split('/')));
      for (const [path, digest] of Object.entries(entry.files)) {
        if (!(path in actual)) errors.push(`${key}: missing cached file ${path}`);
        else if (actual[path] !== digest) errors.push(`${key}: cached file ${path} differs from the lock`);
      }
      for (const path of Object.keys(actual)) {
        if (!(path in entry.files)) errors.push(`${key}: cached file ${path} is not in the lock`);
      }
    }
  }
  return errors;
}

export interface RefreshTemplateOptions {
  readonly root: string;
  readonly config: StarterConfig;
  readonly lockPath: string;
  readonly bundle: string;
  readonly template: string;
  /** Templates manifest; defaults to the public Azure Functions manifest. */
  readonly manifestUrl?: string;
  readonly apiBase?: string;
  readonly codeloadBase?: string;
  readonly token?: string;
}

/**
 * Maintainer command: looks up the template's `manifestId` in the templates
 * manifest, downloads that repository at the manifest's ref, replaces the
 * template cache with the manifest's folder, and records it in starter.lock.json.
 * `.gitignore` is stored as `gitignore.template`; `local.settings.json`,
 * `.git*` metadata, and `.github/` are not cached.
 */
export async function refreshTemplate(options: RefreshTemplateOptions): Promise<TemplateLockEntry> {
  const template = options.config.bundles[options.bundle]?.templates?.[options.template];
  if (!template) throw new Error(`No template ${options.bundle}/${options.template} in starter.config.json.`);
  const key = `${options.bundle}/${options.template}`;
  if (!template.manifestId) throw new Error(`${key} has no manifestId in starter.config.json.`);
  const manifest = await fetchTemplateManifest(options.manifestUrl);
  const upstream = manifest.templates.find(item => item.id === template.manifestId);
  if (!upstream) {
    const reason = manifest.rejected[template.manifestId];
    throw new Error(reason
      ? `Templates manifest entry ${template.manifestId} cannot be used: ${reason}.`
      : `The templates manifest has no ${template.manifestId}.`);
  }
  const { repository, path: folder, ref } = upstream;
  const lock = loadStarterLock(options.lockPath);
  const apiBase = options.apiBase ?? 'https://api.github.com';
  const codeloadBase = options.codeloadBase ?? 'https://codeload.github.com';
  const headers: Record<string, string> = options.token ? { Authorization: `Bearer ${options.token}` } : {};

  const lookup = await fetch(`${apiBase}/repos/${repository}/commits/${ref}`, { headers: { ...headers, Accept: 'application/vnd.github.sha' } });
  if (!lookup.ok) throw new Error(`Cannot resolve ${repository}@${ref} (HTTP ${lookup.status}).`);
  const commit = (await lookup.text()).trim();
  if (!COMMIT.test(commit)) throw new Error(`GitHub returned an invalid commit for ${repository}@${ref}.`);
  const download = await fetch(`${codeloadBase}/${repository}/tar.gz/${commit}`, { headers });
  if (!download.ok) throw new Error(`Cannot download ${repository}@${commit} (HTTP ${download.status}).`);

  const work = mkdtempSync(join(tmpdir(), 'afs-template-'));
  try {
    const archive = join(work, 'template.tar.gz');
    writeFileSync(archive, Buffer.from(await download.arrayBuffer()));
    const extracted = join(work, 'extracted');
    mkdirSync(extracted);
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const result = spawnSync(tar, ['-xzf', archive, '-C', extracted], { encoding: 'utf-8' });
    if (result.status !== 0) throw new Error(`Cannot extract the template archive: ${result.stderr}`);
    const tops = readdirSync(extracted);
    if (tops.length !== 1) throw new Error('The template archive must have one top-level directory.');
    const source = folder === '.' ? join(extracted, tops[0]) : join(extracted, tops[0], ...folder.split('/'));
    if (!existsSync(source) || !lstatSync(source).isDirectory()) throw new Error(`${repository}@${ref} has no folder ${folder}.`);

    const staged = join(work, 'staged');
    mkdirSync(staged);
    for (const path of listAll(source)) {
      const cachePath = cachePathFor(path);
      if (cachePath === null) continue;
      const from = join(source, ...path.split('/'));
      if (lstatSync(from).isSymbolicLink()) throw new Error(`The template contains a link: ${path}`);
      const to = join(staged, ...cachePath.split('/'));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, normalize(readFileSync(from)));
    }
    const appDir = join(options.root, ...template.appDir.split('/'));
    rmSync(appDir, { recursive: true, force: true });
    mkdirSync(dirname(appDir), { recursive: true });
    cpSync(staged, appDir, { recursive: true });

    const entry: TemplateLockEntry = {
      manifestId: upstream.id, repository, path: folder, ref, commit, files: templateLockEntry(appDir),
    };
    const templates = { ...lock.templates, [key]: entry };
    const sorted = Object.fromEntries(Object.keys(templates).sort().map(name => [name, templates[name]]));
    writeFileSync(options.lockPath, `${JSON.stringify({ schemaVersion: 1, templates: sorted }, null, 2)}\n`);
    return entry;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Where an upstream file is cached, or null when it is not cached. */
function cachePathFor(path: string): string | null {
  const parts = path.split('/');
  if (parts[0] === '.github' || parts.some(part => part.startsWith('.git') && part !== '.gitignore')) return null;
  if (parts[parts.length - 1] === '.gitignore') return [...parts.slice(0, -1), 'gitignore.template'].join('/');
  if (parts[parts.length - 1] === 'local.settings.json') return null;
  return path;
}

/** Every file and link under a directory, as POSIX relative paths. */
function listAll(root: string): string[] {
  const paths: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(directory, entry.name), path);
      else paths.push(path);
    }
  };
  walk(root, '');
  return paths.sort();
}
