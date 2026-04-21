# F14: Build System — Cross-Target Generation

**Status:** 📋 Proposed  
**Draft Spec Section:** 9  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

The canonical skill definitions, graph metadata, and agent instructions need to be transformed into target-specific artifacts for GHCP, Claude Code, and Codex. Each target has its own file format, directory structure, and conventions. Maintaining separate copies per target is unsustainable. A build system must generate all artifacts from the canonical source.

## Feature

A build pipeline (`build.ts` or `build.js`) that reads canonical skill metadata and graph definitions, validates them, and generates distribution-ready artifacts for each target platform.

## Build Responsibilities

1. Read canonical skill metadata (`skill.yaml` or `skill.md` + frontmatter)
2. Read graph metadata (`graph.yaml` per skill)
3. Validate graph connectivity and constraints (F1 rules)
4. Generate skill output per target with embedded next-step suggestions
5. Generate `functions-guide` agent definition per target (F12)
6. Generate `post-task-suggester` hook scripts per target (F13)
7. Generate repo templates per target
8. Generate graph manifest (`graph-manifest.json`)
9. Write all artifacts to `dist/`

## Directory Structure

### Source (Canonical)

```
src/
├── skills/
│   ├── azure-functions-help/
│   │   ├── skill.yaml          # Metadata: id, title, description, targets
│   │   ├── graph.yaml          # Graph edges: suggestions, entry conditions
│   │   ├── SKILL.md            # Skill body (target-agnostic, agentskills.io standard)
│   │   └── references/         # Optional: longer supporting docs linked from SKILL.md
│   ├── azure-functions-setup/
│   │   ├── skill.yaml
│   │   ├── graph.yaml
│   │   └── SKILL.md
│   ├── azure-functions-create/
│   │   └── ...
│   └── ...
├── agents/
│   └── functions-guide/
│       └── agent.yaml          # Agent definition (target-agnostic)
├── hooks/
│   └── post-task-suggester/
│       └── hook.yaml           # Hook definition (target-agnostic)
└── templates/
    └── repo-template/
        └── ...                 # Repo template files
```

### Output (Generated)

```
dist/
├── ghcp/
│   ├── skills/
│   │   ├── azure-functions-help.md          # GHCP skill format
│   │   ├── azure-functions-setup.md
│   │   └── ...
│   ├── agents/
│   │   └── functions-guide.md  # GHCP custom agent
│   ├── hooks/
│   │   └── post-task-suggester.js
│   └── repo-template/
│       └── .github/
│           └── copilot-instructions.md
├── claude/
│   ├── skills/
│   ├── agents/
│   └── repo-template/
├── codex/
│   ├── skills/
│   ├── agents/
│   └── repo-template/
└── graph-manifest.json         # Shared graph manifest
```

## Build Pipeline

```
┌─────────────┐     ┌──────────┐     ┌───────────────┐     ┌──────────┐
│ Read Source  │ ──▶ │ Validate │ ──▶ │ Transform     │ ──▶ │ Write    │
│ YAML + MD   │     │ Graph    │     │ Per Target    │     │ dist/    │
└─────────────┘     └──────────┘     └───────────────┘     └──────────┘
```

### Step 1: Read Source

- Parse all `skill.yaml` and `graph.yaml` files
- Parse `SKILL.md` for skill body text (plus optional `references/` subdirectory copied as-is)
- Parse agent and hook definitions

### Step 2: Validate Graph

- All skills are reachable from `azure-functions-help`
- No orphan skills (every skill has ≥ 1 inbound edge)
- Max 3 `on_success` suggestions per skill
- All `target` references in suggestions point to existing skills
- Failure paths converge to entry skills

### Step 3: Transform Per Target

For each target (GHCP, Claude, Codex):

1. Read target-specific template
2. Embed skill content into target format
3. Append next-step suggestions from graph metadata
4. Generate agent definition with routing table
5. Generate hook scripts with graph manifest
6. Generate repo template with project-specific instructions

### Step 4: Write Output

- Write all generated files to `dist/<target>/`
- Write `graph-manifest.json` to `dist/`
- Generate checksums for integrity verification

## Skill Metadata Schema (`skill.yaml`)

```yaml
id: azure-functions-setup
title: Azure Functions Setup
description: Verify prerequisites and set up your environment
category: entry  # entry | task | feedback
targets:
  ghcp: true
  claude: true
  codex: true
tags:
  - setup
  - prerequisites
  - onboarding
```

## CLI Commands

```bash
# Build all targets
npm run build

# Build specific target
npm run build -- --target ghcp

# Validate graph only (no output)
npm run build -- --validate

# Watch mode for development
npm run build -- --watch
```

## Agent Path Mapping (Manifest)

Adopts the `default.yaml` manifest design from func-emulate. Declaratively manages distribution paths to 10+ coding agents.

```yaml
# agent-paths.yaml — Path mapping referenced by the build system
agentPaths:
  # Agents that share .agents/skills/
  shared:
    projectSkills: ".agents/skills"
    agents:
      - github-copilot
      - cursor
      - codex
      - cline
      - gemini-cli
      - opencode
      - amp

  # Agent-specific paths
  custom:
    claude-code:
      projectSkills: ".claude/skills"
      instructions: ".claude/CLAUDE.md"
      mcp: ".claude/settings.json"
    github-copilot:
      instructions: ".github/copilot-instructions.md"
      scopedInstructions: ".github/instructions/"  # *.instructions.md
      agentDefs: ".github/agents/"                  # *.agent.md
      prompts: ".github/prompts/"                    # *.prompt.md
      mcp: ".vscode/mcp.json"
    cursor:
      rules: ".cursor/rules/"                        # *.mdc
      mcp: ".cursor/mcp.json"
    codex:
      instructions: "AGENTS.md"
    windsurf:
      projectSkills: ".windsurf/skills"
      mcp: "~/.codeium/windsurf/mcp_config.json"    # global only
```

The build system uses this mapping to place skills, instructions, and MCP configs at the correct paths for each target.

## MCP Configuration Generation

The build system also generates MCP config files per target (see F19):

| Target | Output File | Format |
|--------|------------|--------|
| GHCP | `.vscode/mcp.json` | `{ "servers": { ... } }` |
| Claude Code | `.claude/settings.json` | `{ "mcpServers": { ... } }` |
| Cursor | `.cursor/mcp.json` | `{ "mcpServers": { ... } }` |

## Response Language Rule Injection

All skills in func-emulate include `> **Language**: Always respond in the same language the user is using.`. The build system automatically injects this rule into all skill outputs:

```
Step 3.5: Inject standard directives
  → Add response language rule to every skill output
  → Add skill version/source metadata
  → Add graph-derived next-step suggestions
```

## Technology

- **Runtime:** Node.js 18+ (ESM)
- **YAML parsing:** `yaml` package
- **Markdown processing:** `marked` or raw string manipulation
- **Validation:** Custom schema checks (no heavy framework)
- **Output:** File system writes, no bundler needed

## Cross-Target Implementation

| Target | Output Format |
|--------|--------------|
| GHCP | `.md` skills, `.md` agents, `.js` hooks, `.github/` repo template, `.vscode/mcp.json` |
| Claude Code | `.md` skills in `.claude/skills/`, `.json` agent manifest, `.claude/settings.json` MCP |
| Cursor | `.md` skills in `.agents/skills/`, `.mdc` rules, `.cursor/mcp.json` |
| Codex | `.md` skills in `.agents/skills/`, `AGENTS.md` instructions, post-task config |
| Windsurf | `.md` skills in `.windsurf/skills/`, global MCP config |
