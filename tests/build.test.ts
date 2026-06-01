import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkills, loadMcpServers, loadAgents, loadHooks } from '../src/build/loader.js';
import { buildPluginMarketplaces, buildPluginPayload, buildTarget } from '../src/build/build-target.js';
import { detectAgents, applySetup } from '../src/setup/index.js';
import { createTempDir, removeDir, resetDir } from './helpers/fs.js';
import type { AgentDefinitions, BuildTargetName, HookDefinitions, McpServer, Skill } from '../src/types.js';

const TEMPLATES_DIR = join(import.meta.dirname, '..', 'templates');
let DIST_DIR = '';

function resetDistDir() {
  DIST_DIR = resetDir(createTempDir('af-skills-build-'));
}

function expectedSkillIds(): string[] {
  return readdirSync(join(TEMPLATES_DIR, 'skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

afterEach(() => {
  removeDir(DIST_DIR);
  DIST_DIR = '';
});

// ─── Loader tests ───

describe('loadSkills', () => {
  let skills: Skill[];
  beforeAll(() => { skills = loadSkills(join(TEMPLATES_DIR, 'skills')); });

  it('loads all skills', () => {
    expect(skills).toHaveLength(expectedSkillIds().length);
  });

  it('each skill has id, title, description, category, and content', () => {
    for (const s of skills) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.content).toBeTruthy();
    }
  });

  it('skill IDs match directory names', () => {
    const ids = skills.map(s => s.id).sort();
    expect(ids).toEqual(expectedSkillIds());
  });

  it('azure-functions-deploy proxies to the Azure Skills deployment workflow', () => {
    const deploySkill = skills.find(skill => skill.id === 'azure-functions-deploy');
    expect(deploySkill?.content).toContain('azure-prepare');
    expect(deploySkill?.content).toContain('azure-validate');
    expect(deploySkill?.content).toContain('azure-deploy');
    expect(deploySkill?.content).toContain('.azure/deployment-plan.md');
    expect(deploySkill?.content).toContain('Validated');
    expect(deploySkill?.content).toContain('Flex Consumption');
  });

  it('azure-functions-setup documents Azure Skills plugin as a deployment prerequisite', () => {
    const setupSkill = skills.find(skill => skill.id === 'azure-functions-setup');
    expect(setupSkill?.content).toContain('Azure Skills plugin');
    expect(setupSkill?.content).toContain('azure-prepare');
    expect(setupSkill?.content).toContain('azure-validate');
    expect(setupSkill?.content).toContain('azure-deploy');
    expect(setupSkill?.content).toContain('/plugin install azure@azure-skills');
    expect(setupSkill?.content).toContain('/plugin install azure@claude-plugins-official');
    expect(setupSkill?.content).toContain('codex plugin marketplace add microsoft/azure-skills');
  });

  it('azure-functions-setup marks local setup state complete after checks finish', () => {
    const setupSkill = skills.find(skill => skill.id === 'azure-functions-setup');
    expect(setupSkill?.content).toContain('azure-functions-skills state setup-complete --dir');
    expect(setupSkill?.content).toContain('After the environment check completes');
    expect(setupSkill?.content).toContain('If the command is unavailable');
    expect(setupSkill?.content).toContain('.azure-functions-skills/state.local.json');
    expect(setupSkill?.content).toContain('"status": "completed"');
  });
});

describe('loadMcpServers', () => {
  let servers: McpServer[];
  beforeAll(() => { servers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml')); });

  it('loads MCP server definitions', () => {
    expect(servers.length).toBeGreaterThanOrEqual(1);
  });

  it('each server has id, command, args', () => {
    for (const s of servers) {
      expect(s.id).toBeTruthy();
      expect(s.command).toBeTruthy();
      expect(s.args).toBeInstanceOf(Array);
    }
  });
});

describe('loadAgents', () => {
  let agents: AgentDefinitions;
  beforeAll(() => { agents = loadAgents(join(TEMPLATES_DIR, 'agents')); });

  it('loads AGENTS.md', () => {
    expect(agents.agentsMd).toBeTruthy();
    expect(agents.agentsMd).toContain('Development Standards');
  });

  it('loads functions-copilot agent', () => {
    expect(agents.copilot).toBeTruthy();
    expect(agents.copilot).toContain('functions-copilot');
    expect(agents.copilot).toContain('azure-functions-best-practices');
    expect(agents.copilot).toContain('azure-functions-agents');
    expect(agents.copilot).toContain('azure-functions-diagnostics');
    expect(agents.copilot).toContain('proxy to Azure Skills');
  });
});

describe('loadHooks', () => {
  let hooks: HookDefinitions;
  beforeAll(() => { hooks = loadHooks(join(TEMPLATES_DIR, 'hooks')); });

  it('loads welcome-setup hook', () => {
    expect(hooks.welcome).toBeTruthy();
    expect(hooks.welcome).toContain('Welcome');
  });
});

// ─── Build target tests ───

describe('buildTarget — ghcp', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('generates copilot-instructions.md', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const instrPath = join(DIST_DIR, 'ghcp', '.github', 'copilot-instructions.md');
    expect(existsSync(instrPath)).toBe(true);
    const content = readFileSync(instrPath, 'utf-8');
    expect(content).toContain('azure-functions-setup');
    expect(content).toContain('azure-functions-create');
    expect(content).toContain('azure-functions-deploy');
  });

  it('generates mcp.json with servers', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const mcpPath = join(DIST_DIR, 'ghcp', '.vscode', 'mcp.json');
    expect(existsSync(mcpPath)).toBe(true);
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(mcp.servers).toBeTruthy();
    expect(mcp.servers['azure']).toBeTruthy();
  });

  it('generates agent definition', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const agentPath = join(DIST_DIR, 'ghcp', '.github', 'agents', 'functions-copilot.agent.md');
    expect(existsSync(agentPath)).toBe(true);
    expect(existsSync(join(DIST_DIR, 'ghcp', '.github', 'agents', 'functions-guide.agent.md'))).toBe(false);
    const content = readFileSync(agentPath, 'utf-8');
    expect(content).toContain('azure-functions-diagnostics');
  });

  it('generates AGENTS.md', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const agentsMdPath = join(DIST_DIR, 'ghcp', 'AGENTS.md');
    expect(existsSync(agentsMdPath)).toBe(true);
  });

  it('generates skill files in .github/skills/', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    for (const s of skills) {
      const skillPath = join(DIST_DIR, 'ghcp', '.github', 'skills', s.id, 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);
      const content = readFileSync(skillPath, 'utf-8');
      expect(content).toMatch(/^---\n/);
      expect(content).toContain(`name: ${s.id}`);
      expect(content).toContain('description:');
    }
  });

  it('azure-functions-create skill is MCP-primary and ships language-snippets reference', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const skillPath = join(DIST_DIR, 'ghcp', '.github', 'skills', 'azure-functions-create', 'SKILL.md');
    const body = readFileSync(skillPath, 'utf-8');
    // MCP-primary: mentions the Azure MCP tool names
    expect(body).toContain('functions_language_list');
    expect(body).toContain('functions_project_get');
    expect(body).toContain('functions_template_get');
    // Best practices tool reference
    expect(body).toContain('get_azure_bestpractices');
    expect(body).toContain('azurefunctions');
    // Path structure + fallback notice
    expect(body).toMatch(/Path A/);
    expect(body).toMatch(/Path B/);
    expect(body).toContain('fallback');
    // Template count should NOT be hardcoded (no "68+")
    expect(body).not.toMatch(/\d+\+?\s*officially maintained templates/);
    // References file ships alongside the skill
    const refsPath = join(
      DIST_DIR, 'ghcp', '.github', 'skills', 'azure-functions-create',
      'references', 'language-snippets.md',
    );
    expect(existsSync(refsPath)).toBe(true);
  });

  it('ships bundled skill assets when generating skill files', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const assetPath = join(
      DIST_DIR, 'ghcp', '.github', 'skills', 'azure-functions-agents',
      'assets', 'quickstart-sample', 'src', 'function_app.py',
    );
    expect(existsSync(assetPath)).toBe(true);
  });

  it('generates hooks in .github/hooks/', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const hooksPath = join(DIST_DIR, 'ghcp', '.github', 'hooks', 'welcome-setup.json');
    expect(existsSync(hooksPath)).toBe(true);
    const hooksJson = JSON.parse(readFileSync(hooksPath, 'utf-8'));
    expect(hooksJson.hooks).toBeTruthy();
    expect(hooksJson.hooks.SessionStart).toBeTruthy();
  });

  it('does not mix plugin artifacts into the workspace layout', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    expect(existsSync(join(DIST_DIR, 'ghcp', '.github', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'ghcp', 'plugin.json'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'ghcp', 'skills'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'ghcp', 'agents'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'ghcp', '.mcp.json'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'ghcp', 'hooks.json'))).toBe(false);
  });

});

