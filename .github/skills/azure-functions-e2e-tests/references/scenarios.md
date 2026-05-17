# E2E Scenario Catalog

Use this catalog to select scenarios for Azure Functions Skills E2E validation. Prefer running a small, focused set first, then expanding to the full matrix. Expected skills/prompts/MCP/hooks/agents must be discovered dynamically from the current repository files at run time, not hard-coded into a runner.

## Matrix dimensions

| Dimension | Values |
| --- | --- |
| Agent | `github-copilot`, `claude-code`, `codex` |
| Install mode | `plugin`, `setup`, `chat` |
| Platform | `windows`, `linux` |
| Scenario group | `discovery`, `visibility`, `startup`, `azure-skills-dependency`, `docs-consistency`, `basic-task` |

## Dynamic inventory requirements

Before running scenarios, inspect the current repository and record:

- All template skills from `templates/skills/*/SKILL.md`.
- Prompt templates from `templates/prompts/`.
- MCP definitions from `templates/mcp/` and generated target-specific MCP files.
- Hook templates from `templates/hooks/` and generated target-specific hook files.
- Agent definitions from `templates/agents/` and generated target-specific agent files.
- Plugin payload manifests and directories from `.github/plugins/azure-functions-skills/` or the built plugin output.
- Azure Skills dependency expectations from README, setup guidance, and generated skills text.

The report should include the inventory counts and paths used for each run. If a template is added or removed, the E2E expectations should change automatically because they come from this inventory.

## Status values

| Status | Meaning |
| --- | --- |
| `pass` | All required checks passed. |
| `warning` | All required checks passed, but there are non-blocking usability, documentation, or partial-support concerns. Do not use `warning` when a required command was skipped, failed, timed out, or did not prove the required behavior. |
| `fail` | Required behavior is broken or contradicts documentation. |
| `blocked` | The scenario could not run because local prerequisites, credentials, or approvals are missing. |
| `unsupported` | The agent/platform does not support the scenario by design or current capability. |

## Agent-visible proof for setup and chat

Setup and chat scenarios must prove both installation and runtime visibility:

1. Install or prepare the workspace with the documented setup/chat command.
2. Check the expected files from the dynamic inventory were written to the isolated workspace.
3. Launch the real target coding-agent CLI with an inspection prompt.
4. Require the agent response to report visible or usable `skills`, `prompts`, `mcp`, `hooks`, and `agents` surfaces, or explicitly classify unsupported surfaces.

File checks alone are insufficient for `pass` because they do not prove the coding agent can load or use the installed surfaces. If the files exist but the agent cannot be launched or cannot confirm visibility, classify the scenario as `blocked` or `fail` with evidence.

## Initial scenarios

### `setup-workspace-ghcp`

- Agent: `github-copilot`
- Install mode: `setup`
- Priority: P0
- Purpose: verify workspace-local GitHub Copilot files are installed.
- Required checks:
  - `.github/copilot-instructions.md` exists.
  - `.github/agents/functions-copilot.agent.md` exists.
  - `.github/skills/<skill-id>/SKILL.md` exists for every template skill.
  - `.github/hooks/welcome-setup.json` exists.
  - `.vscode/mcp.json` exists.
  - `AGENTS.md` exists.
  - A real GitHub Copilot CLI inspection prompt confirms the visible/usable skills, prompts/instructions, MCP config, hooks, and `functions-copilot` agent, or records a blocked/fail reason.

### `setup-workspace-claude`

- Agent: `claude-code`
- Install mode: `setup`
- Priority: P0
- Purpose: verify workspace-local Claude Code files are installed.
- Required checks:
  - `CLAUDE.md` exists.
  - `.claude/settings.json` exists.
  - `.claude/skills/<skill-id>/SKILL.md` exists for every template skill.
  - A real Claude Code inspection prompt confirms the visible/usable skills, prompts/guidance, MCP settings, and agent guidance, or records a blocked/fail reason.

### `setup-workspace-codex`

- Agent: `codex`
- Install mode: `setup`
- Priority: P0
- Purpose: verify workspace-local Codex files are installed.
- Required checks:
  - `AGENTS.md` exists.
  - `.codex/config.toml` exists.
  - `.codex/hooks.json` exists.
  - `.agents/skills/<skill-id>/SKILL.md` exists for every template skill.
  - A real Codex inspection prompt confirms the visible/usable skills, prompts/guidance, MCP config, hooks, and agent guidance, or records a blocked/fail reason.

