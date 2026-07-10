import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TEMPLATE_MANIFEST_URL = 'https://cdn.functions.azure.com/public/templates-manifest/manifest.json';

export type TemplateApplyMode = 'auto' | 'new' | 'add';

export interface TemplateListOptions {
  readonly manifestUrl?: string;
  readonly language?: string;
  readonly resource?: string;
  readonly iac?: string;
}

export interface TemplateApplyOptions {
  readonly manifestUrl?: string;
  readonly language: string;
  readonly template: string;
  readonly runtimeVersion?: string;
  readonly mode?: TemplateApplyMode;
  readonly dryRun?: boolean;
  readonly force?: boolean;
}

export interface TemplateManifest {
  readonly version?: string;
  readonly runtimeVersions?: Record<string, TemplateRuntimeVersions>;
  readonly languages?: readonly string[];
  readonly templates: readonly FunctionTemplate[];
}

export interface TemplateRuntimeVersions {
  readonly supported?: readonly string[];
  readonly preview?: readonly string[];
  readonly frameworkSupported?: readonly string[];
  readonly default?: string;
}

export interface FunctionTemplate {
  readonly id: string;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly longDescription?: string;
  readonly language: string;
  readonly bindingType?: string;
  readonly resource?: string;
  readonly iac?: string;
  readonly priority?: number;
  readonly categories?: readonly string[];
  readonly tags?: readonly string[];
  readonly author?: string;
  readonly repositoryUrl: string;
  readonly folderPath: string;
  readonly gitRef?: string;
  readonly whatsIncluded?: readonly string[];
}

export interface TemplateListResult {
  readonly manifestUrl: string;
  readonly templates: readonly FunctionTemplate[];
}

export interface TemplateApplyResult {
  readonly template: FunctionTemplate;
  readonly mode: Exclude<TemplateApplyMode, 'auto'>;
  readonly dryRun: boolean;
  readonly filesWritten: readonly string[];
  readonly skippedFiles: readonly string[];
  readonly plannedFiles: readonly string[];
}

interface TemplateFile {
  readonly relativePath: string;
  readonly content: Buffer;
}

interface GitHubRepo {
  readonly owner: string;
  readonly repo: string;
}

interface GitHubContentEntry {
  readonly type: 'file' | 'dir';
  readonly path: string;
  readonly download_url: string | null;
}

const ADD_MODE_PROJECT_PATHS = new Set([
  '.gitignore',
  'azure.yaml',
  'host.json',
  'local.settings.json',
  'package-lock.json',
  'package.json',
  'pom.xml',
  'requirements.txt',
  'tsconfig.json',
]);

const ADD_MODE_PROJECT_PREFIXES = [
  '.devcontainer/',
  '.github/',
  '.vscode/',
  'infra/',
];

export async function listFunctionTemplates(options: TemplateListOptions = {}): Promise<TemplateListResult> {
  const manifestUrl = options.manifestUrl ?? DEFAULT_TEMPLATE_MANIFEST_URL;
  const manifest = await loadTemplateManifest(manifestUrl);
  const templates = manifest.templates
    .filter(template => matchesFilter(template.language, options.language))
    .filter(template => matchesFilter(template.resource, options.resource))
    .filter(template => matchesFilter(template.iac, options.iac))
    .slice()
    .sort(compareTemplates);

  return { manifestUrl, templates };
}

export async function applyFunctionTemplate(targetDir: string, options: TemplateApplyOptions): Promise<TemplateApplyResult> {
  const manifestUrl = options.manifestUrl ?? DEFAULT_TEMPLATE_MANIFEST_URL;
  const manifest = await loadTemplateManifest(manifestUrl);
  const template = findTemplate(manifest, options.language, options.template);
  const mode = resolveApplyMode(targetDir, options.mode ?? 'auto');
  const downloadedFiles = await downloadTemplateFiles(template, manifestUrl);
  const templateFiles = downloadedFiles.map(file => ({
    relativePath: normalizeTemplatePath(file.relativePath),
    content: applyRuntimePlaceholders(file.content, options.runtimeVersion),
  }));
  if (mode === 'add') assertAddModeSafe(template, templateFiles);
  const plannedFiles = templateFiles.map(file => file.relativePath).sort();
  const filesWritten: string[] = [];
  const skippedFiles: string[] = [];

  for (const file of templateFiles) {
    if (shouldSkipFile(file.relativePath, mode, options.force === true)) {
      skippedFiles.push(file.relativePath);
      continue;
    }

    const destination = join(targetDir, file.relativePath);
    if (existsSync(destination) && options.force !== true) {
      skippedFiles.push(file.relativePath);
      continue;
    }

    if (!options.dryRun) {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
    }
    filesWritten.push(file.relativePath);
  }

  return {
    template,
    mode,
    dryRun: options.dryRun === true,
    filesWritten: filesWritten.sort(),
    skippedFiles: skippedFiles.sort(),
    plannedFiles,
  };
}

