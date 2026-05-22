# Azure Functions Skills Installation and Routing Design

Date: 2026-05-21  
Scope: Azure Functions Skills distribution, workspace application, and plugin installation flows for GitHub Copilot CLI, Claude Code, and OpenAI Codex.

## Design Concept

The core design principle is to separate the responsibilities of **plugins** and **workspace-local files**.

- **Plugins** distribute the reusable Azure Functions Skills payload as a versioned package.
- **Workspace-local files** decide how that payload is activated in a specific workspace: routing, policy, project-specific wiring, and optional MCP or hook enablement.

This separation is necessary because plugin installation alone cannot express project-specific intent such as "prefer Azure Functions workflows in this workspace", "route through this agent surface", or "enable MCP and hooks only at this scope". Direct plugin commands primarily register the plugin payload, which should be treated as a skills pack. Workspace-side files such as `CLAUDE.md`, `AGENTS.md`, Copilot agent definitions, repository settings, and MCP policy must be applied separately.

Recommended shape:

```text
plugin install         # Register the versioned skills pack with the agent
workspace apply/update # Apply routing, activation, and policy to the workspace
```

This gives users the benefits of standard plugin distribution and managed updates while reducing context pollution, skill overflow, accidental routing, and overwrites of customer-owned instruction files.

Design principles:

1. **Default plugin payload should be skills-only**: Skills use progressive disclosure across Copilot, Claude, and Codex. MCP servers, hooks, and agents affect always-visible tools, lifecycle behavior, and routing. They should be opt-in through flags such as `--include-mcp`, `--include-hooks`, and `--include-agent`.

2. **Workspace routing belongs on each agent's native surface**:
   - GitHub Copilot CLI: `.github/agents/functions-copilot.agent.md` and `.github/copilot/settings.json`.
   - Claude Code: `CLAUDE.md`, optionally `.claude/settings.json` for project plugin enablement or a default agent.
   - Codex: `AGENTS.md`, optionally `.agents/plugins/marketplace.json` and `.codex/config.toml`.

3. **Direct plugin commands must be followed by workspace apply guidance**: Direct plugin commands only register the plugin payload. Routing and workspace policy for MCP or hooks remain unset. README and CLI output should explicitly instruct users to run `azure-functions-skills workspace apply --mode plugin-reference` after direct plugin installation.

4. **The CLI should orchestrate install and workspace application**: Users should not need to memorize each agent's plugin semantics. `azure-functions-skills plugin install` and `azure-functions-skills workspace apply` should absorb the differences between Copilot, Claude, and Codex.

5. **Never overwrite customer-owned workspace files**: `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` are core project files. The CLI should support managed blocks, include files, or fail-if-exists behavior.

6. **Use `--dry-run` for transparency**: Plugin installation and workspace application differ by agent. `--dry-run` should show planned shell commands, files to generate or modify, merge diffs, and whether MCP, hooks, or agents are enabled.

## Current Documentation Facts

### GitHub Copilot CLI

- `copilot plugin install SPECIFICATION` accepts marketplace entries, GitHub repositories, repository subdirectories, Git URLs, and local paths.
- Installed plugin files live under `~/.copilot/installed-plugins/...`.
- Repository settings live at `.github/copilot/settings.json` and can declare `enabledPlugins` and `extraKnownMarketplaces`.
- Local overrides live at `.github/copilot/settings.local.json`.
- Settings cascade from user to repository to local. Repository settings override user settings for the same key; local settings override repository settings.
- Project-level agents and skills take precedence over plugin-provided ones. Plugin skills come after project and user skills.
- MCP definitions can affect the tool surface globally when enabled through user or plugin scope, so MCP tool pollution is a concern.
- `gh skill install` supports `--agent` and `--scope project|user`; the default scope is `project` and the default agent is `github-copilot`.

### Claude Code

