# E2E Scenario Catalog

Use this catalog to select scenarios for Azure Functions Skills E2E validation. Unless the user explicitly requests a narrower scope in the current request, run the full local matrix for GitHub Copilot, Claude Code, and Codex across setup, chat, plugin, docs consistency, basic help, and Azure Skills dependency checks. Expected skills/prompts/MCP/hooks/agents must be discovered dynamically from the current repository files at run time, not hard-coded into a runner.

Do not remove a scenario from the matrix because it is likely to fail, previously failed, requires an interactive command, or requires approval. Keep it in the run checklist and classify it as `pass`, `warning`, `fail`, `blocked`, or `unsupported` with evidence.

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
- Target-specific agent guidance semantics: GitHub Copilot custom agent definitions, Claude Code `CLAUDE.md` guidance, and Codex `AGENTS.md` guidance are not interchangeable and must be reported separately.
- Plugin payload manifests and directories from `.github/plugins/azure-functions-skills/` or the built plugin output.
- Azure Skills dependency expectations from README, setup guidance, and generated skills text.

The report should include the inventory counts and paths used for each run. If a template is added or removed, the E2E expectations should change automatically because they come from this inventory.

## Workspace and cwd requirements

All scenario commands that can write files must run from an isolated scenario workspace under `reports/e2e/<run-id>/workspaces/<scenario-id>/`. This includes setup commands, chat commands, real-agent inspection prompts, and any CLI help/discovery command that could accidentally execute setup or chat behavior. Do not run these commands from the repository root. For this package, treat `setup --help` as unsafe from the repository root because it can follow the setup code path in current CLI versions; use top-level `--help` for read-only discovery, or run subcommand help probes inside a disposable scenario workspace.

When invoking this repository's CLI, pass `--dir <scenario-workspace>` explicitly and set the process cwd to that scenario workspace whenever practical. Avoid reusable examples that depend only on `--dir .`; if `--dir .` is used for an interactive manual step, the command block must first set and verify cwd as the scenario workspace. If a command must run from the repository root to access source files, record why it is read-only or otherwise safe, and verify afterward that no root-level `.agents`, `.claude`, `.codex`, `.github/agents`, `.github/hooks`, `.github/skills/<non-e2e>`, `AGENTS.md`, or `CLAUDE.md` artifacts were created.

Resolve scenario paths from the repository root rather than hard-coding drive letters or host-specific absolute paths. Use `git rev-parse --show-toplevel`, `Join-Path` in PowerShell, and quoted variables in Bash. Do not keep relative `reports/e2e/...` variables after changing cwd; this causes nested scenario workspaces. If cwd drift creates a nested scenario workspace, mark that evidence harness-invalid and rerun the scenario from a clean sibling workspace.

PowerShell pattern:

```powershell
$Repo = (git rev-parse --show-toplevel).Trim()
$RunDir = Join-Path $Repo 'reports/e2e/<run-id>'
$Workspaces = Join-Path $RunDir 'workspaces'
$workspace = Join-Path $Workspaces '<scenario-id>'
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
Push-Location $workspace
try {
  if ((Get-Location).Path -ne $workspace) { throw "cwd is not scenario workspace" }
  # scenario command with --dir $workspace
} finally {
  Pop-Location
}
```

Bash pattern:

```bash
repo="$(git rev-parse --show-toplevel)"
run_dir="$repo/reports/e2e/<run-id>"
workspace="$run_dir/workspaces/<scenario-id>"
mkdir -p "$workspace"
(
  cd "$workspace"
  test "$(pwd)" = "$workspace" || exit 1
  # scenario command with --dir "$workspace"
)
```

Run directories under `reports/e2e/<run-id>/` are analysis-only. The shareable commit artifact is `reports/e2e/current/report.html`, which should be overwritten with the reviewed report at the end of the run.

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

1. Install or prepare the isolated scenario workspace with the documented setup/chat command. The command cwd and `--dir` target must be `reports/e2e/<run-id>/workspaces/<scenario-id>/` or an equivalent disposable workspace, never the repository root.
2. Check the expected files from the dynamic inventory were written to the isolated workspace.
3. Launch the real target coding-agent CLI with an inspection prompt.
4. Require the agent response to report visible or usable `skills`, `prompts`, `mcp`, `hooks`, and `agents` surfaces, or explicitly classify unsupported surfaces.

File checks alone are insufficient for `pass` because they do not prove the coding agent can load or use the installed surfaces. If the files exist but the agent cannot be launched or cannot confirm visibility, classify the scenario as `blocked` or `fail` with evidence.

### Inspection artifact requirement

