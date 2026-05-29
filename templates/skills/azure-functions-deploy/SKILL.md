---
name: azure-functions-deploy
title: Deploy Azure Functions
description: Proxy Azure Functions deployment requests to the Azure Skills prepare, validate, and deploy workflow while preserving Azure Functions-specific guidance
category: task
---

> **Language**: Always respond in the same language the user is using.

# azure-functions-deploy — Deploy Azure Functions

Deploy your Azure Functions app to Azure by proxying to the Azure Skills deployment workflow.

This skill is the Azure Functions-facing entry point. It should not run deployment commands directly. It prepares Azure Functions-specific context, then delegates execution to `azure-prepare`, `azure-validate`, and `azure-deploy` from the Azure Skills plugin.

## Prerequisites

- Azure CLI installed and logged in (`az login`)
- Azure Developer CLI installed and logged in (`azd auth login`) for AZD-based deployments
- An Azure subscription (`az account show`)
- A Functions project with `host.json` in the current directory
- Azure Skills plugin installed with `azure-prepare`, `azure-validate`, and `azure-deploy` available

If any prerequisite is missing, suggest running **azure-functions-setup** first.

## Required delegation model

Use Azure Skills as the deployment engine:

1. If `.azure/deployment-plan.md` is missing, invoke `azure-prepare` first — **unless the shortcut path below applies**.
2. If `.azure/deployment-plan.md` exists but is not `Validated`, invoke `azure-validate` before any deployment attempt.
3. If `.azure/deployment-plan.md` exists and status is `Validated`, invoke `azure-deploy` directly.
4. Never mark the plan as `Validated` from this skill. Only `azure-validate` may do that.
5. Do not run `azd up`, `azd deploy`, `terraform apply`, `az deployment`, or `func azure functionapp publish` directly from this skill unless Azure Skills cannot handle the scenario and the user explicitly approves a fallback.

### Shortcut path for MCP-template projects

When a project was scaffolded from an Azure MCP template (e.g., via `azure-functions-create` Path A), it already contains complete infrastructure. Detect this by checking **all** of these conditions:

1. `azure.yaml` exists in the project root
2. `infra/main.bicep` or `infra/*.tf` exists
3. `host.json` exists
4. `azure.yaml` contains a `metadata.template` field (indicates MCP template origin)

If all conditions are met, **skip `azure-prepare`** and proceed directly:

1. Generate a lightweight `.azure/plan.md` noting the pre-existing infrastructure
2. Invoke `azure-validate` (provisions preview, environment setup)
3. Invoke `azure-deploy` (runs `azd up`)

This avoids the redundant 5–10 minute analysis and planning phase for projects that already have production-ready infrastructure.

The normal workflow is:

```text
azure-functions-deploy → azure-prepare → azure-validate → azure-deploy
```

When a validated plan already exists:

```text
azure-functions-deploy → azure-deploy
```

## Azure Functions context to inject

Before handing off, collect and pass the following Azure Functions-specific guidance to Azure Skills:

- Use Azure Functions deployment best-practices MCP guidance (`get_azure_bestpractices` with `resource: azurefunctions` and `action: deployment`) when available.
- Prefer Flex Consumption / FC1 for new serverless Function Apps.
- Include `functionAppConfig` with deployment storage for FC1 Function Apps.
- Use Linux for Python Function Apps.
- Configure Function authentication or stronger mechanisms; avoid anonymous access unless intentional.
- Enable Application Insights for monitoring, exception tracking, and dependency monitoring.
- Consider private networking and one Function App per independently scaling workload when appropriate.
- Use Azure Functions endpoint verification after deploy; do not use `curl -I` for HTTP trigger verification because HEAD can return false negatives.

## Azure Skills plugin installation guidance

If Azure Skills is unavailable, stop and ask the user to install it for their host:

| Host | Install guidance |
| --- | --- |
| GitHub Copilot CLI | `/plugin marketplace add microsoft/azure-skills`, then `/plugin install azure@azure-skills` |
| Claude Code | `/plugin install azure@claude-plugins-official` |
| Codex CLI | `codex plugin marketplace add microsoft/azure-skills`, then install `azure` from `/plugins` |
| VS Code | Install the Azure MCP extension and companion Azure Skills integration, then reload VS Code |
| GitHub Copilot fallback | `npx skills add https://github.com/microsoft/azure-skills/tree/main/.github/plugins/azure-skills/skills -a github-copilot -g -y` |

## Fallback policy

Prefer Azure Skills for all deployment execution. Use a Functions-specific fallback only when:

- Azure Skills cannot be installed or invoked in the current host,
- the user explicitly asks for a quick publish to an existing Function App, or
- a scenario is not covered by Azure Skills and must be handled by Azure Functions Core Tools.

Before using a fallback, explain what will be skipped compared with `azure-prepare` → `azure-validate` → `azure-deploy`, and ask for confirmation.

## Post-deploy verification

Let `azure-deploy` own post-deploy verification. Add Azure Functions-specific reminders when relevant:

- List deployed functions and verify the app is running.
- Test HTTP trigger endpoints with GET, not HEAD.
- Suggest `azure-functions-health-status` for runtime health, metrics, and Application Insights checks.
- Suggest `azure-functions-best-practices` for production readiness after successful deployment.

## Monitoring `azd up` progress

The `azd up` command uses animated progress bars that may not render correctly in agent terminal capture. If the output appears stuck on a spinner (e.g., repeated "Initialize bicep provider"), the deployment is likely still progressing normally in the background.

To monitor deployment progress independently:

```bash
# Check resource group creation
az group show --name rg-<env-name> -o json

# Check deployment status
az deployment group list --resource-group rg-<env-name> \
  --query "[].{name:name, state:properties.provisioningState}" -o table

# Check Function App status
az functionapp list --resource-group rg-<env-name> \
  --query "[].{name:name, state:state}" -o table
```

Do not kill and restart the `azd up` process based solely on lack of terminal output. Instead, use the commands above to verify whether the deployment is progressing.

## After Deployment

> ✅ Your app is deployed through Azure Skills. Consider running `azure-functions-best-practices` for a production readiness review.

## Next steps

- On missing Azure Skills, suggest `azure-functions-setup` to install or configure the Azure Skills plugin.
- On missing or unvalidated plan, invoke `azure-prepare` and `azure-validate` before `azure-deploy`.
- On successful deployment, suggest `azure-functions-best-practices` for production readiness.
- On deployment failure, suggest `azure-functions-diagnostics` after `azure-deploy` error recovery is exhausted.
