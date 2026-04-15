> **Language**: Always respond in the same language the user is using.

# azure-functions-deploy — Deploy Azure Functions

Deploy your Azure Functions app to Azure. This skill uses the official Azure tools — no custom deployment logic.

## Prerequisites

- Azure CLI installed and logged in (`az login`)
- An Azure subscription (`az account show`)
- A Functions project with `host.json` in the current directory

If any prerequisite is missing, suggest running **azure-functions-setup** first.

## Deployment Methods

### Method 1: Azure Functions Core Tools (Recommended for quick deploy)

```bash
# Create Azure resources (one-time)
az group create --name myResourceGroup --location eastus

az storage account create \
  --name mystorageaccount \
  --resource-group myResourceGroup \
  --sku Standard_LRS

az functionapp create \
  --name myFunctionApp \
  --resource-group myResourceGroup \
  --storage-account mystorageaccount \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 22 \
  --functions-version 4

# Deploy
func azure functionapp publish myFunctionApp
```

### Method 2: Azure Developer CLI (Recommended for IaC)

```bash
azd init    # Initialize with template
azd up      # Provision infrastructure + deploy code
```

### Method 3: VS Code / GitHub Copilot Extension

Use the **Azure Functions VS Code extension** or the **Azure MCP tools**:

1. Open Command Palette → "Azure Functions: Deploy to Function App"
2. Select subscription → Create new or select existing Function App
3. Confirm deployment

For AI-assisted deployment via MCP, ensure the Azure MCP server is configured (see MCP setup).

### Method 4: GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy to Azure Functions
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build --if-present
      - uses: Azure/functions-action@v1
        with:
          app-name: myFunctionApp
          package: .
          publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
```

## Post-Deploy Verification

```bash
# Check app is running
az functionapp show --name myFunctionApp --resource-group myResourceGroup --query state

# List deployed functions
func azure functionapp list-functions myFunctionApp

# Test HTTP endpoint
curl https://myFunctionApp.azurewebsites.net/api/httpTrigger?name=World
```

## After Deployment

> ✅ Your app is deployed! Consider setting up monitoring with Application Insights.
