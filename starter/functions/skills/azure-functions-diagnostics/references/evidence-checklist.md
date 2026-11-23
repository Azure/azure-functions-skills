# Azure Functions Diagnostics Evidence Checklist

Use this checklist before presenting root cause or remediation.

## Target and time

- Target app or local project is identified.
- Subscription/resource group are identified when Azure resources are involved.
- Time window is stated.
- Current vs historical/transient issue is clear.

## Inventory evidence

- Runtime/language is known or explicitly unknown.
- Hosting plan, OS, and Functions runtime are known.
- Trigger/binding inventory is known or unavailable with reason.
- Relevant app settings are checked by name/presence only; secrets are redacted.
- Network shape is checked when connectivity could be relevant.

## Health evidence

- App state and plan state are checked.
- Resource Health is checked when supported.
- Metrics are checked for the time window.
- Application Insights / Log Analytics tables are checked when available.
- Exceptions, warning/error traces, dependency failures, and Activity Log are checked when relevant.

## Reference evidence

- Matching language reference is loaded when language is known.
- Matching extension reference is loaded when trigger/binding is known.
- Official documentation or official repository evidence is preferred over community sources.
- Known GitHub issues/PRs are checked when the symptom matches a likely product issue.

## Hypothesis quality

- The conclusion states whether root cause is confirmed or suspected.
- The evidence supports the conclusion.
- Alternative explanations are mentioned when still plausible.
- Gaps are listed explicitly.

## Remediation safety

- Recommended changes are minimal and reversible where possible.
- Disruptive actions require user confirmation.
- Azure deployment, app restart, config mutation, or large repo clone requires user confirmation.
- Validation plan is included.