Setup, chat, and plugin scenarios should capture the real-agent inspection response into a durable artifact in the scenario workspace. Prefer parseable JSON, normally `e2e-chat-inspection.json` or `e2e-agent-inspection.json`. For GitHub Copilot chat, a Markdown artifact such as `artifact.md` is acceptable when it is produced by the normal `chat --prompt ...` launcher path and contains the required workspace root and surface inventory. For Claude Code and Codex chat scenarios, prefer producing the artifact through `azure-functions-skills chat` pass-through arguments so the test exercises the real chat launcher and the target agent in one command. The runner may write this artifact from noninteractive agent output when the scenario is not specifically testing write behavior.

JSON inspection prompts should require these fields. GitHub Copilot chat may use a Markdown artifact instead, but the artifact must include equivalent labels for the same data.

```json
{
  "agent": "codex",
  "workspaceRoot": "<scenario-workspace>",
  "startupContextVisible": true,
  "skills": [],
  "mcpServers": [],
  "hooks": [],
  "agents": [],
  "passed": true,
  "notes": []
}
```

The runner must parse JSON artifacts or review Markdown artifacts, verify `workspaceRoot` is the isolated scenario workspace, and compare reported surfaces with the dynamic inventory. If the artifact is missing, empty, invalid for its declared format, reports the repository root instead of the scenario workspace, or omits required surfaces without an unsupported/block reason, classify the inspection check as `fail` or `blocked`.

Do not rely on an unobserved interactive `chat` command with no durable artifact. For GitHub Copilot, the primary chat proof is the normal `chat --agent github-copilot` launcher path with either headless Copilot passthrough that returns parseable output or a prompt that writes `artifact.md`/`e2e-chat-inspection.json` inside the scenario workspace. Do not use `chat --agent ghcp`; `ghcp` is the setup target id, not the chat launcher id. Do not use `chat --agent azure-functions-skills:functions-copilot`; that qualified id belongs to direct installed-plugin Copilot inspection, not this package's `chat --agent` option. For Claude Code and Codex, prefer the `chat` command's pass-through behavior to select noninteractive modes. If pass-through fails, record that as chat evidence and use a direct agent command only as a diagnostic follow-up, not as a substitute for passing the chat scenario.

Recommended chat inspection command shapes:

```powershell
# GitHub Copilot: exercise workspace-local agent discovery through chat's normal launcher.
Push-Location $workspace
try {
  if ((Get-Location).Path -ne $workspace) { throw "cwd is not scenario workspace" }
  azure-functions-skills chat --agent github-copilot --dir $workspace --skip-prerequisites `
    --output-format json -s --allow-all --no-ask-user -p "Inspect visible Azure Functions skills, agents, MCP, hooks, startup context, and workspace root. Return raw JSON with passed=true when visible."
} finally {
  Pop-Location
}

# Claude Code: chat inserts --prompt content after -p/--print and forwards the rest.
azure-functions-skills chat --agent claude-code --dir <workspace> --skip-prerequisites `
  --prompt "<inspection prompt>" -p --output-format text --no-session-persistence `
  --permission-mode bypassPermissions --tools Read,LS,Grep,Glob,Write

# Codex: pass the exec subcommand and output-file options through chat.
azure-functions-skills chat --agent codex --dir <workspace> --skip-prerequisites `
  --prompt "<inspection prompt>" exec --sandbox workspace-write --json `
  --output-last-message e2e-chat-inspection.txt --ephemeral --skip-git-repo-check --cd <workspace>
