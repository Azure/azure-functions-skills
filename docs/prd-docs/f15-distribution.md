# F15: Distribution — Installation and Workspace Routing

**Status:** Proposed  
**Draft Spec Section:** 10, 11  
**Depends on:** F14 (Build System), F20 (CLI & Library)  
**Research:** ../research/en/20260521/azure-functions-skills-installation-routing-design-20260521.md

## Problem

Azure Functions Skills need to be distributed across GitHub Copilot CLI, Claude Code, and Codex without assuming that a single plugin install means the workspace is fully configured.

The previous distribution design treated plugin packaging and repo templates as the primary split. Current platform behavior shows a sharper boundary:

- Plugin installation registers a reusable, versioned payload with the agent.
- Workspace files decide whether and how that payload is activated for a specific repository.

Plugin-only install is insufficient for deterministic project behavior because it does not reliably configure repository routing, custom instructions, default or recommended agents, MCP policy, hook trust, or customer-owned instruction files. It can also create context pollution when user-level plugins expose broad skills, hooks, MCP servers, or agents in unrelated repositories.

The repository needs a distribution model that:

- Installs reusable Azure Functions skills as a versioned plugin payload.
- Applies workspace routing and policy explicitly.
- Supports direct agent-native plugin commands and CLI-mediated install flows.
- Avoids overwriting `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, and other customer-owned files.
- Makes MCP, hooks, and router agents opt-in instead of default-on.
- Gives reviewers a transparent `--dry-run` before commands or file writes run.

## Goals

- Provide one conceptual model across GitHub Copilot CLI, Claude Code, and Codex: **Plugin Skills Pack + Workspace Activation Pack**.
- Keep plugin payload skills-only by default.
- Add a workspace apply/update flow that can be used after CLI-mediated or direct plugin installation.
- Preserve the current workspace-local `setup` and `chat` paths for first-run onboarding.
- Support project-scoped declarations where agents provide them, while documenting when installation still lands in a user cache.
- Make all generated workspace changes merge-safe and reviewable.

## Non-Goals

- Do not force MCP, hooks, or router agents to be enabled for every plugin install.
- Do not treat GitHub Copilot plugin project scope as a physical project install unless the platform adds and documents that capability.
- Do not inline full skill bodies into `CLAUDE.md` or `AGENTS.md` by default.
- Do not put subscription IDs, resource group names, secrets, or local environment assumptions in plugin payload.

## Feature

Introduce a distribution and activation strategy with three parts.

1. **Plugin Skills Pack**: a reusable versioned plugin containing Azure Functions skills and optional host-specific artifacts.
2. **Workspace Activation Pack**: thin repository files that route Azure Functions work to the installed plugin or copied skills and declare optional policy.
3. **CLI Orchestrator / Workspace Applier**: commands that run native plugin install flows and apply or update workspace routing with safe merge behavior.

## Architecture

### Plugin Skills Pack

Default payload:

```text
plugin/
  plugin.json or .plugin/plugin.json
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
  skills/
    azure-functions-setup/SKILL.md
    azure-functions-create/SKILL.md
    azure-functions-deploy/SKILL.md
    azure-functions-diagnostics/SKILL.md
    azure-functions-best-practices/SKILL.md
    azure-functions-health-status/SKILL.md
    azure-functions-inventory/SKILL.md
    azure-functions-feedback/SKILL.md
    azure-functions-common/SKILL.md
