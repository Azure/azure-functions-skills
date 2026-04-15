# F16: af-doctor — Project Diagnostics

**Status:** 📋 Proposed  
**Draft Spec Section:** N/A (discovered from func-emulate F18 + fnx-diagnostics)  
**Depends on:** F1 (Skill Graph Metadata), F3 (af-setup)

## Problem

`af-setup` (F3) handles initial environment checks (verifying the presence of Azure CLI, Core Tools, and runtimes), but **diagnosing `func start` failures during development** is an entirely different responsibility.

`func start` failures have many possible causes:

- Syntax errors or invalid version specification in `host.json`
- Missing `local.settings.json` or invalid JSON
- Port 7071 already in use
- Runtime version mismatch (e.g., trying to use v2 model with Python 3.8)
- Extension Bundle download failure
- Azurite/storage emulator not running (when using Blob/Queue triggers)
- Missing worker runtime configuration (`FUNCTIONS_WORKER_RUNTIME` not set)
- `.NET` in-process project misdetection

Developers have no choice but to investigate these one by one manually, and beginners spend the most time identifying root causes.

## Feature

`af-doctor` is a diagnostic skill that checks Azure Functions project health across 8 structured categories and returns actionable fix suggestions for each issue.

Difference from `af-setup`:

| Aspect | af-setup (F3) | af-doctor (F16) |
|--------|-------------|----------------|
| **Timing** | Before development begins (initial setup) | When issues occur (during development) |
| **Target** | Verify presence of global tools | Project-specific config and state |
| **Output** | "Environment Ready / Not Ready" | "8 categories × Pass/Warn/Fail + fix instructions" |
| **Repetition** | Run once is sufficient | Run whenever issues arise |

## Diagnostic Checks

| # | Category | Pass | Warn | Fail |
|---|---------|------|------|------|
| 1 | `host.json` | Exists with `version: "2.0"` | Invalid version | Missing or JSON parse error |
| 2 | `local.settings.json` | Exists with valid JSON | Missing (partially functional) | JSON parse error |
| 3 | Worker runtime | `FUNCTIONS_WORKER_RUNTIME` is set | — | Not set or invalid value |
| 4 | Runtime version | Installed and within Functions support range | Version nearing EOL | Not installed or unsupported |
| 5 | Extension Bundle | Configured in `host.json` and downloaded | Outdated version range | Download failed or invalid range |
| 6 | Port availability | 7071 is available | — | Port in use |
| 7 | Azurite / Storage | Running (only when Storage triggers are used) | Installed but not running | Not installed despite Storage triggers present |
| 8 | Security | Secret values only in `local.settings.json` | — | Secret values detected in source code or config files |

## Output Format

```
Azure Functions Project Diagnostics

  ✅ host.json           version 2.0, valid
  ✅ local.settings.json valid JSON, 5 settings
  ✅ Worker runtime      python (from local.settings.json)
  ⚠️  Runtime version     Python 3.9 — EOL October 2025, upgrade to 3.11+
  ✅ Extension bundle     [4.*, 5.0.0) — cached
  ✅ Port 7071           available
  ⚠️  Azurite             installed but not running (blob_trigger detected)
  ✅ Security             no secrets in tracked files

Issues Found:
  ⚠️  Runtime version: Python 3.9 reaches EOL October 2025.
     Fix: Install Python 3.11+ and update FUNCTIONS_WORKER_RUNTIME_VERSION.
     Docs: https://learn.microsoft.com/azure/azure-functions/functions-reference-python

  ⚠️  Azurite: blob_trigger detected but Azurite is not running.
     Fix: Run 'azurite --silent' or 'npx azurite --silent' in another terminal.
     Docs: https://learn.microsoft.com/azure/storage/common/storage-use-azurite

Summary: 0 errors, 2 warnings, 6 passed

Next Steps:
  → Fix warnings and run 'func start'
```

## Diagnostic Workflow (for AI agents)

```
Step 1: Run af-doctor checks
  → Collect all 8 category results

Step 2: If func start fails, reproduce with verbose output
  → func start --verbose 2>&1

Step 3: Parse error output for known patterns
  → "WorkerConfig for runtime: X not found" → Runtime config issue
  → "0 functions loaded" → Worker indexing not enabled (Python v2)
  → "Port X in use" → Port conflict
  → "No job functions found" → Function detection failure

Step 4: Read project config files for root cause
  → host.json, local.settings.json, package.json/requirements.txt/*.csproj

Step 5: Provide fix with exact command and docs link
```

## Common Error Patterns

| Error Message | Cause | Fix |
|--------------|-------|-----|
| `No job functions found` | Worker indexing not enabled | Set `FUNCTIONS_WORKER_RUNTIME`; for Python v2, set `AzureWebJobsFeatureFlags=EnableWorkerIndexing` |
| `WorkerConfig for runtime: X not found` | Runtime not detected or Core Tools corrupted | Reinstall Core Tools |
| `Port 7071 is in use` | Another process is using the port | `func start --port 7080` or kill the previous process |
| `Extension bundle download failed` | Network issue or CDN outage | `func start --offline` (if cached) or check network |
| `Value cannot be null: AzureWebJobsStorage` | Storage connection string not set | Add `"AzureWebJobsStorage": "UseDevelopmentStorage=true"` to `local.settings.json` |
| `The listener for function 'X' was unable to start` | Binding connection error | Verify connection strings; confirm Azurite/emulator is running |

## Skill Metadata

```yaml
id: af-doctor
title: Azure Functions Project Diagnostics
intent:
  - diagnose_issue
  - func_start_failed
  - troubleshoot
  - debug_project
completion_signals:
  - diagnostics_passed
  - issue_identified_and_fixed
suggestions:
  on_success:
    - target: af-deploy
      reason: "Project is healthy. Ready to deploy."
      priority: 80
    - target: af-observability
      reason: "Set up monitoring for production readiness."
      priority: 60
  on_failure:
    - target: af-setup
      reason: "Diagnostic failures may require environment reconfiguration."
      priority: 80
    - target: af-help
      reason: "Get guided assistance for unresolved issues."
      priority: 60
entry_conditions:
  - func_start_failed
  - error_occurred
  - project_not_working
```

## Relationship to af-setup

```
af-setup (F3)                    af-doctor (F16)
─────────────                    ───────────────
"Do I have the tools?"           "Is my project healthy?"

  Azure CLI installed?             host.json valid?
  Core Tools installed?            local.settings.json valid?
  Python/Node/.NET?                Runtime compatible?
                                   Ports available?
                                   Azurite running?
                                   Secrets safe?

Entry condition:                 Entry condition:
  user_is_new                      func_start_failed
  tooling_unknown                  error_occurred
```

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill runs checks via terminal commands, reports structured results |
| Claude Code | Skill with file reads and terminal execution for each check |
| Codex | Agent instruction with diagnostic workflow |
| Repo Template | Troubleshooting guide in `copilot-instructions.md` |
