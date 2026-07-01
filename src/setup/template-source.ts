import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TemplateSourceOptions, TemplateSourceResult } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');
const PACKAGE_WORKSPACE_DIR = join(__dirname, '..', '..', '.github', 'generated', 'workspace');
const DEFAULT_REPOSITORY_URL = 'https://github.com/Azure/azure-functions-skills.git';

export function resolveTemplateSource(options: TemplateSourceOptions = {}): TemplateSourceResult {
  const mode = options.mode || 'auto';
  const repositoryRoot = options.repositoryPath || process.cwd();
  const repositoryWorkspaceDir = join(repositoryRoot, '.github', 'generated', 'workspace');
  const repositoryTemplatesDir = join(repositoryRoot, 'templates');

  if (mode === 'package') {
    return packageTemplateSource([]);
  }

  if (isValidWorkspaceDir(repositoryWorkspaceDir)) {
    return {
      kind: 'repository',
      workspaceDir: repositoryWorkspaceDir,
      warnings: [],
    };
  }

  if (!options.repositoryPath) {
    const cloned = tryCloneRepositoryTemplates(options);
    if (cloned) return cloned;
  }

  if (mode === 'repository') {
    throw new Error(`Repository template source is unavailable: ${repositoryTemplatesDir}`);
  }

  return packageTemplateSource([
    `Falling back to bundled package templates because repository templates were unavailable: ${repositoryTemplatesDir}`,
  ]);
}

export function cleanupTemplateSource(source: TemplateSourceResult): void {
  if (!source.cleanupDir) return;
  rmSync(source.cleanupDir, { recursive: true, force: true });
}

export function loadBuildDataFromTemplates(templatesDir: string) {
  return {
    skillsDir: join(templatesDir, 'skills'),
    mcpServersPath: join(templatesDir, 'mcp', 'servers.yaml'),
    agentsDir: join(templatesDir, 'agents'),
    hooksDir: join(templatesDir, 'hooks'),
  };
}

export function isValidWorkspaceDir(workspaceDir: string): boolean {
  return existsSync(join(workspaceDir, 'manifest.json'))
    && existsSync(join(workspaceDir, 'ghcp'))
    && existsSync(join(workspaceDir, 'claude'))
    && existsSync(join(workspaceDir, 'codex'));
}

function packageTemplateSource(warnings: string[]): TemplateSourceResult {
  if (isValidWorkspaceDir(PACKAGE_WORKSPACE_DIR)) {
    return {
      kind: 'package',
      workspaceDir: PACKAGE_WORKSPACE_DIR,
      warnings,
    };
  }
  return {
    kind: 'package',
    templatesDir: PACKAGE_TEMPLATES_DIR,
    warnings,
  };
}

function tryCloneRepositoryTemplates(options: TemplateSourceOptions): TemplateSourceResult | null {
  const cloneDir = mkdtempSync(join(tmpdir(), 'af-skills-template-source-'));
  try {
    const cloneArgs = ['clone', '--depth', '1'];
    if (options.repositoryRef) cloneArgs.push('--branch', options.repositoryRef);
    cloneArgs.push(DEFAULT_REPOSITORY_URL, cloneDir);
    if (options.commandRunner) options.commandRunner('git', cloneArgs);
    else execFileSync('git', cloneArgs, { stdio: 'ignore' });
    const workspaceDir = join(cloneDir, '.github', 'generated', 'workspace');
    if (!isValidWorkspaceDir(workspaceDir)) {
      cleanupTemplateSource({ kind: 'repository', workspaceDir, warnings: [], cleanupDir: cloneDir });
      return null;
    }
    return {
      kind: 'repository',
      workspaceDir,
      warnings: [],
      cleanupDir: cloneDir,
    };
  } catch {
    cleanupTemplateSource({ kind: 'repository', templatesDir: cloneDir, warnings: [], cleanupDir: cloneDir });
    return null;
  }
}
