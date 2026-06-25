---
name: azure-functions-diagnostics
description: "Use when diagnosing or resolving Azure Functions issues: deployment failures, runtime errors, trigger/binding failures, language worker issues, telemetry/log analysis, known issue research, source investigation, and remediation. Acts as a facade that routes to focused Azure Functions skills and small language/extension references."
---


# Azure Functions Diagnostics

Use this skill to diagnose and resolve Azure Functions issues by orchestrating focused skills and loading only the references needed for the current app.

Write final answers in the user's language.

## Core principle

Do not load all diagnostic references up front. First collect the app inventory, infer runtime/language and trigger/binding/extension shape, then load only the matching language and extension reference files.

For multi-step reviews, source investigations, or remediation work, create a short checklist plan file or todo list and update it after each completed step. Do not require a checklist for quick read-only diagnosis because it adds token overhead.

## Required inputs

Ask only for missing inputs needed to start:

- Function App name, unless already provided.
- Subscription ID/name and resource group, if needed to disambiguate.
- Symptom, error message, command output, or portal/deployment failure context.
- Time window, default `24h` for current or recent production issues.

If the user has a local workspace issue without a deployed app, skip Azure resource collection and start from local project/runtime/trigger discovery.

## Diagnostic workflow

Follow [workflow.md](references/workflow.md). Use shared reference routing from [../azure-functions-common/references/routing.md](../azure-functions-common/references/routing.md) only after inventory/health data identifies the relevant runtime, trigger, binding, or symptom.

Fast path:

1. Use `azure-functions-inventory` to collect static app specifications.
2. Use `azure-functions-health-status` to collect current health, metrics, telemetry, and Activity Log.
3. Use [../azure-functions-common/references/routing.md](../azure-functions-common/references/routing.md) to select only the required language and extension references.
4. Use [evidence-checklist.md](references/evidence-checklist.md) before stating root cause or recommended fixes.
5. Prefer official documentation, official repositories, official samples, and package/container registries before broader web sources.

## Reference loading rules

Use `azure-functions-common` for shared runtime, language, and trigger/binding references.

- Load exactly one language reference when the runtime is known, plus Durable only when Durable is involved.
- Load only extension references matching the app's triggers/bindings or the symptom.
- Load Extension Bundles only for non-.NET apps or extension-version/binding-resolution symptoms.
- Do not load migration provenance during normal diagnostics.

## Guardrails

- Redact secrets, connection strings, keys, tokens, SAS URLs, and storage credentials.
- Report setting names and whether values exist; do not reveal values.
- Ask before cloning large repositories, using sparse checkout, deploying to Azure, restarting apps, changing configuration, or running disruptive commands.
- Distinguish confirmed evidence from hypotheses.
- For transient issues, state whether the current app is healthy and identify the historical evidence used.

## Next steps

- On success, suggest `azure-functions-inventory` if the app shape or configuration changed during remediation.
- On failure, suggest `azure-functions-health-status` to re-check current health and telemetry before continuing diagnosis.

## Output shape

Use this concise structure unless the user asks for a different format:

```text
Target: <app/resource/local project>
Symptom: <summary>
Inventory: <runtime/plan/network/triggers summary>
Health: <current state/metrics/log findings summary>
Relevant references loaded: <language refs>, <extension refs>
Findings: <evidence-backed bullets>
Likely cause: <confirmed or suspected>
Recommended actions: <ordered steps>
Validation plan: <local/E2E/Azure validation steps>
Gaps: <missing permissions/telemetry/context>
```