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

`azure-functions-doctor` is a two-tier architecture (CLI subcommand + skill) that validates Azure Functions project quality.

### Design Based on Industry Research

| Tool | Check Scope | Exit Code | Differentiator |
|------|-------------|-----------|----------------|
| `brew doctor` | System paths, permissions, conflicts | Non-zero = issues found | Environment checks |
| `npm doctor` | Registry, versions, permissions | Non-zero = issues found | Environment checks |
| `flutter doctor` | SDK, IDE, devices | Non-zero = issues found | Environment checks |
| **`azure-functions-skills doctor`** | **Code + configuration quality** | **Non-zero = issues found** | **Deep analysis via AI agent** |

### Difference from azure-functions-setup (F3)

| Aspect | azure-functions-setup (F3) | azure-functions-doctor (F16) |
|--------|-------------|----------------|
| **Layer** | Environment layer — "Can I develop on this machine?" | Project layer — "Can I safely deploy?" |
| **Target** | Global tool presence and versions | Project configuration, code, and bindings |
| **Output** | "Environment Ready / Not Ready" | Checklist + report file + exit code |
| **Execution** | Interactive (run once) | Repeated execution as CI/CD gate |
| **Azure** | az login verification | No Azure connection required (local only) |

### Difference from related skills

| Aspect | azure-functions-doctor | azure-functions-diagnostics | azure-functions-best-practices |
|--------|----------------------|---------------------------|------------------------------|
| Target | Local workspace | Deployed Azure resources | Deployed Azure resources |
| Entry point | CLI doctor command (headless) | User conversation | User conversation |
| Input | Workspace code + configuration | App name, subscription | App name, subscription |
| Output | Structured JSON report file | Conversational text | Conversational text + remediation proposals |
| Azure connection | Not required | Required | Required |
| CI support | Excellent (headless, exit code) | Limited (interactive) | Limited (interactive) |

## Architecture: Two-Tier Model

```
┌──────────────────────────────────────────────────┐
│  CLI: azure-functions-skills doctor               │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │ Tier 1: Built-in Checks (deterministic)      │ │
│  │  - host.json validation                      │ │
│  │  - extensionBundle version                   │ │
│  │  - local.settings.json validation            │ │
│  │  - package dependencies                      │ │
│  │  - function bindings                         │ │
│  │  - entry point resolution                    │ │
│  │  → Instant, no agent needed                  │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │ Tier 2: AI Analysis (agent-driven, opt-in)   │ │
│  │  - azure-functions-doctor skill execution    │ │
│  │  - Code quality analysis                     │ │
│  │  - Configuration coherence                   │ │
│  │  - Anti-pattern detection                    │ │
│  │  → Requires copilot/claude/codex             │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
│  Report → .azure-functions-skills/                │
│           doctor-report.json                      │
│  stdout → Checklist summary                       │
│  exit   → 0=pass, 1=problems, 2=error            │
└──────────────────────────────────────────────────┘
```

Design principles:
- **Tier 1 alone is valuable** — basic checks work without an agent
- **Tier 2 is opt-in** — `--deep` flag or auto-detected agent
- **Report file is the contract** — between skill and CLI
- **CI first** — non-interactive is the default behavior

## CLI Interface

```
azure-functions-skills doctor [options]

Options:
  --dir <path>        Target workspace (default: cwd)
  --deep              Enable AI agent analysis (Tier 2)
  --no-deep           Skip AI analysis, run built-in checks only
  --agent <name>      Agent for AI analysis: github-copilot, claude-code, codex
  --timeout <seconds> Timeout for AI analysis (default: 300)
  --format <type>     Output format: text, json, markdown (default: text)
  --output <path>     Report file path (default: .azure-functions-skills/doctor-report.json)
  --checks <names>    Comma-separated check names to run
  --severity <level>  Minimum severity to fail: critical, high, medium, low (default: high)
```

### Exit Code Policy

| Code | Meaning | CI handling |
|------|---------|------------|
| 0 | All checks passed | Pipeline passes |
| 1 | Problems found at or above `--severity` threshold | Pipeline fails |
| 2 | Doctor command itself errored (project not found, timeout, etc.) | Pipeline fails |

