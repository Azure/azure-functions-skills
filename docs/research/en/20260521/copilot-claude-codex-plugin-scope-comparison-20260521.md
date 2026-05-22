# Copilot / Claude Code / Codex Plugin and Skill Scope Comparison

Date: 2026-05-21  
Scope: GitHub Copilot CLI, Claude Code, and OpenAI Codex.

## Summary

GitHub Copilot CLI plugin installation does not currently have a documented physical project-scope install. `copilot plugin install` can install from a marketplace, GitHub repository, Git URL, or local path, but installed plugin files live under the Copilot user configuration directory, typically `~/.copilot/installed-plugins/`.

Copilot CLI does support repository-level plugin declaration through `.github/copilot/settings.json` using `enabledPlugins` and `extraKnownMarketplaces`. In practice, this means a repository can declare plugin usage and trigger user-side installation/enablement, but the plugin copy remains user-scoped.

GitHub Copilot skills are different. `gh skill install` supports `--scope project|user`; the default scope is `project`, and the default agent is `github-copilot`. For a single workflow that does not need MCP, hooks, or agents, project-scoped skills are simpler than plugins.

Claude Code has the clearest plugin scope model: `user`, `project`, `local`, and `managed`. `claude plugin install <plugin> --scope project` writes to `.claude/settings.json`.

Codex supports repo and personal marketplaces. A repo can provide a curated plugin catalog, but installed plugin copies live under `~/.codex/plugins/cache/...`, and enable/disable state is stored mostly in `~/.codex/config.toml`.

## Can Copilot Install Plugins at Project Scope?

| Question | Answer |
| --- | --- |
| Physically install plugin under project directory | Not confirmed in official docs. Installed plugins live under `~/.copilot/installed-plugins/`. |
| Install plugin from a project/repo source | Yes. `copilot plugin install` accepts GitHub repositories, repository subdirectories, Git URLs, and local paths. |
| Declare plugin usage in a repository | Yes. Use `.github/copilot/settings.json` with `enabledPlugins` and `extraKnownMarketplaces`. |
| Local project override | Yes. `.github/copilot/settings.local.json` overrides repository settings and is normally gitignored. |
| Enterprise-managed plugin standards | Yes. Enterprise `.github-private` settings can distribute known marketplaces and default-enabled plugins. |
| Project-scoped skill install | Yes. `gh skill install ... --scope project`; default scope is also `project`. |

Practical interpretation:

- Copilot plugin: a user-cache package, optionally declared by repo settings.
- Copilot skill: a workflow unit that can be physically placed in project scope.
- Azure Functions Skills should use plugin + repo settings + thin repo-local routing for Copilot.

## Plugin Installation and Enablement Comparison

| Agent | Method | Scope / effect | Benefits | Drawbacks |
| --- | --- | --- | --- | --- |
| GitHub Copilot CLI | `copilot plugin marketplace add` + `copilot plugin install` | User installed plugin | Easy distribution and updates; can bundle skills, agents, hooks, MCP, LSP, commands | No documented `--scope project`; depends on each user's install state |
| GitHub Copilot CLI | Direct install from GitHub repo, repo subdir, Git URL, or local path | Source may be repo/local; install is user-side | Useful for development and testing | Not a project install; updates and enablement remain user state |
| GitHub Copilot CLI | `.github/copilot/settings.json` `enabledPlugins` / `extraKnownMarketplaces` | Repository-shared declaration | Good team onboarding | Installed copy remains user cache; trust and environment still matter |
| GitHub Copilot CLI | Enterprise-managed plugin standards | Enterprise users | Centralized governance | Enterprise-only, less project-flexible |
| GitHub Copilot / others | `gh skill install --agent github-copilot --scope project` | Project skill | Clear project sharing; supports multiple agents | Not a plugin, so does not bundle MCP/hooks/agents |
| Claude Code | `/plugin install` or `claude plugin install <plugin>` | User by default | Interactive review and token cost visibility | Depends on user state |
| Claude Code | `claude plugin install <plugin> --scope project` | `.claude/settings.json` | Official team-shared plugin scope | Requires repo trust and user consent |
| Claude Code | `--scope local` | `.claude/settings.local.json` | Good for personal project testing | Not shared |
| Claude Code | Managed settings | Managed | Strong governance and marketplace controls | Operational overhead |
| Codex | `$REPO_ROOT/.agents/plugins/marketplace.json` | Repo marketplace | Curated repo catalog | Installed copy and enable state are still user-side |
| Codex | `~/.agents/plugins/marketplace.json` | Personal marketplace | Personal catalog | Not team-shared |
| Codex | `codex plugin marketplace add ...` | Configured marketplace | Tracks GitHub/Git/local marketplaces | Marketplace registration, not physical project install |
| Codex | `policy.installation: INSTALLED_BY_DEFAULT` | Marketplace policy | Expresses default install intent | Runtime enablement/trust/user config still matter |

