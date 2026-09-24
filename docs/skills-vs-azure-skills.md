# Azure Functions Skills vs Azure Skills

Two independent skill packages work together but have **distinct responsibilities**. This page clarifies the boundary so you know which one to install for which task.

## TL;DR

| Need to… | Use |
| --- | --- |
| Create / understand / diagnose / validate an Azure Functions project | **Azure Functions Skills** (this repo) |
| Deploy any Azure resource (Functions, Web Apps, AKS, etc.) | **Azure Skills** ([microsoft/azure-skills](https://github.com/microsoft/azure-skills)) |

You will usually install **both**: Azure Functions Skills for Functions-specific guidance, Azure Skills as the deployment engine that runs underneath.

## Detailed comparison

| Dimension | Azure Functions Skills (this repo) | Azure Skills (microsoft/azure-skills) |
| --- | --- | --- |
| **Scope** | Azure Functions only | All Azure resource types (broad coverage) |
| **Strengths** | Trigger/binding patterns, language-specific anti-patterns, pre-deploy checks with the doctor skill, durable orchestrator determinism | Deployment planning, validation, execution; cross-resource workflows |
| **Key skills** | `azure-functions-create`, `azure-functions-hosted-skills`, `azure-functions-doctor`, `azure-functions-best-practices`, `azure-functions-diagnostics`, `azure-functions-health-status`, `azure-functions-inventory`, `azure-functions-deploy` (facade), `azure-functions-feedback` | `azure-prepare`, `azure-validate`, `azure-deploy` |
| **Owner** | Azure Functions team | Azure (cross-team) |
| **NPM package** | `@azure/functions-skills` | (host plugin marketplace install) |

## How they integrate

When you ask an agent to deploy a Functions app, here is what happens behind the scenes:

```text
User:  "Deploy my Functions app"
  │
  ▼
azure-functions-deploy (this repo)
  │   - Injects Azure Functions-specific context:
  │     - Flex Consumption preference
  │     - Linux for Python
  │     - Function-level authentication
  │     - Application Insights enabled
  │     - functionAppConfig with deployment storage
  │
  ▼
Hands off to azure-skills:
  ├─ azure-prepare    → analyzes app, generates infra plan
  ├─ azure-validate   → validates plan, provisions preview
  └─ azure-deploy     → runs azd up / terraform apply / az deployment
```

`azure-functions-deploy` is a **thin facade** — it does not execute deployments. It enriches the deployment request with Functions-specific guidance, then delegates to Azure Skills.

## When you might need only one

You can use Azure Functions Skills **without** Azure Skills if you only need:

- Pre-deployment checks (`azure-functions-doctor`)
- Code generation and best-practices review
- Runtime diagnostics and health checks

In those cases, no deployment happens, so Azure Skills is not invoked. The `azure-functions-setup` skill checks for Azure Skills and gives install guidance only when you need deployment.

You can use Azure Skills **without** Azure Functions Skills if you are deploying non-Functions resources. The deployment-planning workflow works for any Azure resource type; Azure Functions Skills only contributes Functions-specific knowledge to that workflow.

## Installation order

If you plan to deploy:

1. Install the `azure-functions-skills` plugin with your coding agent. See the [README](../README.md#quick-start).
2. Run the `azure-functions-setup` skill. It checks for Azure Skills and gives install guidance if Azure Skills is missing.
3. Ask the agent to deploy. The `azure-functions-deploy` skill uses Azure Skills for the deployment.

## Related

- [Azure Skills repo](https://github.com/microsoft/azure-skills)
- [`azure-functions-deploy` skill source](../templates/skills/azure-functions-deploy/SKILL.md)