## Tier 1: Built-in Checks

| # | Check ID | Category | Description | Severity |
|---|----------|---------|-------------|----------|
| 1 | `project-exists` | structure | host.json exists | critical |
| 2 | `runtime-version` | configuration | Functions runtime version is supported | critical |
| 3 | `extension-bundle` | configuration | extensionBundle version range is current | high |
| 4 | `node-version` | configuration | Node.js version in support range (Node projects) | high |
| 5 | `python-version` | configuration | Python version in support range (Python projects) | high |
| 6 | `dotnet-version` | configuration | .NET version in support range (.NET projects) | high |
| 7 | `local-settings` | configuration | local.settings.json has required settings | medium |
| 8 | `connection-strings` | configuration | Binding-referenced connection settings exist | high |
| 9 | `deprecated-settings` | configuration | No deprecated setting values | medium |
| 10 | `package-dependencies` | dependencies | No known vulnerable or incompatible versions | high |
| 11 | `function-bindings` | bindings | function.json / attribute syntax is correct | high |
| 12 | `entry-point` | code | Function entry points resolve correctly | critical |
| 13 | `typescript-build` | build | TypeScript build config is correct (TS projects) | medium |

### Check Result Schema

```typescript
interface DoctorCheckResult {
  id: string;            // e.g. "extension-bundle"
  category: string;      // configuration, structure, code, ...
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status: 'pass' | 'warn' | 'fail' | 'skip';
  title: string;
  message: string;
  file?: string;         // relative path
  line?: number;
  recommendation?: string;
}
```

### Check Implementation

Each check is an independent pure function:

```typescript
interface DoctorCheck {
  id: string;
  category: string;
  defaultSeverity: 'critical' | 'high' | 'medium' | 'low';
  appliesTo: (ctx: ProjectContext) => boolean;
  run: (ctx: ProjectContext) => Promise<DoctorCheckResult[]>;
}

interface ProjectContext {
  dir: string;
  language: 'node' | 'python' | 'dotnet' | 'java' | 'powershell' | 'unknown';
  hostJson: object | null;
  localSettings: object | null;
  packageJson: object | null;
  functions: FunctionInfo[];
}
```

Version rules are maintained as code constants (v1). Extracted to external JSON when update frequency warrants it.

```typescript
// src/doctor/rules.ts
export const SUPPORTED_RUNTIME_VERSIONS = ['4'];
export const RECOMMENDED_EXTENSION_BUNDLE = { min: '[4.0.0', max: '5.0.0)' };
export const SUPPORTED_NODE_VERSIONS = [18, 20, 22];
export const SUPPORTED_PYTHON_VERSIONS = ['3.9', '3.10', '3.11', '3.12'];
export const SUPPORTED_DOTNET_VERSIONS = ['6.0', '8.0', '9.0'];
```

## Tier 2: AI Agent Analysis

### Execution Flow

```
1. CLI checks if skills are installed in workspace
   → Auto local-install if not
2. Build doctor prompt
   - Include Tier 1 results as context
   - Specify report file path and JSON schema
3. Launch agent in headless mode (-p)
4. Wait for completion with timeout
5. Read report file
6. Merge Tier 1 + Tier 2 results
7. Print unified summary to stdout
```

### Agent Headless Commands

| Agent | Headless Command | Structured Output | CI Permissions |
|-------|-----------------|-------------------|---------------|
| Copilot CLI | `copilot -p "prompt"` | None (text only) | `--allow-all-tools`, `--allow-tool='write'` |
| Claude Code | `claude -p "query"` | `--output-format json`, **`--json-schema`** | `--dangerously-skip-permissions`, `--bare` |
| Codex | `codex "prompt"` | None | `--approval-mode full-auto` |

### Report Retrieval Strategy

**Strategy A (all agents):** File-based — prompt instructs agent to write JSON to a known path.

**Strategy B (Claude Code only):** `--json-schema` for validated stdout — no file write needed.

**Fallback:** If report file is missing or malformed, Tier 2 is marked as "error"; Tier 1 results are used alone for exit code determination.

### azure-functions-doctor Skill

