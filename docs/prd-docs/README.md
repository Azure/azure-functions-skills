# Feature Requirement Documents (FRDs)

Individual feature specs broken out from the Draft Spec. Each FRD is self-contained and can be implemented independently.

## Vision

`azure-functions-skills` is the **canonical repository** for Azure Functions skills, agents, hooks, MCP integrations, and references. It generates plugin artifacts and repo templates targeting GHCP, Claude Code, and Codex from a single knowledge base.

The key differentiator is **Skill Graph** — skills are not a flat catalog but a directed graph with recommended transitions, enabling workflow discoverability where the next action surfaces naturally.

## Features

| # | Feature | Status | FRD |
|---|---------|--------|-----|
| F1 | [Skill Graph Metadata](./f1-skill-graph-metadata.md) | 📋 Proposed | Canonical graph model connecting skills with directed transitions |
| F2 | [azure-functions-help — Entry & Navigation](./f2-azure-functions-help.md) | 📋 Proposed | Graph-aware help that recommends next steps based on context |
| F3 | [azure-functions-setup — Environment Verification](./f3-azure-functions-setup.md) | 📋 Proposed | Verify tooling prerequisites and onboard new users |
| F4 | [azure-functions-discovery — Project Analysis](./f4-azure-functions-discovery.md) | 📋 Proposed | Analyze existing repos and recommend relevant skills |
| F5 | [azure-functions-create — Project Scaffolding](./f5-azure-functions-create.md) | 📋 Proposed | Scaffold new Azure Functions projects with language/template selection |
| F6 | [azure-functions-deploy — Deployment](./f6-azure-functions-deploy.md) | 📋 Proposed | Guide deployment to Azure with SKU-aware best practices |
| F7 | [azure-functions-observability — Monitoring](./f7-azure-functions-observability.md) | 📋 Proposed | Set up Application Insights, logging, and alerting |
| F8 | [azure-functions-hosting — Hosting Plan Guidance](./f8-azure-functions-hosting.md) | 📋 Proposed | Compare and recommend hosting plans (Consumption, Flex, Premium, Dedicated) |
| F9 | [Language Skills (azure-functions-python, azure-functions-node, azure-functions-dotnet)](./f9-language-skills.md) | 📋 Proposed | Language-specific guidance, patterns, and best practices |
| F10 | [azure-functions-durable — Durable Functions](./f10-azure-functions-durable.md) | 📋 Proposed | Orchestration patterns, fan-out/fan-in, human interaction workflows |
| F11 | [azure-functions-feedback — Improvement Loop](./f11-azure-functions-feedback.md) | 📋 Proposed | Collect usage signals and route to skill improvement pipeline |
| F12 | [functions-copilot Agent](./f12-functions-copilot-agent.md) | 📋 Proposed | Custom agent that interprets user context and routes to skills |
| F13 | [post-task-suggester Hook](./f13-post-task-suggester-hook.md) | 📋 Proposed | Post-completion hooks that surface next-step candidates |
| F14 | [Build System — Cross-Target Generation](./f14-build-system.md) | 📋 Proposed | Build pipeline with agent path manifest for 10+ targets |
| F15 | [Distribution — Installation and Workspace Routing](./f15-distribution.md) | 📋 Proposed | Versioned plugin install plus workspace activation/routing across GHCP, Claude Code, and Codex |
| F16 | [azure-functions-doctor — Project Diagnostics](./f16-azure-functions-doctor.md) | ✅ Implemented | Two-tier (built-in + AI) project code/config analysis with CI exit codes |
| F17 | [azure-functions-migrate — Model Migration](./f17-azure-functions-migrate.md) | 📋 Proposed | Guide migration from legacy programming models (v1→v2, v3→v4, in-process→isolated) |
| F18 | [azure-functions-audit — Project Audit](./f18-azure-functions-audit.md) | 📋 Proposed | Static analysis for security, SKU compatibility, and best practices |
| F19 | [MCP Integration](./f19-mcp-integration.md) | 📋 Proposed | Templates MCP server integration for AI-assisted function creation |
| F20 | [CLI & Library](./f20-cli-library.md) | ✅ Implemented | `setup` + `chat` + `build` commands, library exports for VS Code extensions |
| F21 | [Template Apply CLI & Library](./f21-template-apply-cli-library.md) | 📋 Proposed | Manifest-primary template listing and application to reduce MCP token usage |

