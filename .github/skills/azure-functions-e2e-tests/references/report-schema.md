# E2E Evidence and Report Schema

Use this schema as the stable contract for E2E evidence. HTML can be authored from this data by an agent; a deterministic HTML renderer is optional.

## Scenario result record

Each scenario run should emit one JSON object.

```json
{
  "runId": "20260516-001",
  "scenarioId": "chat-welcome-ghcp",
  "agent": "github-copilot",
  "installMode": "chat",
  "platform": "windows",
  "status": "pass",
  "support": "supported",
  "agentVersion": "...",
  "packageVersion": "...",
  "startedAt": "2026-05-16T00:00:00Z",
  "completedAt": "2026-05-16T00:03:00Z",
  "inventory": {
    "skills": ["templates/skills/azure-functions-create/SKILL.md"],
    "prompts": ["templates/prompts/startup.md"],
    "mcp": ["templates/mcp/servers.yaml"],
    "hooks": ["templates/hooks/welcome-setup.md"],
    "agents": ["templates/agents/functions-copilot.agent.md"]
  },
  "scenarioScope": {
    "requestedScope": "full-local-matrix",
    "explicitlyNarrowedByUser": false,
    "requiredScenarioIds": ["setup-workspace-ghcp", "chat-welcome-ghcp", "plugin-install-ghcp", "..."],
    "omittedScenarioIds": []
  },
  "pluginLifecycle": {
    "preStateCommand": "copilot plugin list",
    "preStateSummary": "azure-functions-skills was not installed",
    "cleanupPolicy": "fresh-install-required",
    "cleanupCommand": "not needed because target plugin was absent",
    "cleanupStatus": "not-needed",
    "installCommand": "copilot plugin install azure-functions-skills@azure-functions-skills",
    "postStateCommand": "copilot plugin list",
    "postStateSummary": "azure-functions-skills installed"
  },
  "commandLog": [
    {
      "command": "codex exec --sandbox read-only ...",
      "cwd": "<redacted-temp-workspace>",
      "startedAt": "2026-05-16T00:01:00Z",
      "completedAt": "2026-05-16T00:01:20Z",
      "exitCode": 0,
      "stdoutExcerpt": "...",
      "stderrExcerpt": "..."
    }
  ],
  "workspaceRetention": {
    "policy": "keep-failed",
    "retainedPath": "<redacted-temp-workspace>",
    "cleanupStatus": "retained for debugging"
  },
  "crossCheck": {
    "status": "pass",
    "reviewer": "self-review",
    "findings": []
  },
  "checks": [
    {
      "name": "welcome message",
      "surface": "prompts",
      "status": "pass",
      "support": "supported",
      "evidence": "Startup prompt mentions Azure Functions Skills."
    }
  ],
  "issues": [],
  "artifacts": {
    "transcript": "reports/e2e/<run-id>/transcripts/chat-welcome-ghcp.md",
    "workspaceDir": "<redacted-temp-workspace>"
  }
}
```

## Required fields

| Field | Required | Notes |
| --- | --- | --- |
| `runId` | Yes | Stable identifier for the whole run. |
| `scenarioId` | Yes | Must match an ID in `scenarios.md`. |
| `agent` | Yes | `github-copilot`, `claude-code`, `codex`, or `all` for static checks. |
| `installMode` | Yes | `plugin`, `setup`, `chat`, or `docs`. |
| `platform` | Yes | `windows`, `linux`, or another explicit platform value. |
| `status` | Yes | `pass`, `warning`, `fail`, `blocked`, or `unsupported`. |
| `support` | Yes | `supported`, `partial`, `unsupported`, or `unknown`. |
| `agentVersion` | Yes for real-agent runs | Use `unavailable` when the CLI is missing. |
| `packageVersion` | Yes | Package version or commit SHA under test. |
| `startedAt` / `completedAt` | Yes | ISO-8601 timestamps. |
| `inventory` | Yes | Dynamic inventory paths used to derive expected skills/prompts/MCP/hooks/agents/plugin payload checks. |
| `scenarioScope` | Yes | Records whether the run used the default full local matrix or was explicitly narrowed by the user. Must list required and omitted scenario IDs. `omittedScenarioIds` should be empty unless the user narrowed scope; otherwise omitted scenarios must appear as scenario records with `blocked`, `unsupported`, or `fail`. |
| `pluginLifecycle` | Yes for plugin scenarios | Records pre-state discovery, cleanup/uninstall or isolation, install/register, and post-state discovery. Use `not-applicable` for non-plugin scenarios. |
| `commandLog` | Yes | Commands used to evaluate the scenario, cwd, timing, exit code, and redacted stdout/stderr excerpts. |
| `workspaceRetention` | Yes | Whether the temporary workspace was deleted or retained for debugging. |
| `crossCheck` | Yes | Review result for this scenario or the overall report. |
| `checks` | Yes | One or more check records. |
| `issues` | Yes | Empty array when no issues are found. |
| `artifacts` | No | Paths to redacted artifacts. |

