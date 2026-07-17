# Azure Skills and Azure Functions Skills Boundary

Created: 2026-05-21

This document helps contributors and PMs decide whether a feature, fix, or feedback item belongs in Azure Skills or Azure Functions Skills.

## Conclusion

Azure Skills is the **Azure platform workflow engine**. It owns the Azure-wide preparation, validation, deployment, IaC, and Azure resource provisioning workflows.

Azure Functions Skills is the **Azure Functions domain layer**. Its skills own Azure Functions-specific creation, diagnostics, operational reviews, runtime / trigger / binding / language worker guidance, and lightweight skill discovery.

Azure Functions Skills is not a replacement for Azure Skills. It should gather Azure Functions-specific context and delegate to Azure Skills when the shared Azure platform workflow is needed.

## Ownership Matrix

| Area | Owner | Reason |
| --- | --- | --- |
| Azure-wide app deployment lifecycle | Azure Skills | `azure-prepare` -> `azure-validate` -> `azure-deploy` is the shared deployment engine. |
| IaC, `azd`, Terraform, Bicep, Azure resource provisioning | Azure Skills | These workflows cover App Service, Container Apps, databases, storage, RBAC, regions, subscriptions, and more, not only Functions. |
| User-facing Azure Functions entry point | Azure Functions Skills | `azure-functions-help` discovers and routes to setup / create / deploy / diagnostics / best-practices workflows. |
| Azure Functions project scaffolding / add function | Azure Functions Skills | This requires runtime, language worker, trigger / binding, and official Azure Functions MCP template knowledge. |
| Azure Functions deployment | Azure Functions Skills entry point; Azure Skills execution engine | `azure-functions-deploy` gathers Functions context and delegates to `azure-prepare` / `azure-validate` / `azure-deploy`. |
| Functions runtime, trigger, binding, language, and extension references | Azure Functions Skills | This is Functions-specific domain knowledge and belongs with `azure-functions-common` reference routing. |
| Diagnostics, health, inventory, best practices, upgrade, Functions-specific migration, testing, performance tuning | Azure Functions Skills | These are Day 1+ Functions-specific workflows that need runtime / trigger / binding evidence. |
| Cross-cloud migration such as Lambda to Functions | Azure Skills primary | `azure-cloud-migrate` owns the cross-cloud scenario. Azure Functions Skills can help with target Functions validation. |
| Plugin payload and optional workspace-local copy | Azure Functions Skills | The repository publishes skills, MCP configuration, and telemetry hooks; host tools own plugin installation. |

## Contributor Decision Guide

Use this table to decide where a change should go.

| Change or feature | Contribution target |
| --- | --- |
| `azd up`, `azd deploy`, `az deployment`, Terraform apply, Bicep deploy | Azure Skills |
| Deployment plan, validation proof, pre-deploy checklist, RBAC verification | Azure Skills |
| Azure resource provisioning, region selection, subscription, resource group, quota, generic Azure auth | Azure Skills |
| Azure Functions Core Tools, `host.json`, `local.settings.json`, `FUNCTIONS_WORKER_RUNTIME` | Azure Functions Skills |
| Functions language worker, programming model, extension bundle, trigger indexing, binding resolution | Azure Functions Skills |
| HTTP / Timer / Blob / Queue / Service Bus / Event Hubs / Cosmos DB / Durable trigger behavior | Azure Functions Skills |
| Official Azure Functions MCP template discovery or Functions project composition | Azure Functions Skills |
| Generic "deploy this app to Azure" across multiple Azure services | Azure Skills |
| "Deploy this Azure Functions app" from an Azure Functions skill | Azure Functions Skills entry point; delegate execution to Azure Skills |
| Deployment failed because IaC, `azd`, RBAC, resource group, or Azure provisioning failed | Usually Azure Skills |
| Deployment failed because Functions host, runtime setting, worker, trigger, binding, app settings, or telemetry failed | Usually Azure Functions Skills |
| Generic Azure compliance, governance, security, or cost review | Azure Skills |
| Functions-specific production readiness, scale, hosting plan, trigger / binding, observability, or language guidance | Azure Functions Skills |
| Programming model migration, runtime version migration, .NET in-process to isolated, extension bundle migration, and other Functions-specific migrations | Azure Functions Skills |
| Lambda-to-Functions migration assessment and code conversion | Azure Skills primary; use Functions-specific guidance where needed |

## Delegation Contract

### `azure-functions-deploy`

`azure-functions-deploy` is the Azure Functions-facing deployment entry point. It should:

1. Confirm that the workspace is an Azure Functions project.
2. Collect Functions-specific deployment context such as runtime, hosting plan preference, trigger shape, endpoint verification guidance, Application Insights expectations, and Flex Consumption guidance.
3. Use Azure Skills as the deployment engine:
   - no plan: invoke `azure-prepare`, unless a documented shortcut applies
   - plan not validated: invoke `azure-validate`
   - validated plan: invoke `azure-deploy`
4. Avoid running deployment commands directly, including `azd up`, `azd deploy`, Terraform apply, `az deployment`, or `func azure functionapp publish`, unless Azure Skills cannot handle the scenario and the user explicitly approves a fallback.
5. After deployment, let `azure-deploy` own deployment verification, then add Functions-specific next steps such as `azure-functions-health-status`, `azure-functions-diagnostics`, or `azure-functions-best-practices`.

### Azure Skills

Azure Skills should continue to support Azure Functions as an Azure compute target because some users may only have Azure Skills installed. However, when Azure Functions Skills is installed, Functions-specific create / deploy / diagnose / review intent should enter through the `azure-functions-*` skills first.

