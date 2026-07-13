# Official Quickstart Template

The canonical serverless agents scaffold is the Azure MCP / Azure Functions template
`ai-serverless-agents-python`, backed by:

- Microsoft Learn: <https://learn.microsoft.com/azure/azure-functions/scenario-serverless-agents-runtime>
- Template repository: <https://github.com/Azure-Samples/functions-quickstart-serverless-agents-azd>

Do not use a bundled copy of the template. Retrieve the template through Azure MCP
`functions_template_get` first, then fall back to the manifest `repositoryUrl`, `folderPath`, and
`gitRef` if MCP retrieval fails.

The official template includes:

- `azure.yaml`
- `infra/` with Foundry, Flex Consumption, dynamic sessions, and optional Connector Namespace MCP
  resources
- `src/function_app.py`
- `src/host.json` with a 30-minute function timeout for background-capable scaffolds
- `src/agents.config.yaml`
- `src/main.agent.md`
- `src/daily_microsoft_blog_summary.agent.md` with a 30-minute timer-agent timeout
- `src/mcp.json`
- `src/local.settings.json.sample`
- `src/requirements.txt` with `azurefunctions-agents-runtime[monitor]` so Application Insights
  observability is enabled by default (add the `[monitor]` extra if the retrieved copy ships the
  base `azurefunctions-agents-runtime` package)

## How to Use It

For a new app, retrieve the template files into the project root, then tailor:

1. Rename `azure.yaml` `name` to match the app.
2. Replace sample agents with the user's agents.
3. Keep `main.agent.md` only when the user asks for a chat bot, debug chat UI, chat API, streaming
  API, or built-in MCP endpoint. Remove it for scheduled-only or background-only apps.
4. Keep dynamic sessions when any agent needs web browsing or code execution.
5. Keep the Office 365 connector path only when an agent needs email tools.
6. Copy `src/local.settings.json.sample` to `src/local.settings.json` for local runs and update
   app-specific env vars in `src/local.settings.json` and `infra/main.parameters.json`.
7. Keep `gpt-4.1` default unless intentionally upgrading to a reasoning-capable model.

## Learn quickstart terminology

The Learn quickstart calls this programming model **serverless agents using Azure Functions** and
describes:

- A chat agent with browser testing, sandboxed Python execution, and web browsing support.
- A timer-triggered agent that gathers Microsoft blog posts, summarizes them, and can email the
  digest through MCP tools from a managed MCP server for a Microsoft 365 Outlook connector.
- Agent definitions in markdown files, app defaults in `agents.config.yaml`, remote MCP servers in
  `mcp.json`, and Azure resources provisioned through `azd`.