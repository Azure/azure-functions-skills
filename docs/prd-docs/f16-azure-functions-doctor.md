# F16: azure-functions-doctor — Project Diagnostics

**Status:** ✅ Implemented
**User guide:** [docs/doctor-guide.md](../doctor-guide.md)
**CLI reference:** [docs/cli-reference.md#doctor](../cli-reference.md#doctor)
**Depends on:** F1 (Skill Graph Metadata), F3 (azure-functions-setup)

## Problem

Configuration mistakes, deprecated app settings, blocking I/O patterns, hardcoded secrets, and non-deterministic durable orchestrators routinely make it into Azure Functions deployments and cause production incidents. There was no single command developers could run *before* deploying to catch these.

`azure-functions-setup` verifies the developer's local environment (Azure CLI, Core Tools, runtimes). `azure-functions-doctor` is a different responsibility: it validates the *project* — its `host.json`, `local.settings.json`, runtime version, extension bundle, code patterns, and configuration coherence — and produces actionable findings.

## Goals

- One CLI command runs all checks and exits non-zero on failure (so it can gate CI).
- Two tiers: deterministic built-ins (always on) + opt-in AI semantic analysis (off by default).
- Output formats for both humans (text/html) and machines (json/markdown).
- Safe by default: deep mode requires explicit acknowledgement of elevated agent permissions.
- Auto-installs skill files if missing, so first-time users don't need a separate setup step.
- Works on Windows, Linux, macOS.

## Architecture

```text
runDoctor(options)
  │
  ├─ Tier 1 (always)
  │    Load context (host.json, local.settings.json, package.json, function files)
  │    Resolve stacks (Azure Stack API or offline fallback)
  │    Execute deterministic checks (project-exists, runtime-version, extension-bundle, …)
  │    Build summary with severity threshold
  │
  └─ Tier 2 (if --deep --accept-deep-risk and agent resolvable)
       Auto-install skill files if state shows them missing
       Build prompt from Tier 1 results
       Spawn agent in headless mode (Copilot CLI / Claude Code / Codex)
       Read agent's JSON findings file
       Merge into report; respect severity threshold (fail-closed on unknown severity)
```

Source: [src/doctor/](../../src/doctor/) — `runner.ts`, `checks.ts`, `context.ts`, `stacks.ts`, `ai-analysis.ts`, `formatters.ts`.

## Tier 1 checks (built-in)

| ID | Severity | Description |
| --- | --- | --- |
| `project-exists` | critical | `host.json` exists at the workspace root |
| `runtime-version` | critical | `host.json` schema version is supported (v4 runtime) |
| `extension-bundle` | high | Extension bundle version range is current (Microsoft.Azure.Functions.ExtensionBundle / ExtensionBundle.Preview) |
| `node-version` / `python-version` / `dotnet-version` | high | Language version is supported and not EOL |
| `local-settings` | medium | `local.settings.json` present and `FUNCTIONS_WORKER_RUNTIME` is set |
| `deprecated-settings` | medium | No deprecated app settings (e.g. `AzureWebJobsDashboard`) |
| `connection-strings` | high | Non-HTTP triggers reference defined storage connections |
| `function-bindings` | high/medium | Trigger types are recognized in v4 programming model |
| `entry-point` | critical | TypeScript/JavaScript entry exists and matches `main` in package.json |
| `typescript-build` | critical | TypeScript compiles without errors (when applicable) |

## Tier 2 (AI semantic analysis)

The agent receives Tier 1 results as context and looks for:

- **Code quality** — exception-handling gaps, resource disposal issues, async/await anti-patterns, hardcoded secrets, deprecated API usage
- **Configuration coherence** — `host.json` settings conflicting with bindings, app settings referenced in code but missing, connection-name mismatches, scaling config issues
- **Azure Functions-specific patterns** — durable orchestrator determinism, Service Bus `autoComplete` conflicts, missing `FUNCTIONS_WORKER_RUNTIME`, output binding error gaps, idempotency issues, blocking I/O in async handlers

Each finding includes id, category, severity, status, title, message, optional file/line/recommendation.

## Output formats

| Format | Use case |
| --- | --- |
| `text` (default) | Local terminal, CI logs (also written to stdout regardless of `--format`) |
| `json` | CI artifacts, custom tooling |
| `markdown` | PR comments, GitHub Actions job summary |
| `html` | Local viewing, hosted artifacts |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | All checks passed at or below severity threshold |
| 1 | Problems found at or above `--severity` (default `high`) |
| 2 | Doctor command itself failed (not a project issue) |

## Security model

Tier 2 spawns an agent with elevated permissions (file write, shell execution) so the agent can read and analyze workspace files freely. Workspace content can prompt-inject the agent. To make the risk explicit:

- `--deep` alone refuses to start the agent
- User must add `--accept-deep-risk` to acknowledge the risk
- A warning is printed to stderr immediately before agent spawn
- Workspace files (`.azure-functions-skills/state.local.json`, `doctor-ai-agent.log`) are written but only the state file is auto-added to `.gitignore`

## CI integration

GitHub Actions example, full snippet: [docs/doctor-guide.md → GitHub Actions](../doctor-guide.md#github-actions-integration).

## Testing

A fixture library at [tests/fixtures/doctor-bad-apps/](../../tests/fixtures/doctor-bad-apps/) covers every check at every tier. See [docs/bad-app-fixtures.md](../bad-app-fixtures.md) for the manual E2E workflow.

## Cross-target implementation

| Target | Surfacing |
| --- | --- |
| GitHub Copilot CLI | `copilot -p` invocation with `--allow-all-tools` |
| Claude Code | `claude -p` with `--dangerously-skip-permissions` and `--max-turns 20` |
| Codex | `codex --approval-mode full-auto -q` |
| Repository template | Skill instructions copied into `.github/skills/azure-functions-doctor/` |

## References to external knowledge

The skill references under [templates/skills/azure-functions-doctor/references/](../../templates/skills/azure-functions-doctor/references/) provide tagged checklists the agent can load on demand:

- `source-only-checks.md` — code patterns
- `language-checks.md` — per-language pitfalls
- `iac-azure-resource-checks.md` — managed identity, network, scaling
- `ai-semantic-checks.md` — durable determinism, output bindings, idempotency

These are sourced from [docs/doctor-checks-best-practices-reference.md](../doctor-checks-best-practices-reference.md).