## Skill Lifecycle Model

Skills are classified into four roles:

| Role | Skills | Purpose |
|------|--------|---------|
| **Entry** | azure-functions-help, azure-functions-setup, azure-functions-discovery | First contact points for users |
| **Task** | azure-functions-create, azure-functions-deploy, azure-functions-observability, azure-functions-hosting, azure-functions-python, azure-functions-node, azure-functions-dotnet, azure-functions-durable, azure-functions-migrate, azure-functions-audit | Concrete work execution |
| **Diagnostic** | azure-functions-doctor | Troubleshooting and project health checks |
| **Transition** | azure-functions-help, functions-copilot agent, post-task-suggester hook | Navigate between skills |
| **Infrastructure** | azure-functions-mcp (MCP Integration) | Connect AI agents to Functions tools |
| **Feedback** | azure-functions-feedback | Route usage data to improvement loops |

## Skill Graph (Initial)

```
azure-functions-help
  → azure-functions-setup
  → azure-functions-discovery

azure-functions-setup
  → azure-functions-create
  → azure-functions-help

azure-functions-discovery
  → azure-functions-deploy
  → azure-functions-observability
  → azure-functions-hosting
  → azure-functions-migrate (if legacy model detected)
  → azure-functions-python / azure-functions-node / azure-functions-dotnet / azure-functions-durable

azure-functions-create
  → azure-functions-deploy
  → azure-functions-observability
  → azure-functions-hosting

azure-functions-deploy
  → azure-functions-observability
  → azure-functions-feedback

azure-functions-observability
  → azure-functions-feedback

azure-functions-hosting
  → azure-functions-deploy
  → azure-functions-feedback

azure-functions-python / azure-functions-node / azure-functions-dotnet
  → azure-functions-deploy
  → azure-functions-observability

azure-functions-durable
  → azure-functions-observability
  → azure-functions-feedback

azure-functions-doctor
  → azure-functions-setup (if environment issues)
  → azure-functions-deploy (if project healthy)

azure-functions-migrate
  → azure-functions-doctor (post-migration validation)
  → azure-functions-deploy

azure-functions-audit
  → azure-functions-deploy (if audit passes)
  → azure-functions-doctor (if critical issues)
```

## Relationship to Draft Spec

The Draft Spec defines the overall vision: a workflow-aware plugin source repo with directed skill graphs. These FRDs break the implementation into shippable units. F1 (Skill Graph Metadata) is the foundation — all other features depend on or extend it.

## Review Findings (from func-emulate)

The following features were identified by reviewing the func-emulate prototype (F18, F20, F21, fnx-diagnostics, fnx-create-function skills) and added as F16–F19:

| FRD | Source | Key Insight |
|-----|--------|-------------|
| F16 (azure-functions-doctor) | fnx F18 + fnx-diagnostics | `azure-functions-setup` (env check) ≠ project diagnostics; `func start` failure diagnosis is a distinct workflow |
| F17 (azure-functions-migrate) | fnx F21 migrate | Legacy model migration (v1→v2, v3→v4) is a top developer pain point with structured patterns |
| F18 (azure-functions-audit) | fnx F21 audit | Pre-deploy static analysis (security, SKU compat) is distinct from post-deploy monitoring (F7) |
| F19 (MCP Integration) | fnx F6/F10/F20 | MCP tools are the bridge between AI agents and Functions templates; skills must reference them |

Existing FRDs were also updated:
- **F3** gained Agent Workspace Configuration (agent detection + skill/MCP auto-placement)
- **F5** gained "Add function to existing project" path with MCP tool integration
- **F14** gained agent path manifest and response language rule injection
