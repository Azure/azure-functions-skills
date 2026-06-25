# Infrastructure, Deployment, and Local Development

Use the scaffolded Bicep in [../assets/infra](../assets/infra) as the current baseline. It is
derived from the latest quickstart sample and provisions Foundry, Flex Consumption,
identity-based storage settings, Application Insights, dynamic sessions, and optional Connector
Namespace MCP resources.

## Asset Files

| File | Purpose |
| --- | --- |
| `main.bicep` | Subscription-scope root template. Creates resource group and composes modules. |
| `main.parameters.json` | Maps `azd` environment values to Bicep parameters. |
| `app/api.bicep` | Flex Consumption function app with user-assigned identity and identity-based storage. |
| `app/foundry.bicep` | Foundry account, project, model deployment, and model RBAC. |
| `app/rbac.bicep` | Storage and Application Insights RBAC for the function app identity, plus deployer storage upload RBAC. |
| `app/session-pool.bicep` | ACA dynamic session pool for `execute_python`. |
| `app/session-pool-rbac.bicep` | Session Executor role for the app identity and deployer user. |
| `app/connector-gateway.bicep` | Connector Namespace resources and connection MCP server config. |
| `app/trigger-config.bicep` | Optional Connector Namespace trigger config that calls the function app connector webhook. |

## Local User Access

Local development calls real Azure resources through the developer's Azure CLI identity. The
scaffolded Bicep grants the deployer user:

- Foundry/Cognitive Services roles needed to call the provisioned model locally.
- `Storage Blob Data Contributor` on the storage account so `azd deploy` can upload the function
  deployment package to the deployment container.
- `Azure ContainerApps Session Executor` on the dynamic session pool.
- Connector connection access policy when optional Office 365 MCP resources are enabled.

The deployed function app identity receives the same service access it needs for cloud runs.

For custom tools that access other Azure resources, add explicit RBAC for both the app identity
and, when local development needs it, the deployer user.

## Default Model Parameters

New scaffolds default to `gpt-4.1`:

```json
"foundryModel": { "value": "${FOUNDRY_MODEL=gpt-4.1}" },
"foundryModelName": { "value": "${FOUNDRY_MODEL_NAME=gpt-4.1}" },
"foundryModelVersion": { "value": "${FOUNDRY_MODEL_VERSION=2025-04-14}" },
"foundryDeploymentCapacity": { "value": "${FOUNDRY_DEPLOYMENT_CAPACITY=200}" },
"reasoningEffort": { "value": "${AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT=}" },
"reasoningSummary": { "value": "${AZURE_FUNCTIONS_AGENTS_REASONING_SUMMARY=concise}" }
```

`main.bicep` emits reasoning app settings only when `reasoningEffort` is non-empty. Older models
can fail when unsupported reasoning settings are present.

## Optional Email Connector

`TO_EMAIL` controls whether the Office 365 Outlook Connector Namespace resources are created:

```bicep
var emailEnabled = !empty(toEmail)

module office365Connector './app/connector-gateway.bicep' = if (emailEnabled) {
  ...
}
```

If the user wants a different connector, adapt `connector-gateway.bicep` for that connector type.

## Connector Trigger Config Deployment

Connector-triggered agents require a Connector Namespace trigger config. This is separate from
the function app deployment because the callback URL needs the `connector_extension` system key,
which exists only after the Functions host loads the Connector Extension.

Use the preview extension bundle in `host.json` for apps with connector triggers:

```json
{
  "version": "2.0",
  "functionTimeout": "00:30:00",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle.Preview",
    "version": "[4.42.0, 5.0.0)"
  }
}
```

For Flex Consumption background agents, use `functionTimeout: "00:30:00"` as the scaffold default
and match timer/connector/queue agent runtime timeouts with `timeout: 1800` in the agent file or
`agents.config.yaml`. Keep synchronous HTTP work under the Azure front-end response limit of about
230 seconds; use deferred triggers for longer runs.

After `azd up`, get the key and deploy `trigger-config.bicep`:

```bash
function_name=$(azd env get-value AZURE_FUNCTION_NAME)
gateway_name=$(azd env get-value O365_CONNECTOR_GATEWAY_NAME)
key=$(az functionapp keys list \
  -g rg-$(azd env get-value AZURE_ENV_NAME) \
  -n "$function_name" \
  --query "systemKeys.connector_extension" -o tsv)

az deployment group create \
  -g rg-$(azd env get-value AZURE_ENV_NAME) \
  --template-file infra/app/trigger-config.bicep \
  --parameters \
    connectorGatewayName="$gateway_name" \
    connectionName=office365-outlook \
    triggerConfigName=Office-365-Outlook-on-new-email \
    triggerOperationName=OnNewEmailV3 \
    folderPath=Inbox \
    callbackUrl="https://${function_name}.azurewebsites.net/runtime/webhooks/connector?functionName=OnNewEmail&code=${key}"
```