```

For GitHub Copilot chat, parse the raw JSON/stdout returned by the chat-launched Copilot process or parse the workspace artifact produced by the agent, and keep command output as evidence. Direct `copilot -p --output-format json` is useful for installed-plugin inspection and diagnostics, but it is not equivalent to the workspace-local `chat` launcher path and should not be the primary proof for `chat-welcome-ghcp`. For Claude Code, parse the requested raw JSON artifact or stdout text. For Codex, parse the `--output-last-message` file and keep the full `--json` transcript as command evidence.

## Fresh plugin install requirements

Plugin scenarios validate the installation flow, not reuse of a plugin that happened to be installed before the run. Every plugin scenario must capture these phases:

1. **Pre-state discovery** — record installed plugins, registered marketplaces, source directories, or current CLI help/list output for the target host.
2. **Target cleanup or isolation** — if `azure-functions-skills` is already installed or registered in a way that would satisfy the test without reinstalling, uninstall/remove only that target plugin with the official CLI after user approval, or use a documented isolated config/profile if the host supports one.
3. **Fresh install/register** — run the README command contract after cleanup/isolation.
4. **Post-state discovery** — record plugin list/details or equivalent evidence that the fresh install/register changed the active state.
5. **Agent-visible inspection** — launch the real agent and ask it to report usable `agents`, `skills`, `prompts`, `mcp`, `hooks`, plugin surfaces, and Azure Skills dependency surfaces.

Plugin scenario inspection commands must run from that scenario's workspace under `reports/e2e/<run-id>/workspaces/<scenario-id>/`. If plugin registration requires a repository plugin payload path, pass the payload path explicitly instead of changing cwd to the repository root.

If cleanup would mutate user-level state and approval is unavailable, mark the cleanup check `blocked`. If a CLI does not expose uninstall/select/list commands outside an interactive UI, record the command/help output and classify the plugin scenario as `blocked` unless the user completes the interaction. Do not uninstall unrelated plugins. Do not uninstall the dependent `azure-skills` plugin unless the selected dependency scenario explicitly requires a missing-dependency state and the user approves it.

Start plugin scenarios with cleanup after pre-state discovery. The cleanup command sequence is stable enough to document directly per host. Treat "not installed" or "not registered" as a clean pre-state for the target phase and continue. Treat existing installation as normal pre-state, not as a failure.

GitHub Copilot cleanup/install sequence:

```powershell
copilot plugin list
copilot plugin marketplace list
copilot plugin uninstall azure-functions-skills
copilot plugin marketplace remove azure-functions-skills
copilot plugin marketplace add Azure/azure-functions-skills
copilot plugin install azure-functions-skills@azure-functions-skills
copilot plugin list
copilot --agent azure-functions-skills:functions-copilot -p "<inspection prompt>" --output-format json -s --allow-all --no-ask-user
```

Linux/macOS shells use the same `copilot` subcommands; quote the inspection prompt with single quotes or pass it through a variable. Do not remove `azure-skills` or any unrelated plugin during this scenario.

## Automation-friendly command patterns

Use noninteractive CLI modes whenever they can preserve the scenario contract. Keep this section to host-specific caveats; scenario command contracts above remain the source of truth.

- Claude Code inspection prompts should use `claude -p` / `claude --print` with `--output-format json` when practical, `--no-session-persistence`, `--permission-mode dontAsk`, and a small tool allowlist such as `--tools Read,LS,Grep,Glob`.
- Claude Code parseable artifact prompts may use `--output-format text` plus shell redirection to `e2e-chat-inspection.json` when the prompt requires raw JSON only. Use `setup --agent claude` for setup-mode installation; `claude-code` is the chat launcher id unless current CLI help says otherwise.
- Claude Code session-scoped plugin tests should prefer `--plugin-dir <plugin-payload-dir>` when available. This loads a plugin for the current run only and avoids manual/global install state. If the README command is still `--add-dir`, record whether `--add-dir` and `--plugin-dir` are equivalent or whether README needs to be updated.
- Claude Code installed plugin tests should use `claude plugin list --json`, `claude plugin install <plugin> --scope local|project|user`, and `claude plugin uninstall|remove <plugin> --scope <scope> -y` for approved fresh-install cleanup.
- Codex inspection prompts should use `codex exec --sandbox read-only --json --output-last-message <file> --ephemeral --skip-git-repo-check --cd <workspace> <prompt>` when practical.
- For Codex, keep the `--json` transcript as command evidence and parse the `--output-last-message` file as the concise inspection artifact. Do not use bare `codex <prompt>` for non-TTY E2E.
- Codex marketplace cleanup can use `codex plugin marketplace remove <name>` followed by `codex plugin marketplace add <source>` when approved. Current Codex CLI versions may expose noninteractive plugin installation through `codex plugin add <plugin>@<marketplace>` or `codex plugin add <plugin> --marketplace <marketplace>`; prefer that automation-friendly form when help output confirms it. If the installed Codex CLI lacks noninteractive plugin add/list/remove support, plugin activation from `/plugins` remains `blocked` unless the user completes the interaction or an isolated profile proves activation.
- If a TUI opens despite these options, capture the help output showing the missing noninteractive path and classify the scenario instead of waiting indefinitely.

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
  - A real GitHub Copilot CLI run through `azure-functions-skills chat --agent github-copilot --dir <scenario-workspace>` with headless passthrough (`--output-format json -s --allow-all --no-ask-user -p <inspection prompt>`) or an artifact-writing prompt confirms the startup-loaded agent can see or use installed skills, prompts/instructions, MCP, hooks, and agent surfaces. If a manual rerun uses `--dir .`, the command evidence must show the cwd was the scenario workspace, not the repository root.
  - Do not fail this scenario solely because a direct `copilot -p` headless diagnostic cannot select the workspace-local `functions-copilot` agent. That diagnostic uses a different discovery path than the chat launcher.

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
  1. Run `copilot plugin marketplace list` and `copilot plugin list` or the current CLI equivalents and record whether `azure-functions-skills` is already registered/installed.
  2. Run `copilot plugin uninstall azure-functions-skills` after approval. If the target plugin is absent, record that as clean pre-state and continue. If this cannot be done and no isolated Copilot plugin config is available, mark cleanup `blocked` and do not mark the scenario `pass`.
  3. Run `copilot plugin marketplace remove azure-functions-skills` after approval. If the target marketplace is absent, record that as clean pre-state and continue.
  4. Run `copilot plugin marketplace add Azure/azure-functions-skills`.
  5. Run `copilot plugin install azure-functions-skills@azure-functions-skills`.
  6. Run `copilot plugin list` and, when available, plugin details to prove post-install state.
  7. Run `copilot --agent azure-functions-skills:functions-copilot -p "<inspection prompt>" --output-format json -s --allow-all --no-ask-user` or the current qualified installed-plugin agent equivalent from CLI help/error output.
- Required checks:
  - Existing plugin registration is discovered and then cleared or isolated safely; if global cleanup is unsafe, denied, or unsupported, record `blocked` for cleanup and continue only with a proven isolated registration when possible.
  - The uninstall/remove command for the target plugin is recorded when the plugin was present before the run.
  - The documented marketplace add command completes or produces an auth/approval `blocked` result.
  - The documented plugin install command completes or produces an auth/approval `blocked` result.
  - Post-install plugin state is recorded.
  - The post-install Copilot command runs with the installed-plugin agent, normally `--agent azure-functions-skills:functions-copilot`, and an inspection prompt.
  - `functions-copilot` agent is discoverable through the installed plugin. A qualified plugin agent name is expected and should not be reported as a docs or product failure.
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
  1. Run `claude plugin list` and `claude plugin marketplace list` when available, plus `claude plugin --help`, and record whether `azure-functions-skills` is already installed. For `--add-dir` source tests, also record the exact source directory being added.
  2. If testing an installed Claude plugin and `azure-functions-skills` is already installed, run `claude plugin uninstall azure-functions-skills` or `claude plugin remove azure-functions-skills` after approval. If testing `--add-dir`, start from an isolated workspace and use a single explicit `--add-dir` source for this run.
  3. Use the README plugin-from-source flow: `git clone https://github.com/Azure/azure-functions-skills.git` when testing from remote, or the local repository equivalent when testing the current branch.
  4. Run `claude --add-dir ./azure-functions-skills/.github/plugins/azure-functions-skills` or the local equivalent plugin payload path from the README contract. When current Claude Code supports it, also run or prefer the session-scoped automation equivalent `claude -p --plugin-dir <plugin-payload-dir> --output-format json --no-session-persistence <inspection prompt>` to avoid manual/global plugin state.
  5. Run Claude with an inspection prompt in the isolated workspace.
