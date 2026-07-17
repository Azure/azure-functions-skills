---
name: azure-functions-doctor
title: Azure Functions Project Diagnostics
description: "Analyze local Azure Functions workspace code and configuration for common issues. Produces structured JSON findings for integration with the doctor CLI command. This skill targets local workspaces only — use azure-functions-diagnostics for deployed Azure resources."
category: task
---

# Azure Functions Project Diagnostics

Analyze the local Azure Functions workspace for code and configuration issues that static checks cannot detect. This skill is invoked by the `azure-functions-skills doctor --deep` CLI command.

## Instructions

You are running as part of `azure-functions-doctor`. Analyze the workspace at the current directory for Azure Functions code and configuration issues that require semantic understanding.

Before detailed analysis, read `references/routing.md` and then load only the checklist reference files that match the project language, detected triggers/bindings, and requested execution scope. Do not load every checklist by default.

## Context from built-in checks

The CLI has already run Tier 1 deterministic checks. Their results are provided below for context — do not repeat checks that have already passed or been reported.

{{tier1Results}}

## Analysis scope

Focus on issues that require understanding code semantics, not just syntax or file structure:

### Code quality
- Load `references/ai-semantic-checks.md` for semantic code-quality checks.
- Load `references/language-checks.md` for language-specific patterns.

### Configuration coherence
- Load `references/source-only-checks.md` when interpreting deterministic check output.
- Load `references/iac-azure-resource-checks.md` only when IaC files or Azure resource context are present.

### Azure Functions-specific patterns
- Use the routed checklist files to evaluate Durable, Service Bus, Event Hubs, storage, HTTP, timer, and language-specific risks.
- Prefer findings with concrete evidence from a file path and line number.

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
6. For Python projects, treat programming-model discovery, Blueprint
   registration, dependency-manifest presence, `azure-functions-worker`,
   native-wheel compatibility, and deployment-artifact filtering as Tier 1
   concerns. Report them only when the Tier 1 context shows that the relevant
   deterministic check did not run or could not determine the result.
