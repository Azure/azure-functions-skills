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
| **Strengths** | Trigger/binding patterns, language-specific anti-patterns, doctor pre-deploy validation, durable orchestrator determinism | Deployment planning, validation, execution; cross-resource workflows |
| **Key skills** | `azure-functions-create`, `azure-functions-doctor`, `azure-functions-best-practices`, `azure-functions-diagnostics`, `azure-functions-health-status`, `azure-functions-inventory`, `azure-functions-deploy` (facade), `azure-functions-feedback` | `azure-prepare`, `azure-validate`, `azure-deploy` |
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

- Pre-deployment validation (`doctor`)
- Code generation and best-practices review
- Runtime diagnostics and health checks

In those cases, no deployment happens, so Azure Skills is not invoked. The `azure-functions-skills install` command **does not** force-install Azure Skills — it asks the user/CI to confirm before doing so via the prerequisite system.

You can use Azure Skills **without** Azure Functions Skills if you are deploying non-Functions resources. The deployment-planning workflow works for any Azure resource type; Azure Functions Skills only contributes Functions-specific knowledge to that workflow.

## Installation order

If you plan to deploy:

1. `npx @azure/functions-skills install --agent <name>` — sets up Functions skills and (with prompts) ensures Azure Skills is present.
2. Use `chat` or your editor to invoke the agent. The `azure-functions-deploy` skill will be available.

## Related

- [Azure Skills repo](https://github.com/microsoft/azure-skills)
- [`azure-functions-deploy` skill source](../templates/skills/azure-functions-deploy/SKILL.md)
- [Internal: Azure Skills prerequisite design](internal/azure-skills-prerequisite-cli-design.md)