async function loadTemplateManifest(manifestUrl: string): Promise<TemplateManifest> {
  const parsed = new URL(manifestUrl);
  const raw = parsed.protocol === 'file:'
    ? readFileSync(fileURLToPath(parsed), 'utf-8')
    : await fetchText(manifestUrl);
  const parsedJson: unknown = JSON.parse(raw);
  if (!isTemplateManifest(parsedJson)) {
    throw new Error(`Template manifest at ${manifestUrl} does not match the expected schema.`);
  }
  return parsedJson;
}

async function downloadTemplateFiles(template: FunctionTemplate, manifestUrl: string): Promise<readonly TemplateFile[]> {
  const repositoryUrl = new URL(template.repositoryUrl);
  if (repositoryUrl.protocol === 'file:') {
    if (new URL(manifestUrl).protocol !== 'file:') {
      throw new Error('Local file template repositories are only supported with local file manifests.');
    }
    return readLocalTemplateFiles(fileURLToPath(repositoryUrl), template.folderPath);
  }

  const repo = parseGitHubRepo(repositoryUrl);
  if (!repo) {
    throw new Error(`Unsupported template repository URL: ${template.repositoryUrl}`);
  }

  return downloadGitHubTemplateFiles(repo, template.folderPath, normalizeGitHubRef(template.gitRef ?? 'main'));
}

function readLocalTemplateFiles(sourceDir: string, folderPath: string): readonly TemplateFile[] {
  assertSafeFolderPath(folderPath);
  const sourceRoot = resolve(sourceDir);
  const rootDir = folderPath === '.' ? sourceRoot : resolve(sourceRoot, folderPath);
  assertPathInside(sourceRoot, rootDir, 'Template folder');
  if (!existsSync(rootDir)) {
    throw new Error(`Template folder does not exist: ${rootDir}`);
  }
  const files: TemplateFile[] = [];
  collectLocalFiles(rootDir, rootDir, files);
  return files;
}

function collectLocalFiles(rootDir: string, currentDir: string, files: TemplateFile[]): void {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectLocalFiles(rootDir, entryPath, files);
    } else if (entry.isFile()) {
      files.push({
        relativePath: relative(rootDir, entryPath),
        content: readFileSync(entryPath),
      });
    }
  }
}

async function downloadGitHubTemplateFiles(repo: GitHubRepo, folderPath: string, ref: string): Promise<readonly TemplateFile[]> {
  assertSafeFolderPath(folderPath);
  const rootPath = folderPath === '.' ? '' : folderPath.replace(/^\/+|\/+$/g, '');
  const entries = await listGitHubContents(repo, rootPath, ref);
  const files: TemplateFile[] = [];

  for (const entry of entries) {
    if (!entry.download_url) {
      throw new Error(`GitHub file entry is missing download URL: ${entry.path}`);
    }
    const content = await fetchBuffer(entry.download_url);
    files.push({
      relativePath: rootPath ? entry.path.slice(rootPath.length + 1) : entry.path,
      content,
    });
  }

  return files;
}

async function listGitHubContents(repo: GitHubRepo, path: string, ref: string): Promise<readonly GitHubContentEntry[]> {
  const encodedPath = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const url = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodedPath}`);
  url.searchParams.set('ref', ref);
  const entries = await fetchJson(url.toString());
  if (!Array.isArray(entries)) {
    throw new Error(`GitHub contents path is not a directory: ${path || '.'}`);
  }

  const files: GitHubContentEntry[] = [];
  for (const entry of entries) {
    if (!isGitHubContentEntry(entry)) continue;
    if (entry.type === 'file') {
      files.push(entry);
    } else {
      files.push(...await listGitHubContents(repo, entry.path, ref));
    }
  }
  return files;
}

function parseGitHubRepo(url: URL): GitHubRepo | null {
  if (url.hostname.toLowerCase() !== 'github.com') return null;
  const [owner, repoName] = url.pathname.replace(/^\/+/, '').split('/');
  if (!owner || !repoName) return null;
  return { owner, repo: repoName.replace(/\.git$/i, '') };
}

function normalizeGitHubRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '');
}

function assertSafeFolderPath(folderPath: string): void {
  if (isAbsolute(folderPath) || folderPath.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe template folder path: ${folderPath}`);
  }
}