Azure Skills owns the common deployment contract:

```text
azure-prepare -> azure-validate -> azure-deploy
```

Azure Functions Skills owns the Functions-facing contract:

```text
azure-functions-help -> azure-functions-deploy -> azure-prepare -> azure-validate -> azure-deploy
```

## Skill Discovery Rules

`azure-functions-help` should discover the available `azure-functions-*` skills and route user intent as follows:

| User intent | Route |
| --- | --- |
| Set up local tools or verify prerequisites | `azure-functions-setup` |
| Create a new Functions project or add a function to an existing project | `azure-functions-create` |
| Build or modify Azure Functions hosted AI agent apps, scheduled agents, connector-triggered agents, background AI workflows, or chat/API agents | `azure-functions-agents` |
| Deploy a Functions app | `azure-functions-deploy`, then delegate to Azure Skills |
| Review production readiness, best practices, security, observability, scale, or cost for a Function App | `azure-functions-best-practices` |
| Diagnose runtime errors, trigger failures, binding issues, language worker errors, telemetry, logs, or deployment symptoms after Azure deployment recovery is exhausted | `azure-functions-diagnostics` |
| Collect current deployed app shape without diagnosis | `azure-functions-inventory` |
| Collect current health, metrics, logs, Resource Health, Activity Log, or host health evidence | `azure-functions-health-status` |
| Capture reusable feedback for this skill suite | `azure-functions-feedback` |

When the user intent is generic Azure deployment with no Functions-specific context, route to Azure Skills. When the workspace or prompt clearly identifies Azure Functions, route to Azure Functions Skills first and delegate common Azure execution only when needed.

## Product Boundary for Future Skills

Use these rules when deciding whether a future skill belongs in Azure Functions Skills.

### Belongs in Azure Functions Skills

- It depends on Functions runtime, host, language worker, programming model, trigger, binding, extension bundle, or Function App settings.
- It explains or fixes Functions-specific operational behavior.
- It needs Functions-specific evidence, such as deployed functions, trigger metadata, worker runtime, host health endpoints, App Insights traces for Functions, or trigger-specific metrics.
- It improves Azure Functions skill discovery or the workspace-local copy experience.
- It packages Azure Functions team knowledge into agent-consumable workflow, checklist, script, or reference files.

Examples:

- `azure-functions-upgrade`
- Functions-specific migration guidance, such as programming model migration and .NET in-process to isolated worker migration
- Functions testing guidance
- Functions OpenTelemetry / observability guidance
- Functions performance and scaling tuning
- Runtime / programming model / extension bundle migration
- Trigger / binding diagnostics and best practices

### Belongs in Azure Skills

- It applies to multiple Azure compute services, not only Azure Functions.
- It owns Azure resource creation, deployment execution, validation, IaC generation, or cross-service architecture.
- It changes `azure-prepare`, `azure-validate`, or `azure-deploy` behavior.
- It handles cross-cloud migration as a portfolio-level workflow.
- It manages generic Azure governance, compliance, security, cost, RBAC, subscription, region, or quota workflows.

Examples:

- Generic deployment engine improvements
- Bicep / Terraform / AZD deployment recipes
- Azure-wide resource lookup, cost, RBAC, compliance, or diagnostics
- Cross-cloud migration orchestration
- Multi-service architecture planning

## Handling Overlap Intentionally

Some overlap is expected and healthy. The rule is to avoid duplicate execution engines while allowing Functions-specific context to wrap generic Azure workflows.

| Overlap area | Decision |
| --- | --- |
| Create | Azure Functions Skills owns Functions project creation. Azure Skills may still prepare Azure infrastructure or support users who do not have Functions Skills installed. |
| Deploy | Azure Functions Skills owns the Functions-facing entry point. Azure Skills owns deployment execution. |
| Best practices | Azure Functions Skills owns Functions-specific review. Azure Skills owns Azure-wide compliance, cost, governance, and broad architecture guidance. |
| Upgrade | Azure Functions Skills owns Functions runtime / language / programming model / extension bundle upgrade guidance. Azure Skills may own hosting-plan or platform migration when it is part of a broader Azure upgrade workflow. |
| Diagnostics | Azure Functions Skills owns Functions runtime / trigger / binding / worker diagnosis. Azure Skills owns Azure resource provisioning and generic deployment failures. |
| Migration | Azure Functions Skills owns Functions-specific migration such as programming model, runtime, language worker, extension bundle, and .NET in-process to isolated. Azure Skills owns cross-cloud migration orchestration such as Lambda-to-Functions, while Azure Functions Skills helps with target Functions validation and post-migration operational guidance. |

## Recommended Repository Updates

To keep this boundary durable, keep these files aligned:

- `templates/skills/azure-functions-help/SKILL.md`: keep discovery lightweight and based on the runtime skill list.
- `templates/skills/azure-functions-deploy/SKILL.md`: keep the Azure Skills delegation model explicit.
- `templates/skills/azure-functions-common/references/routing.md`: keep Functions-specific reference routing focused and small.
- Azure Skills `azure-prepare` specialized routing: mention that `azure-functions-*` is the preferred entry point when Azure Functions Skills is installed.
- Azure Skills Functions references: avoid duplicating deep runtime / trigger / binding diagnostics that belong in Azure Functions Skills.

## Summary

The boundary should be explained as:

> Azure Skills owns the common Azure deployment and platform workflows. Azure Functions Skills owns the Azure Functions-specific agent experience, domain knowledge, diagnostics, reviews, and routing. When both are needed, Azure Functions Skills gathers Functions context and delegates common Azure execution to Azure Skills.
