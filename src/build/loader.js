import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load all skills from the skills directory.
 * Each skill dir contains skill.yaml, graph.yaml, SKILL.md, and an optional references/ subdir.
 */
export function loadSkills(skillsDir) {
  const dirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  return dirs.map(dir => {
    const base = join(skillsDir, dir);
    const skillYaml = readFileSync(join(base, 'skill.yaml'), 'utf-8');
    const graphYaml = readFileSync(join(base, 'graph.yaml'), 'utf-8');
    const content = readFileSync(join(base, 'SKILL.md'), 'utf-8');

    const refsPath = join(base, 'references');
    const referencesDir =
      existsSync(refsPath) && statSync(refsPath).isDirectory() ? refsPath : null;

    const scriptsPath = join(base, 'scripts');
    const scriptsDir =
      existsSync(scriptsPath) && statSync(scriptsPath).isDirectory() ? scriptsPath : null;

    return {
      id: parseYamlValue(skillYaml, 'id'),
      title: parseYamlValue(skillYaml, 'title'),
      description: parseYamlValue(skillYaml, 'description'),
      category: parseYamlValue(skillYaml, 'category'),
      content,
      graph: parseGraph(graphYaml),
      referencesDir,
      scriptsDir,
      raw: { skill: skillYaml, graph: graphYaml },
    };
  });
}

/**
 * Load MCP server definitions from servers.yaml.
 */
export function loadMcpServers(yamlPath) {
  const raw = readFileSync(yamlPath, 'utf-8');
  const servers = [];
  // Split into server blocks by "- id:"
  const blocks = raw.split(/(?=^\s*- id:)/m).filter(b => b.includes('- id:'));

  for (const block of blocks) {
    servers.push({
      id: parseYamlListItemValue(block, 'id'),
      name: parseYamlValue(block, 'name'),
      description: parseYamlValue(block, 'description'),
      type: parseYamlValue(block, 'type') || 'stdio',
      command: parseYamlValue(block, 'command'),
      args: parseYamlArray(block, 'args'),
    });
  }
  return servers;
}

/**
 * Load agent definitions from the agents directory.
 */
export function loadAgents(agentsDir) {
  const agentsMd = readFileSync(join(agentsDir, 'AGENTS.md'), 'utf-8');
  const guide = readFileSync(join(agentsDir, 'functions-guide.agent.md'), 'utf-8');
  return { agentsMd, guide };
}

/**
 * Load hooks from the hooks directory.
 */
export function loadHooks(hooksDir) {
  const welcome = readFileSync(join(hooksDir, 'welcome-setup.md'), 'utf-8');
  return { welcome };
}

// ─── Minimal YAML helpers (no dependencies) ───

function parseYamlValue(yaml, key) {
  const re = new RegExp(`^\\s*${key}:\\s*["']?(.+?)["']?\\s*$`, 'm');
  const m = yaml.match(re);
  return m ? m[1].trim() : '';
}

function parseYamlListItemValue(yaml, key) {
  // Matches "- id: value" (list item with dash prefix)
  const re = new RegExp(`^\\s*-\\s+${key}:\\s*["']?(.+?)["']?\\s*$`, 'm');
  const m = yaml.match(re);
  return m ? m[1].trim() : '';
}

function parseYamlArray(yaml, key) {
  const re = new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`);
  const m = yaml.match(re);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
}

function parseGraph(graphYaml) {
  const suggestions = { on_success: [], on_failure: [] };
  let currentSection = null;

  for (const line of graphYaml.split('\n')) {
    if (line.includes('on_success:')) { currentSection = 'on_success'; continue; }
    if (line.includes('on_failure:')) { currentSection = 'on_failure'; continue; }
    if (line.includes('entry_conditions:')) { currentSection = null; continue; }

    if (currentSection) {
      const targetMatch = line.match(/target:\s*(.+)/);
      if (targetMatch) {
        const target = targetMatch[1].trim();
        suggestions[currentSection].push({ target });
      }
      const reasonMatch = line.match(/reason:\s*["'](.+)["']/);
      if (reasonMatch && suggestions[currentSection].length > 0) {
        const last = suggestions[currentSection][suggestions[currentSection].length - 1];
        last.reason = reasonMatch[1];
      }
      const prioMatch = line.match(/priority:\s*(\d+)/);
      if (prioMatch && suggestions[currentSection].length > 0) {
        const last = suggestions[currentSection][suggestions[currentSection].length - 1];
        last.priority = parseInt(prioMatch[1], 10);
      }
    }
  }

  return { suggestions };
}
