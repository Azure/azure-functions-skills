---
name: azure-functions-health-status
title: Azure Functions Health Status
description: "Use when investigating current Azure Functions app status and health: Running/Stopped state, Resource Health, plan status, Azure Monitor metrics, Application Insights/Log Analytics requests, failures, exceptions, traces, dependencies, and recent Activity Log. Do not use for static inventory-only requests."
category: task
---

# Azure Functions Health Status

Use this skill to investigate the current status and health of an existing Azure Function App.

Write final answers in the user's language.

## Required interaction

Ask only for missing inputs that are needed to identify the app and time window:

- Function App name (required unless already provided)
- Subscription ID or name (optional)
- Resource group (optional)
- Investigation time window, default `24h` (optional)

If subscription or resource group is unknown, discover them with Resource Graph. If multiple matching apps are found, ask the user to choose one.

## Fast path

1. Call Azure best practices for `azurefunctions` first when available.
2. Run the bundled health script for the current shell/OS:
   - `scripts/get-functionapp-health-status.ps1 -AppName <app-name>`
   - `scripts/get-functionapp-health-status.sh -a <app-name>` on macOS/Linux or Bash
   - Add `-SubscriptionId <sub>` and/or `-ResourceGroup <rg>` when known.
   - Add `-Hours <n>` when the user requests a specific time window.
   - For Bash, use `-s <sub>`, `-g <resource-group>`, and/or `-H <hours>` when known.
   - Bash script requires Azure CLI plus a working `python3` or `python` executable for JSON shaping.
3. If bundled script execution is unavailable, use `references/health-status-commands-and-kql.md`.
4. Report health findings and action items; avoid dumping raw logs unless requested.

If health findings require runtime or trigger-specific interpretation, use `../azure-functions-common/references/routing.md` on demand. Do not load shared language/extension references for plain status output.

## Scope boundary

This skill should collect:

- Current app state: enabled/running/stopped, metadata availability, runtime availability
- Plan status and Resource Health result
- Azure Monitor metrics: instance count, CPU, memory, execution counts/units, always-ready units
- Trigger status summary and notable disabled or indexing-failed functions
- Application Insights/Log Analytics: request counts/failures/p95, dependency failures, exceptions, warning/error traces
- Recent Activity Log events
- Gaps: missing telemetry, unsupported Resource Health, unavailable diagnostic data

Do not perform full static inventory beyond fields needed to interpret health. Use the inventory skill for detailed specifications.

## Next steps

- On success, suggest `azure-functions-diagnostics` to interpret findings and recommend fixes when health signals are degraded or unclear.
- On failure, suggest `azure-functions-inventory` to confirm app identity and configuration before retrying health checks.

## Interpretation rules

- For Flex Consumption, Resource Health may return `Unknown` or `Unsupported`; rely on app metadata, plan status, metrics, telemetry, and Activity Log.
- Workspace-based Application Insights uses `AppRequests`, `AppExceptions`, `AppTraces`, and `AppDependencies`; classic tables may be empty.
- Treat unresolved `%SETTING_NAME%` placeholders in traces/exceptions as configuration/indexing issues.
- Redact connection strings, keys, tokens, and storage secrets. It is safe to report setting names and whether values exist.

## Output template

```text
Target: <app> (<resource-group>, <subscription>, <region>)
Current status: app <state>, metadata <availability/runtime>, plan <status>, Resource Health <state/reason>
Metrics: instances <max/avg>, CPU <max>, memory <max>, executions <summary>
Execution: requests <n>, failed <n>, p95 highlights <...>; dependency failures <n>
Triggers: enabled <n>, disabled <n>; indexing/config issues <summary>
Recent changes: <Activity Log summary>
Findings: <1-3 bullets>
Recommended next actions: <1-3 bullets>
Gaps: <unavailable telemetry or unsupported checks>
```