## Check record

```json
{
  "name": "plugin installed",
  "surface": "plugin",
  "status": "pass",
  "support": "supported",
  "evidence": "copilot plugin list includes azure-functions-skills"
}
```

`surface` must be one of `plugin`, `skills`, `prompts`, `mcp`, `hooks`, `agents`, `agent-launch`, `agent-inspection`, `setup-files`, or `general`.
Use `support: "unsupported"` for surfaces that the package or agent cannot support today. For example, Claude Code native plugin support must not be reported as passing unless the test actually launches Claude with the plugin loaded and proves the plugin surfaces are visible.
Checks should cite dynamic inventory paths instead of assuming a fixed template list. If a template changes, the next run should discover the new inventory and update expectations automatically.

For plugin scenarios, command logs must prove the documented install sequence was attempted before any plugin visibility result is marked `pass` or `warning`. For example, GitHub Copilot plugin evidence must include `copilot plugin marketplace add Azure/azure-functions-skills`, `copilot plugin install azure-functions-skills@azure-functions-skills`, and a post-install `copilot --agent functions-copilot ...` inspection command. If those required commands are missing, fail, time out, or do not prove visibility, classify the scenario as `fail` or `blocked`, not `warning`.

Plugin scenarios must also prove fresh-install semantics. A plugin scenario cannot be `pass` unless evidence includes:

- Pre-state discovery output for installed plugins and marketplaces or the closest current CLI equivalent.
- Cleanup/isolation evidence. If `azure-functions-skills` was already installed, record the official uninstall/remove command and result. If cleanup required user approval and approval was unavailable, mark the cleanup check and the plugin scenario `blocked` unless an isolated config/profile proves freshness.
- Install/register command output from the documented flow.
- Post-state discovery output after install/register.
- Real-agent inspection output proving usable plugin surfaces.

Do not count setup-mode files, repository payload files, or a previously installed plugin as plugin scenario success unless the documented plugin lifecycle above completed in the current run.

## Issue record

```json
{
  "severity": "high",
  "summary": "Plugin installed but functions-copilot was not discoverable.",
  "recommendedFix": "Verify plugin manifest agents path and regenerate plugin payload."
}
```

Severity values:

- `critical`
- `high`
- `medium`
- `low`

## Command log display

HTML reports should expose command logs in collapsed sections, for example with `<details><summary>Command and output</summary>...</details>`.
Include the command text, cwd, exit code, timing, and redacted stdout/stderr excerpts. Keep the high-level report readable while making the raw evaluation path available for debugging.

## Workspace retention record

Ask the user whether to keep failed workspaces, keep all workspaces, or delete all temporary workspaces. Record the selected policy and cleanup status. Workspaces must live under `reports/e2e/<run-id>/workspaces/<scenario-id>/` or another explicitly disposable run directory, never in the repository root. If retained paths are included in shareable reports, redact user-specific path segments.

## Git and publishing policy

