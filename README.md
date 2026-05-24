# Azure Functions Skills

[![npm](https://img.shields.io/npm/v/@agent-loom/azure-functions-skills)](https://www.npmjs.com/package/@agent-loom/azure-functions-skills)
[![E2E report](https://github.com/Azure/azure-functions-skills/actions/workflows/publish-e2e-report.yml/badge.svg)](https://azure.github.io/azure-functions-skills/)

Latest E2E status: [HTML report](https://azure.github.io/azure-functions-skills/)

Azure Functions Skills provides guided setup, create, deploy, diagnostics, and review workflows for coding agents such as GitHub Copilot CLI, Claude Code, and Codex.

## Recommended: install as a plugin

Use the plugin when your agent supports plugin installation. The default plugin payload is **skills-only** so global installs do not add MCP, hooks, or extra agent surfaces to every session. Add workspace activation when a repo needs project-local routing, MCP, or hooks.

Most users should run the one-time `install` command. It performs the host plugin install and workspace activation together:

```bash
npx @agent-loom/azure-functions-skills install --agent ghcp --dir ./my-app --dry-run
npx @agent-loom/azure-functions-skills install --agent ghcp --dir ./my-app
```

When `--agent` is omitted, interactive terminals ask which agent to install. In CI or other non-interactive shells, pass `--agent ghcp`, `--agent claude`, `--agent codex`, or `--all` explicitly.

`install` adds workspace-local MCP/hooks by default because those files live in the target repo rather than in the global plugin payload. Use `--no-mcp` or `--no-hooks` for a smaller activation. Use `--source local` when testing the plugin payload from this checkout.

`install` writes local state to `.azure-functions-skills/state.local.json` so future `chat` and `update` commands can use the same agent selection. The state file intentionally stores no secrets. With `--yes`, the CLI also adds only this state file to `.gitignore`:

```gitignore
.azure-functions-skills/state.local.json
```

It does not ignore the whole `.azure-functions-skills/` directory, because include-file routing docs under that directory may be useful to commit.

GitHub Copilot CLI:

```bash
copilot plugin marketplace add Azure/azure-functions-skills
copilot plugin install azure-functions-skills@azure-functions-skills
```

Claude Code plugin-from-source:

```bash
git clone https://github.com/Azure/azure-functions-skills.git
claude --add-dir ./azure-functions-skills/.github/plugins/azure-functions-skills
```

Codex CLI:

```bash
codex plugin marketplace add Azure/azure-functions-skills
# Then install azure-functions-skills from /plugins.
```

For VS Code plugin-from-source flows, point the installer at:

```text
Azure/azure-functions-skills:.github/plugins/azure-functions-skills
```

### Workspace activation

`install` calls workspace activation internally. Advanced users can still run `workspace apply` directly. For Claude and Codex, these are important user-owned files, so existing `CLAUDE.md` or `AGENTS.md` files are not modified unless you approve it.

```bash
# Preview changes without writing files.
npx @agent-loom/azure-functions-skills workspace apply --agent claude --mode plugin-reference --dry-run

# CI/non-interactive approval to append an Azure Functions managed block.
npx @agent-loom/azure-functions-skills workspace apply --agent claude --mode plugin-reference --yes

# Keep CLAUDE.md or AGENTS.md small by adding an include line and writing the routing block elsewhere.
npx @agent-loom/azure-functions-skills workspace apply --agent codex --mode plugin-reference --merge-strategy include-file --yes

# Add workspace MCP/hooks only when explicitly needed.
npx @agent-loom/azure-functions-skills workspace apply --agent codex --mode plugin-reference --include-mcp --include-hooks --yes
```

`workspace update` refreshes an existing Azure Functions managed block without replacing the rest of the file.

After installing, ask your agent:

```text
@functions-copilot set up Azure Functions
```

With GitHub Copilot CLI, launch through the wrapper so the workspace agent and Azure Functions startup context are selected consistently:

```bash
npx @agent-loom/azure-functions-skills chat --dir ./my-app
```

For a one-shot prompt:

```bash
npx @agent-loom/azure-functions-skills chat --dir ./my-app -- -p "Explain what Azure Functions Skills can do and which workflow I should start with."
```

If you intentionally want the session to run without permission prompts, add `--yolo`:

```bash
npx @agent-loom/azure-functions-skills chat --dir ./my-app -- --yolo
```

For a guided overview first, ask:

```text
@functions-copilot Explain what Azure Functions Skills can do, when to use setup/create/deploy/diagnostics/best-practices/feedback, and which workflow I should start with.
```

See [docs/usage-scenarios.md](docs/usage-scenarios.md) for customer-friendly scenario walkthroughs and expected results.

## Plugin vs. `chat` vs. `setup`

| Option | Use when | What it does |
| --- | --- | --- |
| `install` | You are setting up Azure Functions Skills for a repo | Runs plugin install and workspace activation together. |
| `chat` | You want to launch a CLI agent with Azure Functions context | Starts the state-selected or explicitly selected CLI agent with the Azure Functions startup prompt. It does not install files. |
| `workspace apply` | You installed the plugin and need repo-local routing or opt-in MCP/hooks | Writes thin routing blocks and optional workspace files without copying skill bodies. |
| `plugin install` | You need advanced control over host plugin installation only | Runs the host plugin install flow without being the recommended first-run command. |
| `install --local` | Your agent does not support plugins or you need full workspace-local fallback | Copies agent instructions, skills, hooks, and MCP config into the target workspace. |

## CLI commands

Run without global install:

```bash
npx @agent-loom/azure-functions-skills chat
npx @agent-loom/azure-functions-skills install --agent ghcp --dry-run
npx @agent-loom/azure-functions-skills workspace apply --agent claude --mode plugin-reference --dry-run
```

Or install globally:

```bash
npm install -g @agent-loom/azure-functions-skills
azure-functions-skills chat
azure-functions-skills install --agent ghcp
```

Useful options:

```bash
npx @agent-loom/azure-functions-skills chat --agent github-copilot --dir ./my-app
npx @agent-loom/azure-functions-skills chat --prompt "Create an HTTP trigger function"
npx @agent-loom/azure-functions-skills chat --agent codex --dir ./my-app -- exec --sandbox read-only --json
npx @agent-loom/azure-functions-skills install --agent ghcp --dir ./my-app
npx @agent-loom/azure-functions-skills install --all --dir ./my-app --yes
npx @agent-loom/azure-functions-skills install --local --agent ghcp --dir ./my-app --skip-prerequisites
npx @agent-loom/azure-functions-skills state setup-complete --dir ./my-app --agent github-copilot
npx @agent-loom/azure-functions-skills workspace apply --agent codex --dir ./my-app --mode plugin-reference --yes
npx @agent-loom/azure-functions-skills workspace update --agent claude --dir ./my-app --mode plugin-reference --yes
```

`chat` launches the state-selected or explicitly selected agent CLI and forwards extra arguments to that CLI. Use `--` to make the boundary explicit. Unrecognized `chat` options are also forwarded for compatibility with agent-specific flags. `install` does not launch an agent; it prepares the plugin, workspace, and local state once. On first chat launch after install, the startup context asks the agent to run `azure-functions-setup`; after it completes, mark that with `state setup-complete` so later chats skip the setup prompt.

Headless examples:

```bash
# GitHub Copilot CLI: pass a noninteractive prompt and JSON output flags through to copilot.
npx @agent-loom/azure-functions-skills chat --agent github-copilot --dir ./my-app --skip-prerequisites -- --output-format json -s --allow-all --no-ask-user -p "Inspect visible Azure Functions skills and return JSON."

# Claude Code: chat inserts --prompt content after -p/--print and forwards the rest.
npx @agent-loom/azure-functions-skills chat --agent claude-code --dir ./my-app --skip-prerequisites --prompt "Inspect visible Azure Functions skills and return JSON." -- -p --output-format json --no-session-persistence --permission-mode bypassPermissions --tools Read,LS,Grep,Glob

# Codex CLI: pass the exec subcommand and noninteractive output options through to codex.
npx @agent-loom/azure-functions-skills chat --agent codex --dir ./my-app --skip-prerequisites --prompt "Inspect visible Azure Functions skills." -- exec --sandbox read-only --json --output-last-message e2e-chat-inspection.txt --ephemeral --skip-git-repo-check --cd .
```

## Skills

| Skill | Purpose |
| --- | --- |
| `azure-functions-setup` | Verify local prerequisites such as Azure CLI, Azure Functions Core Tools, runtimes, and Azure Skills deployment dependency. |
| `azure-functions-create` | Create new Functions projects or add functions by using Azure MCP template discovery first. |
| `azure-functions-deploy` | Prepare, validate, and deploy through Azure Skills while adding Azure Functions-specific guidance. |
| `azure-functions-best-practices` | Review an app for Azure Functions configuration, security, reliability, and production-readiness guidance. |
| `azure-functions-diagnostics` | Investigate deployment, runtime, trigger, binding, language worker, logging, and telemetry issues. |
| `azure-functions-health-status` | Collect current health, metrics, logs, Resource Health, and Activity Log evidence. |
| `azure-functions-inventory` | Collect app specification and configuration inventory without diagnosing health. |
| `azure-functions-common` | Shared language, trigger, binding, extension, routing, and local emulator references for the skill suite. |
| `azure-functions-feedback` | Turn session findings into previewed issues or pull requests for this repository. |

The `functions-copilot` agent routes user requests to the right skill and suggests the next step after each workflow.

## What `setup` and `workspace apply` write

`install` runs host plugin installation and then applies workspace activation. By default it writes thin routing, plugin references, MCP, and supported hooks. Use `--no-mcp` or `--no-hooks` to keep the workspace activation smaller.

`install --local` is the compatibility path for the previous full `setup` behavior.

`workspace apply --mode plugin-reference` writes thin activation files only. It does not copy skill bodies:

```text
.github/copilot-instructions.md              # GHCP routing
CLAUDE.md                                    # Claude routing
AGENTS.md                                    # Codex routing
.github/copilot/settings.json                # GHCP plugin reference
.claude/settings.json                        # Claude plugin reference / optional MCP
.agents/plugins/marketplace.json             # Codex plugin reference
```

Optional flags add more surfaces:

```text
--include-mcp    .vscode/mcp.json, .claude/settings.json, .codex/config.toml
--include-hooks  .github/hooks/welcome-setup.json, .codex/hooks.json
```

`setup` remains the full workspace-local fallback.

For GitHub Copilot workspaces, `setup` writes:

```text
.github/copilot-instructions.md
.github/agents/functions-copilot.agent.md
.github/skills/<skill-id>/SKILL.md
.github/hooks/welcome-setup.json
.vscode/mcp.json
AGENTS.md
```

Claude Code and Codex receive equivalent workspace-local instructions, skills, hooks, and MCP configuration in their native locations.

## Development

See [docs/development.md](docs/development.md) for contributor prerequisites, validation commands, the template-to-plugin workflow, local smoke tests, and the CLI release process.

## License

MIT
