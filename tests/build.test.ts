import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
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

function hasCommand(command: string, args: string[] = ['--version']): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch (_err) {
    return false;
  }
}

function findPowerShellCommand(): string | null {
  if (hasCommand('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'])) return 'pwsh';
  if (hasCommand('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'])) return 'powershell.exe';
  return null;
}

function runTelemetryPowerShellHook(options: { stateTelemetryEnabled: boolean; input: string }): string[] | null {
  const powershell = findPowerShellCommand();
  if (!powershell) return null;

  const workspace = createTempDir('af-skills-telemetry-hook-');
  const hookDir = join(workspace, '.azure-functions-skills', 'hooks', 'scripts');
  const fakeBin = join(workspace, 'fake-bin');
  const fakeNpxScript = join(fakeBin, 'fake-npx.cjs');
  const npxArgsPath = join(workspace, 'npx-args.json');
  mkdirSync(hookDir, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(hookDir, 'track-telemetry.ps1'), readFileSync(join(TEMPLATES_DIR, 'hooks', 'scripts', 'track-telemetry.ps1'), 'utf-8'));
  writeFileSync(join(workspace, '.azure-functions-skills', 'state.local.json'), `${JSON.stringify({
    package: { version: '9.8.7' },
    install: { mode: 'local', scope: 'workspace' },
    telemetry: { enabled: options.stateTelemetryEnabled },
  })}\n`);
  writeFileSync(fakeNpxScript, [
    "const { writeFileSync } = require('node:fs');",
    "writeFileSync(process.env.NPX_ARGS_PATH || '', JSON.stringify(process.argv.slice(2)));",
  ].join('\n'));
  if (process.platform === 'win32') {
    writeFileSync(join(fakeBin, 'npx.cmd'), `@"${process.execPath}" "${fakeNpxScript}" %*\r\n`);
  } else {
    const fakeNpx = join(fakeBin, 'npx');
    writeFileSync(fakeNpx, `#!/usr/bin/env sh\n"${process.execPath}" "${fakeNpxScript}" "$@"\n`);
    chmodSync(fakeNpx, 0o755);
  }

  try {
    execFileSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(hookDir, 'track-telemetry.ps1')], {
      cwd: workspace,
      input: options.input,
      encoding: 'utf-8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH || ''}`,
        NPX_ARGS_PATH: npxArgsPath,
      },
    });
    if (!existsSync(npxArgsPath)) return [];
    return JSON.parse(readFileSync(npxArgsPath, 'utf-8')) as string[];
  } finally {
    removeDir(workspace);
  }
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
    expect(setupSkill?.content).toContain('npx @azure/functions-skills state setup-complete --dir');
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

  it('loads telemetry hook manifests and scripts', () => {
    expect(hooks.copilotTelemetry).toContain('PostToolUse');
    expect(hooks.claudeTelemetry).toContain('PostToolUse');
    expect(hooks.telemetryConfig).toContain('__APPLICATIONINSIGHTS_INSTRUMENTATION_KEY__');
    expect(hooks.trackTelemetryPowerShell).toContain('plugin-telemetry');
    expect(hooks.trackTelemetryShell).toContain('plugin-telemetry');
  });
});

// ─── Build target tests ───

describe('buildTarget — ghcp', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('does not generate copilot-instructions.md (routing is handled by functions-copilot.agent.md)', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const instrPath = join(DIST_DIR, 'ghcp', '.github', 'copilot-instructions.md');
    expect(existsSync(instrPath)).toBe(false);
  });

  it('generates root .mcp.json with mcpServers for Copilot CLI', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const mcpPath = join(DIST_DIR, 'ghcp', '.mcp.json');
    expect(existsSync(mcpPath)).toBe(true);
    expect(existsSync(join(DIST_DIR, 'ghcp', '.vscode', 'mcp.json'))).toBe(false);
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(mcp.mcpServers).toBeTruthy();
    expect(mcp.mcpServers['azure']).toBeTruthy();
    expect(mcp.mcpServers['azure'].tools).toEqual(['*']);
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
    expect(existsSync(join(DIST_DIR, 'ghcp', '.github', 'hooks', 'azure-functions-telemetry.json'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'ghcp', '.azure-functions-skills', 'hooks', 'scripts', 'track-telemetry.sh'))).toBe(true);
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
    expect(existsSync(join(DIST_DIR, 'ghcp', '.mcp.json'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'ghcp', '.vscode', 'mcp.json'))).toBe(false);
    expect(existsSync(join(DIST_DIR, 'ghcp', 'hooks.json'))).toBe(false);
  });

});