describe('buildTarget — claude', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('generates CLAUDE.md', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('claude', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const claudePath = join(DIST_DIR, 'claude', 'CLAUDE.md');
    expect(existsSync(claudePath)).toBe(true);
    const content = readFileSync(claudePath, 'utf-8');
    expect(content).toContain('azure-functions-setup');
  });

  it('generates .claude/settings.json with mcpServers', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('claude', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const settingsPath = join(DIST_DIR, 'claude', '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(settings.mcpServers).toBeTruthy();
  });

  it('generates skill files in .claude/skills/<id>/SKILL.md', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('claude', { skills, mcpServers, agents, hooks }, DIST_DIR);

    for (const s of skills) {
      const skillPath = join(DIST_DIR, 'claude', '.claude', 'skills', s.id, 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);
    }
  });
});

describe('buildTarget — codex', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('generates AGENTS.md with full instructions', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const agentsPath = join(DIST_DIR, 'codex', 'AGENTS.md');
    expect(existsSync(agentsPath)).toBe(true);
    const content = readFileSync(agentsPath, 'utf-8');
    expect(content).toContain('azure-functions-setup');
    expect(content).toContain('azure-functions-create');
    expect(content).toContain('azure-functions-deploy');
  });

  it('generates skill files in .agents/skills/', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    for (const s of skills) {
      const skillPath = join(DIST_DIR, 'codex', '.agents', 'skills', s.id, 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);
      const content = readFileSync(skillPath, 'utf-8');
      // SKILL.md must have YAML frontmatter with name and description
      expect(content).toMatch(/^---\n/);
      expect(content).toContain(`name: ${s.id}`);
      expect(content).toContain('description:');
    }
  });

  it('generates .codex/config.toml with MCP servers', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const configPath = join(DIST_DIR, 'codex', '.codex', 'config.toml');
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('[mcp_servers.azure]');
    expect(content).toContain('command = "npx"');
  });

  it('generates .codex/hooks.json with SessionStart hook', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const hooksPath = join(DIST_DIR, 'codex', '.codex', 'hooks.json');
    expect(existsSync(hooksPath)).toBe(true);
    const hooksJson = JSON.parse(readFileSync(hooksPath, 'utf-8'));
    expect(hooksJson.hooks).toBeTruthy();
    expect(hooksJson.hooks.SessionStart).toBeTruthy();
    expect(hooksJson.hooks.SessionStart).toHaveLength(1);
  });
});