function assertPathInside(root: string, candidate: string, label: string): void {
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the template repository.`);
  }
}

function assertAddModeSafe(template: FunctionTemplate, files: readonly TemplateFile[]): void {
  const nestedProjectFile = files.find(file => {
    const normalized = normalizeTemplatePath(file.relativePath);
    return normalized.includes('/') && ADD_MODE_PROJECT_PATHS.has(normalized.split('/').at(-1) ?? '');
  });
  if (nestedProjectFile) {
    throw new Error(
      `Template '${template.id}' appears to contain a nested full project (${nestedProjectFile.relativePath}). ` +
      'Apply it with --mode new, or choose an add-specific template.',
    );
  }
}

function findTemplate(manifest: TemplateManifest, language: string, templateId: string): FunctionTemplate {
  const template = manifest.templates.find(candidate =>
    equalsIgnoreCase(candidate.id, templateId) && equalsIgnoreCase(candidate.language, language));
  if (!template) {
    throw new Error(`Template '${templateId}' for language '${language}' was not found in the manifest.`);
  }
  return template;
}

function resolveApplyMode(targetDir: string, mode: TemplateApplyMode): Exclude<TemplateApplyMode, 'auto'> {
  if (mode === 'new' || mode === 'add') return mode;
  return existsSync(join(targetDir, 'host.json')) ? 'add' : 'new';
}

function shouldSkipFile(relativePath: string, mode: Exclude<TemplateApplyMode, 'auto'>, force: boolean): boolean {
  if (mode === 'new') return false;
  const normalized = normalizeTemplatePath(relativePath);
  if (ADD_MODE_PROJECT_PATHS.has(normalized)) return true;
  if (!force && normalized === 'local.settings.json') return true;
  return ADD_MODE_PROJECT_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function normalizeTemplatePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').includes('..') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Unsafe template file path: ${path}`);
  }
  return normalized;
}

function applyRuntimePlaceholders(content: Buffer, runtimeVersion: string | undefined): Buffer {
  if (!runtimeVersion || !isTextContent(content)) return content;
  const replaced = content.toString('utf-8')
    .replaceAll('{{nodeVersion}}', runtimeVersion)
    .replaceAll('{{javaVersion}}', runtimeVersion)
    .replaceAll('{{pythonVersion}}', runtimeVersion)
    .replaceAll('{{runtimeVersion}}', runtimeVersion);
  return Buffer.from(replaced, 'utf-8');
}

function isTextContent(content: Buffer): boolean {
  return !content.includes(0);
}

function matchesFilter(actual: string | undefined, expected: string | undefined): boolean {
  return !expected || equalsIgnoreCase(actual, expected);
}

function equalsIgnoreCase(actual: string | undefined, expected: string | undefined): boolean {
  return Boolean(actual && expected && actual.toLowerCase() === expected.toLowerCase());
}

function compareTemplates(left: FunctionTemplate, right: FunctionTemplate): number {
  const priority = (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER);
  if (priority !== 0) return priority;
  return left.id.localeCompare(right.id);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url: string): Promise<unknown> {
  const text = await fetchText(url);
  return JSON.parse(text) as unknown;
}

function isTemplateManifest(value: unknown): value is TemplateManifest {
  return isRecord(value)
    && Array.isArray(value.templates)
    && value.templates.every(isFunctionTemplate);
}

function isFunctionTemplate(value: unknown): value is FunctionTemplate {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.displayName === 'string'
    && typeof value.shortDescription === 'string'
    && typeof value.language === 'string'
    && typeof value.repositoryUrl === 'string'
    && typeof value.folderPath === 'string';
}

function isGitHubContentEntry(value: unknown): value is GitHubContentEntry {
  return isRecord(value)
    && (value.type === 'file' || value.type === 'dir')
    && typeof value.path === 'string'
    && (typeof value.download_url === 'string' || value.download_url === null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