describe('buildTarget — claude', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('generates CLAUDE.md as lightweight routing block (not inlined skills)', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('claude', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const claudePath = join(DIST_DIR, 'claude', 'CLAUDE.md');
    expect(existsSync(claudePath)).toBe(true);
    const content = readFileSync(claudePath, 'utf-8');
    // Should contain skill routing list
    expect(content).toContain('azure-functions-setup');
    // Should be small (routing only, not full skill content)
    expect(content.length).toBeLessThan(3000);
    // Should NOT contain full skill content (that's in .claude/skills/)
    expect(content).not.toContain('## First-Time Setup');
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
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toContain('.azure-functions-skills/hooks/scripts/track-telemetry.sh');
    expect(existsSync(join(DIST_DIR, 'claude', '.azure-functions-skills', 'hooks', 'telemetry.config.json'))).toBe(true);
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

  it('generates AGENTS.md with routing and dev standards (not inlined skills)', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('codex', { skills, mcpServers, agents, hooks }, DIST_DIR);

    const agentsPath = join(DIST_DIR, 'codex', 'AGENTS.md');
    expect(existsSync(agentsPath)).toBe(true);
    const content = readFileSync(agentsPath, 'utf-8');
    // Should contain skill routing list
    expect(content).toContain('azure-functions-setup');
    // Should contain dev standards from AGENTS.md template
    expect(content).toContain('Code Quality');
    // Should be small (routing + standards, not full skill content)
    expect(content.length).toBeLessThan(5000);
    // Should NOT contain full skill content
    expect(content).not.toContain('## First-Time Setup');
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
    expect(hooksJson.hooks.PostToolUse).toBeTruthy();
    expect(existsSync(join(DIST_DIR, 'codex', '.azure-functions-skills', 'hooks', 'scripts', 'track-telemetry.ps1'))).toBe(true);
  });
});

// ─── Skill instruction embedding ───

