# F19: MCP Integration — Azure MCP Server

**Status:** ✅ Implemented (Layer 1 — Azure MCP Server wired into `azure-functions-create`)
**Draft Spec Section:** N/A (discovered from func-emulate F6/F10)
**Depends on:** F1 (Skill Graph Metadata), F5 (azure-functions-create)

## Problem

For AI coding agents to access Azure Functions templates and function metadata, there are currently two approaches:

1. **Embed patterns in skill files** — Static; skills need updating whenever templates change
2. **Search web documentation** — Slow, inaccurate, and risks hallucination

The solution is **MCP (Model Context Protocol) servers**: exposing template catalogs, project scaffolding, and runtime metadata as MCP tools that AI agents can access programmatically.

The official [Azure MCP Server](https://learn.microsoft.com/azure/developer/azure-mcp-server/tools/azure-functions) (`@azure/mcp`) now includes Azure Functions tools natively, providing 68+ templates across 6 languages (C#, Java, JavaScript, Python, TypeScript, PowerShell). `azure-functions-skills` integrates with these tools so all skills can reference them.

## Feature

Integration design with the Azure MCP Server. Enables skills to leverage MCP tools for template search, code generation, and Azure resource management.

## Two Integration Layers

### Layer 1: Azure MCP Server — Azure Functions tools (implemented)

The Azure MCP Server includes Azure Functions tools for template discovery and project scaffolding.

**Available Azure Functions MCP Tools:**

| Tool | Description | Consuming Skills |
|------|------------|-----------------|
| `functions language list` | Discover supported languages, runtime versions, and prerequisites | azure-functions-create, azure-functions-help |
| `functions project get` | Project initialization files (host.json, package.json, etc.) | azure-functions-create |
| `functions list or get template` | List templates (omit template name) or get full template code (include template name) | azure-functions-create, azure-functions-help |
| `function app list or get` | List or get details of existing Azure Functions apps | azure-functions-deploy, azure-functions-discovery |

**Automatic MCP configuration generation:**

During `azure-functions-setup` (F3) workspace configuration, MCP settings are placed based on the detected agent:

```json
// .mcp.json (GitHub Copilot CLI)
{
  "mcpServers": {
    "azure": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure/mcp@latest", "server", "start"],
      "tools": ["*"]
    }
  }
}
```

```json
// .claude/settings.json (Claude Code)
{
  "mcpServers": {
    "azure": {
      "command": "npx",
      "args": ["-y", "@azure/mcp@latest", "server", "start"]
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

How each skill utilizes Azure MCP tools:

| Skill | Azure MCP Tool | Purpose |
|-------|----------|---------|
| **azure-functions-create** (F5) | `functions language list`, `functions list or get template`, `functions project get` | Template search, code generation, project scaffolding |
| **azure-functions-help** (F2) | `functions language list`, `functions list or get template` | Display available template lists |
| **azure-functions-deploy** (F7) | `function app list or get` | Discover existing function apps |
| **azure-functions-discovery** (F4) | `function app list or get` | Detailed information for detected apps |

## MCP Availability Detection

Skills detect whether Azure MCP tools are available and fall back to embedded patterns if not:

```
Azure MCP tools available?
├── Yes → Retrieve templates via MCP (latest, accurate)
└── No → Use embedded patterns/examples within the skill (static but reliable)
```

Skills are designed with MCP in mind, but always have fallbacks so they **function without MCP**.

## Build Integration (F14)

The build system generates MCP config files per target:

| Target | Output File | Format |
|--------|------------|--------|
| GHCP | `.mcp.json` | `{ "mcpServers": { ... } }` |
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
| GHCP | Place MCP config in `.mcp.json`. Skill instructs MCP tool invocations |
| Claude Code | Place MCP config in `.claude/settings.json` |
| Codex | Include MCP config in agent definition |
| Repo Template | Include MCP config template in repo template |