```

Default excluded or inactive artifacts:

```text
agents/                  # enabled by --include-agent
hooks.json / hooks/       # enabled by --include-hooks
.mcp.json                 # enabled by --include-mcp
```

The default plugin payload should be skills-only because skill content is loaded progressively. MCP servers, hooks, and agents affect the always-visible tool, lifecycle, or routing surface and should require explicit opt-in.

### Workspace Activation Pack

Workspace activation declares how the repository uses Azure Functions Skills.

GitHub Copilot CLI:

```text
.github/copilot/settings.json          # plugin marketplace / enabledPlugins / disabledSkills, optional
.github/agents/functions-copilot.agent.md
.github/copilot-instructions.md        # thin routing only
.github/hooks/welcome-setup.json       # opt-in setup mode only
.vscode/mcp.json                       # VS Code MCP, opt-in
AGENTS.md                              # optional cross-agent fallback
```

Claude Code:

```text
CLAUDE.md                              # thin routing only
.claude/settings.json                  # project plugin enablement / optional default agent / MCP policy
.claude/settings.local.json            # personal local opt-in, not committed
.claude/skills/                        # copy-mode fallback only
```

Codex:

```text
AGENTS.md                              # primary routing anchor
.agents/plugins/marketplace.json       # repo-curated plugin catalog
.codex/config.toml                     # MCP / hooks / skill policy, opt-in
.codex/hooks.json                      # setup mode only, trust gated
.agents/skills/                        # copy-mode fallback only
```

## Supported Modes

### Mode A: `chat`

`chat` is not plugin-based. It should install or update the required workspace-local Azure Functions skills and routing files, run prerequisite checks, and launch the selected agent CLI with a startup prompt.

```bash
npx @agent-loom/azure-functions-skills chat --agent github-copilot --dir ./my-app
npx @agent-loom/azure-functions-skills chat --agent claude-code --dir ./my-app
npx @agent-loom/azure-functions-skills chat --agent codex --dir ./my-app
```

Options:

| Option | Meaning |
| --- | --- |
| `--agent github-copilot|claude-code|codex` | Agent CLI to launch |
| `--dir <path>` | Target workspace |
| `--prompt <text>` | Override startup prompt |
| `--workspace-mode minimal|copy|plugin-reference` | Workspace application mode before chat |
| `--skip-prerequisites` | Skip prerequisite checks |
| `--check-prerequisites` | Check prerequisites only |
| `--` | Pass remaining arguments to the agent CLI |

### Mode B: `setup` / `workspace apply`

`setup` remains the workspace-local installation path. `workspace apply` should become the clearer command name or alias.

```bash
npx @agent-loom/azure-functions-skills setup --agent ghcp --dir ./my-app
npx @agent-loom/azure-functions-skills setup --agent claude --dir ./my-app
npx @agent-loom/azure-functions-skills setup --agent codex --dir ./my-app
```

Recommended options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--agent ghcp|claude|codex|all` | auto | Agent surface to configure |
| `--dir <path>` | cwd | Target workspace |
| `--mode minimal|copy|plugin-reference` | `copy` for compatibility | `minimal` writes routing only, `copy` copies skills, `plugin-reference` writes routing and settings for an installed plugin |
| `--update` | false | Update an existing managed block |
| `--dry-run` | false | Show planned writes without mutating files |
| `--merge-strategy managed-block|include-file|fail-if-exists|append` | `managed-block` | How to merge with customer-owned instruction files |
| `--include-mcp` | false | Add workspace-level MCP |
| `--include-hooks` | false | Add workspace-level hooks |
| `--force` | false | Allow overwrite or conflict resolution when explicitly requested |

`workspace apply --mode plugin-reference` should write only routing, settings, marketplace references, and managed instruction blocks. It must not copy skill bodies.

```bash
npx @agent-loom/azure-functions-skills workspace apply --agent ghcp --mode plugin-reference --dir ./my-app
npx @agent-loom/azure-functions-skills workspace apply --agent claude --mode plugin-reference --dir ./my-app
npx @agent-loom/azure-functions-skills workspace apply --agent codex --mode plugin-reference --dir ./my-app
```

### Mode C: `plugin install`

`plugin install` is the CLI-mediated path for native plugin installation plus optional workspace activation.

```bash
npx @agent-loom/azure-functions-skills plugin install --agent github-copilot --scope user
npx @agent-loom/azure-functions-skills plugin install --agent claude-code --scope project --dir ./my-app
npx @agent-loom/azure-functions-skills plugin install --agent codex --scope project --dir ./my-app
```

