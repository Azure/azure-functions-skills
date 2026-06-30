import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySetup } from '../src/setup/index.js';
import { applyLocalUpdate } from '../src/setup/local-update.js';
import { resolveTemplateSource } from '../src/setup/template-source.js';
import { loadAgents, loadHooks, loadMcpServers, loadSkills } from '../src/build/loader.js';
import { buildTarget } from '../src/build/build-target.js';
import { createTempDir, removeDir } from './helpers/fs.js';
import type { CliAgentName } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const TEMPLATES_DIR = join(ROOT_DIR, 'templates');
const TEMP_DIRS: string[] = [];
const ALL_AGENTS: readonly CliAgentName[] = ['ghcp', 'claude', 'codex'];

function makeTempDir(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) removeDir(dir);
});

function createRepositoryWorkspaceArtifacts(marker: string): string {
  const repoDir = makeTempDir('af-skills-template-repo-');
  const templatesDir = join(repoDir, 'templates');
  cpSync(TEMPLATES_DIR, templatesDir, { recursive: true });
  const setupSkill = join(templatesDir, 'skills', 'azure-functions-setup', 'SKILL.md');
  writeFileSync(setupSkill, `${readFileSync(setupSkill, 'utf-8')}\n${marker}\n`);
  const workspaceDir = join(repoDir, '.github', 'generated', 'workspace');
  const data = {
    skills: loadSkills(join(templatesDir, 'skills')),
    mcpServers: loadMcpServers(join(templatesDir, 'mcp', 'servers.yaml')),
    agents: loadAgents(join(templatesDir, 'agents')),
    hooks: loadHooks(join(templatesDir, 'hooks')),
  };
  for (const target of ['ghcp', 'claude', 'codex'] as const) buildTarget(target, data, workspaceDir);
  writeFileSync(join(workspaceDir, 'manifest.json'), JSON.stringify({ targets: ['ghcp', 'claude', 'codex'] }));
  return repoDir;
}