### `chat-welcome-ghcp`

- Agent: `github-copilot`
- Install mode: `chat`
- Priority: P0
- Purpose: verify `chat` auto-setup and GitHub Copilot agent selection.
- Required checks:
  - `chat` installs GitHub Copilot workspace files when missing.
  - Startup prompt mentions Azure Functions Skills.
  - Startup prompt detects existing `host.json` when present.
  - Launch command selects `functions-copilot`.
  - Azure Skills dependency check is attempted or clear manual guidance is shown.
  - A real GitHub Copilot CLI inspection prompt confirms the startup-loaded agent can see or use installed skills, prompts/instructions, MCP, hooks, and agent surfaces.

### `chat-welcome-claude`

- Agent: `claude-code`
- Install mode: `chat`
- Priority: P0
- Purpose: verify `chat` auto-setup for Claude Code.
- Required checks:
  - `chat` installs Claude workspace files when missing.
  - Startup prompt mentions Azure Functions Skills.
  - Claude launch receives the startup prompt.
  - A real Claude Code inspection prompt confirms the startup context can see or use installed skills, prompts/guidance, MCP settings, and agent guidance.

### `chat-welcome-codex`

- Agent: `codex`
- Install mode: `chat`
- Priority: P0
- Purpose: verify `chat` auto-setup for Codex.
- Required checks:
  - `chat` installs Codex workspace files when missing.
  - Startup prompt mentions Azure Functions Skills.
  - Codex launch receives the startup prompt.
  - A real Codex inspection prompt confirms the startup context can see or use installed skills, prompts/guidance, MCP config, hooks, and agent guidance.

### `plugin-install-ghcp`

- Agent: `github-copilot`
- Install mode: `plugin`
- Priority: P1
- Purpose: verify repository plugin installation and discoverability in GitHub Copilot.
- Command contract:
  1. Clear or isolate existing GitHub Copilot plugin state for `azure-functions-skills` and dependent `azure-skills` when safe; otherwise ask the user or mark cleanup `blocked`.
  2. Run `copilot plugin marketplace add Azure/azure-functions-skills`.
  3. Run `copilot plugin install azure-functions-skills@azure-functions-skills`.
  4. Run `copilot --agent functions-copilot -p "<inspection prompt>"` or the current documented equivalent from README/CLI help.
- Required checks:
  - Existing plugin registration is cleared or isolated safely; if global cleanup is unsafe, record `blocked` for cleanup and continue with an isolated registration when possible.
  - The documented marketplace add command completes or produces an auth/approval `blocked` result.
  - The documented plugin install command completes or produces an auth/approval `blocked` result.
  - The post-install Copilot command runs with `--agent functions-copilot` and an inspection prompt.
  - `functions-copilot` agent is discoverable.
  - Every skill from the dynamic inventory is discoverable from the plugin payload or by the agent.
  - MCP configuration is discoverable and usable when supported.
  - Hooks are discoverable or documented as unsupported.
  - Azure Skills dependency is installed or clear install guidance is shown.
  - A real GitHub Copilot CLI prompt asks the agent to report visible/usable agents, skills, MCP, hooks, prompts, and Azure Skills dependency surfaces.

### `plugin-install-claude`

- Agent: `claude-code`
- Install mode: `plugin`
- Priority: P1
- Purpose: verify plugin/source registration and discoverability in Claude Code, or explicitly report the current lack of native plugin support.
- Command contract:
  1. Clear or isolate existing Claude source/plugin registration when safe; otherwise ask the user or mark cleanup `blocked`.
  2. Use the README plugin-from-source flow: `git clone https://github.com/Azure/azure-functions-skills.git` when testing from remote, or the local repository equivalent when testing the current branch.
  3. Run `claude --add-dir ./azure-functions-skills/.github/plugins/azure-functions-skills` or the local equivalent plugin payload path.
  4. Run Claude with an inspection prompt in the isolated workspace.