- Plugin install scopes are `user`, `project`, `local`, and `managed`.
- `claude plugin install <plugin> --scope project` writes plugin enablement into `.claude/settings.json`.
- `enabledPlugins` and `extraKnownMarketplaces` are supported in settings.
- Plugins can include skills, agents, hooks, MCP servers, LSP servers, monitors, and themes.
- A plugin-root `CLAUDE.md` is not loaded as project context.
- `claude plugin details` can show component inventory and token cost.
- Claude has relatively mature controls for context pollution, including `skillOverrides`, `skillListingBudgetFraction`, and `maxSkillDescriptionChars`.

### Codex

- Skills are loaded from repository `.agents/skills`, user `~/.agents/skills`, admin `/etc/codex/skills`, and system-bundled locations.
- The initial skill listing has a budget of roughly 2% of the context window, or 8,000 characters when the context window is unknown. Large skill sets can shorten or omit descriptions.
- `agents/openai.yaml` supports `policy.allow_implicit_invocation: false` for manual-only skills.
- Plugins use `.codex-plugin/plugin.json` and can include `skills/`, `hooks/`, `.mcp.json`, `.app.json`, and `assets/`.
- Repo marketplaces live at `$REPO_ROOT/.agents/plugins/marketplace.json`; personal marketplaces live at `~/.agents/plugins/marketplace.json`.
- Installed plugin copies live under `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`.
- Plugin enablement state is stored in `~/.codex/config.toml`.
- Plugin-bundled hooks require `[features].plugin_hooks = true`.

## Distribution Model

### 1. Plugin Skills Pack

Purpose: distribute reusable Azure Functions workflows as a versioned package.

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

Not enabled by default, or shipped only in advanced/full payloads:

```text
agents/                  # Enabled by --include-agent
hooks.json / hooks/       # Enabled by --include-hooks
.mcp.json                 # Enabled by --include-mcp
```

Rationale:

- Skills only expose name and description until invoked.
- MCP servers expand the tool surface and introduce authorization and identity scope concerns.
- Hooks affect lifecycle behavior and differ by host trust model.
- Agents increase routing candidates and can pollute unrelated user-level sessions.

### 2. Workspace Activation Pack

Purpose: declare how Azure Functions Skills should behave in a specific workspace.

GitHub Copilot CLI:

```text
.github/copilot/settings.json          # Optional plugin marketplace / enabledPlugins / disabledSkills
.github/agents/functions-copilot.agent.md
.github/copilot-instructions.md        # Thin routing only
.github/hooks/welcome-setup.json       # Opt-in / setup mode only
.vscode/mcp.json                       # VS Code MCP, opt-in
AGENTS.md                              # Optional cross-agent fallback
```

Claude Code:

```text
CLAUDE.md                              # Thin routing only
.claude/settings.json                  # Project plugin enablement / optional default agent / MCP policy
.claude/settings.local.json            # Personal local opt-in, not committed
.claude/skills/                        # Copy-mode fallback only
```

Codex:

```text
AGENTS.md                              # Primary routing anchor
.agents/plugins/marketplace.json       # Repo-curated plugin catalog
.codex/config.toml                     # MCP / hooks / skill policy, opt-in
.codex/hooks.json                      # Setup mode only, trust gated
.agents/skills/                        # Copy-mode fallback only
```

## Supported Install Modes

### Mode A: `chat`

Target users: users who want to start an Azure Functions workflow immediately and avoid context pollution.

`chat` does not use plugin installation. Before launching the agent CLI, it installs or updates the required Azure Functions skills and routing files locally in the workspace. The skills are visible only in that workspace. This is the preferred path for users who want to avoid user-level plugin skill overflow and MCP or hook pollution.

`chat` should continue to do the following:

1. Detect the agent CLI, or use `--agent`.
2. If Azure Functions skills or the activation pack are missing, run workspace-local setup without using plugins.
3. Run prerequisite checks.
4. Pass the startup prompt to the selected agent CLI.
5. For GitHub Copilot, launch with `--agent functions-copilot`.

Recommended commands:

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

Target users: users who do not want plugin installation and want explicit workspace-local routing and skills.

