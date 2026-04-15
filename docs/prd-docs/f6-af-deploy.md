# F6: af-deploy — Deployment

**Status:** 📋 Proposed  
**Draft Spec Section:** 4.2, 6, 8  
**Depends on:** F1 (Skill Graph Metadata), F5 (af-create recommended first)

## Problem

Deploying Azure Functions involves multiple choices (Azure CLI vs. azd vs. VS Code vs. GitHub Actions), each with different prerequisites and configuration patterns. Developers often guess incorrectly, leading to failed deployments, wrong SKU selection, or missing app settings. There's no unified guidance that adapts to the user's project and preferred tooling.

## Feature

`af-deploy` provides deployment guidance tailored to the user's project, selected hosting plan, and preferred deployment method. It covers first-time deployment, CI/CD setup, and redeployment patterns.

## Deployment Methods

| Method | When to Use | Prerequisites |
|--------|------------|--------------|
| Azure CLI (`az functionapp`) | Quick deploy, manual | Azure CLI, logged in |
| Azure Developer CLI (`azd`) | Infrastructure-as-code, repeatable | azd installed |
| VS Code Extension | GUI-first developers | Azure Functions extension |
| GitHub Actions | CI/CD automation | GitHub repo, service principal |
| Azure DevOps Pipelines | Enterprise CI/CD | ADO project, service connection |
| ZIP Deploy (direct) | Advanced / custom pipelines | Azure CLI or REST API |

## Workflow

```
1. Detect project state
   ├── No project → "Run af-create first"
   ├── Project exists, no Azure resources → Guide resource creation
   └── Project exists, resources exist → Guide deployment

2. Method selection
   → Recommend based on context (azd if infra-as-code, CLI if quick)

3. Resource creation (if needed)
   → Resource group, Storage account, Function App, App Service Plan

4. Configuration
   → App settings, connection strings, CORS, runtime version

5. Deploy
   → Execute deployment with selected method

6. Post-deploy verification
   → Health check, function listing, test invocation

7. Next steps (from graph metadata)
   → "Next: af-observability to set up monitoring"
```

## Skill Metadata

```yaml
id: af-deploy
title: Deploy Azure Functions
intent:
  - deploy_to_azure
  - publish_function_app
  - set_up_cicd
  - create_azure_resources
completion_signals:
  - deployment_succeeded
  - functions_accessible
suggestions:
  on_success:
    - target: af-observability
      reason: "Deployment succeeded. Set up monitoring to track app health."
      priority: 100
    - target: af-feedback
      reason: "Share your deployment experience."
      priority: 40
  on_failure:
    - target: af-setup
      reason: "Deployment failure may be caused by missing prerequisites or wrong credentials."
      priority: 80
    - target: af-hosting
      reason: "Deployment might fail due to SKU limitations. Review hosting plan."
      priority: 60
entry_conditions:
  - project_exists
  - ready_to_deploy
```

## SKU-Aware Guidance

`af-deploy` provides different instructions based on the target hosting plan:

| Hosting Plan | Key Considerations |
|-------------|-------------------|
| Flex Consumption | Newest runtime, fastest cold start, per-execution billing |
| Linux Premium (EP) | Always-warm instances, VNET, larger instance sizes |
| Windows Consumption | Widest trigger support, 5-min timeout default |
| Windows Dedicated (ASP) | Predictable pricing, full App Service features |
| Container Apps | Custom containers, Dapr integration, KEDA scaling |

## Common Deployment Commands

### Azure CLI

```bash
# Create resources
az group create --name myResourceGroup --location eastus
az storage account create --name mystorageaccount --resource-group myResourceGroup
az functionapp create --name myFunctionApp --resource-group myResourceGroup \
  --storage-account mystorageaccount --consumption-plan-location eastus \
  --runtime python --runtime-version 3.11 --functions-version 4

# Deploy
func azure functionapp publish myFunctionApp
```

### Azure Developer CLI

```bash
azd init
azd up  # provisions infrastructure + deploys code
```

## Post-Deploy Verification

After deployment, `af-deploy` verifies:

1. Function App is running (`az functionapp show --query state`)
2. Functions are listed (`func azure functionapp list-functions`)
3. HTTP endpoints are reachable (if HTTP triggers exist)
4. App settings are configured correctly

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill guides through deployment steps interactively |
| Claude Code | Skill with terminal commands and verification |
| Codex | Agent instruction with deployment workflow |
| Repo Template | Deployment guide in `copilot-instructions.md` |
