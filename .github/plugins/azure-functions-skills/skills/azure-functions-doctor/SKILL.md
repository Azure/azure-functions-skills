---
name: azure-functions-doctor
description: "Analyze local Azure Functions workspace code and configuration for common issues. Produces structured JSON findings for integration with the doctor CLI command. This skill targets local workspaces only — use azure-functions-diagnostics for deployed Azure resources."
---


# Azure Functions Project Diagnostics

Analyze the local Azure Functions workspace for code and configuration issues that static checks cannot detect. This skill is invoked by the `azure-functions-skills doctor --deep` CLI command.

## Instructions

You are running as part of `azure-functions-doctor`. Analyze the workspace at the current directory for Azure Functions code and configuration issues that require semantic understanding.

## Context from built-in checks

The CLI has already run Tier 1 deterministic checks. Their results are provided below for context — do not repeat checks that have already passed or been reported.

{{tier1Results}}

## Analysis scope

Focus on issues that require understanding code semantics, not just syntax or file structure:

### Code quality
- Exception handling gaps in function handlers
- Resource disposal issues (HttpClient, database connections not disposed)
- Async/await anti-patterns (fire-and-forget, missing await)
- Hardcoded secrets or connection strings in source code
- Deprecated API usage in Azure Functions SDK

### Configuration coherence
- host.json settings that conflict with function bindings
- App settings referenced in code but missing from local.settings.json
- Scaling configuration issues (e.g. maxConcurrentRequests=1 in production)
- Timer trigger schedules that conflict with function execution time
- Duplicate or conflicting binding configurations

### Azure Functions-specific patterns
- Durable Functions orchestrator determinism violations
- Service Bus/Event Hub trigger with autoComplete=true but manual completion in code
- Connection setting name typos between bindings and local.settings.json
- Missing FUNCTIONS_WORKER_RUNTIME or incorrect value for the project language

## Output

Write your findings as a JSON array to the file path specified below. Each finding must follow this schema:

```json
{
  "id": "string — short kebab-case identifier",
  "category": "string — code | configuration | pattern",
  "severity": "critical | high | medium | low | info",
  "status": "fail | warn",
  "title": "string — short human-readable title",
  "message": "string — detailed description",
  "file": "string — relative file path (optional)",
  "line": "number — line number (optional)",
  "recommendation": "string — how to fix (optional)"
}
```

**Report file path:** {{reportPath}}

## Rules

1. Only report actual problems — do not suggest improvements unless they fix an issue.
2. Be specific: include file paths and line numbers when possible.
3. Do not repeat findings already covered by the Tier 1 built-in checks.
4. If no issues are found, write an empty JSON array `[]`.
5. Do not modify any project files — this is a read-only analysis.