Keep existing `setup`, but clarify its semantics. `workspace apply` can be an alias or successor.

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
| `--mode minimal|copy|plugin-reference` | `copy` for compatibility | `minimal` writes routing only, `copy` copies skills, `plugin-reference` writes routing/settings for an installed plugin |
| `--update` | false | Update existing managed blocks |
| `--dry-run` | false | Show planned writes |
| `--merge-strategy managed-block|include-file|fail-if-exists|append` | `managed-block` | How to merge with existing `CLAUDE.md` / `AGENTS.md` |
| `--include-mcp` | false | Add workspace-level MCP |
| `--include-hooks` | false | Add workspace-level hooks |
| `--force` | false | Allow overwrite on conflicts |

`setup --update` matters because plugin updates do not automatically update workspace routing files.

`workspace apply` is also the follow-up command after direct plugin commands. It applies only the workspace-side pieces and avoids duplicate skill copies.

```bash
npx @agent-loom/azure-functions-skills workspace apply --agent ghcp --mode plugin-reference --dir ./my-app
npx @agent-loom/azure-functions-skills workspace apply --agent claude --mode plugin-reference --dir ./my-app
npx @agent-loom/azure-functions-skills workspace apply --agent codex --mode plugin-reference --dir ./my-app
```

In `--mode plugin-reference`, workspace-local skill bodies are not copied. The CLI writes thin routing, settings, marketplace references, and managed instruction blocks.

### Mode C: `plugin install`

Target users: users who want the standard versioned plugin installation path.

Add a new command:

```bash
npx @agent-loom/azure-functions-skills plugin install --agent github-copilot --scope user
npx @agent-loom/azure-functions-skills plugin install --agent claude-code --scope project --dir ./my-app
npx @agent-loom/azure-functions-skills plugin install --agent codex --scope project --dir ./my-app
```

Common options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--agent github-copilot|claude-code|codex|all` | auto | Install target |
| `--scope user|project|local|managed` | agent default | Plugin registration scope; Copilot `project` means repo settings declaration |
| `--dir <path>` | cwd | Target workspace for project/local scope |
| `--source marketplace|github|git|local|npm` | marketplace | Plugin source |
| `--version <semver|tag|sha>` | latest | Pin version |
| `--workspace apply|skip|prompt` | prompt | Whether to apply the workspace activation pack after plugin install |
| `--workspace-mode minimal|plugin-reference|copy` | minimal | Workspace activation content |
| `--include-agent` | false | Enable plugin or workspace agent |
| `--include-mcp` | false | Enable MCP |
| `--include-hooks` | false | Enable hooks |
| `--dry-run` | false | Show planned commands and file diff |

`plugin install --workspace apply` should internally call `workspace apply --mode plugin-reference` after plugin registration. This avoids implementation duplication and gives users of direct plugin commands the same workspace activation path.

`--dry-run` example:

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

`--dry-run` must not execute commands or write files.

### Mode D: `plugin update`

Purpose: update both the plugin package and the workspace activation pack.

```bash
npx @agent-loom/azure-functions-skills plugin update --agent all --dir ./my-app
npx @agent-loom/azure-functions-skills workspace update --agent all --dir ./my-app
```

Update targets:

- Plugin installation or marketplace registration.
- `.github/copilot/settings.json` / `.claude/settings.json` / `.agents/plugins/marketplace.json`.
- Managed blocks in `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md`.
- Generated hooks and MCP config, but only when explicitly opted in.

## Agent-Specific Design

### GitHub Copilot CLI

Recommended direct plugin commands:

```bash
copilot plugin marketplace add Azure/azure-functions-skills
copilot plugin install azure-functions-skills@azure-functions-skills
copilot --agent azure-functions-skills:functions-copilot
```

CLI-mediated path:

```bash
npx @agent-loom/azure-functions-skills plugin install --agent github-copilot --scope user --include-agent
npx @agent-loom/azure-functions-skills workspace apply --agent ghcp --mode plugin-reference --dir ./my-app
```

For Copilot, `--scope project` should mean generating repository settings because physical project-scoped plugin installation is not documented.

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

Notes:

- README must include the agent selection step after plugin installation.
- Installed plugin agents may use qualified IDs such as `azure-functions-skills:functions-copilot`.
- MCP should not be enabled by default through user-scope plugin installation.
- Copilot does not currently expose a confirmed per-skill manual-only frontmatter equivalent, so dangerous workflows should be controlled by narrow descriptions and project routing.

### Claude Code

Recommended plugin command:

```bash
claude plugin install azure-functions-skills@azure-functions-skills --scope project
```

CLI-mediated path:

```bash
npx @agent-loom/azure-functions-skills plugin install --agent claude-code --scope project --dir ./my-app --workspace apply
```

Workspace apply writes project plugin enablement and thin routing, for example:

```json
{
  "enabledPlugins": {
    "azure-functions-skills@azure-functions-skills": true
  },
  "extraKnownMarketplaces": {
    "azure-functions-skills": {
      "source": {
        "source": "github",
        "repo": "Azure/azure-functions-skills"
      }
    }
  }
}
```

Do not inline full skill bodies in `CLAUDE.md`. Use a short managed block:

```md
<!-- azure-functions-skills:start -->
# Azure Functions Skills

