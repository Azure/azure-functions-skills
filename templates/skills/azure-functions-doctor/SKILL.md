---
name: azure-functions-doctor
title: Azure Functions Project Diagnostics
description: "Analyze local Azure Functions workspace code and configuration for common issues, then report prioritized findings with evidence and fixes. Use when the user asks to check, review, audit, or diagnose a local Azure Functions project before running or deploying it. This skill targets local workspaces only — use azure-functions-diagnostics for deployed Azure resources."
category: task
---

# Azure Functions Project Diagnostics

Analyze the local Azure Functions workspace for code, configuration, packaging, and supply-chain issues. Do the complete analysis yourself: read the project files, run the checks in the reference checklists, and report the findings to the user.

## Instructions

1. Identify the project root. Look for `host.json`. If the workspace has more than one Functions app, ask the user which app to analyze, or analyze each app separately.
2. Detect the language, the programming model, the triggers and bindings, the dependency manifests, and the IaC files.
3. Read `references/routing.md`. Then load only the checklist reference files that match the project and the scope that the user requested. Do not load every checklist by default.
4. Do the source-only checks first (`references/source-only-checks.md`). Then do the semantic, language, and supply-chain checks.
5. Report the findings in the format below.

## Analysis scope

### Configuration and packaging
- Load `references/source-only-checks.md` for `host.json`, app settings, bindings, dependencies, secrets, and deploy-artifact checks.
- Load `references/iac-azure-resource-checks.md` only when IaC files or Azure resource context are present.

### Code quality
- Load `references/ai-semantic-checks.md` for semantic code-quality checks.
- Load `references/language-checks.md` for language-specific patterns.

### Security and supply chain
- Load `references/supply-chain-checks.md` when the project has a dependency manifest.

### Azure Functions-specific patterns
- Use the routed checklist files to evaluate Durable, Service Bus, Event Hubs, storage, HTTP, timer, and language-specific risks.
- Prefer findings with concrete evidence from a file path and line number.

## Output

Give the user a short summary first: the project language and model, the number of findings for each severity, and the most important issue.

Then list each finding, from the highest severity to the lowest:

| Field | Content |
|-------|---------|
| ID | Checklist ID, for example `CF-003` or `SC-101` |
| Severity | `critical`, `high`, `medium`, `low`, or `info` |
| Status | `fail` or `warn` |
| Title | Short description of the issue |
| Location | Relative file path and line number, when known |
| Evidence | What you found and why it is an issue |
| Fix | A specific step or code change that fixes the issue |

If the user asks for a machine-readable report, write a JSON array to the file path that the user gives. Use this schema for each finding:

```json
{
  "id": "string — checklist ID or short kebab-case identifier",
  "category": "string — configuration | code | pattern | security | supply-chain",
  "severity": "critical | high | medium | low | info",
  "status": "fail | warn",
  "title": "string — short human-readable title",
  "message": "string — detailed description",
  "file": "string — relative file path (optional)",
  "line": "number — line number (optional)",
  "recommendation": "string — how to fix (optional)"
}
```

## Rules

1. Only report actual problems. Do not suggest improvements unless they fix an issue.
2. Be specific. Include file paths and line numbers when possible.
3. Report each issue one time, even if more than one checklist covers it.
4. If you find no issues, tell the user which checks you did and that they found no issues.
5. Do not modify project files during the analysis. Apply fixes only after the user asks you to.
6. Do not run project code, install scripts, or package-manager install commands to do a check. Read the files instead.
7. If a check needs data that you cannot get (for example, Azure runtime metadata without Azure CLI), tell the user that you did not do the check and why.