# Azure Functions Skills Installation and Routing Research

Date: 2026-05-21  
Scope: GitHub Copilot CLI, Claude Code, and OpenAI Codex plugin installation, workspace activation, and routing.

## Summary

Azure Functions Skills should use a hybrid distribution model: a reusable versioned plugin payload plus explicit workspace activation files. Plugin installation alone should not be treated as sufficient because it registers the skills package but does not reliably configure repository routing, custom instructions, MCP policy, hooks, or project-specific activation.

Recommended model:

```text
plugin install         # Register the versioned skills pack with the agent
workspace apply/update # Apply routing, activation, policy, and optional MCP/hooks
```

## Key Findings

### GitHub Copilot CLI

- `copilot plugin install` can install from marketplaces, GitHub repos, Git URLs, and local paths.
- Installed plugin files live in the user configuration area under `~/.copilot/installed-plugins/...`.
- Repository settings can declare plugins through `.github/copilot/settings.json` with `enabledPlugins` and `extraKnownMarketplaces`.
- A documented physical project-scoped plugin install was not confirmed.
- Project skills are clearer than plugins for single workflow units because `gh skill install --scope project` is supported.
- For Azure Functions Skills, Copilot should use plugin install plus repository settings and thin workspace routing.

### Claude Code

- Claude Code supports plugin scopes: `user`, `project`, `local`, and `managed`.
- `claude plugin install <plugin> --scope project` writes project enablement to `.claude/settings.json`.
- Plugins can include skills, agents, hooks, MCP servers, LSP servers, monitors, and themes.
- Plugin-root `CLAUDE.md` is not loaded as project context, so workspace routing should still be written to project files.
- Claude has useful controls for context cost and skill listing behavior, including plugin details and skill listing settings.

### Codex

- Codex skills can be loaded from repo `.agents/skills`, user `~/.agents/skills`, admin locations, and system locations.
- Codex has an explicit skill listing budget, so broad user-level skill packs can cause listing pressure.
- Repo marketplaces live at `$REPO_ROOT/.agents/plugins/marketplace.json`; installed plugin copies live under `~/.codex/plugins/cache/...`.
- Plugin-bundled hooks require `[features].plugin_hooks = true`.
- Codex should keep `AGENTS.md` as the primary workspace routing anchor and use repo marketplace declarations for project distribution.

## Design Implications

1. Default plugin payload should be skills-only.
2. MCP servers, hooks, and router agents should be opt-in through flags such as `--include-mcp`, `--include-hooks`, and `--include-agent`.
3. Direct plugin commands must be followed by a workspace activation step such as `workspace apply --mode plugin-reference`.
4. `chat` should remain a local workspace path and should not require plugin installation.
5. Generated changes to `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` must be merge-safe and avoid overwriting customer content.
6. `--dry-run` should show planned native commands, file writes, merge diffs, and disabled opt-in artifacts before mutation.

## Recommended Documentation Shape

README and PRD documentation should distinguish four paths:

1. CLI-mediated plugin install with optional `--workspace apply`.
2. Direct agent-native plugin commands followed by `workspace apply --mode plugin-reference`.
3. Workspace-local `setup` / `workspace apply` without plugin install.
4. `chat`, which prepares workspace-local routing and launches the selected agent CLI.

## References

- GitHub Copilot CLI plugin reference: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- GitHub Copilot CLI configuration directory: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- GitHub CLI `gh skill install`: https://cli.github.com/manual/gh_skill_install
- Claude Code plugins reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code settings: https://code.claude.com/docs/en/settings
- Codex plugin build docs: https://developers.openai.com/codex/plugins/build
- Codex skills docs: https://developers.openai.com/codex/skills
- Codex hooks docs: https://developers.openai.com/codex/hooks