Common options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--agent github-copilot|claude-code|codex|all` | auto | Install target |
| `--scope user|project|local|managed` | agent default | Plugin registration scope. For Copilot, `project` means repo settings declaration. |
| `--dir <path>` | cwd | Target workspace for project/local scope |
| `--source marketplace|github|git|local|npm` | marketplace | Plugin source |
| `--version <semver|tag|sha>` | latest | Pin version |
| `--workspace apply|skip|prompt` | prompt | Whether to apply workspace activation after plugin install |
| `--workspace-mode minimal|plugin-reference|copy` | minimal | Workspace activation content |
| `--include-agent` | false | Enable plugin or workspace agent |
| `--include-mcp` | false | Enable MCP |
| `--include-hooks` | false | Enable hooks |
| `--dry-run` | false | Show planned commands and file diff |

`plugin install --workspace apply` should call the same implementation as `workspace apply --mode plugin-reference` after plugin registration.

Dry-run example:

```text
Planned actions:
  Commands:
    - claude plugin install azure-functions-skills@azure-functions-skills --scope project
  Workspace files:
    - update .claude/settings.json: enabledPlugins / extraKnownMarketplaces
    - update CLAUDE.md: replace managed block azure-functions-skills
  Not enabled:
    - MCP servers (--include-mcp not set)
    - hooks (--include-hooks not set)
    - plugin agent (--include-agent not set)
```

### Mode D: direct plugin commands

Direct plugin commands remain supported and documented, but they must be followed by workspace apply guidance.

GitHub Copilot CLI:

```bash
copilot plugin marketplace add Azure/azure-functions-skills
copilot plugin install azure-functions-skills@azure-functions-skills
copilot --agent azure-functions-skills:functions-copilot
npx @agent-loom/azure-functions-skills workspace apply --agent ghcp --mode plugin-reference --dir ./my-app
```

Claude Code:

```bash
claude plugin install azure-functions-skills@azure-functions-skills --scope project
npx @agent-loom/azure-functions-skills workspace apply --agent claude --mode plugin-reference --dir ./my-app
```

Codex:

```bash
codex plugin marketplace add Azure/azure-functions-skills --sparse .github/plugins
npx @agent-loom/azure-functions-skills workspace apply --agent codex --mode plugin-reference --dir ./my-app
```

### Mode E: `plugin update` / `workspace update`

Updates should cover both plugin registration and workspace activation files.

```bash
npx @agent-loom/azure-functions-skills plugin update --agent all --dir ./my-app
npx @agent-loom/azure-functions-skills workspace update --agent all --dir ./my-app
```

Only opt-in MCP and hook files should be updated. Existing managed blocks should be replaced only under `--update` semantics, and customer content outside managed blocks must remain unchanged.

## Agent-Specific Behavior

### GitHub Copilot CLI

For Copilot, `--scope project` means generating repository settings, not physically installing the plugin into the project.

```json
{
  "extraKnownMarketplaces": {
    "azure-functions-skills": {
      "source": {
        "source": "github",
        "repo": "Azure/azure-functions-skills"
      }
    }
  },
  "enabledPlugins": {
    "azure-functions-skills@azure-functions-skills": true
  }
}
```

Implementation notes:

- README must state that installed Copilot plugin files live in the user plugin cache.
- README must show explicit agent selection after plugin install.
- The installed plugin agent may need a qualified ID such as `azure-functions-skills:functions-copilot`.
- MCP stays off by default.
- Use narrow descriptions and project routing to control side-effect skills because a confirmed Copilot per-skill manual-only frontmatter was not identified.

### Claude Code

Claude Code supports project-scoped plugin enablement directly.

```bash
claude plugin install azure-functions-skills@azure-functions-skills --scope project
```

Workspace apply should update `.claude/settings.json` and a thin managed block in `CLAUDE.md`. It must not inline full skill bodies into `CLAUDE.md`.

```md
<!-- azure-functions-skills:start -->
# Azure Functions Skills

For Azure Functions setup, create, deploy, diagnostics, inventory, health, and best-practices tasks, prefer the Azure Functions Skills plugin. Route deployment through azure-functions-deploy, diagnostics through azure-functions-diagnostics, and static inventory through azure-functions-inventory.
<!-- azure-functions-skills:end -->
```

Implementation notes:

- Replace any primary README path based on `claude --add-dir` with `claude plugin install ... --scope project|user|local`.
- Mention `claude plugin details` for component and token cost inspection.
- Emit `disable-model-invocation: true` through target-specific generation for Claude side-effect skills where appropriate.

### Codex

Codex should use repo marketplace declarations for project distribution.

```json
{
  "name": "azure-functions-skills",
  "interface": {
    "displayName": "Azure Functions Skills"
  },
  "plugins": [
    {
      "name": "azure-functions-skills",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/Azure/azure-functions-skills.git",
        "path": "./.github/plugins/azure-functions-skills",
        "ref": "v0.12.1"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Development"
    }
  ]
}
```

Workspace apply should update `AGENTS.md` with a thin managed block.

```md
<!-- azure-functions-skills:start -->
# Azure Functions Skills

