# F4: azure-functions-discovery — Project Analysis

**Status:** 📋 Proposed  
**Draft Spec Section:** 4.1, 6, 8  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

When a developer opens an existing Azure Functions project, they don't know which skills are relevant to their codebase. A Python Durable Functions app needs different guidance than a Node.js HTTP-only app. Without project analysis, users must manually browse the skill catalog and guess what applies.

## Feature

`azure-functions-discovery` scans the current project and recommends the most relevant skills based on what it finds. It serves as the "intelligent starting point" for existing projects (as opposed to `azure-functions-setup` for new environments).

## Analysis Points

| Signal | Detection | Skill Recommended |
|--------|-----------|------------------|
| `host.json` exists | File exists check | Confirms this is a Functions project |
| `requirements.txt` / `function_app.py` | File exists | azure-functions-python |
| `package.json` with `@azure/functions` | Package dependency check | azure-functions-node |
| `*.csproj` with Functions Worker SDK | MSBuild project scan | azure-functions-dotnet |
| `pom.xml` with Functions Maven plugin | Maven POM scan | (Java — future) |
| Durable Functions imports | Code pattern scan | azure-functions-durable |
| `host.json` extension bundles | JSON field check | Extension bundle version guidance |
| `.azure/` directory | Directory exists | azure-functions-deploy (already deployed) |
| Application Insights key | Config scan | azure-functions-observability |
| No monitoring config | Absence check | azure-functions-observability (recommend setup) |
| Multiple functions detected | Function count | azure-functions-hosting (scaling considerations) |

## Output Format

```
Azure Functions Project Discovery

  Project: ./my-functions-app
  Language: Python (v2 programming model)
  Functions: 4 (3 HTTP, 1 Timer)
  Host: v4 (extension bundle 4.x)
  Deployment: Not detected

Recommended Skills:
  1. azure-functions-deploy — Your project has no deployment configuration. Set up Azure deployment.
  2. azure-functions-observability — No Application Insights configured. Add monitoring before going to production.
  3. azure-functions-python — Python-specific tips for v2 programming model and async patterns.

  Run any skill name to get started.
```

## Skill Metadata

```yaml
id: azure-functions-discovery
title: Azure Functions Project Discovery
intent:
  - analyze_project
  - find_relevant_skills
  - understand_codebase
completion_signals:
  - project_analyzed
  - skills_recommended
suggestions:
  on_success:
    - target: azure-functions-deploy
      reason: "Most projects need deployment guidance."
      priority: 90
    - target: azure-functions-observability
      reason: "Observability is critical for production readiness."
      priority: 80
    - target: azure-functions-hosting
      reason: "Hosting plan choice affects cost and performance."
      priority: 60
  on_failure:
    - target: azure-functions-setup
      reason: "If no project is detected, the user may need environment setup."
      priority: 80
    - target: azure-functions-create
      reason: "If the directory is empty, suggest creating a new project."
      priority: 90
entry_conditions:
  - existing_project
  - repo_opened
```

## Behavior

### Scan Depth

`azure-functions-discovery` performs lightweight scanning only:

- File existence checks (not full AST parsing)
- `package.json` / `requirements.txt` dependency checks (top-level only)
- `host.json` field extraction
- Pattern matching for Durable Functions imports (regex, not full code analysis)

This keeps execution fast (< 2 seconds) and avoids reading sensitive files.

### Priority Ranking

Recommendations are sorted by:

1. **Missing critical items** (no deployment config, no monitoring) — highest priority
2. **Language-specific guidance** — medium priority
3. **Optimization opportunities** (hosting plan, scaling) — lower priority

Maximum 3 recommendations shown. Full list available via `azure-functions-help`.

### No Project Detected

If the directory has no `host.json`, `azure-functions-discovery` outputs:

```
No Azure Functions project detected in this directory.

Suggestions:
  → azure-functions-create: Scaffold a new Azure Functions project here.
  → azure-functions-setup: Verify your development environment is ready.
```

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill scans workspace via file checks and reports |
| Claude Code | Skill with file system access for project analysis |
| Codex | Agent instruction with project detection heuristics |
| Repo Template | Auto-discovery note in `copilot-instructions.md` |