A new skill `azure-functions-doctor` provides the AI analysis instructions:

```markdown
## Analyze workspace code for common issues:
- Exception handling gaps
- Memory leaks / resource disposal
- Async/await anti-patterns
- Hardcoded secrets or connection strings
- Deprecated API usage

## Analyze configuration coherence:
- host.json + function bindings consistency
- App settings referenced but missing
- Scaling configuration issues

## Output findings as structured JSON to: {{reportPath}}
```

## Common Error Patterns (Tier 1 Coverage)

| Error Message | Cause | Fix |
|--------------|-------|-----|
| `No job functions found` | Worker indexing not enabled | Set `FUNCTIONS_WORKER_RUNTIME`; for Python v2, set `AzureWebJobsFeatureFlags=EnableWorkerIndexing` |
| `WorkerConfig for runtime: X not found` | Runtime not detected | Reinstall Core Tools |
| `Port 7071 is in use` | Port conflict | `func start --port 7080` or kill the previous process |
| `Extension bundle download failed` | Network issue or CDN outage | `func start --offline` (if cached) or check network |
| `Value cannot be null: AzureWebJobsStorage` | Storage connection string not set | Add `"AzureWebJobsStorage": "UseDevelopmentStorage=true"` to `local.settings.json` |
| `The listener for function 'X' was unable to start` | Binding connection error | Verify connection strings; confirm Azurite/emulator is running |

## Report Format

### JSON Report Schema

```json
{
  "version": 1,
  "timestamp": "2026-05-25T12:00:00Z",
  "workspace": "/path/to/project",
  "language": "typescript",
  "tiers": {
    "builtin": {
      "ran": true,
      "checks": [ ]
    },
    "ai": {
      "ran": true,
      "agent": "github-copilot",
      "durationMs": 45000,
      "checks": [ ]
    }
  },
  "summary": {
    "total": 15,
    "critical": 1,
    "high": 2,
    "medium": 3,
    "low": 1,
    "pass": 8,
    "status": "fail"
  }
}
```

### stdout Text Output

```
Azure Functions Doctor

Project: my-functions-app (typescript)

Built-in checks:
  ✅ project-exists        Functions project found
  ✅ runtime-version       v4 (supported)
  ❌ extension-bundle      Bundle version [3.*, 4.0.0) is outdated
  ✅ node-version          Node.js 22.x (supported)
  ⚠️  local-settings       AzureWebJobsStorage not set
  ✅ function-bindings     3 functions, all bindings valid
  ✅ entry-point           All entry points resolved

AI analysis (github-copilot):
  ❌ async-disposal        src/functions/queueHandler.ts:42
                           HttpClient created but never disposed
  ⚠️  error-handling       src/functions/timerTrigger.ts:15
                           Unhandled promise rejection possible

Summary: 2 problems, 1 warning, 5 passed
Report: .azure-functions-skills/doctor-report.json
```

## CI Integration

### GitHub Actions Examples

```yaml
# Tier 1 only (no agent, fast, free)
- name: Azure Functions Doctor
  run: npx @agent-loom/azure-functions-skills doctor --no-deep --format json

# Tier 2 included (with GitHub Copilot)
- name: Azure Functions Doctor (Deep)
  run: npx @agent-loom/azure-functions-skills doctor --deep --agent github-copilot --timeout 300
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### CI Recommendations

- `--no-deep` for Tier 1 only → fast, deterministic, free
- `--format json` for machine-readable output
- `--severity critical` for critical-only failures (gradual adoption)

## Use Cases

| Use Case | Environment | Configuration |
|----------|------------|---------------|
| Developer pre-deploy check | Local terminal | `doctor` (interactive, report file) |
| GitHub Actions CI gate | CI runner | `doctor --no-deep --format json` (headless, exit code) |
| PR review assist | CI / Codespace | `doctor --deep --agent github-copilot` (AI analysis) |

## Skill Metadata

```yaml
id: azure-functions-doctor
title: Azure Functions Project Diagnostics
intent:
  - diagnose_issue
  - func_start_failed
  - troubleshoot
  - debug_project
  - pre_deploy_check
  - ci_gate