For Azure Functions setup, create, deploy, diagnostics, inventory, health, and best-practices tasks, prefer the Azure Functions Skills plugin. Route deployment through azure-functions-deploy, diagnostics through azure-functions-diagnostics, and static inventory through azure-functions-inventory.
<!-- azure-functions-skills:end -->
```

Notes:

- Replace README guidance that uses `claude --add-dir ...` as the primary plugin path. Current docs support `claude plugin install <plugin> --scope project|user|local`.
- Existing `CLAUDE.md` should receive only a managed block.
- Mention `claude plugin details` as a way to review token cost and component inventory.
- Side-effect skills should consider `disable-model-invocation: true`, emitted through target-specific generation if needed.

### Codex

Codex should use repo marketplaces for project-scoped plugin exposure.

```bash
npx @agent-loom/azure-functions-skills plugin install --agent codex --scope project --dir ./my-app --workspace apply
```

Workspace apply can generate:

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

`AGENTS.md` should receive a managed routing block:

```md
<!-- azure-functions-skills:start -->
# Azure Functions Skills

For Azure Functions work, use the Azure Functions Skills plugin or repo-local `.agents/skills` entries. Prefer setup/create/deploy/diagnostics/best-practices skills by intent. Do not treat generic Azure tasks as Azure Functions tasks unless the user mentions Function Apps, triggers, bindings, host.json, or Functions deployment/runtime errors.
<!-- azure-functions-skills:end -->
```

Notes:

- Codex plugin hooks require `[features].plugin_hooks = true`, so they remain off by default.
- `allow_implicit_invocation: false` is useful for deploy, feedback, or destructive workflows.
- Codex has an explicit skill list budget, so narrow descriptions and skills-only defaults are especially valuable.

## File Merge Strategy

Treat `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` as customer-owned files.

Default: `managed-block`

```md
<!-- azure-functions-skills:start version=0.12.1 -->
...
<!-- azure-functions-skills:end -->
```

Rules:

1. Append the block if it does not exist.
2. Replace the block on `--update` if it already exists.
3. Never modify content outside the block.
4. Fail on conflict and suggest `--force` or `--merge-strategy include-file`.

Alternative: `include-file`

```md
See .azure-functions-skills/CLAUDE.azure-functions.md for Azure Functions routing.
```

## Context Pollution Controls

| Risk | Default control | Opt-in |
| --- | --- | --- |
| Skill listing pollution | Skills-only payload, narrow descriptions, workspace routing | `--mode copy` only when needed |
| Instruction pollution | Do not inline full skill bodies into `CLAUDE.md` / `AGENTS.md` | Advanced verbose instruction mode only |
| MCP tool pollution | Exclude MCP from default plugin payload; enable at workspace/local scope | `--include-mcp` |
| Hook pollution | Plugin hooks off by default; workspace hooks only in setup mode | `--include-hooks` |
| Agent pollution | Plugin agent off by default; Copilot users explicitly select the agent | `--include-agent` |
| Duplicate skills | Document that project skills override plugin skills | Future `workspace cleanup` |

## README Update Plan

README installation guidance should be ordered as follows.

1. **Recommended: CLI-mediated install**

```bash
npx @agent-loom/azure-functions-skills plugin install --agent github-copilot --scope user --workspace apply
npx @agent-loom/azure-functions-skills plugin install --agent claude-code --scope project --dir ./my-app --workspace apply
npx @agent-loom/azure-functions-skills plugin install --agent codex --scope project --dir ./my-app --workspace apply
```

2. **Direct plugin commands**

Direct plugin commands only register the plugin payload. They do not configure workspace routing, instructions, repository settings, MCP, or hook policy. Follow them with `workspace apply --mode plugin-reference`.

GitHub Copilot:

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
# Then install azure-functions-skills from /plugins, or let the repo marketplace expose it.
npx @agent-loom/azure-functions-skills workspace apply --agent codex --mode plugin-reference --dir ./my-app
```

