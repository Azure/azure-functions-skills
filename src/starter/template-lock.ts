import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listFiles, normalize, sha256 } from './build.js';
import type { StarterConfig } from './config.js';

/** One cached app template: where it came from and the hash of every cached file. */
export interface TemplateLockEntry {
  readonly repository: string;
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
    templates[key] = { repository: entry.repository, ref: entry.ref, commit: entry.commit, files: { ...entry.files } };
  }
  return { schemaVersion: 1, templates };
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
  /** Upstream repository; defaults to the one in the current lock entry. */
  readonly repository?: string;
  readonly ref: string;
  readonly apiBase?: string;
  readonly codeloadBase?: string;
  readonly token?: string;
}

/**
 * Maintainer command: downloads one upstream commit of a template repository,
 * replaces the template cache with it, and records it in starter.lock.json.
 * `.gitignore` is stored as `gitignore.template`; `local.settings.json`,
 * `.git*` metadata, and `.github/` are not cached.
 */
export async function refreshTemplate(options: RefreshTemplateOptions): Promise<TemplateLockEntry> {
  const template = options.config.bundles[options.bundle]?.templates?.[options.template];
  if (!template) throw new Error(`No template ${options.bundle}/${options.template} in starter.config.json.`);
  const key = `${options.bundle}/${options.template}`;
  const lock = loadStarterLock(options.lockPath);
  const repository = options.repository ?? lock.templates[key]?.repository;
  if (!repository || !REPOSITORY.test(repository)) throw new Error(`Pass the upstream repository for ${key}.`);
  if (!REF.test(options.ref)) throw new Error(`Invalid ref: ${options.ref}`);
  const apiBase = options.apiBase ?? 'https://api.github.com';
  const codeloadBase = options.codeloadBase ?? 'https://codeload.github.com';
  const headers: Record<string, string> = options.token ? { Authorization: `Bearer ${options.token}` } : {};

  const lookup = await fetch(`${apiBase}/repos/${repository}/commits/${options.ref}`, { headers: { ...headers, Accept: 'application/vnd.github.sha' } });
  if (!lookup.ok) throw new Error(`Cannot resolve ${repository}@${options.ref} (HTTP ${lookup.status}).`);
  const commit = (await lookup.text()).trim();
  if (!COMMIT.test(commit)) throw new Error(`GitHub returned an invalid commit for ${repository}@${options.ref}.`);
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
    const source = join(extracted, tops[0]);

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

    const entry: TemplateLockEntry = { repository, ref: options.ref, commit, files: templateLockEntry(appDir) };
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