- Required checks:
  - Existing plugin/source registration is discovered and then cleared or isolated safely; if global cleanup is unsafe, denied, or unsupported, record `blocked` for cleanup and continue only with a proven isolated source registration when possible.
  - If an installed target plugin was present before the run, the official uninstall/remove command is recorded or the cleanup check is `blocked`.
  - The documented `--add-dir` command is attempted and recorded, or the report explicitly records that current Claude Code uses `--plugin-dir` as the noninteractive session-scoped equivalent and flags the README divergence in `docs-command-consistency`.
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
  1. Run `codex plugin --help`, `codex plugin marketplace --help`, and any available `list`/`details` commands to record current install and marketplace support. Also record `codex exec --help` so the report shows which noninteractive inspection options were available.
  2. If `azure-functions-skills` is already installed or registered in a way that would satisfy the scenario without reinstalling, remove only that target plugin/marketplace with the official CLI after approval, or use a documented isolated Codex config/profile. If current Codex only supports interactive `/plugins` for uninstall/select, record that and mark cleanup or install/select `blocked` unless the user completes the interaction.
  3. Run `codex plugin marketplace add Azure/azure-functions-skills`.
  4. Install/select `azure-functions-skills` from `/plugins` when the CLI supports it, or record the current documented/CLI-help equivalent.
  5. Record post-install state using available list/details/help output.
  6. Run Codex with an inspection prompt in the isolated workspace, preferably `codex exec --sandbox read-only --json --output-last-message <file> --ephemeral --skip-git-repo-check --cd <workspace> <inspection prompt>`.
- Required checks:
  - Existing plugin registration is discovered and then cleared or isolated safely; if global cleanup is unsafe, denied, interactive-only, or unsupported, record `blocked` for cleanup and continue only with a proven isolated registration when possible.
  - If the target plugin or marketplace was present before the run, the official remove/uninstall command is recorded or the cleanup check is `blocked`.
  - The documented marketplace add command completes or produces an auth/approval `blocked` result.
  - The plugin install/select step is attempted or documented as unsupported by current CLI help.
  - Post-install or post-registration state is recorded.
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
