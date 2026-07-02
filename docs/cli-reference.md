# CLI Reference

Full reference for every `@azure/functions-skills` command, all flags, and headless examples.

For a guided tour and recommended workflows, start with the [README](../README.md).

## Quick links

- [`install`](#install) — install plugin + workspace activation
- [`update`](#update) — refresh plugin and workspace
- [`setup`](#setup) — workspace-local install (no plugin host)
- [`chat`](#chat) — launch a CLI agent with Azure Functions context
- [`doctor`](#doctor) — pre-deployment validation
- [`workspace apply` / `workspace update`](#workspace-apply--workspace-update) — workspace activation files
- [`plugin install` / `plugin update`](#plugin-install--plugin-update) — host plugin only
- [`state setup-complete`](#state-setup-complete) — mark first-run setup done
- [`build`](#build) — build plugin artifacts (contributors)

## Conventions

- `npx @azure/functions-skills <cmd>` runs without global install. Pinning a version: `npx @azure/functions-skills@<version> <cmd>`.
- If installed globally (`npm i -g @azure/functions-skills`), drop the `npx` prefix and use `azure-functions-skills <cmd>`.
- `--dir <path>` defaults to the current working directory.
- `--agent <name>` accepts `github-copilot`, `claude-code`, `codex`, or the short forms `ghcp`, `claude`, `codex` where the underlying command supports it.

---

## `install`

One-step install: registers the plugin with the host agent and applies workspace activation.

```bash
npx @azure/functions-skills install --agent ghcp --dir ./my-app
```

Options:

| Flag | Default | Description |
| --- | --- | --- |
| `--agent <name>` | (interactive prompt) | Repeatable. `ghcp`, `claude`, `codex`. CI must specify. |
| `--all` | off | Install all supported agents. |
| `--dir <path>` | `cwd` | Target directory. |
| `--local` | off | Full workspace-local setup from bundled npm package assets. Compatibility flow when the host has no plugin support. |
| `--dry-run` | off | Print planned actions without writing. |
| `--yes` | off | Approve modifying existing instruction files and adding state to `.gitignore`. |
| `--source <name>` | `marketplace` | `marketplace`, `github`, or `local`. |
| `--scope <name>` | `workspace` | `workspace` or `user`. |
| `--no-mcp` | off | Do not add workspace MCP files. |
| `--no-hooks` | off | Do not add workspace hook files. |
| `--skip-prerequisites` | off | Skip external prerequisite checks. |
| `-- <args...>` | — | Pass-through to host plugin install (single agent only). |

State: `install` writes `.azure-functions-skills/state.local.json` so future `chat`/`update` runs can use the same agent selection. With `--yes`, only this state file is appended to `.gitignore`; the directory itself is not ignored because workspace activation files may be useful to commit.

Local installs use only the `templates/` assets bundled in the installed `@azure/functions-skills` npm package. They do not fetch templates from GitHub or accept a source ref. If a newer npm package is available, local install/update prints an actionable update command such as `npm install -g @azure/functions-skills@latest`.

---

## `update`

Refresh plugin registration and workspace activation. Reads installed agents from state when `--agent` is omitted.

```bash
npx @azure/functions-skills update
npx @azure/functions-skills update --agent ghcp
```

Same flags as `install`. For workspaces installed with `install --local`, `update` auto-detects local mode from state and refreshes files from the currently installed npm package's bundled assets.

---

## `setup`

Workspace-local install only — copies skill bodies, hooks, MCP configuration. Use when the host does not support plugins, or when a fully self-contained workspace is required.

```bash
npx @azure/functions-skills setup --agent ghcp --dir ./my-app
```

| Flag | Default | Description |
| --- | --- | --- |
| `--agent <name>` | detect | Repeatable. |
| `--all` | off | Install all supported agents. |
| `--dir <path>` | `cwd` | Target directory. |
| `--as-plugin` | off | Register as native plugin instead of copying files. |
| `--check-prerequisites` | off | Check external prerequisites without installing them. |
| `--skip-prerequisites` | off | Skip prerequisite checks entirely. |

---

## Library API for local installs

VS Code extensions can run the CLI `install --local` flow without spawning the CLI:

```ts
import { installLocalSkills } from '@azure/functions-skills/setup';

const result = await installLocalSkills({
  targetDir: workspaceFolder.uri.fsPath,
  agents: ['ghcp'],
  yes: true,
  prerequisites: 'skip',
});
```

| Option | Required | Description |
| --- | --- | --- |
| `targetDir` | yes | Workspace root where package-bundled local assets should be installed. |
| `agents` | no | `ghcp`, `claude`, `codex`. Defaults to GHCP-compatible setup when omitted. |
| `dryRun` | no | Return planned local files without writing. |
| `yes` | no | Approve safe noninteractive changes such as state `.gitignore` updates and GHCP git initialization. |
| `prerequisites` | no | `auto`, `check-only`, or `skip`, matching CLI behavior. |
| `checkForUpdates` | no | Set `false` to skip npm package freshness guidance. |
| `runner` | no | Injectable command runner for tests or extension-host controlled npm checks. |
| `initializeGitForGhcp` | no | Set `false` to skip GHCP git initialization. |

The result includes `agents`, `filesWritten`, `state`, `gitignoreResult`, `gitRepoResult`, and `packageUpdate` so an extension can present its own notifications.

---

## `chat`

Launch a CLI coding agent with Azure Functions context. When `--agent` is omitted, chat uses workspace state to select the previously installed agent.

```bash
npx @azure/functions-skills chat --dir ./my-app
npx @azure/functions-skills chat --agent github-copilot --dir ./my-app
```

| Flag | Default | Description |
| --- | --- | --- |
| `--agent <name>` | state | `github-copilot`, `claude-code`, `codex`. |
| `--prompt <text>` | startup template | Custom prompt. |
| `--dir <path>` | `cwd` | Working directory. |
| `--as-plugin` | off | Ensure the native plugin is registered before launching the agent. |
| `--dry-run` | off | Print the planned agent launch without starting the agent or updating state. |
| `--check-prerequisites` | off | Check external prerequisites and exit. |
| `--skip-prerequisites` | off | Skip prerequisite checks. |
| `-- <args...>` | — | Pass-through to the underlying agent CLI. |

### Headless examples

```bash
# GitHub Copilot CLI — noninteractive JSON output:
npx @azure/functions-skills chat --agent github-copilot --dir ./my-app --skip-prerequisites -- \
  --output-format json -s --allow-all --no-ask-user \
  -p "Inspect visible Azure Functions skills and return JSON."

# Claude Code:
npx @azure/functions-skills chat --agent claude-code --dir ./my-app --skip-prerequisites \
  --prompt "Inspect visible Azure Functions skills and return JSON." -- \
  -p --output-format json --no-session-persistence \
  --permission-mode bypassPermissions --tools Read,LS,Grep,Glob

# Codex CLI:
npx @azure/functions-skills chat --agent codex --dir ./my-app --skip-prerequisites \
  --prompt "Inspect visible Azure Functions skills." -- \
  exec --sandbox read-only --json --output-last-message out.txt \
  --ephemeral --skip-git-repo-check --cd .
```

`chat` does not install files; run `install` (or `setup`) once before the first chat.

---

## `doctor`

Pre-deployment validation. Two tiers: Tier 1 deterministic built-in checks (always on), Tier 2 LLM agent semantic analysis (opt-in with `--deep --accept-deep-risk`).

See [doctor-guide.md](doctor-guide.md) for a full walkthrough.

```bash
# Tier 1 only
npx @azure/functions-skills doctor --dir ./my-app

# Tier 2 (requires explicit risk acceptance — agent runs with elevated permissions)
npx @azure/functions-skills doctor --dir ./my-app --deep --accept-deep-risk --agent github-copilot

# HTML report for local viewing
npx @azure/functions-skills doctor --dir ./my-app --format html --output doctor-report.html

# CI mode (JSON artifact)
npx @azure/functions-skills doctor --dir ./my-app --format json --output doctor.json
```

| Flag | Default | Description |
| --- | --- | --- |
| `--dir <path>` | `cwd` | Target workspace. |
| `--deep` | off | Enable AI agent analysis (Tier 2). Requires `--accept-deep-risk`. |
| `--no-deep` | — | Force Tier 1 only. |
| `--accept-deep-risk` | off | Acknowledge that `--deep` runs the agent with elevated permissions (file write, shell execution). Required for Tier 2. |
| `--agent <name>` | state | Agent for Tier 2: `github-copilot`, `claude-code`, `codex`. |
| `--install-mode <m>` | `local` | How to auto-install skills if not present: `local` (CI-safe) or `plugin`. |
| `--timeout <seconds>` | `300` | Tier 2 timeout. |
| `--format <type>` | `text` | `text`, `json`, `markdown`, `html`. |
| `--output <path>` | `.azure-functions-skills/doctor-report.json` | Report file path. |
| `--checks <names>` | all | Comma-separated check IDs to run. |
| `--severity <level>` | `high` | Minimum severity to fail: `critical`, `high`, `medium`, `low`. |

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | All checks passed |
| `1` | Problems found at or above `--severity` threshold |
| `2` | Doctor command itself failed (not a project issue) |

---

## `workspace apply` / `workspace update`

Apply or refresh workspace activation files without re-running the host plugin install.

```bash
# Preview
npx @azure/functions-skills workspace apply --agent claude --mode plugin-reference --dry-run

# Apply (append managed block)
npx @azure/functions-skills workspace apply --agent claude --mode plugin-reference --yes

# Keep CLAUDE.md/AGENTS.md small (separate include file)
npx @azure/functions-skills workspace apply --agent codex --mode plugin-reference \
  --merge-strategy include-file --yes

# Add MCP/hooks explicitly
npx @azure/functions-skills workspace apply --agent codex --mode plugin-reference \
  --include-mcp --include-hooks --yes
```

| Flag | Default | Description |
| --- | --- | --- |
| `--agent <name>` | detect | Repeatable. |
| `--dir <path>` | `cwd` | Target directory. |
| `--mode <name>` | `copy` | `minimal`, `copy`, `plugin-reference`. |
| `--merge-strategy <name>` | `managed-block` | `managed-block`, `include-file`, `fail-if-exists`, `append`. |
| `--update` | off | Replace existing Azure Functions managed blocks. |
| `--dry-run` | off | Print planned changes without writing. |
| `--yes` | off | Approve modifying existing instruction files. |
| `--include-agent` | off | Add GHCP `functions-copilot` workspace agent definition. |
| `--include-mcp` | off | Add workspace MCP configuration files. |
| `--include-hooks` | off | Add supported workspace hook files. |

---

## `plugin install` / `plugin update`

Host plugin registration only — does not apply workspace activation.

```bash
npx @azure/functions-skills plugin install --agent ghcp --dry-run
```

| Flag | Default | Description |
| --- | --- | --- |
| `--agent <name>` | (required) | Repeatable. |
| `--dir <path>` | `cwd` | Target directory. |
| `--scope <name>` | `workspace` | `workspace` or `user`. |
| `--source <name>` | `marketplace` | `marketplace`, `github`, or `local`. |
| `--version <value>` | package version | Plugin version/ref to install. |
| `--workspace` / `--no-workspace` | `workspace on` | Apply workspace activation. |
| `--dry-run` | off | Print planned changes. |
| `--yes` | off | Approve workspace activation changes. |

---

## `state setup-complete`

Mark the first-run setup skill as complete so subsequent `chat` calls skip the setup prompt.

```bash
npx @azure/functions-skills state setup-complete --dir ./my-app --agent github-copilot
```

---

## `build`

Build plugin artifacts (workspace layouts + plugin payload) into `dist/`. For contributors only — see [CONTRIBUTING.md](../CONTRIBUTING.md).

```bash
npm run build
# or
npx @azure/functions-skills build
```

---

## Comparison: `install` vs `chat` vs `setup`

| Option | Use when | What it does |
| --- | --- | --- |
| `install` | Setting up Azure Functions Skills for a repo | Plugin install + workspace activation (one step). |
| `chat` | Launching a CLI agent with Azure Functions context | Starts the selected agent with the startup prompt. Does not install files. |
| `workspace apply` | After plugin install, need repo-local routing or opt-in MCP/hooks | Writes thin routing blocks and optional workspace files. |
| `plugin install` | Advanced control over host plugin install only | Runs the host plugin flow without workspace activation. |
| `install --local` / `setup` | Host has no plugin support, or fully self-contained workspace | Copies skill bodies, hooks, MCP into the workspace. |

---

## Environment variables

| Variable | Purpose |
| --- | --- |
| `AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE` | Set to `1` to skip live Azure Stack API calls in doctor (uses built-in fallback). Useful for CI and reproducible tests. |