## Skill Scope Comparison

| Agent | Project / repo | Local | User / personal | Managed / admin | Plugin skill | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub Copilot CLI | `.github/skills/`, `.agents/skills/`, `.claude/skills/`; also `gh skill install --scope project` | Additional dirs/env/settings can extend | `~/.copilot/skills/`, `~/.agents/skills/` | Enterprise/org remote customizations | Provided by installed plugins | Plugin skills come after project/user skills |
| Claude Code | `.claude/skills/<name>/SKILL.md` | Visibility override via `.claude/settings.local.json` | `~/.claude/skills/<name>/SKILL.md` | Managed settings/enterprise | Plugin `skills/`, namespaced | Plugin skills are managed through `/plugin` |
| Codex | `$CWD/.agents/skills`, parents, repo root | Directory hierarchy works like local scoping | `$HOME/.agents/skills` | `/etc/codex/skills`, system skills | Plugin `skills/` | Same-name skills can both appear; initial list has a budget |

## Plugin Scope / Install Location

| Agent | User | Project / repo | Local | Managed | Install copy |
| --- | --- | --- | --- | --- | --- |
| GitHub Copilot CLI | `~/.copilot/settings.json`, `~/.copilot/installed-plugins/` | `.github/copilot/settings.json` declares plugin and marketplace | `.github/copilot/settings.local.json` | Enterprise `.github-private` settings | `~/.copilot/installed-plugins/{marketplace}/{plugin}` or `_direct` |
| Claude Code | `~/.claude/settings.json` | `.claude/settings.json` | `.claude/settings.local.json` | Managed settings | `~/.claude/plugins/cache`; data under `~/.claude/plugins/data/{id}` |
| Codex | `~/.agents/plugins/marketplace.json`, `~/.codex/config.toml` | `$REPO_ROOT/.agents/plugins/marketplace.json` | Repo-local marketplace source paths | System/MDM/cloud/requirements | `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/` |

## Plugin Artifact Comparison

| Artifact | GitHub Copilot CLI | Claude Code | Codex |
| --- | --- | --- | --- |
| Skills | Supported | Supported | Supported |
| Agents / subagents | Supported | Supported; plugin agents cannot use hooks, mcpServers, or permissionMode | Not a primary plugin artifact; custom agents are usually `.codex/agents/` |
| Hooks | Supported; user/project/plugin hooks are combined | Supported with many lifecycle events and hook types | Supported, but plugin hooks require `[features].plugin_hooks = true` |
| MCP servers | Supported | Supported | Supported |
| LSP servers | Supported | Supported | Not a primary documented Codex plugin field |
| Commands | Supported | Commands are treated as skills | Skill and prompt invocation are primary |
| Apps/connectors | Not prominent | Channels/MCP integrations | `.app.json` / apps supported |
| Visual assets | Marketplace metadata | Themes/output styles/interface data | `assets/` and interface metadata |
| Persistent plugin data | `~/.copilot/plugin-data/` | `${CLAUDE_PLUGIN_DATA}` | `${PLUGIN_DATA}`, plus Claude-compatible variables |

## Discovery and Precedence