Do not print or commit callback URLs; they include a system key.

## Deploy

When the user has asked to deploy or has approved cloud deployment, execute these commands for the
user. Do not merely list them as next steps. Use a generous timeout for `azd up` because it
provisions Foundry, Functions, storage, dynamic sessions, and optional Connector Namespace
resources.

Deploy from the local workspace with `azd up` unless the user explicitly asks for continuous
deployment. Do not create GitHub Actions workflows, CI/CD pipeline files, repository secrets, or
run `azd pipeline config` for a normal deployment request.

Confirm the Azure subscription before provisioning. Many users have access to multiple
subscriptions, and this scaffold creates subscription-scope resources. Unless the user already
named the target subscription, show the active subscription and confirm it is correct:

```bash
az account show --query "{name:name,id:id,tenantId:tenantId}" --output table
```

If needed, switch subscriptions before `azd provision` or `azd up`:

```bash
az account set --subscription <subscription-id>
```

From the project root:

```bash
azd init
azd env set AZURE_LOCATION eastus2
azd up
```

After `azd up` completes:

1. Run `azd env get-values` and capture useful outputs.
2. If connectors are present, open the Connector Namespace portal deep link at
  `https://connectors.azure.com/<subscription-id>/<resource-group>/<connector-gateway-name>/overview`
  and ask the user to authorize the connections. Do not use the generic Azure portal resource
  blade URL for connector authorization.
3. Check connection status after authorization.
4. Open or provide the built-in chat URL only when the app intentionally includes built-in chat UI
  or chat API endpoints.
5. Manually trigger timer/non-HTTP agents with the admin endpoint when practical.
6. After manual triggers or external events, query Application Insights requests, traces, and
  exceptions to confirm the function fired and whether the agent/tool run succeeded.
7. Summarize what was deployed, what was verified, and what still requires user action.

For optional email delivery:

```bash
azd env set TO_EMAIL user@example.com
azd up
```

## Local Development Workflow

Provision Azure resources before running locally:

```bash
azd init
azd env set AZURE_LOCATION eastus2
azd provision
azd env get-values
```

Copy the provisioned values into `src/local.settings.json`, especially:

- `FOUNDRY_PROJECT_ENDPOINT`
- `FOUNDRY_MODEL`
- `ACA_SESSION_POOL_ENDPOINT`
- `O365_MCP_SERVER_URL`, if using email or connector tools
- app-specific values such as `TO_EMAIL` or `SUBSCRIPTION_ID`

Keep local settings in lockstep with Bicep and `infra/main.parameters.json`. When app-specific
deployment parameters change, rename or remove the corresponding `src/local.settings.json` keys in
the same edit. Do not leave stale local-only keys such as old Teams channel IDs after switching to
a Flow bot DM recipient.

Start Azurite in another terminal when `AzureWebJobsStorage` is `UseDevelopmentStorage=true` or
the app uses local timer, queue, blob, or durable storage behavior:

```bash
azurite --skipApiVersionCheck
```

Run the function app:

```bash
cd src
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
func start
```

Manual timer or queue test:

```bash
curl -X POST http://localhost:7071/admin/functions/<agent-file-stem> \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Reasoning-Capable Upgrade

Only for models that support reasoning settings:

```bash
azd env set FOUNDRY_MODEL gpt-5.4
azd env set FOUNDRY_MODEL_NAME gpt-5.4
azd env set FOUNDRY_MODEL_VERSION 2026-03-05
azd env set FOUNDRY_DEPLOYMENT_CAPACITY 200
azd env set AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT medium
azd env set AZURE_FUNCTIONS_AGENTS_REASONING_SUMMARY concise
azd provision
```

If the agent is underthinking or the task needs deeper reasoning, offer to raise
`AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT` to `high` and increase `FOUNDRY_DEPLOYMENT_CAPACITY`
within available quota.

If the model deployment fails, revert to `gpt-4.1` values and provision again.

## Deployed Function Keys

Built-in chat endpoints use the default function key:

```bash
az functionapp keys list \
  --resource-group <resource-group> \
  --name <function-app-name> \
  --query "functionKeys.default" \
  --output tsv
```

The MCP endpoint uses the MCP extension system key:

```bash
az functionapp keys list \
  --resource-group <resource-group> \
  --name <function-app-name> \
  --query "systemKeys.mcp_extension" \
  --output tsv
```