- Required checks:
  - Existing plugin/source registration is cleared or isolated safely; if global cleanup is unsafe, record `blocked` for cleanup and continue with an isolated registration when possible.
  - The documented `--add-dir` command is attempted and recorded.
  - The post-registration Claude command runs with an inspection prompt, or the scenario is `blocked`/`unsupported` with evidence.
  - Every skill from the dynamic inventory is discoverable if the mode is supported.
  - MCP settings are discoverable or merged into local settings.
  - Unsupported plugin capabilities are clearly reported as `unsupported`, not `pass`.
  - A real Claude Code prompt asks the agent to report visible/usable agents, skills, MCP, hooks, prompts, and Azure Skills dependency surfaces.

### Capability surface checks

Every agent run should report the following surfaces, with direct file evidence and real-agent response evidence from the actual coding-agent CLI when available:

| Surface | GitHub Copilot setup evidence | Claude Code setup evidence | Codex setup evidence |
| --- | --- | --- | --- |
| `plugin` | VS Code plugin registration/settings or unsupported/block reason | Unsupported today unless Claude is actually launched with plugin/source directory loaded | Codex marketplace/source registration or unsupported/block reason |
| `skills` | `.github/skills/<skill-id>/SKILL.md` | `.claude/skills/<skill-id>/SKILL.md` | `.agents/skills/<skill-id>/SKILL.md` |
| `prompts` | Startup prompt delivered to Copilot launcher and/or `.github/copilot-instructions.md` | Startup prompt delivered to Claude and/or `CLAUDE.md` | Startup prompt delivered to Codex and/or `AGENTS.md` |
| `mcp` | `.vscode/mcp.json` | `.claude/settings.json` | `.codex/config.toml` |
| `hooks` | `.github/hooks/welcome-setup.json` | Partial/unsupported unless a native Claude hook is actually configured | `.codex/hooks.json` |
| `agents` | `.github/agents/functions-copilot.agent.md` | `CLAUDE.md` agent guidance | `AGENTS.md` |

### `plugin-install-codex`

- Agent: `codex`
- Install mode: `plugin`
- Priority: P1
- Purpose: verify plugin marketplace/source registration and discoverability in Codex.
- Command contract:
  1. Clear or isolate existing Codex plugin marketplace/install state for `azure-functions-skills` and dependent `azure-skills` when safe; otherwise ask the user or mark cleanup `blocked`.
  2. Run `codex plugin marketplace add Azure/azure-functions-skills`.
  3. Install/select `azure-functions-skills` from `/plugins` when the CLI supports it, or record the current documented/CLI-help equivalent.
  4. Run Codex with an inspection prompt in the isolated workspace.
- Required checks:
  - Existing plugin registration is cleared or isolated safely; if global cleanup is unsafe, record `blocked` for cleanup and continue with an isolated registration when possible.
  - The documented marketplace add command completes or produces an auth/approval `blocked` result.
  - The plugin install/select step is attempted or documented as unsupported by current CLI help.
  - The post-install Codex command runs with an inspection prompt, or the scenario is `blocked`/`unsupported` with evidence.
  - Every skill from the dynamic inventory is discoverable from the plugin payload or by the agent.
  - MCP configuration is discoverable.
  - Hook behavior is verified or marked unsupported.
  - A real Codex prompt asks the agent to report visible/usable agents, skills, MCP, hooks, prompts, and Azure Skills dependency surfaces.

### `docs-command-consistency`

- Agent: `all`
- Install mode: `docs`
- Priority: P0
- Purpose: verify README commands match actual CLI and supported agents.
- Required checks:
  - README plugin commands match current intended plugin flow.
  - README `setup` and `chat` examples use supported agent IDs and options.
  - README skill list matches template skill directories.
  - README development commands match `package.json` scripts or known release process.

### `basic-help-prompt`

- Agent: `all available real agents`
- Install mode: `plugin` or `chat`
- Priority: P1
- Purpose: verify the real agent can explain Azure Functions Skills.
- Required checks:
  - Response mentions setup, create, deploy, diagnostics, best practices, and feedback.
  - Response suggests an appropriate next action.
  - Response does not claim unsupported live deployment or diagnostics without prerequisites.

### `azure-skills-dependency`

- Agent: `github-copilot`, `codex`
- Install mode: `plugin` or `chat`
- Priority: P1
- Purpose: verify Azure Skills dependency detection and guidance.
- Required checks:
  - GitHub Copilot guidance includes Azure Skills plugin install flow.
  - Codex guidance includes Azure Skills plugin install flow when applicable.
  - Missing dependency is reported as blocked or warning, not pass.