// ─── Skill instruction embedding ───

describe('skill instruction embedding', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('GHCP instructions include skill-authored next step guidance', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const instrPath = join(DIST_DIR, 'ghcp', '.github', 'copilot-instructions.md');
    const content = readFileSync(instrPath, 'utf-8');
    expect(content).toContain('## Next steps');
    expect(content).toContain('suggest `azure-functions-create`');
    expect(content).toContain('suggest `azure-functions-deploy`');
  });
});

// ─── Plugin manifest tests ───

describe('Codex plugin manifest', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('does not mix plugin artifacts into the workspace layout', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    expect(existsSync(join(DIST_DIR, 'codex', '.agents', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'codex', 'skills'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'codex', '.codex-plugin'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'codex', '.mcp.json'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'codex', '.agents', 'plugins'))).toBe(false);
  });
});

describe('buildPluginPayload', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('generates a skills-only plugin payload by default without workspace layout files', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    const payloadDir = join(DIST_DIR, 'plugin', 'azure-functions-skills');

    buildPluginPayload({ skills, mcpServers, agents, hooks, packageVersion: '9.8.7' }, payloadDir);

    expect(existsSync(join(payloadDir, '.plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(payloadDir, 'plugin.json'))).toBe(true);
    expect(existsSync(join(payloadDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(payloadDir, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(payloadDir, '.mcp.json'))).toBe(false);
    expect(existsSync(join(payloadDir, 'hooks.json'))).toBe(false);
    expect(existsSync(join(payloadDir, 'agents'))).toBe(false);
    expect(existsSync(join(payloadDir, '.github'))).toBe(false);
    expect(existsSync(join(payloadDir, '.agents'))).toBe(false);
    expect(existsSync(join(payloadDir, '.codex'))).toBe(false);

    const manifest = JSON.parse(readFileSync(join(payloadDir, '.plugin', 'plugin.json'), 'utf-8'));
    expect(manifest.name).toBe('azure-functions-skills');
    expect(manifest.version).toBe('9.8.7');
    expect(manifest.skills).toBe('./skills/');
    expect(manifest).not.toHaveProperty('agents');
    expect(manifest).not.toHaveProperty('hooks');
    expect(manifest).not.toHaveProperty('mcpServers');

    for (const s of skills) {
      expect(existsSync(join(payloadDir, 'skills', s.id, 'SKILL.md'))).toBe(true);
    }
  });

  it('emits skills-only host plugin manifests by default', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    const payloadDir = join(DIST_DIR, 'plugin', 'azure-functions-skills');

    buildPluginPayload({ skills, mcpServers, agents, hooks, packageVersion: '9.8.7' }, payloadDir);

    const defaultManifest = JSON.parse(readFileSync(join(payloadDir, 'plugin.json'), 'utf-8'));
    const claudeManifest = JSON.parse(readFileSync(join(payloadDir, '.claude-plugin', 'plugin.json'), 'utf-8'));
    const codexManifest = JSON.parse(readFileSync(join(payloadDir, '.codex-plugin', 'plugin.json'), 'utf-8'));

    expect(defaultManifest.interface).toBeTruthy();
    expect(defaultManifest).not.toHaveProperty('agents');
    expect(defaultManifest).not.toHaveProperty('hooks');
    expect(defaultManifest).not.toHaveProperty('mcpServers');
    expect(claudeManifest).toMatchObject({
      name: 'azure-functions-skills',
      version: '9.8.7',
      description: 'Azure Functions skills for setup, create, and deploy workflows',
      skills: './skills/',
    });
    expect(claudeManifest).not.toHaveProperty('agents');
    expect(claudeManifest).not.toHaveProperty('hooks');
    expect(claudeManifest).not.toHaveProperty('mcpServers');
    expect(claudeManifest).not.toHaveProperty('interface');
    expect(codexManifest).not.toHaveProperty('agents');
    expect(codexManifest).not.toHaveProperty('hooks');
    expect(codexManifest).not.toHaveProperty('mcpServers');
  });

  it('generates a full plugin payload when explicitly requested', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    const payloadDir = join(DIST_DIR, 'plugin', 'azure-functions-skills');

    buildPluginPayload({ skills, mcpServers, agents, hooks, packageVersion: '9.8.7' }, payloadDir, { profile: 'full' });

    expect(existsSync(join(payloadDir, '.mcp.json'))).toBe(true);
    expect(existsSync(join(payloadDir, 'hooks.json'))).toBe(true);
    expect(existsSync(join(payloadDir, 'agents', 'functions-copilot.agent.md'))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(payloadDir, '.plugin', 'plugin.json'), 'utf-8'));
    expect(manifest.skills).toBe('./skills/');
    expect(manifest.agents).toBe('./agents/');
    expect(manifest.hooks).toBe('./hooks.json');
    expect(manifest.mcpServers).toBe('./.mcp.json');

    const claudeManifest = JSON.parse(readFileSync(join(payloadDir, '.claude-plugin', 'plugin.json'), 'utf-8'));
    expect(claudeManifest.skills).toBe('./skills/');
    expect(claudeManifest.hooks).toBe('./hooks.json');
    expect(claudeManifest.mcpServers).toBe('./.mcp.json');
  });
});

