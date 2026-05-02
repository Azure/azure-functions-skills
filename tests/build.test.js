import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkills, loadMcpServers, loadAgents, loadHooks } from '../src/build/loader.js';
import { buildTarget } from '../src/build/build-target.js';

const TEMPLATES_DIR = join(import.meta.dirname, '..', 'templates');
const DIST_DIR = join(import.meta.dirname, '..', 'dist-test');

// ─── Loader tests ───

describe('loadSkills', () => {
  let skills;
  beforeAll(() => { skills = loadSkills(join(TEMPLATES_DIR, 'skills')); });

  it('loads all skills', () => {
    expect(skills).toHaveLength(7);
  });

  it('each skill has id, title, content, graph', () => {
    for (const s of skills) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.content).toBeTruthy();
      expect(s.graph).toBeTruthy();
      expect(s.graph.suggestions).toBeTruthy();
    }
  });

  it('skill IDs match directory names', () => {
    const ids = skills.map(s => s.id).sort();
    expect(ids).toEqual([
      'azure-functions-common',
      'azure-functions-create',
      'azure-functions-deploy',
      'azure-functions-diagnostics',
      'azure-functions-health-status',
      'azure-functions-inventory',
      'azure-functions-setup',
    ]);
  });
});

describe('loadMcpServers', () => {
  let servers;
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
  let agents;
  beforeAll(() => { agents = loadAgents(join(TEMPLATES_DIR, 'agents')); });

  it('loads AGENTS.md', () => {
    expect(agents.agentsMd).toBeTruthy();
    expect(agents.agentsMd).toContain('Development Standards');
  });

  it('loads functions-guide agent', () => {
    expect(agents.guide).toBeTruthy();
    expect(agents.guide).toContain('functions-guide');
  });
});

describe('loadHooks', () => {
  let hooks;
  beforeAll(() => { hooks = loadHooks(join(TEMPLATES_DIR, 'hooks')); });

  it('loads welcome-setup hook', () => {
    expect(hooks.welcome).toBeTruthy();
    expect(hooks.welcome).toContain('Welcome');
  });
});

// ─── Build target tests ───

describe('buildTarget — ghcp', () => {
  beforeEach(() => {
    if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true });
    mkdirSync(DIST_DIR, { recursive: true });
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

    const agentPath = join(DIST_DIR, 'ghcp', '.github', 'agents', 'functions-guide.agent.md');
    expect(existsSync(agentPath)).toBe(true);
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
    expect(body).toContain('functions language list');
    expect(body).toContain('functions project get');
    expect(body).toContain('functions list or get template');
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

  it('generates plugin.json manifest', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const manifestPath = join(DIST_DIR, 'ghcp', 'plugin.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.name).toBe('azure-functions-skills');
    expect(manifest.version).toBeTruthy();
    expect(manifest.description).toBeTruthy();
  });

  it('generates plugin skills/ directory', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    for (const s of skills) {
      const skillPath = join(DIST_DIR, 'ghcp', 'skills', s.id, 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);
    }
  });

  it('generates plugin .mcp.json', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const mcpPluginPath = join(DIST_DIR, 'ghcp', '.mcp.json');
    expect(existsSync(mcpPluginPath)).toBe(true);
    const mcp = JSON.parse(readFileSync(mcpPluginPath, 'utf-8'));
    expect(mcp.mcpServers).toBeTruthy();
    expect(mcp.mcpServers['azure']).toBeTruthy();
  });

  it('generates plugin hooks.json at plugin root', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const hooksPluginPath = join(DIST_DIR, 'ghcp', 'hooks.json');
    expect(existsSync(hooksPluginPath)).toBe(true);
    const hooksJson = JSON.parse(readFileSync(hooksPluginPath, 'utf-8'));
    expect(hooksJson.hooks.SessionStart).toBeTruthy();
  });
});

describe('buildTarget — claude', () => {
  beforeEach(() => {
    if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true });
    mkdirSync(DIST_DIR, { recursive: true });
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
    if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true });
    mkdirSync(DIST_DIR, { recursive: true });
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

