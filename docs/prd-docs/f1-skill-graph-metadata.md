# F1: Skill Graph Metadata

**Status:** 📋 Proposed  
**仮スペック Section:** 2, 3  
**Depends on:** None (foundation)

## Problem

Traditional skill/plugin catalogs are flat lists — users must know which skill they need before they can use it. This creates a discoverability gap: a developer who just set up their environment doesn't know that the next logical step is `af-create`, or that after deployment they should configure observability.

There's no machine-readable way to express "after this skill completes, suggest these next skills."

## Feature

A canonical graph metadata model where each skill declares:

- **Intent** — what the skill solves
- **Entry conditions** — when the skill should be suggested
- **Completion signals** — how to detect the skill succeeded
- **Suggestions** — directed edges to next skills on success/failure
- **Priority** — relative weight for ordering suggestions

This metadata is the **source of truth** before any target-specific generation. The build system reads it and embeds transition information into GHCP skills, Claude plugins, Codex agents, hooks, and repo templates.

## Schema

Each skill maintains a `graph.yaml` (or integrated into `skill.yaml`) with this structure:

```yaml
id: <skill-id>
title: <human-readable title>
intent:
  - <user_intent_1>
  - <user_intent_2>
completion_signals:
  - <signal_1>
  - <signal_2>
suggestions:
  on_success:
    - target: <skill-id>
      reason: "<why this is the logical next step>"
      priority: <0-100>
  on_failure:
    - target: <skill-id>
      reason: "<why this fallback makes sense>"
      priority: <0-100>
entry_conditions:
  - <condition_1>
  - <condition_2>
```

## Examples

### af-setup

```yaml
id: af-setup
title: Azure Functions Setup
intent:
  - verify_tooling
  - onboard_user
completion_signals:
  - azure_cli_available
  - core_tools_available
  - language_runtime_detected
suggestions:
  on_success:
    - target: af-create
      reason: "The environment is ready. The next logical step is to create a new Azure Functions app."
      priority: 100
    - target: af-help
      reason: "If the user is unsure what to do next, provide guided options."
      priority: 60
  on_failure:
    - target: af-help
      reason: "Setup could not be completed. Route to troubleshooting guidance."
      priority: 100
entry_conditions:
  - user_is_new
  - tooling_unknown
```

### af-create

```yaml
id: af-create
title: Create Azure Functions App
intent:
  - scaffold_project
  - choose_language
  - choose_template
completion_signals:
  - function_project_created
suggestions:
  on_success:
    - target: af-deploy
      reason: "A project exists. Offer deployment next."
      priority: 100
    - target: af-observability
      reason: "Offer monitoring setup before or after deployment."
      priority: 70
    - target: af-help
      reason: "Provide other common next steps."
      priority: 40
  on_failure:
    - target: af-setup
      reason: "Creation failure may be caused by missing prerequisites."
      priority: 70
```

## Schema Rules

1. `id` must be unique across all skills and match the directory name
2. `intent` values are free-form but should use snake_case
3. `completion_signals` are semantic — detected by the skill itself, not the graph engine
4. `suggestions.on_success` is ordered by `priority` descending; consumers show top 3 max
5. `suggestions.on_failure` always includes a fallback to `af-help` or `af-setup`
6. `entry_conditions` inform the `functions-guide` agent and `af-help` skill

## Graph Constraints

- The graph must be **connected** — every skill must be reachable from `af-help`
- No orphan skills — every skill must have at least one inbound edge
- Maximum 3 `on_success` suggestions per skill (prevents cognitive overload)
- Failure paths must converge to entry skills (af-help, af-setup)

## Build Integration

The build system (F14) reads all `graph.yaml` files and:

1. Validates graph connectivity and constraint compliance
2. Generates a merged `graph-manifest.json` for runtime consumers
3. Embeds next-step suggestions into each skill's output text
4. Generates routing tables for the `functions-guide` agent (F12)
5. Generates hook mappings for `post-task-suggester` (F13)

## Future Extensions

- Conditional edges (e.g., suggest `af-python` only if Python runtime detected)
- Weight learning from usage telemetry (F11: af-feedback)
- Visual graph explorer in `af-help`