describe('skill instruction embedding', () => {
  beforeEach(() => {
    resetDistDir();
  });

  it('GHCP agent definition includes skill routing and next step guidance', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    buildTarget('ghcp', { skills, mcpServers, agents, hooks }, DIST_DIR);

    // Agent definition has routing rules and next step guidance
    const agentPath = join(DIST_DIR, 'ghcp', '.github', 'agents', 'functions-copilot.agent.md');
    const content = readFileSync(agentPath, 'utf-8');
    expect(content).toContain('azure-functions-setup');
    expect(content).toContain('azure-functions-create');
    expect(content).toContain('azure-functions-deploy');
    expect(content).toContain('suggest');
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
    expect(existsSync(join(payloadDir, 'hooks', 'copilot-hooks.json'))).toBe(true);
    expect(existsSync(join(payloadDir, 'agents', 'functions-copilot.agent.md'))).toBe(true);
    const mcpConfig = JSON.parse(readFileSync(join(payloadDir, '.mcp.json'), 'utf-8'));
    expect(mcpConfig.mcpServers.azure).toEqual({
      command: 'npx',
      args: ['-y', '@azure/mcp@latest', 'server', 'start'],
    });

    const manifest = JSON.parse(readFileSync(join(payloadDir, '.plugin', 'plugin.json'), 'utf-8'));
    expect(manifest.skills).toBe('./skills/');
    expect(manifest.agents).toBe('./agents/');
    expect(manifest.hooks).toEqual({
      paths: ['./hooks/copilot-hooks.json'],
      exclusive: true,
    });
    expect(manifest.mcpServers).toBe('./.mcp.json');

    const claudeManifest = JSON.parse(readFileSync(join(payloadDir, '.claude-plugin', 'plugin.json'), 'utf-8'));
    expect(claudeManifest.skills).toBe('./skills/');
    expect(claudeManifest.hooks).toBe('./hooks/hooks.json');
    expect(claudeManifest.mcpServers).toBe('./.mcp.json');
  });

  it('generates a plugin payload with telemetry hooks but without agents or MCP', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    const payloadDir = join(DIST_DIR, 'plugin', 'azure-functions-skills');

    buildPluginPayload({ skills, mcpServers, agents, hooks, packageVersion: '9.8.7' }, payloadDir, { profile: 'hooks' });

    expect(existsSync(join(payloadDir, 'hooks', 'copilot-hooks.json'))).toBe(true);
    expect(existsSync(join(payloadDir, 'hooks', 'telemetry.config.json'))).toBe(true);
    expect(existsSync(join(payloadDir, '.mcp.json'))).toBe(false);
    expect(existsSync(join(payloadDir, 'agents'))).toBe(false);
    expect(existsSync(join(payloadDir, 'hooks.json'))).toBe(false);

    const manifest = JSON.parse(readFileSync(join(payloadDir, '.plugin', 'plugin.json'), 'utf-8'));
    expect(manifest.hooks).toEqual({
      paths: ['./hooks/copilot-hooks.json'],
      exclusive: true,
    });
    expect(manifest).not.toHaveProperty('agents');
    expect(manifest).not.toHaveProperty('mcpServers');
  });

  it('ships telemetry hooks and scripts in the full plugin payload', () => {
    const skills = loadSkills(join(TEMPLATES_DIR, 'skills'));
    const mcpServers = loadMcpServers(join(TEMPLATES_DIR, 'mcp', 'servers.yaml'));
    const agents = loadAgents(join(TEMPLATES_DIR, 'agents'));
    const hooks = loadHooks(join(TEMPLATES_DIR, 'hooks'));
    const payloadDir = join(DIST_DIR, 'plugin', 'azure-functions-skills');

    buildPluginPayload({ skills, mcpServers, agents, hooks, packageVersion: '9.8.7' }, payloadDir, { profile: 'full' });

    expect(existsSync(join(payloadDir, 'hooks', 'copilot-hooks.json'))).toBe(true);
    expect(existsSync(join(payloadDir, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(payloadDir, 'hooks', 'telemetry.config.json'))).toBe(true);
    expect(existsSync(join(payloadDir, 'hooks', 'scripts', 'track-telemetry.ps1'))).toBe(true);
    expect(existsSync(join(payloadDir, 'hooks', 'scripts', 'track-telemetry.sh'))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(payloadDir, '.plugin', 'plugin.json'), 'utf-8'));
    expect(manifest.hooks).toEqual({
      paths: ['./hooks/copilot-hooks.json'],
      exclusive: true,
    });

    const script = readFileSync(join(payloadDir, 'hooks', 'scripts', 'track-telemetry.ps1'), 'utf-8');
    expect(script).toContain('azure-functions-');
    expect(script).toContain('APPLICATIONINSIGHTS_INSTRUMENTATION_KEY');
  });

  it('telemetry scripts honor workspace state opt-out and local skill paths', () => {
    const shellScript = readFileSync(join(TEMPLATES_DIR, 'hooks', 'scripts', 'track-telemetry.sh'), 'utf-8');
    const powershellScript = readFileSync(join(TEMPLATES_DIR, 'hooks', 'scripts', 'track-telemetry.ps1'), 'utf-8');

    for (const script of [shellScript, powershellScript]) {
      expect(script).toContain('state.local.json');
      expect(script).toContain('telemetry');
      expect(script).toContain('enabled');
      expect(script).toContain('.github/skills/azure-functions-');
      expect(script).toContain('.claude/skills/azure-functions-');
      expect(script).toContain('--plugin-name');
      expect(script).toContain('--plugin-version');
    }
  });

  it('does not invoke telemetry when workspace state disables collection', () => {
    const args = runTelemetryPowerShellHook({
      stateTelemetryEnabled: false,
      input: JSON.stringify({
        toolName: 'Read',
        sessionId: 'session-123',
        toolArgs: {
          path: '.github/skills/azure-functions-create/SKILL.md',
          content: 'SECRET_FILE_CONTENT',
        },
      }),
    });

    if (args === null) return;
    expect(args).toEqual([]);
  }, 15_000);

  it('emits only telemetry metadata for enabled hook events', () => {
    const args = runTelemetryPowerShellHook({
      stateTelemetryEnabled: true,
      input: JSON.stringify({
        toolName: 'Read',
        sessionId: 'session-123',
        toolArgs: {
          path: '.github/skills/azure-functions-create/references/node.md',
          content: 'SECRET_FILE_CONTENT',
          arguments: 'SECRET_TOOL_ARGUMENTS',
        },
      }),
    });

    if (args === null) return;
    expect(args).toContain('server');
    expect(args).toContain('plugin-telemetry');
    expect(args).toContain('--plugin-name');
    expect(args).toContain('azure-functions-skills');
    expect(args).toContain('--plugin-version');
    expect(args).toContain('9.8.7+local.workspace');
    expect(args).toContain('--event-type');
    expect(args).toContain('reference_file_read');
    expect(args).toContain('--session-id');
    expect(args).toContain('session-123');
    expect(args).toContain('--file-reference');
    expect(args).toContain('azure-functions-create\\references\\node.md');
    expect(args.join(' ')).not.toContain('SECRET_FILE_CONTENT');
    expect(args.join(' ')).not.toContain('SECRET_TOOL_ARGUMENTS');
  }, 15_000);
});

