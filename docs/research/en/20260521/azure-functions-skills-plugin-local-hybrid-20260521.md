# Azure Functions Skills: Plugin / Workspace-Local / Hybrid Design Research

Date: 2026-05-21  
Scope: Distribution and startup design for Azure Functions Skills across GitHub Copilot CLI, Claude Code, and Codex.

## Questions Investigated

This research examined three questions for making the Azure Functions Skills repository usable across multiple coding agents.

1. When many skills are installed through a global plugin, how can Claude Code and Codex route users reliably to Azure Functions-specific skills or agents?
2. How should the welcome message, prerequisite check, and first-skill guidance currently expanded by the CLI into workspace-local files work for Claude Code and Codex?
3. How much of the same experience can work as plugin-only, without the CLI?

## Summary

The recommended model is hybrid. Keep the global or user-level plugin as a reusable skill bundle, and place a thin workspace-local activation/routing/policy layer in repositories that should use Azure Functions Skills.

Claude Code can get closer to plugin-only because it has project and local plugin scopes. Codex still benefits strongly from workspace-local files because plugin hooks are opt-in and trust gated, skill listing has a budget, and subagents are not automatically spawned.

## Confirmed Platform Facts

### GitHub Copilot / Agent Skills

GitHub Copilot supports project and personal skills. Project skills can live under `.github/skills`, `.claude/skills`, and `.agents/skills`; personal skills can live under `~/.copilot/skills` and `~/.agents/skills`. Copilot uses `SKILL.md` descriptions to select relevant skills and loads the skill body only when selected.

Copilot CLI can read custom instructions from files such as `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, and `AGENTS.md`. Root `AGENTS.md` and `.github/copilot-instructions.md` can be used together.

### Claude Code

Claude Code plugins can include skills, agents, hooks, MCP servers, and LSP servers. The plugin manifest is `.claude-plugin/plugin.json`, pointing to plugin-root components such as `skills/`, `agents/`, `hooks/`, and `.mcp.json`.

The critical feature is scope. Claude Code plugin enablement can be user, project, local, or managed. Project scope is stored in `.claude/settings.json` and can be committed for team use. Local scope is stored in `.claude/settings.local.json` and is normally gitignored.

Claude skills can come from `.claude/skills/<skill-name>/SKILL.md`, `~/.claude/skills/<skill-name>/SKILL.md`, or plugin `skills/`. `description` and `when_to_use` drive routing. Skill descriptions are listed within a budget; if the budget is exceeded, descriptions can be shortened or omitted. Settings such as `skillListingBudgetFraction`, `maxSkillDescriptionChars`, and `skillOverrides` help manage this. Plugin skills are managed through the plugin surface rather than `skillOverrides`.

Claude custom subagents can be distributed at user, project, or plugin scope. Project subagents live in `.claude/agents/`; plugin subagents are namespaced. A project `.claude/settings.json` can set a default `agent`, and subagents can preload relevant skills through a `skills` field.

Claude hooks can be configured by plugins or project settings. `SessionStart` can support startup guidance and prerequisite checks, but trust and policy behavior must be explicit to users.

### Codex

Codex skills are read from `.agents/skills`, `~/.agents/skills`, admin locations, and system locations. Codex uses progressive disclosure: initial context includes skill name, description, and path; full `SKILL.md` content is read only when selected. The initial skill listing is budgeted, so global plugin pollution can make descriptions shorter or omit some skills.

Codex plugins use `.codex-plugin/plugin.json` and can include `skills/`, `hooks/`, `.mcp.json`, and `.app.json`. Repo marketplaces live at `$REPO_ROOT/.agents/plugins/marketplace.json`; personal marketplaces live at `~/.agents/plugins/marketplace.json`.

Codex hooks can come from user or repo `.codex/hooks.json` files. Project-local hooks require workspace trust, and plugin-bundled hooks require `[features].plugin_hooks = true`. A `SessionStart` hook can add developer context through stdout or JSON `hookSpecificOutput.additionalContext`, but plugin-only first-run behavior remains uncertain because users must enable and trust hooks.

Codex custom agents live in `~/.codex/agents/` or `.codex/agents/`, but Codex does not automatically spawn subagents. For routing, `AGENTS.md` and skill descriptions matter more.

## Current Repository Observations

`azure-functions-skills/` is already close to a hybrid model.

- Canonical sources live under `templates/`.
- `src/build/build-target.ts` generates workspace-local artifacts for `ghcp`, `claude`, and `codex`.
- The same build target generates plugin payloads.
- `src/setup/index.ts` copies workspace-local files and runs prerequisite checks.
- `src/chat/index.ts` auto-runs setup when needed and passes a startup prompt to the selected CLI agent.
- `README.md` already describes plugin, chat, and setup entry points.

Current plugin payload shape:

```text
.github/plugins/azure-functions-skills/
  plugin.json
  .plugin/plugin.json
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
  skills/<skill-id>/SKILL.md
  agents/functions-copilot.agent.md
  hooks.json
  .mcp.json
```

Current workspace-local setup roughly emits:

```text
GitHub Copilot:
  .github/copilot-instructions.md
  .github/agents/functions-copilot.agent.md
  .github/skills/<skill-id>/SKILL.md
  .github/hooks/welcome-setup.json
  .vscode/mcp.json
  AGENTS.md

Claude Code:
  CLAUDE.md
  .claude/settings.json
  .claude/skills/<skill-id>/SKILL.md

Codex:
  AGENTS.md
  .agents/skills/<skill-id>/SKILL.md
  .codex/config.toml
  .codex/hooks.json
