<!--
---
name: Functions Hosted Skills with Azure Developer CLI
description: Build and deploy an Azure Functions app with chat and timer-triggered Microsoft blog summary hosted skills, Microsoft Foundry, and Azure Container Apps dynamic sessions.
page_type: sample
languages:
- azdeveloper
- python
- bicep
products:
- azure
- azure-functions
- azure-container-apps
- azure-ai-foundry
urlFragment: functions-daily-blog-hosted-skills-azd
---
-->

# Functions Hosted Skills with Azure Developer CLI

This sample shows how to build and deploy Functions Hosted Skills on Azure Functions using the Azure Developer CLI (`azd`). It creates a Python function app with two hosted skills:

- `main.agent.md`: a chat hosted skill with built-in chat UI/API/MCP endpoints and Python dynamic session pool code execution.
- `daily_microsoft_blog_summary.agent.md`: a timer-triggered hosted skill that summarizes recent Microsoft blog posts with the same dynamic session pool.

The runtime still uses agent-based identifiers for `.agent.md` files, `agents.config.yaml`, packages, environment variables, and HTTP endpoints. These identifiers are unchanged by the rebrand.

Email delivery is optional. If you provide an email recipient, the deployment creates an Office 365 Outlook Connector Gateway and MCP server so the timer hosted skill can email the digest. If you leave the recipient blank, no Office 365 resources are created and the timer hosted skill returns the digest in its final response so you can verify the run in Function logs or Application Insights.

## Prerequisites