describe('template source resolution', () => {
  it.each(ALL_AGENTS)('applySetup can use cloned repository workspace artifacts for %s', async agent => {
    const marker = `CLONED_APPLY_SETUP_MARKER_${agent}`;
    const targetDir = makeTempDir(`af-skills-cloned-template-target-${agent}-`);
    const cwd = process.cwd();
    const emptyDir = makeTempDir(`af-skills-cloned-template-cwd-${agent}-`);
    let result: Awaited<ReturnType<typeof applySetup>>;

    process.chdir(emptyDir);
    try {
      result = await applySetup(targetDir, {
        agents: [agent],
        prerequisites: 'skip',
        templateSource: {
          mode: 'repository',
          repositoryRef: 'feature/test-branch',
          commandRunner: (_command, args) => {
            createRepositoryWorkspaceArtifactsIn(args.at(-1) as string, marker);
          },
        },
      });
    } finally {
      process.chdir(cwd);
    }

    const installedSkill = readFileSync(installedSkillPath(targetDir, agent), 'utf-8');
    expect(installedSkill).toContain(marker);
    expect(result.templateSource.kind).toBe('repository');
    expect(result.warnings).toEqual([]);
    expect(result.welcomeMessage).toContain('azure-functions-setup');
    const workspaceDir = result.templateSource.workspaceDir;
    if (!workspaceDir) throw new Error('Expected cloned repository workspaceDir to be reported.');
    expect(existsSync(workspaceDir)).toBe(false);
  });

  it('applySetup can use repository templates for local installs', async () => {
    const marker = 'REPOSITORY_TEMPLATE_MARKER';
    const repoDir = createRepositoryWorkspaceArtifacts(marker);
    const targetDir = makeTempDir('af-skills-template-target-');

    const result = await applySetup(targetDir, {
      agents: ['ghcp'],
      prerequisites: 'skip',
      templateSource: { mode: 'repository', repositoryPath: repoDir },
    });

    const installedSkill = readFileSync(join(targetDir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8');
    expect(installedSkill).toContain(marker);
    expect(result.templateSource.kind).toBe('repository');
    expect(result.warnings).toEqual([]);
  });

  it('applySetup auto mode falls back to package templates with a warning', async () => {
    const targetDir = makeTempDir('af-skills-template-fallback-');

    const result = await applySetup(targetDir, {
      agents: ['ghcp'],
      prerequisites: 'skip',
      templateSource: { mode: 'auto', repositoryPath: join(targetDir, 'missing-repo') },
    });

    const installedSkill = readFileSync(join(targetDir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8');
    expect(installedSkill).toContain('name: azure-functions-setup');
    expect(result.templateSource.kind).toBe('package');
    expect(result.warnings.some(warning => warning.includes('Falling back'))).toBe(true);
  });

  it('applyLocalUpdate can use repository templates', async () => {
    const marker = 'LOCAL_UPDATE_REPOSITORY_TEMPLATE_MARKER';
    const repoDir = createRepositoryWorkspaceArtifacts(marker);
    const targetDir = makeTempDir('af-skills-local-template-target-');
    mkdirSync(join(targetDir, '.github', 'skills', 'azure-functions-setup'), { recursive: true });
    writeFileSync(join(targetDir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'), 'old setup skill');

    const result = await applyLocalUpdate(targetDir, {
      agents: ['ghcp'],
      templateSource: { mode: 'repository', repositoryPath: repoDir },
    });

    const updatedSkill = readFileSync(join(targetDir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8');
    expect(updatedSkill).toContain(marker);
    expect(result.templateSource.kind).toBe('repository');
    expect(result.warnings).toEqual([]);
  });

  it('repository mode fails when repository templates are unavailable', async () => {
    const targetDir = makeTempDir('af-skills-template-missing-');

    await expect(applySetup(targetDir, {
      agents: ['ghcp'],
      prerequisites: 'skip',
      templateSource: { mode: 'repository', repositoryPath: join(targetDir, 'missing-repo') },
    })).rejects.toThrow(/Repository template source is unavailable/);

    expect(existsSync(join(targetDir, '.github'))).toBe(false);
  });

  it('uses repositoryRef when cloning repository templates', () => {
    const commands: string[][] = [];
    const cwd = process.cwd();
    const emptyDir = makeTempDir('af-skills-empty-cwd-');
    process.chdir(emptyDir);
    try {
      const result = resolveTemplateSource({
        mode: 'repository',
        repositoryRef: 'feature/test-branch',
        commandRunner: (command, args) => {
          commands.push([command, ...args]);
          createRepositoryWorkspaceArtifactsIn(args.at(-1) as string, 'CLONED_REF_MARKER');
        },
      });

      expect(result.kind).toBe('repository');
    } finally {
      process.chdir(cwd);
    }

    expect(commands[0]).toEqual([
      'git',
      'clone',
      '--depth',
      '1',
      '--branch',
      'feature/test-branch',
      'https://github.com/Azure/azure-functions-skills.git',
      expect.any(String),
    ]);
  });
});

function installedSkillPath(targetDir: string, agent: CliAgentName): string {
  if (agent === 'ghcp') return join(targetDir, '.github', 'skills', 'azure-functions-setup', 'SKILL.md');
  if (agent === 'claude') return join(targetDir, '.claude', 'skills', 'azure-functions-setup', 'SKILL.md');
  return join(targetDir, '.agents', 'skills', 'azure-functions-setup', 'SKILL.md');
}

function createRepositoryWorkspaceArtifactsIn(repoDir: string, marker: string): void {
  const templatesDir = join(repoDir, 'templates');
  cpSync(TEMPLATES_DIR, templatesDir, { recursive: true });
  const setupSkill = join(templatesDir, 'skills', 'azure-functions-setup', 'SKILL.md');
  writeFileSync(setupSkill, `${readFileSync(setupSkill, 'utf-8')}\n${marker}\n`);
  const workspaceDir = join(repoDir, '.github', 'generated', 'workspace');
  const data = {
    skills: loadSkills(join(templatesDir, 'skills')),
    mcpServers: loadMcpServers(join(templatesDir, 'mcp', 'servers.yaml')),
    agents: loadAgents(join(templatesDir, 'agents')),
    hooks: loadHooks(join(templatesDir, 'hooks')),
  };
  for (const target of ['ghcp', 'claude', 'codex'] as const) buildTarget(target, data, workspaceDir);
  writeFileSync(join(workspaceDir, 'manifest.json'), JSON.stringify({ targets: ['ghcp', 'claude', 'codex'] }));
}