describe('buildPluginMarketplaces', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('generates Copilot and Claude marketplace manifests pointing at the committed plugin payload', () => {
    buildPluginMarketplaces(DIST_DIR, {
      packageVersion: '9.8.7',
      pluginSource: './.github/plugins/azure-functions-skills',
    });

    const copilotMarketplace = JSON.parse(readFileSync(join(DIST_DIR, '.plugin', 'marketplace.json'), 'utf-8'));
    expect(copilotMarketplace.name).toBe('azure-functions-skills');
    expect(copilotMarketplace.plugins[0].name).toBe('azure-functions-skills');
    expect(copilotMarketplace.plugins[0].version).toBe('9.8.7');
    expect(copilotMarketplace.plugins[0].source).toBe('./.github/plugins/azure-functions-skills');

    const claudeMarketplace = JSON.parse(readFileSync(join(DIST_DIR, '.claude-plugin', 'marketplace.json'), 'utf-8'));
    expect(claudeMarketplace.name).toBe('azure-functions-skills');
    expect(claudeMarketplace.plugins[0].source).toBe('./.github/plugins/azure-functions-skills');
  });
});

describe('npm package manifest', () => {
  it('does not publish generated dist artifacts', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8'));

    expect(pkg.files).toContain('templates/');
    expect(pkg.files).not.toContain('dist/');
  });
});

