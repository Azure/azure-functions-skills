# F19: MCP Integration — Template & Runtime MCP Server

**Status:** 🚧 Partially Implemented (Layer 1 — Templates MCP wired into `azure-functions-create`)
**Draft Spec Section:** N/A (discovered from func-emulate F6/F10)
**Depends on:** F1 (Skill Graph Metadata), F5 (azure-functions-create)

## Problem

For AI coding agents to access Azure Functions templates and function metadata, there are currently two approaches:

1. **Embed patterns in skill files** — Static; skills need updating whenever templates change
2. **Search web documentation** — Slow, inaccurate, and risks hallucination

func-emulate solved this problem through **MCP (Model Context Protocol) servers**: exposing template catalogs, project scaffolding, and SKU profiles as MCP tools that AI agents can access programmatically.

The `azure-functions-templates-mcp-server` (by Manvir Kaur) already exists, providing 68+ templates across 4 languages via MCP. `azure-functions-skills` needs to design integration with this server so all skills can reference it.

## Feature

Integration design with MCP servers. Enables skills to leverage MCP tools for template search, code generation, and SKU compatibility checks.

## Two Integration Layers

### Layer 1: Templates MCP (existing external server)

Incorporating the Azure Functions Templates MCP Server into the skill ecosystem.

**Available MCP Tools:**

| Tool | Description | Consuming Skills |
|------|------------|-----------------|
| `get_languages_list` | List of supported languages (runtime versions, template count) | azure-functions-create, azure-functions-help |
| `get_project_template` | Project initialization files (host.json, package.json, etc.) | azure-functions-create |
| `get_azure_functions_templates_list` | Template list by language (descriptions, categories) | azure-functions-create, azure-functions-help |
| `get_azure_functions_template` | Full template source code + required app settings | azure-functions-create |
| `get_sku_profile` | SKU profile (host/bundle versions) — *future* | azure-functions-hosting, azure-functions-audit |

**Automatic MCP configuration generation:**

During `azure-functions-setup` (F3) workspace configuration, MCP settings are placed based on the detected agent:

```json
// .vscode/mcp.json (GitHub Copilot)
{
  "servers": {
    "azure-functions-templates": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "manvir-templates-mcp-server"]
    }
  }
}
```

```json
// .claude/settings.json (Claude Code)
{
  "mcpServers": {
    "azure-functions-templates": {
      "command": "npx",
      "args": ["-y", "manvir-templates-mcp-server"]
    }
  }
}
```

### Layer 2: Core Tools MCP (future vision)

A future vision where the `func` command itself exposes MCP tools:

| Tool | Description | Status |
|------|------------|--------|
| `get_functions_list` | List of functions on the running host (triggers, routes) | Future |
| `get_host_status` | Host status (version, PID, uptime) | Future |
| `invoke_function` | Execute HTTP/non-HTTP functions | Future |
| `get_invocation_logs` | Recent execution logs | Future |

This layer can be implemented by wrapping the `/admin/functions` API from `func start`. However, since it requires changes to Core Tools itself, only Layer 1 is targeted for the initial release.

## Skill × MCP Integration Matrix

How each skill utilizes MCP tools:

| Skill | MCP Tool | Purpose |
|-------|----------|---------|
| **azure-functions-create** (F5) | `get_languages_list`, `get_azure_functions_templates_list`, `get_azure_functions_template`, `get_project_template` | Template search, code generation, project scaffolding |
| **azure-functions-help** (F2) | `get_languages_list`, `get_azure_functions_templates_list` | Display available template lists |
| **azure-functions-hosting** (F8) | `get_sku_profile` | Retrieve SKU-specific constraint information |
| **azure-functions-audit** (F18) | `get_sku_profile` | SKU compatibility checks |
| **azure-functions-discovery** (F4) | `get_sku_profile` | Detailed information for detected SKU |

## MCP Availability Detection

Skills detect whether MCP tools are available and fall back to embedded patterns if not:

```
MCP tools available?
├── Yes → Retrieve templates via MCP (latest, accurate)
└── No → Use embedded patterns/examples within the skill (static but reliable)
```

Skills are designed with MCP in mind, but always have fallbacks so they **function without MCP**.

## Build Integration (F14)

The build system generates MCP config files per target:

| Target | Output File | Format |
|--------|------------|--------|
| GHCP | `.vscode/mcp.json` | `{ "servers": { ... } }` |
| Claude Code | `.claude/settings.json` | `{ "mcpServers": { ... } }` |
| Cursor | `.cursor/mcp.json` | `{ "mcpServers": { ... } }` |
| Codex | `codex-mcp.json` | Agent-specific format |

## Skill Metadata

```yaml
id: azure-functions-mcp
title: MCP Server Integration
intent:
  - configure_mcp
  - connect_templates
  - enable_ai_tools
completion_signals:
  - mcp_configured
  - templates_accessible
suggestions:
  on_success:
    - target: azure-functions-create
      reason: "MCP is configured. Create functions using template tools."
      priority: 100
    - target: azure-functions-help
      reason: "Explore what the MCP tools can do."
      priority: 60
  on_failure:
    - target: azure-functions-setup
      reason: "MCP configuration failed. Check environment setup."
      priority: 80
entry_conditions:
  - mcp_not_configured
  - ai_agent_detected
```

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Place MCP config in `.vscode/mcp.json`. Skill instructs MCP tool invocations |
| Claude Code | Place MCP config in `.claude/settings.json` |
| Codex | Include MCP config in agent definition |
| Repo Template | Include MCP config template in repo template |