- An Azure account with an active subscription
- [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
- Python 3.13
- Azurite, if you want to run the function app locally

## Initialize the project

Clone this repository or initialize it from the template repository:

```bash
azd init --template Azure-Samples/functions-daily-blog-hosted-skills-azd
```

Supply an environment name when prompted. In `azd`, the environment keeps deployment state and is used in the generated resource group name.

## Configure optional email delivery

Email delivery is disabled by default. To deploy the sample without Office 365 Outlook, do not set `TO_EMAIL`.

To enable email delivery, set `TO_EMAIL` before running `azd up`:

```bash
azd env set TO_EMAIL you@example.com
```

When email delivery is enabled, `azd up` provisions an Office 365 Outlook connection and MCP server. After deployment, authenticate the connection in the Connector Namespace portal before expecting the timer hosted skill to send email.

Open the Connector Namespace portal from the deployed environment:

```bash
CONNECTOR_PORTAL_URL="https://connectors.azure.com/$(az account show --query id -o tsv)/rg-$(azd env get-value AZURE_ENV_NAME)/$(azd env get-value O365_CONNECTOR_GATEWAY_NAME)/overview"
echo "$CONNECTOR_PORTAL_URL"
open "$CONNECTOR_PORTAL_URL"
```

Use the `connectors.azure.com` URL for authorization, not the generic Azure portal resource URL.

## Deploy to Azure

Run:

```bash
azd up
```

The deployment creates:

- A Flex Consumption Azure Functions app
- A user-assigned managed identity
- A storage account and Application Insights
- A Microsoft Foundry account, project, and `gpt-4.1` deployment
- An Azure Container Apps dynamic session pool
- Optional Office 365 Outlook Connector Gateway resources, when `TO_EMAIL` is set

The scaffold defaults to `gpt-4.1`, `FOUNDRY_DEPLOYMENT_CAPACITY=200`, and no reasoning settings.
If you intentionally upgrade to a reasoning-capable model such as `gpt-5.4`, set the Foundry model
parameters and `AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT`/`AZURE_FUNCTIONS_AGENTS_REASONING_SUMMARY`
together. If your subscription has less remaining quota than the default capacity, lower
`FOUNDRY_DEPLOYMENT_CAPACITY` or choose another region/SKU/model. Use reasoning effort `medium` by
default; raise it to `high` and increase capacity when a hosted skill needs deeper reasoning.

After deployment, `azd` stores output values in your local environment. You can review them with:

```bash
azd env get-values
```

## Use the chat hosted skill

After `azd up` completes, open the built-in chat UI:

```text
https://<function-app-name>.azurewebsites.net/agents/main/
```

The chat hosted skill also exposes `POST /agents/main/chat`, `POST /agents/main/chatstream`, and an MCP tool through `/runtime/webhooks/mcp`. It can use Python code execution through the dynamic session pool, but it does not have access to the Office 365 Outlook email tool.

## Verify the timer-triggered hosted skill

The timer hosted skill runs once per day by default. To verify timer runs, inspect Function logs or Application Insights for `Daily Microsoft Blog Summary Agent` responses.

When `TO_EMAIL` is blank, the timer hosted skill does not try to send email. It returns the complete digest as its final response so the digest appears in logs.

When `TO_EMAIL` is set and the Office 365 connection is authenticated, the timer hosted skill sends the digest to that recipient using the Office 365 Outlook MCP tool.

## Observability

The app depends on `azurefunctions-agents-runtime[monitor]`, so Application Insights observability is enabled by default in the deployed sample. No telemetry code is required in `function_app.py`. When the runtime detects both the `[monitor]` extra and the `APPLICATIONINSIGHTS_CONNECTION_STRING` app setting (provisioned automatically by this sample's Bicep), it configures OpenTelemetry export to Azure Monitor and instruments the hosted skills with Microsoft Agent Framework (MAF) gen_ai instrumentation.

The runtime emits two span types, both recorded as dependency spans:

- `agent.run {name}`: one span per hosted skill invocation, capturing the trigger type, model, session id, tool-call count, and outcome.
- `dynamic_session.execute`: one span per `execute_python` dynamic-sessions call, capturing the session id, whether stderr was produced, and the Azure Container Apps operation correlation.

In the Azure portal, view these spans in your Application Insights resource under Transaction Search or the end-to-end transaction view, not the Logs/AppTraces blade.

Runtime-added attributes use the `af.` prefix (standard OpenTelemetry attributes like `server.address` are reused as-is). If a call fails, the span is tagged with `af.fault_domain`, set to one of `app`, `runtime`, `platform`, `model`, `connector`, `sandbox`, or `unknown`. A `dynamic_session.execute` call that returns non-empty stderr, or raises, is marked as an error span with `af.fault_domain=sandbox`. These sandbox failures remain visible in Application Insights even when the tool converts the failure into a string result returned to the model.

Content attributes such as `af.agent.input`, `af.agent.response`, `af.dynamic_session.code`, `af.dynamic_session.stdout`, and `af.dynamic_session.stderr` are off by default. Set `ENABLE_SENSITIVE_DATA=true` to include them; otherwise only metadata like byte and call counts is recorded. Keep this setting off in production to reduce the risk of capturing PII or other sensitive content.

If `APPLICATIONINSIGHTS_CONNECTION_STRING` is set but the `[monitor]` extra is missing, the runtime logs a one-time warning asking you to install `azurefunctions-agents-runtime[monitor]`.

Optionally, add `"telemetryMode": "OpenTelemetry"` to `src/host.json` to align Azure Functions host request telemetry with the runtime's spans under a single operation id. Runtime spans are recorded correctly even without this setting.

## Run locally

Copy the sample local settings file and fill in values from a deployed environment:

```bash
cd src
cp local.settings.json.sample local.settings.json
```

For local runs with Microsoft Foundry, set `AZURE_FUNCTIONS_AGENTS_PROVIDER` to `foundry`, fill in `FOUNDRY_PROJECT_ENDPOINT` and `FOUNDRY_MODEL`, and set `ACA_SESSION_POOL_ENDPOINT` if you want Python code execution. Set `TO_EMAIL`, `O365_MCP_SERVER_URL`, and optionally `O365_MCP_CLIENT_ID` only when you want local email delivery.

Install dependencies and start the Functions host:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
func start
```

For local MCP access to Office 365 Outlook, sign in with Azure CLI and make sure your user account has access to the Connector Gateway connection:

```bash
az login
```

## Project structure

```text
azure.yaml
infra/
  main.bicep
  main.parameters.json
  app/
    api.bicep
    connector-gateway.bicep
    foundry.bicep
    rbac.bicep
    session-pool.bicep
    session-pool-rbac.bicep
src/
  function_app.py
  main.agent.md
  daily_microsoft_blog_summary.agent.md
  agents.config.yaml
  host.json
  mcp.json
  requirements.txt
```

## Clean up resources

When you are finished, delete the Azure resources:

```bash
azd down
```