// ─── Setup CLI tests ───

describe('setup module', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('detectAgents returns an array of detected agent names', async () => {
    const agents = await detectAgents();
    expect(agents).toBeInstanceOf(Array);
    // At minimum, should return something (we're in a dev env)
  });

  it('applySetup copies files to target directory', async () => {
    await applySetup(DIST_DIR, { agents: ['ghcp'], prerequisites: 'skip' });

    // Should have copilot-instructions.md
    expect(existsSync(join(DIST_DIR, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.vscode', 'mcp.json'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'AGENTS.md'))).toBe(true);
  });

  it('applySetup omits duplicate GHCP plugin directories from workspace root', async () => {
    await applySetup(DIST_DIR, { agents: ['ghcp'], prerequisites: 'skip' });

    expect(existsSync(join(DIST_DIR, '.github', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.github', 'agents', 'functions-copilot.agent.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.github', 'agents', 'functions-guide.agent.md'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'skills'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'agents'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'plugin.json'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'hooks.json'))).toBe(false);
    expect(existsSync(join(DIST_DIR, '.mcp.json'))).toBe(false);
  });

  it('applySetup handles codex target', async () => {
    await applySetup(DIST_DIR, { agents: ['codex'], prerequisites: 'skip' });

    expect(existsSync(join(DIST_DIR, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.agents', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.codex', 'config.toml'))).toBe(true);
  });

  it('applySetup omits duplicate Codex plugin skills from workspace root', async () => {
    await applySetup(DIST_DIR, { agents: ['codex'], prerequisites: 'skip' });

    expect(existsSync(join(DIST_DIR, '.agents', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'skills'))).toBe(false);
    expect(existsSync(join(DIST_DIR, '.codex-plugin'))).toBe(false);
    expect(existsSync(join(DIST_DIR, '.mcp.json'))).toBe(false);
    expect(existsSync(join(DIST_DIR, '.agents', 'plugins'))).toBe(false);
  });

  it('applySetup handles claude target', async () => {
    await applySetup(DIST_DIR, { agents: ['claude'], prerequisites: 'skip' });

    expect(existsSync(join(DIST_DIR, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.claude', 'settings.json'))).toBe(true);
  });

  it('applySetup omits Claude plugin payload files from workspace setup', async () => {
    await applySetup(DIST_DIR, { agents: ['claude'], prerequisites: 'skip' });

    expect(existsSync(join(DIST_DIR, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.claude', 'skills', 'azure-functions-setup', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.claude-plugin'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'plugin.json'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'agents'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'hooks.json'))).toBe(false);
    expect(existsSync(join(DIST_DIR, '.mcp.json'))).toBe(false);
  });

  it('applySetup handles multiple agents at once', async () => {
    await applySetup(DIST_DIR, { agents: ['ghcp', 'claude', 'codex'], prerequisites: 'skip' });

    expect(existsSync(join(DIST_DIR, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.codex', 'config.toml'))).toBe(true);
  });

  it('applySetup returns a summary with welcome message', async () => {
    const result = await applySetup(DIST_DIR, { agents: ['ghcp'], prerequisites: 'skip' });

    expect(result.agents).toContain('ghcp');
    expect(result.filesWritten).toBeGreaterThan(0);
    expect(result.welcomeMessage).toContain('Azure Functions');
  });

  it('applySetup reports Azure Skills prerequisite installation results', async () => {
    const calls: string[] = [];
    const result = await applySetup(DIST_DIR, {
      agents: ['ghcp'],
      prerequisiteRunner: async (command, args) => {
        calls.push([command, ...args].join(' '));
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(calls).toEqual([
      'copilot plugin list',
      'copilot plugin marketplace add microsoft/azure-skills',
      'copilot plugin install azure@azure-skills',
    ]);
    expect(result.prerequisites?.[0].status).toBe('installed');
    expect(result.welcomeMessage).toContain('External prerequisites');
  });
});

describe('skill references/ subdirectory', () => {
  let FIXTURE_DIR = '';
  let REF_DIST_DIR = '';

  beforeEach(() => {
    FIXTURE_DIR = createTempDir('af-skills-refs-fixture-');
    REF_DIST_DIR = createTempDir('af-skills-refs-dist-');
    // Build a minimal skill fixture: skills/demo-skill/{SKILL.md, references/*}
    const skillDir = join(FIXTURE_DIR, 'skills', 'demo-skill');
    mkdirSync(join(skillDir, 'references', 'nested'), { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: demo-skill\ntitle: Demo\ndescription: Demo skill with references\ncategory: test\n---\n\n# Demo\nSee [more](references/extra.md).\n',
    );
    writeFileSync(join(skillDir, 'references', 'extra.md'), '# Extra reference\n');
    writeFileSync(join(skillDir, 'references', 'nested', 'deep.md'), '# Nested ref\n');
  });

  afterEach(() => {
    removeDir(FIXTURE_DIR);
    removeDir(REF_DIST_DIR);
    FIXTURE_DIR = '';
    REF_DIST_DIR = '';
  });

  it('loadSkills returns referencesDir when references/ exists', () => {
    const skills = loadSkills(join(FIXTURE_DIR, 'skills'));
    expect(skills).toHaveLength(1);
    expect(skills[0].referencesDir).toBeTruthy();
    expect(skills[0].referencesDir?.endsWith('references')).toBe(true);
  });

  it('loadSkills returns referencesDir=null when references/ is missing', () => {
    // Remove references to test the negative case
    removeDir(join(FIXTURE_DIR, 'skills', 'demo-skill', 'references'));
    const skills = loadSkills(join(FIXTURE_DIR, 'skills'));
    expect(skills[0].referencesDir).toBeNull();
  });

  // Minimal agents/hooks/mcp stubs for cross-target builds
  function buildFixture(target: BuildTargetName) {
    const skills = loadSkills(join(FIXTURE_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget(target, { skills, mcpServers, agents, hooks }, REF_DIST_DIR);
  }

  it('ghcp build copies references/ under .github/skills/<id>/', () => {
    buildFixture('ghcp');
    expect(existsSync(join(REF_DIST_DIR, 'ghcp', '.github', 'skills', 'demo-skill', 'references', 'extra.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'ghcp', '.github', 'skills', 'demo-skill', 'references', 'nested', 'deep.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'ghcp', 'skills'))).toBe(false);
  });

  it('claude build emits .claude/skills/<id>/SKILL.md and copies references/', () => {
    buildFixture('claude');
    expect(existsSync(join(REF_DIST_DIR, 'claude', '.claude', 'skills', 'demo-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'claude', '.claude', 'skills', 'demo-skill', 'references', 'extra.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'claude', '.claude', 'skills', 'demo-skill', 'references', 'nested', 'deep.md'))).toBe(true);
  });

  it('codex build copies references/ under .agents/skills/<id>/', () => {
    buildFixture('codex');
    expect(existsSync(join(REF_DIST_DIR, 'codex', '.agents', 'skills', 'demo-skill', 'references', 'extra.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'codex', 'skills'))).toBe(false);
  });
});
