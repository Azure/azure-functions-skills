# Azure Functions Diagnostics Workflow

Use this workflow for deployed or deployment-targeted Azure Functions issues.

## 1. Understand the symptom

Collect only what is needed:

- Error message or failing command (`func`, `az`, `azd`, portal, deployment pipeline, runtime invocation).
- Function App name, subscription, resource group, and time window.
- Whether the issue is current, intermittent, historical, deployment-time, startup-time, or invocation-time.

For multi-step reviews, source investigation, or remediation, maintain a concise checklist plan and mark each step complete as work progresses. Skip this for quick read-only diagnosis to keep token use low.

## 2. Inventory first

Use the `azure-functions-inventory` skill.

Inventory should identify:

- Runtime/language.
- Hosting plan/SKU/OS.
- Functions runtime version.
- Trigger and binding inventory.
- Deployment mode and selected app settings, with secrets redacted.
- Network shape: VNet integration, private endpoints, public network access.
- Related resources in the resource group.

## 3. Health and telemetry second

Use the `azure-functions-health-status` skill.

Health should identify:

- Current app state and Resource Health if supported.
- Plan status and core metrics.
- Application Insights / Log Analytics requests, exceptions, traces, dependencies.
- Trigger status and indexing/configuration issues.
- Recent Activity Log changes.

## 4. Route to focused references

Use `../../azure-functions-common/references/routing.md` after inventory and trigger discovery.

Load only:

- The matching language reference.
- The matching extension references.
- Extension Bundles reference only when bundle resolution is relevant.

## 5. Known issue research

Prioritize information sources in this order:

1. Microsoft Learn / Azure Docs.
2. Official Azure or Microsoft GitHub repositories, issues, PRs, and release notes.
3. Official package/container registries such as npm, PyPI, Maven Central, NuGet, Docker Hub, and MCR.
4. Official samples.
5. Broader internet sources only as secondary context; treat blogs and Stack Overflow as potentially outdated.

## 6. Source investigation

Search/query first. Clone only when needed.

Ask before cloning large repositories or using sparse checkout. Prefer sparse checkout for large repositories such as `azure-sdk-for-net`.

## 7. Validate the hypothesis

Before presenting root cause:

- Confirm whether the issue is still happening.
- If transient, state the historical evidence and current health separately.
- Compare logs, metrics, configuration, known issues, and source behavior.

## 8. Remediate and verify

Recommend minimal safe changes first.

If code/config is changed:

- Validate locally when possible.
- Run E2E smoke tests when possible.
- Ask before deploying to Azure or making disruptive changes.