For Azure Functions work, use the Azure Functions Skills plugin or repo-local `.agents/skills` entries. Prefer setup/create/deploy/diagnostics/best-practices skills by intent. Do not treat generic Azure tasks as Azure Functions tasks unless the user mentions Function Apps, triggers, bindings, host.json, or Functions deployment/runtime errors.
<!-- azure-functions-skills:end -->
```

Implementation notes:

- Codex plugin hooks require `[features].plugin_hooks = true`; keep them off by default.
- Emit `agents/openai.yaml` with `policy.allow_implicit_invocation: false` for side-effect skills where appropriate.
- Keep skill descriptions narrow because Codex has an explicit skill listing budget.

## Merge Strategy

Generated changes to `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` must use one of the supported strategies.

Default: `managed-block`

```md
<!-- azure-functions-skills:start version=0.12.1 -->
...
<!-- azure-functions-skills:end -->
```

Rules:

1. Append the block when it does not exist.
2. Replace only the block on `--update`.
3. Never change content outside the block.
4. Fail on conflicts and suggest `--force` or `--merge-strategy include-file`.

Alternative: `include-file`

```md
See .azure-functions-skills/CLAUDE.azure-functions.md for Azure Functions routing.
```

`fail-if-exists` is useful for strict repositories that require humans to merge generated guidance manually.

## Context Pollution Controls

| Risk | Default control | Opt-in |
| --- | --- | --- |
| Skill listing pollution | Skills-only plugin, narrow descriptions, workspace routing | `--mode copy` when needed |
| Instruction pollution | Do not inline skill bodies into instruction files | Advanced verbose instructions only |
| MCP tool pollution | Exclude MCP from default plugin enablement | `--include-mcp` |
| Hook pollution | Plugin hooks off by default; workspace hooks setup-only | `--include-hooks` |
| Agent pollution | Plugin agent off by default; explicit agent selection | `--include-agent` |
| Duplicate skills | Document project skills override plugin skills | Future cleanup command |

## Acceptance Criteria

- `plugin install --dry-run` prints planned native commands and file changes without executing commands or writing files.
- `workspace apply --mode plugin-reference --dry-run` prints all planned workspace changes and includes MCP/hooks/agent opt-in state.
- `workspace apply --mode plugin-reference` does not copy skill bodies.
- Existing `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` content outside the managed block is preserved.
- Direct plugin command documentation includes the follow-up `workspace apply --mode plugin-reference` step for each agent.
- GitHub Copilot project scope is documented as repository settings declaration, not physical project plugin install.
- Claude Code project install uses `claude plugin install ... --scope project` as the primary plugin path.
- Codex project distribution writes or updates a repo marketplace entry instead of relying only on personal marketplace state.
- MCP, hooks, and router agents are disabled by default and require `--include-mcp`, `--include-hooks`, or `--include-agent`.
- `chat` remains usable without plugin install and continues to support first-run onboarding.

## Implementation Notes

Existing `setup --as-plugin` and `chat --as-plugin` behavior should be redesigned to match this specification.

Required implementation work:

1. Add or formalize `workspace apply/update` commands.
2. Add `plugin install/update` commands that wrap native agent plugin flows.
3. Refactor `--as-plugin` into explicit install and workspace activation semantics.
4. Add a shared dry-run planner that covers commands, file writes, merge diffs, and opt-in state.
5. Make generated `CLAUDE.md` and `AGENTS.md` thin by default.
6. Add managed-block merge utilities and tests.
7. Split plugin payload variants into `skills-only` and advanced/full variants.
8. Generate host-specific hook files instead of assuming one hook schema works everywhere.
9. Add E2E scenarios for Copilot qualified-agent selection, Claude project plugin install, Codex repo marketplace install, merge safety, dry-run output, and direct plugin command followed by workspace apply.

## Open Questions

- If Copilot adds native project-scoped plugin install later, should `--scope project` switch from repository settings declaration to native project install?
- Should Azure MCP be omitted from the default plugin payload entirely, or included but disabled until `--include-mcp`?
- How much should this CLI automate installation of the Azure Skills plugin required by `azure-functions-deploy`?
- Should manual-only metadata live in shared skill source or be emitted through target-specific generation?