describe('partner drop pipeline', () => {
  it('uses the shared engineering npm release template for partner blob upload', () => {
    const pipeline = readFileSync(join(import.meta.dirname, '..', 'azure-pipelines', 'partner-drop-upload.yml'), 'utf-8');

    expect(pipeline).toContain('repository: eng');
    expect(pipeline).toContain('name: engineering');
    expect(pipeline).toContain('ref: refs/heads/main');
    expect(pipeline).toContain('/ci/release-npm-package.yml@eng');
    expect(pipeline).toContain('pipeline: officialBuild');
    expect(pipeline).toContain('targetFolder: azure-functions/azure-functions-skills/{version}');
    expect(pipeline).toContain('runPipeline: false');
    expect(pipeline).not.toContain('/ci/internal/upload-partner-package.yml@eng');
    expect(pipeline).not.toContain('Stage package in versioned partner path');
    expect(pipeline).not.toContain('az storage blob upload');
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
  it('publishes the local plugin payload but not workspace build output', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8'));

    expect(pkg.files).toContain('templates/');
    expect(pkg.files).toContain('dist/plugin/');
    expect(pkg.files).not.toContain('dist/workspace/');
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

    // GHCP: agent definition + mcp + AGENTS.md (no copilot-instructions.md)
    expect(existsSync(join(DIST_DIR, '.github', 'agents', 'functions-copilot.agent.md'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.mcp.json'))).toBe(true);
    expect(existsSync(join(DIST_DIR, '.vscode', 'mcp.json'))).toBe(false);
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
    expect(existsSync(join(DIST_DIR, '.mcp.json'))).toBe(true);
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

    // GHCP: no copilot-instructions.md (routing via agent definition)
    expect(existsSync(join(DIST_DIR, '.github', 'agents', 'functions-copilot.agent.md'))).toBe(true);
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