// ─── Next-step suggestion embedding ───

describe('next-step suggestions', () => {
  beforeEach(() => {
    if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true });
    mkdirSync(DIST_DIR, { recursive: true });
  });

  it('GHCP instructions include graph suggestions', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const instrPath = join(DIST_DIR, 'ghcp', '.github', 'copilot-instructions.md');
    const content = readFileSync(instrPath, 'utf-8');
    // azure-functions-setup should suggest azure-functions-create on success
    expect(content).toContain('azure-functions-create');
    // azure-functions-create should suggest azure-functions-deploy on success
    expect(content).toContain('azure-functions-deploy');
  });
});

// ─── Plugin manifest tests ───

describe('Codex plugin manifest', () => {
  beforeEach(() => {
    if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true });
    mkdirSync(DIST_DIR, { recursive: true });
  });

  it('generates .codex-plugin/plugin.json with correct structure', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const manifestPath = join(DIST_DIR, 'codex', '.codex-plugin', 'plugin.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.name).toBe('azure-functions-skills');
    expect(manifest.version).toBeTruthy();
    expect(manifest.skills).toBe('./skills/');
    expect(manifest.mcpServers).toBe('./.mcp.json');
    expect(manifest.interface).toBeTruthy();
    expect(manifest.interface.displayName).toBeTruthy();
  });

  it('generates .mcp.json at plugin root', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const mcpPath = join(DIST_DIR, 'codex', '.mcp.json');
    expect(existsSync(mcpPath)).toBe(true);
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(mcp['azure']).toBeTruthy();
    expect(mcp['azure'].command).toBe('npx');
  });

  it('generates marketplace.json', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const mpPath = join(DIST_DIR, 'codex', '.agents', 'plugins', 'marketplace.json');
    expect(existsSync(mpPath)).toBe(true);
    const mp = JSON.parse(readFileSync(mpPath, 'utf-8'));
    expect(mp.plugins).toBeInstanceOf(Array);
    expect(mp.plugins[0].name).toBe('azure-functions-skills');
  });

  it('generates plugin skills under skills/ (plugin convention)', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    // Plugin convention: skills go under <plugin>/skills/<name>/SKILL.md
    for (const s of skills) {
      const skillPath = join(DIST_DIR, 'codex', 'skills', s.id, 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);
    }
  });
});

// ─── Setup CLI tests ───

