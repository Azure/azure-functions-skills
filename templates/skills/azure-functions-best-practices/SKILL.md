---
name: azure-functions-best-practices
title: Azure Functions Best Practices Review
description: "Use when reviewing an existing Azure Function App against Azure Functions best practices and proposing safe, approval-gated remediations for runtime, configuration, identity, security, observability, performance, scale, cost, triggers, and bindings."
category: task
---

# Azure Functions Best Practices Review

Use this skill to review an existing Azure Function App, prioritize best-practice findings, and help apply approved remediations.

Write final answers in the user's language.

## When to use

- Review my Function App for best practices
- Improve or harden an existing Azure Functions app
- Check whether a Function App follows recommended settings
- Suggest safe fixes for Function App configuration, runtime, scale, security, or observability
- Prepare a best-practices report before production readiness review

## Do not use for

- Creating a new Function App: use `azure-functions-create`
- Static inventory only: use `azure-functions-inventory`
- Current health/status only: use `azure-functions-health-status`
- Active incident root-cause analysis: use `azure-functions-diagnostics`
- Deployment-only tasks: use `azure-functions-deploy`
- Generic Azure compliance scans: use Azure-wide compliance tooling when available

## Core principles

1. **Evidence first** — do not recommend changes until app inventory is collected.
2. **MCP guidance first** — before scoring findings, call the Azure best-practices MCP guidance for Azure Functions (`get_azure_bestpractices` / `get_azure_bestpractices_get` with `resource: azurefunctions` and `action: all`) when the tool is available.
3. **Report before remediation** — present findings and ask which fixes to apply.
4. **Approval-gated changes** — do not update app settings, restart apps, deploy code, change networking, change identity/RBAC, or modify source/IaC without explicit user approval.
5. **Load references on demand** — use `azure-functions-common` routing to load only relevant language and trigger/binding references.
6. **Redact secrets** — report setting names and presence only; never reveal values.

## Required best-practices guidance

Treat Azure best-practices MCP output as the authoritative current guidance layer for this skill. Always attempt to retrieve it before producing the review report, unless the tool is unavailable. If it is unavailable, state that the MCP guidance could not be loaded and continue with the local checklist as a fallback.

Use the MCP output to update the evaluation baseline for items such as supported runtime versions, Functions Host v4, extension bundle range, Flex Consumption guidance, authentication posture, private networking, Application Insights, trigger/binding recommendations, and language-specific recommendations.

## Required inputs

Ask only for missing inputs needed to start:

- Function App name, unless already provided
- Subscription ID/name and resource group, if needed to disambiguate
- Review scope: `quick`, `full`, `security`, `performance-scale`, `cost`, `observability`, or `configuration`
- Whether local source/IaC is available when the user wants code or infrastructure fixes

## Workflow

1. **Collect static evidence** with `azure-functions-inventory`. If `azure-functions-inventory` is unavailable, use these Azure CLI commands as fallback:

   ```bash
   # Function App details
   az functionapp show --name <app> --resource-group <rg>
   # Configuration
   az functionapp config show --name <app> --resource-group <rg>
   # App settings (names only — do not reveal values)
   az functionapp config appsettings list --name <app> --resource-group <rg> --query "[].{name:name}"
   # Deployed functions
   az functionapp function list --name <app> --resource-group <rg>
   ```
2. **Collect runtime evidence when useful** with `azure-functions-health-status` for production readiness, performance, observability, or degraded apps.
3. **Get current MCP guidance** from Azure Functions best-practices guidance (`get_azure_bestpractices` / `get_azure_bestpractices_get` with `resource: azurefunctions` and `action: all`) and cite whether it was loaded.
4. **Route references** through `../azure-functions-common/references/routing.md` based on runtime and trigger/binding inventory.
5. **Evaluate findings** using [review-checklist.md](references/review-checklist.md).
6. **Prioritize results** as Critical, High, Medium, or Low.
7. **Present a report first** with evidence, risk, recommendation, and validation plan.
8. **Ask for approval** before any remediation.
9. **Apply approved fixes** or generate commands/IaC/source patches using [remediation-patterns.md](references/remediation-patterns.md).
10. **Validate after changes** by rerunning the relevant inventory, health, or deployment checks.

## Output shape

Use this structure unless the user asks for a different format:

```text
Target: <app> (<resource-group>, <subscription>, <region>)
Scope: <quick/full/security/performance-scale/cost/observability/configuration>
Inventory summary: <plan/runtime/triggers/network/identity/settings summary>
Runtime signals: <health/metrics/telemetry summary or not collected>
Findings:
  Critical:
    - <finding with evidence and risk>
  High:
    - <finding with evidence and risk>
  Medium:
    - <finding with evidence and risk>
  Low:
    - <finding with evidence and risk>
Recommended remediations:
  1. <safe fix, approval required before applying>
  2. <manual/IaC/source change recommendation>
Validation plan:
  - <post-change checks>
Gaps: <missing permissions/telemetry/source/IaC>
```

## Next steps

- If findings indicate active failures, suggest `azure-functions-diagnostics`.
- If the user only wanted inventory, suggest `azure-functions-inventory` next time.
- If approved fixes require deployment, suggest `azure-functions-deploy` after validation.
