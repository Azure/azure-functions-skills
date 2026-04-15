# Feature Requirement Documents (FRDs)

Individual feature specs broken out from the [仮スペック](../../../仮スペック.md). Each FRD is self-contained and can be implemented independently.

## Vision

`azure-functions-skills` is the **canonical repository** for Azure Functions skills, agents, hooks, MCP integrations, and references. It generates plugin artifacts and repo templates targeting GHCP, Claude Code, and Codex from a single knowledge base.

The key differentiator is **Skill Graph** — skills are not a flat catalog but a directed graph with recommended transitions, enabling workflow discoverability where the next action surfaces naturally.

## Features

| # | Feature | Status | FRD |
|---|---------|--------|-----|
| F1 | [Skill Graph Metadata](./f1-skill-graph-metadata.md) | 📋 Proposed | Canonical graph model connecting skills with directed transitions |
| F2 | [af-help — Entry & Navigation](./f2-af-help.md) | 📋 Proposed | Graph-aware help that recommends next steps based on context |
| F3 | [af-setup — Environment Verification](./f3-af-setup.md) | 📋 Proposed | Verify tooling prerequisites and onboard new users |
| F4 | [af-discovery — Project Analysis](./f4-af-discovery.md) | 📋 Proposed | Analyze existing repos and recommend relevant skills |
| F5 | [af-create — Project Scaffolding](./f5-af-create.md) | 📋 Proposed | Scaffold new Azure Functions projects with language/template selection |
| F6 | [af-deploy — Deployment](./f6-af-deploy.md) | 📋 Proposed | Guide deployment to Azure with SKU-aware best practices |
| F7 | [af-observability — Monitoring](./f7-af-observability.md) | 📋 Proposed | Set up Application Insights, logging, and alerting |
| F8 | [af-hosting — Hosting Plan Guidance](./f8-af-hosting.md) | 📋 Proposed | Compare and recommend hosting plans (Consumption, Flex, Premium, Dedicated) |
| F9 | [Language Skills (af-python, af-node, af-dotnet)](./f9-language-skills.md) | 📋 Proposed | Language-specific guidance, patterns, and best practices |
| F10 | [af-durable — Durable Functions](./f10-af-durable.md) | 📋 Proposed | Orchestration patterns, fan-out/fan-in, human interaction workflows |
| F11 | [af-feedback — Improvement Loop](./f11-af-feedback.md) | 📋 Proposed | Collect usage signals and route to skill improvement pipeline |
| F12 | [functions-guide Agent](./f12-functions-guide-agent.md) | 📋 Proposed | Custom agent that interprets user context and routes to skills |
| F13 | [post-task-suggester Hook](./f13-post-task-suggester-hook.md) | 📋 Proposed | Post-completion hooks that surface next-step candidates |
| F14 | [Build System — Cross-Target Generation](./f14-build-system.md) | 📋 Proposed | Build pipeline with agent path manifest for 10+ targets |
| F15 | [Distribution — Plugin Packaging](./f15-distribution.md) | 📋 Proposed | Package and distribute plugins per target (GHCP, Claude, Codex) |
| F16 | [af-doctor — Project Diagnostics](./f16-af-doctor.md) | 📋 Proposed | Structured diagnostics for `func start` failures and project health |
| F17 | [af-migrate — Model Migration](./f17-af-migrate.md) | 📋 Proposed | Guide migration from legacy programming models (v1→v2, v3→v4, in-process→isolated) |
| F18 | [af-audit — Project Audit](./f18-af-audit.md) | 📋 Proposed | Static analysis for security, SKU compatibility, and best practices |
| F19 | [MCP Integration](./f19-mcp-integration.md) | 📋 Proposed | Templates MCP server integration for AI-assisted function creation |
| F20 | [CLI & Library](./f20-cli-library.md) | ✅ Implemented | `setup` + `chat` + `build` commands, library exports for VS Code extensions |

## Skill Lifecycle Model

Skills are classified into four roles:

| Role | Skills | Purpose |
|------|--------|---------|
| **Entry** | af-help, af-setup, af-discovery | First contact points for users |
| **Task** | af-create, af-deploy, af-observability, af-hosting, af-python, af-node, af-dotnet, af-durable, af-migrate, af-audit | Concrete work execution |
| **Diagnostic** | af-doctor | Troubleshooting and project health checks |
| **Transition** | af-help, functions-guide agent, post-task-suggester hook | Navigate between skills |
| **Infrastructure** | af-mcp (MCP Integration) | Connect AI agents to Functions tools |
| **Feedback** | af-feedback | Route usage data to improvement loops |

## Skill Graph (Initial)

```
af-help
  → af-setup
  → af-discovery

af-setup
  → af-create
  → af-help

af-discovery
  → af-deploy
  → af-observability
  → af-hosting
  → af-migrate (if legacy model detected)
  → af-python / af-node / af-dotnet / af-durable

af-create
  → af-deploy
  → af-observability
  → af-hosting

af-deploy
  → af-observability
  → af-feedback

af-observability
  → af-feedback

af-hosting
  → af-deploy
  → af-feedback

af-python / af-node / af-dotnet
  → af-deploy
  → af-observability

af-durable
  → af-observability
  → af-feedback

af-doctor
  → af-setup (if environment issues)
  → af-deploy (if project healthy)

af-migrate
  → af-doctor (post-migration validation)
  → af-deploy

af-audit
  → af-deploy (if audit passes)
  → af-doctor (if critical issues)
```

## Relationship to 仮スペック

The 仮スペック defines the overall vision: a workflow-aware plugin source repo with directed skill graphs. These FRDs break the implementation into shippable units. F1 (Skill Graph Metadata) is the foundation — all other features depend on or extend it.

## Review Findings (from func-emulate)

The following features were identified by reviewing the func-emulate prototype (F18, F20, F21, fnx-diagnostics, fnx-create-function skills) and added as F16–F19:

| FRD | Source | Key Insight |
|-----|--------|-------------|
| F16 (af-doctor) | fnx F18 + fnx-diagnostics | `af-setup` (env check) ≠ project diagnostics; `func start` failure diagnosis is a distinct workflow |
| F17 (af-migrate) | fnx F21 migrate | Legacy model migration (v1→v2, v3→v4) is a top developer pain point with structured patterns |
| F18 (af-audit) | fnx F21 audit | Pre-deploy static analysis (security, SKU compat) is distinct from post-deploy monitoring (F7) |
| F19 (MCP Integration) | fnx F6/F10/F20 | MCP tools are the bridge between AI agents and Functions templates; skills must reference them |

Existing FRDs were also updated:
- **F3** gained Agent Workspace Configuration (agent detection + skill/MCP auto-placement)
- **F5** gained "Add function to existing project" path with MCP tool integration
- **F14** gained agent path manifest and response language rule injection