3. **Workspace-local setup**

```bash
npx @agent-loom/azure-functions-skills setup --agent ghcp --dir ./my-app
npx @agent-loom/azure-functions-skills setup --agent claude --dir ./my-app
npx @agent-loom/azure-functions-skills setup --agent codex --dir ./my-app
```

4. **Chat**

```bash
npx @agent-loom/azure-functions-skills chat --agent github-copilot --dir ./my-app
```

## Implementation Notes

The current code already has `setup --as-plugin` and `chat --as-plugin`, but their semantics should be redesigned.

Needed changes:

1. Replace `--as-plugin` internals with documented native plugin flows:
   - Copilot: `copilot plugin marketplace add` / `copilot plugin install`, plus optional `.github/copilot/settings.json` for project declaration.
   - Claude: `claude plugin install <plugin> --scope user|project|local` instead of `claude --add-dir` as the primary path.
   - Codex: repo marketplace or `codex plugin marketplace add`; do not write only a personal marketplace for project scope.
2. Split plugin payload variants:
   - `skills-only` default.
   - `full` advanced payload with MCP/hooks/agents.
   - host-specific manifests where needed.
3. Make `generateClaudeMd` and `generateCodexAgents` thin by default.
4. Add managed-block merge utilities with tests.
5. Add `workspace apply/update`, or extend `setup --mode minimal|copy|plugin-reference --update`.
6. Implement `--dry-run` for `plugin install`, `workspace apply`, and `workspace update`.
7. Add E2E scenarios for Copilot qualified-agent plugin install, Claude project plugin install, Codex repo marketplace install, existing instruction-file merge safety, and direct plugin command followed by `workspace apply --mode plugin-reference`.

## Open Questions

1. If Copilot adds native project-scoped plugin installation later, should `--scope project` switch from repository settings declaration to native project install?
2. Should Azure MCP be excluded from the default plugin payload entirely, or included but disabled until `--include-mcp`?
3. How far should this CLI go in automatically installing the Azure Skills plugin required by `azure-functions-deploy`?
4. Should Claude/Codex manual-only metadata live in shared skill source, or be emitted by target-specific generation?

## References

- GitHub Copilot CLI plugin reference: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- GitHub Copilot CLI configuration directory: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- GitHub CLI `gh skill install`: https://cli.github.com/manual/gh_skill_install
- Claude Code plugins reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code settings: https://code.claude.com/docs/en/settings
- Codex plugin build docs: https://developers.openai.com/codex/plugins/build
- Codex skills docs: https://developers.openai.com/codex/skills
- Codex hooks docs: https://developers.openai.com/codex/hooks
- Japanese source: `Research/ja/20260521/azure-functions-skills-installation-routing-design-20260521.md`
- Related English research: `Research/en/20260521/azure-functions-skills-plugin-local-hybrid-20260521.md`
- Related English research: `Research/en/20260521/copilot-claude-codex-plugin-scope-comparison-20260521.md`
