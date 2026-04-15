# F18: af-audit — Project Audit & Static Analysis

**Status:** 📋 Proposed  
**Draft Spec Section:** N/A (discovered from func-emulate F21 audit)  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

Azure Functions apps accumulate problems over time:

- `authLevel: 'anonymous'` left on production HTTP endpoints
- Hardcoded secrets leak into source code
- Continued use of deprecated Extension Bundle versions
- Using features not supported on the target SKU (e.g., Durable Timer on Flex Consumption)
- Missing logging configuration, leaving no telemetry during production incidents

Generic linters cannot detect these **Functions-specific issues**. `af-observability` (F7) handles production monitoring setup, while `af-audit` handles pre-deployment **static checks** — they operate at different layers.

## Feature

`af-audit` performs Functions domain-specific static analysis on Azure Functions projects, detecting security, SKU compatibility, performance, and best practice issues.

## Rule Categories

| Category | Prefix | Target |
|---------|--------|--------|
| **Security** | `SEC-` | Auth level, secret leaks, CORS configuration |
| **SKU Compatibility** | `SKU-` | Features not supported on the target SKU |
| **Performance** | `PERF-` | Synchronous I/O, unbounded concurrency, large payloads |
| **Configuration** | `CFG-` | Missing app settings, invalid binding expressions |
| **Deprecation** | `DEP-` | Deprecated bindings, EOL runtimes, old Extension Bundles |
| **Best Practice** | `BP-` | App Insights not configured, missing test files |

## Rule Examples

### Security Rules

| ID | Rule | Level | Auto-fix |
|----|------|-------|----------|
| SEC-001 | HTTP function `authLevel` is `anonymous` | Error | ⚠️ Manual review required |
| SEC-002 | Connection string pattern detected in source code | Error | ❌ |
| SEC-003 | `local.settings.json` not included in `.gitignore` | Error | ✅ Add to `.gitignore` |
| SEC-004 | CORS set to `*` | Warning | ❌ |

### SKU Compatibility Rules

| ID | Rule | Level | Target SKU |
|----|------|-------|-----------|
| SKU-001 | Durable Functions Timer not supported on Flex Consumption | Error | Flex |
| SKU-002 | Execution timeout exceeds SKU limit | Error | Consumption (5/10min) |
| SKU-003 | VNET integration required but on Consumption plan | Warning | Consumption |
| SKU-004 | Custom container required but on unsupported SKU | Error | Flex, Consumption |

### Performance Rules

| ID | Rule | Level | Auto-fix |
|----|------|-------|----------|
| PERF-001 | Synchronous file I/O inside async function | Warning | ✅ Convert to `fs.promises` |
| PERF-002 | Large payload without HTTP response streaming | Info | ❌ |
| PERF-003 | No connection pooling (DB client created each time) | Warning | ❌ |

## Output Format

```
Azure Functions Audit — my-functions-app (Flex Consumption, Node.js v4)
═══════════════════════════════════════════════════════════════════════

ERRORS (must fix)
  ✗ SEC-001  src/functions/webhook.js:12
    Auth level is "anonymous" — this function is publicly accessible.
    Fix: Set authLevel to "function" or "admin", or use API Management.

  ✗ SKU-001  src/functions/orchestrator.js:28
    Durable Functions createTimer() is not supported on Flex Consumption.
    Fix: Use a different delay mechanism or switch to Premium SKU.
    Docs: https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan#limitations

WARNINGS (should fix)
  ⚠ CFG-001  host.json
    Extension bundle version [3.*, 4.0.0) is outdated. Latest: [4.*, 5.0.0).
    Fix: Update extensionBundle.version in host.json.

  ⚠ PERF-001  src/functions/processImage.js:34
    Synchronous file read (fs.readFileSync) in async function handler.
    Fix: Use fs.promises.readFile() instead.

INFO
  ℹ BP-001   No Application Insights connection string configured.
  ℹ BP-002   3 functions have no associated test files.

Summary: 2 errors, 2 warnings, 2 info
```

## Skill Metadata

```yaml
id: af-audit
title: Azure Functions Project Audit
intent:
  - audit_project
  - check_security
  - check_sku_compatibility
  - check_best_practices
completion_signals:
  - audit_completed_clean
  - issues_found_and_reported
suggestions:
  on_success:
    - target: af-deploy
      reason: "Audit passed. Project is ready for deployment."
      priority: 90
    - target: af-feedback
      reason: "Share your audit experience."
      priority: 30
  on_failure:
    - target: af-doctor
      reason: "If audit found critical issues, run diagnostics."
      priority: 70
    - target: af-help
      reason: "Get guidance on fixing audit findings."
      priority: 60
entry_conditions:
  - pre_deployment_check
  - security_review_requested
  - sku_compatibility_check
```

## SKU Detection for Rules

Target SKU detection order:

1. `app-config.yaml` → `local.targetSku` (fnx format)
2. `local.settings.json` → SKU hint
3. Azure resource metadata (`.azure/` directory)
4. Ask the user (if detection fails)
5. Default: apply only rules common across all SKUs

## CI Integration

`af-audit` can be used in CI pipelines:

```yaml
# GitHub Actions example
- name: Azure Functions Audit
  run: |
    # AI agent runs af-audit and outputs in SARIF format
    # Integrates with GitHub Code Scanning
```

Output formats: `text` (default), `json`, `sarif` (GitHub Code Scanning compatible)

## Relationship to Other Skills

```
af-audit (F18)                     af-observability (F7)
──────────────                     ────────────────────
Pre-deployment static checks        Post-deployment production monitoring

  Source code analysis                Application Insights configuration
  Configuration file validation      Log level configuration
  SKU compatibility checks            Alert rule configuration
  Security pattern detection          Kusto query templates

Timing: Before func start           Timing: After deployment
```

```
af-audit (F18)                     af-doctor (F16)
──────────────                     ───────────────
Static analysis for quality/compat   Dynamic diagnostics for project health

  "Are there problems in this code?"   "Why is func start failing?"
  Pattern matching on code & config    Runtime state checks
  SKU constraint violations            Port conflicts, Azurite state
```

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill scans project files, reports findings with severity |
| Claude Code | Skill with source code analysis and config validation |
| Codex | Agent instruction with audit rule set |
| Repo Template | Pre-deploy checklist in `copilot-instructions.md` |