describe('setup module', () => {
  let detectAgents, applySetup;

  beforeAll(async () => {
    const mod = await import('../src/setup/index.js');
    detectAgents = mod.detectAgents;
    applySetup = mod.applySetup;
  });

  beforeEach(() => {
    if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true });
    mkdirSync(DIST_DIR, { recursive: true });
  });

  it('detectAgents returns an array of detected agent names', async () => {
    const agents = await detectAgents();
    expect(agents).toBeInstanceOf(Array);
    // At minimum, should return something (we're in a dev env)
  });

  it('applySetup copies files to target directory', async () => {
    await applySetup(DIST_DIR, { agents: ['ghcp'] });

    // Should have copilot-instructions.md
    expect(existsSync(join(DIST_DIR, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.vscode', 'mcp.json'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'AGENTS.md'))).toBe(true);
  });

  it('applySetup handles codex target', async () => {
    await applySetup(DIST_DIR, { agents: ['codex'] });

    expect(existsSync(join(DIST_DIR, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.codex', 'config.toml'))).toBe(true);
  });

  it('applySetup handles claude target', async () => {
    await applySetup(DIST_DIR, { agents: ['claude'] });

    expect(existsSync(join(DIST_DIR, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.claude', 'settings.json'))).toBe(true);
  });

  it('applySetup handles multiple agents at once', async () => {
    await applySetup(DIST_DIR, { agents: ['ghcp', 'claude', 'codex'] });

    expect(existsSync(join(DIST_DIR, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.codex-plugin', 'plugin.json'))).toBe(true);
  });

  it('applySetup returns a summary with welcome message', async () => {
    const result = await applySetup(DIST_DIR, { agents: ['ghcp'] });

    expect(result.agents).toContain('ghcp');
    expect(result.filesWritten).toBeGreaterThan(0);
    expect(result.welcomeMessage).toContain('Azure Functions');
  });
});

describe('skill references/ subdirectory', () => {
  const FIXTURE_DIR = join(import.meta.dirname, '..', 'dist-test-refs-fixture');
  const REF_DIST_DIR = join(import.meta.dirname, '..', 'dist-test-refs');

  beforeEach(() => {
    for (const d of [FIXTURE_DIR, REF_DIST_DIR]) {
      if (existsSync(d)) rmSync(d, { recursive: true });
    }
    // Build a minimal skill fixture: skills/demo-skill/{skill.yaml, graph.yaml, SKILL.md, references/*}
    const skillDir = join(FIXTURE_DIR, 'skills', 'demo-skill');
    mkdirSync(join(skillDir, 'references', 'nested'), { recursive: true });
    writeFileSync(
      join(skillDir, 'skill.yaml'),
      'id: demo-skill\ntitle: Demo\ndescription: "Demo skill with references"\ncategory: test\n',
    );
    writeFileSync(
      join(skillDir, 'graph.yaml'),
      'suggestions:\n  on_success: []\n',
    );
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# Demo\nSee [more](references/extra.md).\n',
    );
    writeFileSync(join(skillDir, 'references', 'extra.md'), '# Extra reference\n');
    writeFileSync(join(skillDir, 'references', 'nested', 'deep.md'), '# Nested ref\n');
  });

  it('loadSkills returns referencesDir when references/ exists', () => {
    const skills = loadSkills(join(FIXTURE_DIR, 'skills'));
    expect(skills).toHaveLength(1);
    expect(skills[0].referencesDir).toBeTruthy();
    expect(skills[0].referencesDir.endsWith('references')).toBe(true);
  });

  it('loadSkills returns referencesDir=null when references/ is missing', () => {
    // Remove references to test the negative case
    rmSync(join(FIXTURE_DIR, 'skills', 'demo-skill', 'references'), { recursive: true });
    const skills = loadSkills(join(FIXTURE_DIR, 'skills'));
    expect(skills[0].referencesDir).toBeNull();
  });

  // Minimal agents/hooks/mcp stubs for cross-target builds
  function buildFixture(target) {
    const skills = loadSkills(join(FIXTURE_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget(target, { skills, mcpServers, agents, hooks }, REF_DIST_DIR);
  }

  it('ghcp build copies references/ under .github/skills/<id>/ and skills/<id>/', () => {
    buildFixture('ghcp');
    expect(existsSync(join(REF_DIST_DIR, 'ghcp', '.github', 'skills', 'demo-skill', 'references', 'extra.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'ghcp', '.github', 'skills', 'demo-skill', 'references', 'nested', 'deep.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'ghcp', 'skills', 'demo-skill', 'references', 'extra.md'))).toBe(true);
  });

  it('claude build emits .claude/skills/<id>/SKILL.md and copies references/', () => {
    buildFixture('claude');
    expect(existsSync(join(REF_DIST_DIR, 'claude', '.claude', 'skills', 'demo-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'claude', '.claude', 'skills', 'demo-skill', 'references', 'extra.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'claude', '.claude', 'skills', 'demo-skill', 'references', 'nested', 'deep.md'))).toBe(true);
  });

  it('codex build copies references/ under .agents/skills/<id>/ and skills/<id>/', () => {
    buildFixture('codex');
    expect(existsSync(join(REF_DIST_DIR, 'codex', '.agents', 'skills', 'demo-skill', 'references', 'extra.md'))).toBe(true);
    expect(existsSync(join(REF_DIST_DIR, 'codex', 'skills', 'demo-skill', 'references', 'extra.md'))).toBe(true);
  });
});