```

The shape is directionally good, but official platform behavior suggests improvements.

- The Claude plugin manifest currently does not expose `agents`. If a Claude equivalent of `functions-copilot` should ship in the plugin, `.claude-plugin/plugin.json` should include agents after E2E validation.
- Claude workspace-local output currently inlines all skill bodies into `CLAUDE.md`, which increases always-on context cost. `CLAUDE.md` should be thin routing and startup guidance; full skill bodies should remain in `.claude/skills`.
- Codex plugin manifest includes `agents`, but Codex plugin documentation primarily focuses on skills, MCP, apps, and hooks. Codex custom agents are normally `.codex/agents/*.toml`; plugin agent support should be validated.
- A single shared `hooks.json` across GHCP, Claude, and Codex is risky because hook schemas differ. Host-specific hook generation is safer.
- `generateCodexHooks()` currently assumes `bash -c`, which weakens Windows support. A Node script or PowerShell fallback is preferable.

## Routing Under Global Plugin Install

### GitHub Copilot

The existing `functions-copilot.agent.md` is a clear router agent. Users can use `copilot --agent functions-copilot` or `@functions-copilot`. This should remain.

Workspace-local `.github/agents/functions-copilot.agent.md` anchors Azure Functions routing in the project, even if users have many global skills installed.

### Claude Code

Three layers are possible:

1. Plugin skills only: namespaced plugin skills reduce collisions, but routing still depends on descriptions and listing budget.
2. Plugin agent: ship a `functions-copilot` equivalent under `agents/`, invoked explicitly or configured as project default.
3. Project-local agent/instructions: use `.claude/agents/functions-copilot.md` and `CLAUDE.md` as routing anchors.

Recommended: keep reusable skills and an optional router agent in the plugin, then use workspace-local `.claude/settings.json` and/or `.claude/agents/functions-copilot.md` to make routing explicit. Claude's project/local plugin scope makes a pinned-reference mode realistic.

### Codex

Codex should primarily route through `AGENTS.md` and skill descriptions, not through a plugin agent.

Recommended combination:

- Add short Azure Functions routing guidance to root `AGENTS.md`.
- Use `.agents/skills/<skill-id>/SKILL.md` in copy mode, or reference namespaced plugin skills in `AGENTS.md` when plugin mode is used.
- Leave room in `.codex/config.toml` for skill disablement or MCP policy.
- Add `.codex/agents/functions-copilot.toml` only for explicit subagent use.

## Welcome, Prerequisite Checks, and Initial Guidance

The current CLI approach remains the most reliable: `setup` writes workspace-local files, and `chat` passes a startup prompt directly to the agent CLI.

### GitHub Copilot

Use `.github/hooks/welcome-setup.json` and `.github/copilot-instructions.md`, but do not rely only on hooks. Keep equivalent guidance in the `chat` startup prompt and `azure-functions-setup` skill.

### Claude Code

Possible mechanisms:

1. Thin `CLAUDE.md` first-run guidance.
2. Project `.claude/settings.json` hooks such as `SessionStart`.
3. Plugin hooks.

Recommended: thin workspace-local `CLAUDE.md` plus optional project hook for deterministic prerequisite context injection. Avoid large inline skill bodies.

### Codex

Codex can use `.codex/hooks.json` `SessionStart` to add welcome and prerequisite context. However, project hooks require trust and plugin hooks require `[features].plugin_hooks = true`.

Recommended:

- `chat` passes startup prompt directly.
- `setup` generates `.codex/hooks.json` and `AGENTS.md`.
- Plugin-only documents hook enablement as optional, not required.

## Plugin-Only Capabilities and Limits

Plugin-only can distribute skills, MCP config, and optional hooks. Claude Code can avoid some global pollution with project/local plugin scope. Codex can expose plugins through a repo marketplace.

Plugin-only struggles with:

- Deterministically stating that the workspace is an Azure Functions project.
- Running hooks from the first session without user trust/configuration.
- Always showing a user-visible welcome and prerequisite result.
- Ensuring Azure Functions skills remain visible under large global skill lists.
- Tailoring guidance to local runtime, trigger, or `host.json` detection.

Plugin-only is good for users who already know the plugin. First-run onboarding and reliable routing still need workspace-local activation.

## Recommended Architecture

1. Treat plugin payload as a reusable skills pack.
2. Keep workspace-local activation thin.
3. Optimize router agents and instructions per host.
4. Generate hooks per host, backed by shared scripts.
5. Keep `chat` as a reliable first-run path.

## Next Actions

1. Validate adding `agents` to the Claude plugin manifest.
2. Thin Claude workspace-local output so `CLAUDE.md` no longer inlines full skill content.
3. Validate Codex plugin `agents` behavior; use `.codex/agents/*.toml` if needed.
4. Split hook generation by host.
5. Design pinned-reference mode.
6. Tighten skill descriptions for listing-budget behavior.

## Recommended User Experience

First-time users should use CLI flows:

```bash
npx @agent-loom/azure-functions-skills chat --agent codex --dir ./my-app
```

or:

```bash
npx @agent-loom/azure-functions-skills setup --agent codex --dir ./my-app
codex "set up Azure Functions"
```

Existing users or teams can use plugin installation plus thin workspace guidance.

```bash
claude plugin install azure-functions-skills@<marketplace> --scope project
```

Even then, repositories should include thin `AGENTS.md` / `CLAUDE.md` routing to identify the workspace as Azure Functions-related.

## Final Conclusion

The hybrid recommendation is sound. Claude Code can move closer to pinned-reference or project-plugin mode because it has official project/local plugin scopes. Codex should retain workspace-local `AGENTS.md` and optional `.codex/hooks.json` because skill budgets, plugin hook opt-in, hook trust, and explicit subagent spawning make plugin-only routing less reliable.
