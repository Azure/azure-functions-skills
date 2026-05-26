# F16: azure-functions-doctor — Project Diagnostics

**Status:** 📋 Proposed → 🔧 Design Complete  
**Draft Spec Section:** N/A (discovered from func-emulate F18 + fnx-diagnostics)  
**Depends on:** F3 (azure-functions-setup), F20 (CLI & Library)  
**Design Spec:** `azure-functions-skills/PLAN-doctor-command-design-20260525.md`

## Problem

The top two causes of Azure Functions incidents are:

1. **Customer code issues** — bugs, deprecated API usage, inadequate exception handling, memory leaks
2. **Configuration issues** — host.json misconfiguration, extensionBundle version mismatch, missing local.settings.json, unresolved connection string placeholders

`azure-functions-setup` (F3) handles initial environment verification (checking CLI tool presence), but **there is no mechanism to validate project code and configuration quality before deployment**.

Developers must investigate `func start` failures one by one manually, and beginners waste the most time. There is also no standard way to gate code and configuration issues in CI pipelines.

## Feature

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

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| CLI | `npx @agent-loom/azure-functions-skills doctor [options]` |
| GHCP | Skill + CLI doctor command via `copilot -p` headless |
| Claude Code | Skill + CLI doctor with `--json-schema` structured output |
| Codex | Skill + CLI doctor command via `codex` headless |
| GitHub Actions | `npx ... doctor --no-deep --format json` in workflow step |