| Surface | Discovery / precedence |
| --- | --- |
| Copilot settings | user < repository < local < CLI/env |
| Copilot skills | project skills, parent project skills, user skills, plugin skills, additional directories |
| Copilot agents | Docs vary; project-level agents and plugin agents must be validated for the target CLI surface |
| Copilot hooks | User, project, and plugin hooks can all run |
| Copilot MCP | Project-level MCP can override user definitions by name; plugin/additional config details must be validated |
| Claude settings | managed > command line > local > project > user |
| Claude skills | Enterprise/personal/project plus namespaced plugin skills; full content loads on invocation |
| Claude subagents | Managed > CLI `--agents` > project > user > plugin |
| Claude plugins | user/project/local/managed; higher scopes can override lower ones |
| Codex `AGENTS.md` | Global first, then project root to cwd; closer-to-cwd instructions effectively win |
| Codex skills | repo current/parent/root, user, admin, system; descriptions may be shortened or omitted under budget pressure |
| Codex hooks | Matching hooks from user/project/plugin/managed sources can all run; project hooks need trust; plugin hooks require feature flag |
| Codex custom agents | Custom agents in user or project locations can override built-ins by name |

## Context Pollution and Artifact Placement

The safest design is not to put every artifact inside a user-level plugin. Instead:

- Put reusable skills in the plugin.
- Put always-on instructions, routing, project policy, and repo-specific hooks in the workspace.
- Treat MCP and hooks as opt-in, project/local/managed enablement.
- Keep secrets, cloud targets, resource group names, endpoints, and identity settings out of plugin payload.

| Pollution type | What happens | Main cause | Mitigation |
| --- | --- | --- | --- |
| Instruction pollution | Azure Functions guidance appears in unrelated repos | User-level global instructions | Keep always-on instructions workspace-local |
| Skill listing pollution | Too many skills crowd the initial skill list | User/plugin skills installed broadly | Narrow descriptions; manual-only where available; repo-specific skills stay in repo |
| Tool pollution | MCP tools and commands expand tool choices | User/plugin MCP always enabled | Enable MCP only in project/local/managed settings |
| Hook pollution | Lifecycle scripts run in unrelated repos | User/plugin hooks always enabled | Use repo policy; plugin hooks opt-in |
| Agent pollution | Specialist agents become candidates in unrelated tasks | User/plugin agents too broad | Narrow descriptions; repo-specific agents in workspace |

## Skill Listing Pollution Controls

Use narrow descriptions, explicit non-use cases, manual-only controls where available, and repo-specific skill placement.

| Technique | GitHub Copilot CLI | Claude Code | Codex |
| --- | --- | --- | --- |
| Narrow `description` | Supported | Supported | Supported |
| Include "do not use" cases | Supported | Supported | Supported |
| Manual-only skill | No confirmed per-skill official frontmatter; use narrow descriptions, explicit invocation, and `disabledSkills` | `disable-model-invocation: true` | `agents/openai.yaml` `policy.allow_implicit_invocation: false` |
| Repo-specific skills | `.github/skills/`, `.agents/skills/`, optionally `.claude/skills/` | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` |

## Azure Functions Skills Implication

Azure Functions Skills should use a hybrid distribution model.

1. Plugin: reusable payload and versioned skill pack.
2. Workspace files: activation, routing, policy, and optional MCP/hooks.
3. README: clearly distinguish physical plugin install, repository plugin declaration, project skill install, and workspace apply.
4. Artifacts: stay close to each agent's supported model; Claude has the broadest plugin surface, Codex hooks are opt-in, and Copilot is more user-cache oriented.

## References

- GitHub Copilot CLI plugin reference: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- GitHub Copilot CLI configuration directory: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- GitHub CLI `gh skill install`: https://cli.github.com/manual/gh_skill_install
- Claude Code plugins reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code settings: https://code.claude.com/docs/en/settings
- Codex plugin build docs: https://developers.openai.com/codex/plugins/build
- Codex skills docs: https://developers.openai.com/codex/skills
- Codex hooks docs: https://developers.openai.com/codex/hooks
- Japanese source: `Research/ja/20260521/copilot-claude-codex-plugin-scope-comparison-20260521.md`