Date-stamped run directories under `reports/e2e/<run-id>/` are analysis-only and should be ignored by git. They may contain evidence JSON, transcripts, retained workspaces, session notes, and skill-improvement notes. The only E2E report artifact intended for commit is `reports/e2e/current/report.html`.

After cross-checking a run, copy the reviewed `reports/e2e/<run-id>/report.html` to `reports/e2e/current/report.html`. Do not copy analysis-only artifacts into `current/` unless explicitly requested.

## Skill improvement report

Each run should produce a companion skill-improvement report that lists where the agent struggled while running the skill, such as command option discovery, unclear documentation, authentication prompts, unsupported non-interactive CLI behavior, or report-writing ambiguity. Each item should include a proposed change to this skill or its references.

## Cross-check record

Before finalizing, review evidence, report text, status classifications, command logs, and failure analysis. Record whether the review found contradictions or missing evidence. If another model/agent/reviewer is available, use it for the critique; otherwise record an explicit self-review.

The cross-check must include a default-scope coverage check:

- If `explicitlyNarrowedByUser` is false, verify that GitHub Copilot, Claude Code, and Codex all have setup, chat, and plugin scenario records, plus shared docs consistency, basic help, and Azure Skills dependency records.
- Verify that no required scenario is absent from both `scenarioResults` and `omittedScenarioIds`.
- Verify that every omitted scenario has an explicit user narrowing reason; otherwise add a `blocked`, `unsupported`, or `fail` scenario record before publishing.
- Verify that every plugin scenario has `pluginLifecycle` pre-state, cleanup/isolation, install/register, post-state, and inspection evidence. If any phase is missing, the plugin scenario cannot be `pass` or `warning`.
- Verify that command logs for setup/chat/agent-inspection scenarios use isolated scenario workspaces as cwd or document why a different cwd was safe.
- Verify `git status --short` does not show generated root-level `.agents`, `.claude`, `.codex`, `.github/agents`, `.github/hooks`, `.github/skills/<non-e2e>`, `AGENTS.md`, or `CLAUDE.md` artifacts. If any appear and are confirmed untracked generated output, remove them before publishing.

## Redaction requirements

Never publish these values in JSON, HTML, transcripts, or logs:

- GitHub tokens and personal access tokens.
- Azure access tokens and OIDC tokens.
- Function keys.
- Publish profiles.
- Connection strings.
- API keys and passwords.
- Tenant-specific secrets.
- Customer data.
- Personal local paths such as user profile directories.

Recommended redaction placeholders:

| Sensitive value | Placeholder |
| --- | --- |
| GitHub token | `<redacted-github-token>` |
| Azure token | `<redacted-azure-token>` |
| Function key | `<redacted-function-key>` |
| Connection string | `<redacted-connection-string>` |
| Local temp path | `<redacted-temp-workspace>` |
| User profile path | `<redacted-user-home>` |

## HTML report content contract

A human-readable HTML report should include:

- Test datetime.
- Package version or commit SHA.
- Agent versions.
- Platform.
- Scenario x agent matrix.
- Capability surface matrix for every tested agent across `plugin`, `skills`, `prompts`, `mcp`, `hooks`, and `agents`.
- Status legend.
- Support status per agent.
- Failures and unsupported scenarios.
- Evidence summaries for every check, including file path, expected marker, launcher command, and agent response excerpt when available.
- Collapsed command and output sections for every command that contributed to the result.
- Workspace retention policy and retained workspace paths when applicable.
- Dynamic inventory counts and source paths used to decide what should be visible.
- Scenario scope coverage, including any user-requested narrowing and all blocked/unsupported scenarios that could not run.
- Plugin lifecycle evidence for each plugin scenario: pre-state, cleanup/uninstall or isolation, install/register, post-state, and inspection.
- Failure analysis for each `fail`, `blocked`, or `unsupported` result.
- Skill-improvement findings from agent execution friction.
- Cross-check/re-review results.
- Recommended fixes.
- Links to redacted raw artifacts when available.

The HTML does not need to be generated by a deterministic script. It must be grounded in the JSON evidence.