completion_signals:
  - diagnostics_passed
  - issue_identified_and_fixed
suggestions:
  on_success:
    - target: azure-functions-deploy
      reason: "Project is healthy. Ready to deploy."
      priority: 80
    - target: azure-functions-observability
      reason: "Set up monitoring for production readiness."
      priority: 60
  on_failure:
    - target: azure-functions-setup
      reason: "Diagnostic failures may require environment reconfiguration."
      priority: 80
    - target: azure-functions-help
      reason: "Get guided assistance for unresolved issues."
      priority: 60
entry_conditions:
  - func_start_failed
  - error_occurred
  - project_not_working
  - pre_deploy
  - ci_pipeline
```

## Implementation Plan (TDD)

### Phase A: Tier 1 Foundation

| Step | Work | Test |
|------|------|------|
| A.1 | `ProjectContext` type + `DoctorCheck` interface | Types compile |
| A.2 | `loadProjectContext(dir)` | host.json/package.json/function load |
| A.3 | `project-exists` check | Exists / not-exists |
| A.4 | `extension-bundle` check | Version range validation |
| A.5 | `runtime-version` check | Supported / deprecated |
| A.6 | Remaining Tier 1 checks | Pass/fail per check |
| A.7 | `DoctorRunner` — execute, aggregate, report | Integration |

### Phase B: CLI Integration

| Step | Work | Test |
|------|------|------|
| B.1 | Add `doctor` to CLI help | Help text |
| B.2 | Tier 1 execution flow (`--no-deep`) | Command test |
| B.3 | stdout formatters (text/json/markdown) | Output format |
| B.4 | Exit code logic | Severity threshold |
| B.5 | Report file output | File write |

### Phase C: Tier 2 (AI Analysis)

| Step | Work | Test |
|------|------|------|
| C.1 | `azure-functions-doctor` skill template | Skill loader |
| C.2 | Doctor prompt builder | Prompt assembly |
| C.3 | Headless agent launcher | Spawn + timeout (mock) |
| C.4 | Report file read + merge | Parse + merge |
| C.5 | `--deep` flag integration | E2E |

### Phase D: CI / Polish

| Step | Work | Test |
|------|------|------|
| D.1 | Auto-install (skills not installed) | State check |
| D.2 | `--checks` filtering | Selective execution |
| D.3 | GitHub Actions workflow examples | Documentation |
| D.4 | README update | — |

## Future (v2)

- `--fix` option — Tier 1: deterministic auto-fix; Tier 2: AI-suggested fixes (with confirmation)
- `--smoke-test` flag — run `func start` with timeout for runtime verification (requires Core Tools; HTTP triggers only for auto-test; non-HTTP triggers require emulators)
- External rules JSON — when version update frequency warrants extraction
- Port availability check, Azurite status check (runtime checks, not static analysis)

---

## Implementation Reference

The following sections reflect the actual implemented behavior (PR #118, merged 2026-05-27).

### Runtime Architecture

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

### Tier 1 checks (built-in)

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

### Tier 2 (AI semantic analysis)

The agent receives Tier 1 results as context and looks for:

- **Code quality** — exception-handling gaps, resource disposal issues, async/await anti-patterns, hardcoded secrets, deprecated API usage
- **Configuration coherence** — `host.json` settings conflicting with bindings, app settings referenced in code but missing, connection-name mismatches, scaling config issues
- **Azure Functions-specific patterns** — durable orchestrator determinism, Service Bus `autoComplete` conflicts, missing `FUNCTIONS_WORKER_RUNTIME`, output binding error gaps, idempotency issues, blocking I/O in async handlers

Each finding includes id, category, severity, status, title, message, optional file/line/recommendation.

### Output formats

| Format | Use case |
| --- | --- |
| `text` (default) | Local terminal, CI logs (also written to stdout regardless of `--format`) |
| `json` | CI artifacts, custom tooling |
| `markdown` | PR comments, GitHub Actions job summary |
| `html` | Local viewing, hosted artifacts |

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | All checks passed at or below severity threshold |
| 1 | Problems found at or above `--severity` (default `high`) |
| 2 | Doctor command itself failed (not a project issue) |

### Security model

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
