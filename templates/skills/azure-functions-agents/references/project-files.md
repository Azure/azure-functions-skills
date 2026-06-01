# Project Files

A serverless agents app is a Python Azure Functions app with agent-specific files in the
function app project root, usually `src`.

## Required and Common Files

| File or folder | Required | Purpose |
| --- | --- | --- |
| `function_app.py` | Yes | Bootstraps the runtime. |
| `host.json` | Yes | Azure Functions host config. |
| `requirements.txt` | Yes | Runtime package and app dependencies. |
| `local.settings.json` | For local runs | Local app settings. Scaffold this directly. |
| `*.agent.md` | Yes | Agent definitions. |
| `agents.config.yaml` | Common | App-wide runtime defaults. |
| `mcp.json` | When using MCP | Remote HTTP MCP and connection MCP servers, including headers and Entra auth. |
| `tools/` | Optional | Custom Python tools. |
| `skills/` | Optional | Agent Skills. |
| `infra/` | For azd deploy | Bicep infrastructure. |

## function_app.py

```python
from azure_functions_agents import create_function_app

app = create_function_app()
```

## requirements.txt

Use the official PyPI package:

```text
azurefunctions-agents-runtime
```

Add app-specific dependencies below it.

## host.json

Default apps that do not use connector triggers can use the standard extension bundle:

```json
{
  "version": "2.0",
  "functionTimeout": "00:30:00",
  "extensions": {
    "http": {
      "routePrefix": ""
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

Apps that use Connector Namespace triggers must use the preview extension bundle because the
Connector Extension is delivered through that bundle for Python and other non-.NET languages:

```json
{
  "version": "2.0",
  "functionTimeout": "00:30:00",
  "extensions": {
    "http": {
      "routePrefix": ""
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle.Preview",
    "version": "[4.42.0, 5.0.0)"
  }
}
```

The Connector Extension is in the latest preview bundle.

Set `functionTimeout` explicitly in scaffolded apps instead of relying on plan defaults. For Flex
Consumption timer, connector-triggered, queue, and other background agents, use `00:30:00` as the
default. This gives model calls, dynamic sessions, connector MCP calls, and retries enough room
without asking the user to guess a duration. For simple chat/API-only apps, `00:15:00` is usually
enough, but `00:30:00` is acceptable when the app also contains background agents.

Align the Azure Functions host timeout with the agent runtime timeout. The host timeout must be at
least as long as the longest `timeout` in `agents.config.yaml` or an individual `.agent.md` file;
making it a little longer is fine. For synchronous HTTP agents, remember that Azure's front-end
HTTP response limit is about 230 seconds even when `functionTimeout` is longer. Use a timer,
queue, connector trigger, or other deferred workflow for longer work.

## agents.config.yaml

Minimal Foundry app:

```yaml
model: $FOUNDRY_MODEL
timeout: 900
```

For background-only apps where most agents are timer, connector-triggered, queue, or otherwise
long-running, use a 30-minute app-wide runtime timeout:

```yaml
model: $FOUNDRY_MODEL
timeout: 1800
```

With dynamic sessions:

```yaml
system_tools:
  dynamic_sessions_code_interpreter:
    endpoint: $ACA_SESSION_POOL_ENDPOINT

model: $FOUNDRY_MODEL
timeout: 900
```

Keep model, timeout, and system tool defaults here. Keep MCP server definitions in `mcp.json`.
When a mixed app has both chat/API and background agents, keep the app-wide timeout at `900` and
set `timeout: 1800` on the background `.agent.md` files.

## local.settings.json

Default scaffold for local development with `gpt-4.1`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "AZURE_FUNCTIONS_AGENTS_PROVIDER": "foundry",
    "FOUNDRY_PROJECT_ENDPOINT": "",
    "FOUNDRY_MODEL": "gpt-4.1",
    "ACA_SESSION_POOL_ENDPOINT": "",
    "TO_EMAIL": "",
    "O365_MCP_SERVER_URL": "",
    "O365_MCP_CLIENT_ID": ""
  }
}
```

Do not include reasoning settings for `gpt-4.1`. Add them only for reasoning-capable models.

Keep `local.settings.json`, `infra/main.parameters.json`, and Bicep parameters in lockstep. When
you rename or replace app-specific parameters, such as switching from Teams `groupId`/`channelId`
to a Flow bot recipient email, update the local settings keys and placeholders in the same pass.
Remove stale keys that no longer drive the app so local `func start` does not test a different
configuration than `azd up` deploys.

## .funcignore

```text
.git*
.vscode
__azurite_db*__.json
__blobstorage__
__queuestorage__
local.settings.json
test
.venv
__pycache__
*.pyc
*.pyo
.python_packages
.env
```

Keep `local.settings.json` out of deployment packages even when it exists in the scaffold.