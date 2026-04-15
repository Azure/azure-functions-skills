# F2: af-help — Entry & Navigation

**Status:** 📋 Proposed  
**仮スペック Section:** 4.1, 5, 7.2  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

Developers new to Azure Functions skills don't know which skill to use first, or which skill to use next after completing a task. A static "list of skills" doesn't provide context-aware guidance. Users need an intelligent entry point that understands where they are in their development journey and recommends the right next step.

## Feature

`af-help` is not a traditional help command that dumps a list. It's a **graph navigator** that:

1. Detects the user's current context (tooling installed, project exists, deployment state)
2. Locates their position in the skill graph
3. Recommends the most relevant next skill(s) with reasons
4. Provides a full skill overview when asked

## Behavior

### Context-Aware Responses

| Context | Recommendation |
|---------|---------------|
| No Azure CLI, no Core Tools | "Start with `af-setup` to prepare your environment." |
| Tools installed, no project | "Your environment is ready. Use `af-create` to scaffold a new Functions app." |
| Project exists, not deployed | "You have a Functions project. Use `af-deploy` to deploy, or `af-observability` to set up monitoring first." |
| Project deployed | "Your app is running. Use `af-observability` to verify monitoring, or `af-feedback` to share your experience." |
| Unknown / can't detect | Show full skill catalog grouped by lifecycle role |

### Full Catalog Mode

When context detection fails or when explicitly asked, `af-help` shows skills grouped by lifecycle:

```
Azure Functions Skills

  Getting Started
    af-setup        Verify prerequisites and set up your environment
    af-discovery    Analyze this repo and find relevant skills

  Build
    af-create       Scaffold a new Functions project
    af-python       Python-specific patterns and best practices
    af-node         Node.js/TypeScript patterns and best practices
    af-dotnet       .NET (isolated) patterns and best practices
    af-durable      Durable Functions orchestration patterns

  Ship
    af-deploy       Deploy to Azure
    af-hosting      Compare hosting plans (Flex, Premium, Consumption)
    af-observability  Set up monitoring and alerting

  Improve
    af-feedback     Share feedback to improve these skills
```

## Skill Metadata

```yaml
id: af-help
title: Azure Functions Help & Navigation
intent:
  - get_help
  - list_skills
  - what_next
  - where_to_start
completion_signals:
  - user_navigated_to_skill
  - skill_list_shown
suggestions:
  on_success:
    - target: af-setup
      reason: "New user should start with environment setup."
      priority: 100
    - target: af-discovery
      reason: "If the user already has a project, discover what's relevant."
      priority: 80
  on_failure: []
entry_conditions:
  - always_available
```

## Context Detection Strategy

`af-help` uses lightweight checks (no heavy scanning):

1. **Azure CLI** — `az --version` exit code
2. **Core Tools** — `func --version` exit code
3. **Project detection** — `host.json` exists in current directory
4. **Language detection** — `requirements.txt` (Python), `package.json` with functions references (Node), `*.csproj` with Functions SDK (.NET)
5. **Deployment state** — `.azure/` directory or Azure resource metadata

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill invoked via `@azure-functions help` or slash command |
| Claude Code | Skill file with context detection logic |
| Codex | Agent instruction with help routing |
| Repo Template | `copilot-instructions.md` includes help guidance |

## UX Requirements

- Response must include **why** a skill is recommended, not just the name
- Maximum 3 recommendations in context-aware mode
- Full catalog mode groups by lifecycle role (Entry → Task → Feedback)
- Each skill entry shows a one-line description
