---
name: azure-functions-agents
description: "Build, scaffold, extend, deploy, and troubleshoot event-driven AI agents and scheduled serverless agent apps on Azure Functions using azurefunctions-agents-runtime. Use when the user wants a scheduled agent, morning briefing, daily digest, timer agent, inbox summary, email or Teams briefing, background AI workflow, connector-triggered agent, event-driven AI automation, HTTP/chat agent, webhook-style agent, or Azure Functions hosted agent."
argument-hint: "Describe the agent, trigger, tools, model needs, and deployment target"
---


# Azure Functions Agents

Use this skill to build event-driven AI agents on Azure Functions with the Azure Functions
serverless agents runtime. This programming model is new, so prefer these patterns over older
package README examples.

## Current Defaults

- Scaffold with Microsoft Foundry as the model provider.
- Scaffold files may keep `gpt-4.1` as the safe Bicep fallback, but before provisioning or
  deploying, check the user's subscription/region for the best deployable GPT model and quota.
- Prefer the newest deployable GPT reasoning model with remaining quota when available, such as
  `gpt-5.4` or newer. Only configure reasoning settings for models known to support them. Older
  models can fail if `AZURE_FUNCTIONS_AGENTS_REASONING_*` settings are present.
- For `gpt-5.x` and other reasoning-capable models, use reasoning effort `medium` by default,
  `high` when the task needs deeper reasoning or the agent is underthinking, `xhigh` only when the
  selected model supports it, and reasoning summary `concise`.
- If an agent needs web browsing, current public data, browser automation, data analysis, or code
  execution, use Azure Container Apps dynamic sessions. Do not write custom web-fetch tools for
  those cases.
- Use remote HTTP MCP servers and connection MCP servers from `mcp.json`; local `stdio` MCP
  servers are not supported by the runtime. When the user brings a stdio MCP server, convert the
  needed actions into Python custom tools or use a hosted remote MCP endpoint.
- Use Connector Namespaces, represented as `Microsoft.Web/connectorGateways` resources in Bicep.
- Generated apps should include a ready-to-edit `src/local.settings.json`, not only a template.
- Generated `requirements.txt` must use the official PyPI package: `azurefunctions-agents-runtime`.

## Progressive References

Load only the files needed for the task:

| Need | Reference |
| --- | --- |
| Required files and scaffold contents | [project-files.md](./references/project-files.md) |
| Agent frontmatter, triggers, built-in endpoints | [agent-files.md](./references/agent-files.md) |
| Trigger schemas, connector triggers, built-in endpoint routes | [triggers.md](./references/triggers.md) |
| Built-in chat APIs, session IDs, built-in MCP tools | [built-in-endpoints.md](./references/built-in-endpoints.md) |
| Local/deployed testing recipes by trigger type | [testing.md](./references/testing.md) |
| Foundry model defaults, upgrades, reasoning settings | [models.md](./references/models.md) |
| Dynamic sessions for code execution and web browsing | [sessions.md](./references/sessions.md) |
| Connector Namespace overview, naming, and safety boundaries | [connectors.md](./references/connectors.md) |
| Remote MCP server entries, headers/auth, Connector MCP server configs, authorization, `mcp.json`, and inspection | [connector-mcp.md](./references/connector-mcp.md) |
| Connector operation IDs, schemas, and dynamic parameters | [connector-schemas.md](./references/connector-schemas.md) |
| Microsoft Teams connector targets, links, schemas, and troubleshooting smoke tests | [connector-teams.md](./references/connector-teams.md) |
| Connector side-effect smoke tests for Teams, Outlook, and MCP tools | [connector-smoke-tests.md](./references/connector-smoke-tests.md) |
| Connector-triggered agents and trigger config deployment | [connector-triggers.md](./references/connector-triggers.md) |
| Custom Python tools and Agent Skills | [tools-and-skills.md](./references/tools-and-skills.md) |
| Writing robust agent instructions | [agent-authoring.md](./references/agent-authoring.md) |
| Bicep, azd, deployment, local development | [infra-and-deployment.md](./references/infra-and-deployment.md) |
| Azure resource naming abbreviations used by the Bicep assets | [abbreviations.json](./references/abbreviations.json) |
| Diagnostics and common failures | [troubleshooting.md](./references/troubleshooting.md) |
| Full quickstart app copied into this skill | [quickstart-reference.md](./references/quickstart-reference.md) |

## Assess the Workspace

Before editing, inspect the app. Look for:

- `src/function_app.py` importing `create_function_app()`
- `src/*.agent.md`
- `src/agents.config.yaml`
- `src/mcp.json`
- `src/tools/` and `src/skills/`
- `src/local.settings.json`
- `infra/main.bicep`, `infra/app/*.bicep`, `infra/main.parameters.json`
- `azure.yaml`
- `.azure/*/config.json` for existing `azd` environments

For existing apps, read the current files and preserve the app's structure. Current apps should
use explicit `builtin_endpoints`, `trigger.args`, Foundry provider settings, `agents.config.yaml`
for shared runtime defaults, and Connector Namespace MCP entries in `mcp.json`.

When inspecting deployed connectors, remember that Connector Namespace resources live under
`Microsoft.Web/connectorGateways`. Connections are `connectorGateways/<gateway>/connections`, MCP
server configs are `connectorGateways/<gateway>/mcpserverconfigs`, and trigger configs are
`connectorGateways/<gateway>/triggerconfigs`. Do not search for legacy top-level
`Microsoft.Web/connections` to find Connector Namespace connections.

## Discuss and Plan the Agent

When the user says they want to create an agent, do not jump straight to files unless the request
already contains enough detail. First learn enough to shape the app and discuss a short plan.

Ask only the questions needed to move forward, usually covering:

- **Goal:** What should the agent accomplish, and what should a successful run produce?
- **Invocation:** Should it be chat/API-driven, scheduled, event-triggered, connector-triggered,
  or some combination?
- **Inputs and outputs:** What data starts the run, and should the result be returned, logged,
  emailed, posted, drafted, stored, or sent somewhere else?
- **Interactive surfaces:** Does the user want to chat with the agent, expose a chat/API surface,
  stream responses, or expose the agent as a built-in MCP tool? Enable built-in endpoints only for
  those interactive scenarios.
- **Tools and services:** Does it need web/code execution, Microsoft Learn, Office 365, Teams,
  Azure Resource Manager, storage, queues, databases, or custom APIs?
- **Teams targets:** If the agent needs a Teams team, channel, or chat target, ask the user to
  paste a Teams link and parse IDs from it on their behalf. Do not ask them to manually find raw
  team IDs, channel IDs, or chat IDs. Load [connector-teams.md](./references/connector-teams.md)
  before wiring Teams posting or diagnosing a missing Teams message.
- **Safety boundaries:** For actions like email, Teams posts, ticket creation, or resource changes,
  should the agent draft, ask for confirmation, or act automatically?
- **Model selection:** Which Azure subscription and region should be checked for GPT model access
  and quota? If the user has not specified them, use the current Azure CLI subscription and the
  planned `AZURE_LOCATION`.
- **Deployment preference:** Default to building and deploying to Azure with `azd up`, but offer
  to run locally first if the user wants a local iteration loop.

Do not ask the user to estimate runtime duration unless the workflow is obviously unusual or may
run longer than the standard background-agent defaults. Set practical timeouts yourself: keep
simple chat/API agents at the runtime default, set timer, connector-triggered, queue, and other
background agents to 30 minutes, and align `host.json` `functionTimeout` to the longest agent
timeout. For synchronous HTTP work that may take longer than about 230 seconds, choose a
background/deferred pattern instead of relying on a longer HTTP response.

Do not add `builtin_endpoints` or a `main.agent.md` debug/chat agent just to test a scheduled,
timer, connector-triggered, queue, or other background workflow. If the user asks for a chat bot,
debug chat UI, chat API, streaming API, or says they want to talk to the agent, enable the
appropriate built-in endpoints for that agent or add a separate interactive agent. Otherwise,
verify background agents with the admin invoke endpoint and Application Insights.

After the discovery, summarize the plan before editing. Include the agent files, trigger or
built-in endpoints, model choice, tools/MCP/connectors, infrastructure changes, and how it will be
tested. If the user has already provided enough detail, make reasonable choices and proceed.

## Scaffold a New App

Use **manifest discovery + MCP primary retrieval** when Azure MCP tools are available:

1. Fetch the Azure Functions template manifest from
   `https://cdn.functions.azure.com/public/templates-manifest/manifest.json` and find
   `ai-serverless-agents-python`. Use its catalog metadata (`priority`, `categories`, `tags`,
   `whatsIncluded`) to explain why this is the correct serverless agents scaffold. Keep
   `repositoryUrl`, `folderPath`, and `gitRef` for fallback.
2. Call Azure MCP `functions_template_get` with `language: python` and
   `template: ai-serverless-agents-python`. This is the primary source for the complete project
   files.
3. Write the returned `files` array into the target project. If the output is truncated or saved to
   a temporary file, read the complete JSON response before deciding retrieval failed.
4. If MCP returns an actual tool error, cannot retrieve the template, or returns an empty/zero-file
   result after reading the complete response, fall back to the manifest `repositoryUrl`,
   `folderPath`, and `gitRef` using direct GitHub download first and `git clone --depth 1` only if
   downloads fail. Tell the user that MCP retrieval failed and GitHub fallback was used.
5. If both MCP and GitHub retrieval fail, use the bundled
   [assets/quickstart-sample](./assets/quickstart-sample) as the offline last resort.

When Azure MCP tools are not available, skip directly to the manifest/GitHub fallback above, then
to the bundled quickstart sample. Do not invent a project structure from memory.

After scaffolding from MCP, GitHub, or the bundled sample, tailor the app to the user's agent.

Baseline structure:

```text
<project-root>/
  azure.yaml
  infra/
    abbreviations.json
    main.bicep
    main.parameters.json
    app/
      api.bicep
      connector-gateway.bicep
      trigger-config.bicep        # if using connector triggers
      foundry.bicep
      rbac.bicep
      session-pool.bicep
      session-pool-rbac.bicep
  src/
    function_app.py
    host.json
    local.settings.json
    requirements.txt
    .funcignore
    agents.config.yaml
    main.agent.md              # only when the user wants chat/API/MCP endpoints
    <agent-name>.agent.md
    mcp.json
```

Default scaffold choices:

- Python 3.13 in Bicep.
- Foundry provider. Keep `gpt-4.1` in template defaults only as a safe fallback.
- Before running `azd provision` or `azd up`, run the model and quota checks in
  [models.md](./references/models.md), recommend the best deployable GPT model, and set the
  `FOUNDRY_MODEL`, `FOUNDRY_MODEL_NAME`, `FOUNDRY_MODEL_VERSION`, `FOUNDRY_DEPLOYMENT_CAPACITY`,
  and reasoning env vars when a better reasoning-capable model is selected.
- No reasoning app settings unless the app is explicitly upgraded to a reasoning-capable model.
- ACA dynamic session pool when any agent needs code execution or web browsing.
- Optional Office 365 Outlook connection MCP server when `TO_EMAIL` is set.
- Built-in endpoints only when the scenario is interactive. Do not add debug chat UI, chat API,
  streaming API, built-in MCP, or a general `main.agent.md` to a scheduled-only/background-only app
  unless the user asked for that surface.
- Explicit timeout settings: use `functionTimeout: "00:30:00"` in `host.json` for background-capable
  apps, keep simple chat/API agents at `timeout: 900`, and set timer, connector-triggered, queue,
  or other long-running background agents to `timeout: 1800` unless the task clearly needs more.
- Connector-triggered apps use the preview extension bundle and a second-step trigger config
  deployment after the `connector_extension` system key exists.
- `local.settings.json` includes local storage and Foundry/MCP placeholders.

After copying, remove or adjust sample-specific agents and instructions. Keep infrastructure
modules only when the app needs them.

## Local Development First Rule

Default to deploying new apps to Azure with `azd up`; these agents are designed for managed
identity, Foundry, dynamic sessions, Connector Namespaces, Application Insights, and Functions
hosting. Offer to run locally first when the user wants to iterate before deploying, and explain
the local tools required.

Local prerequisites:

- Azure Developer CLI (`azd`)
- Azure Functions Core Tools v4
- Python 3.13+
- Azurite, when using `AzureWebJobsStorage=UseDevelopmentStorage=true`
- Azure CLI login for local managed-identity-equivalent access

When an app uses Foundry, dynamic sessions, or connector MCP servers, run `azd provision` before
local development. Local `func start` still calls real Azure resources for model, session pool,
and connector operations.

Local loop:

1. `azd init`
2. `azd provision`
3. Copy outputs from `azd env get-values` into `src/local.settings.json`.
4. Start Azurite with `azurite --skipApiVersionCheck`.
5. From `src`, create a venv, install requirements, and run `func start`.

The scaffolded Bicep grants the deployer/local user access to Foundry and the session pool, and
connection access policies when optional connectors are enabled.

## Build or Modify Agents

Each `.agent.md` file defines one agent. Use YAML frontmatter for runtime configuration and
markdown for behavior. The file stem becomes the function name and built-in endpoint route
segment.

Choose endpoints from the scenario, not from testing convenience. Scheduled-only, timer,
connector-triggered, queue, and other background agents should omit `builtin_endpoints` unless the
user asks to talk to that agent, expose it as an API, or expose it as a built-in MCP tool. Use the
admin endpoint and Application Insights to test background agents.

Current trigger example:

```yaml
---
name: Daily Report
description: Sends a daily report.

trigger:
  type: timer_trigger
  args:
    schedule: "0 0 15 * * *"

mcp: true
---
```

Current built-in endpoint example:

```yaml
---
name: Chat Agent
description: Interactive agent for testing.

builtin_endpoints:
  debug_chat_ui: true
  chat_api: true
  mcp: true

mcp: false
---
```

Load [agent-files.md](./references/agent-files.md) before adding less common frontmatter fields.

## Model Selection Guidance

For new scaffolds, keep `gpt-4.1` as the safe Bicep default, but actively try to select the best
deployable GPT model before provisioning. Use `az cognitiveservices model list` and
`az cognitiveservices usage list` to check the user's subscription, target region, model version,
deployment SKU, and quota. See [models.md](./references/models.md) for copyable commands.

Do not silently deploy `gpt-4.1` just because it is the template default. Either run the model
and quota checks and choose/recommend a better deployable model, or state why the checks could not
be run and then use `gpt-4.1` without reasoning settings.

Recommend the newest deployable GPT reasoning model with remaining quota. Ask the user to choose
when there are meaningful tradeoffs, such as newer/slower/costlier reasoning models versus smaller
mini/nano models. If no reasoning-capable model has quota, or if availability/quota discovery
cannot determine what the user can deploy, use `gpt-4.1` without reasoning settings.

When selecting a reasoning-capable model, confirm reasoning support from the Azure OpenAI
reasoning models documentation, then set model and reasoning values together. Use reasoning effort
`medium` by default. Offer `high` and increased deployment capacity when the task needs deeper
reasoning or the deployed agent is underthinking. Use `xhigh` only when the selected model supports
it and the user wants maximum reasoning with possible latency/cost tradeoffs. Use reasoning summary
`concise`.

## Deploy and Verify

For new apps, use `azd up` from the project root. If the user has agreed to deploy, run the
deployment commands yourself instead of stopping after printing them. Set required `azd` env vars,
run `azd init` when needed, run model/quota checks before provisioning, confirm the active Azure
subscription, then run `azd up` with a generous timeout. Pause only for information you genuinely
need from the user, such as a missing recipient email, region choice, subscription confirmation,
or portal-only connector authorization. Do not route secrets through chat.

Before `azd provision` or `azd up`, run `az account show --query "{name:name,id:id,tenantId:tenantId}"`
and show the selected subscription to the user unless they already explicitly named the subscription
for this deployment. If it is not the intended subscription, have the user choose or run
`az account set --subscription <subscription-id>` before provisioning. Do not deploy to whichever
Azure CLI subscription happens to be active without making that choice visible.

Unless the user explicitly asks for continuous deployment, deploy from the local workspace with
`azd up`. Do not create GitHub Actions workflows, CI/CD pipeline files, repository secrets, or run
`azd pipeline config` for a normal app deployment request.

After deployment, verify outputs with `azd env get-values`, open or provide the relevant app URL,
show the user how to get the default function key only when built-in chat UI/API endpoints are
present, open Connector Namespace authorization links when connectors are present, check
connection status, and run a smoke test when practical. For timer or other non-HTTP agents,
manually trigger the function with the admin endpoint after deployment, then query Application
Insights requests, traces, and exceptions for that run. For built-in chat agents, open or provide
the `/agents/<slug>/` URL and call the chat API if useful. Do not rely on `az functionapp log tail`
for Flex Consumption agent diagnostics.

When a manual trigger starts a timer/background agent, tell the user what to expect before waiting:
the admin endpoint often returns `202 Accepted`, the agent may run for several minutes, and
Application Insights can lag. Give short progress updates while checking telemetry, especially for
runs that take 5-10 minutes. If telemetry does not appear after a reasonable wait, or the function
appears stuck past its expected duration, say so and switch to troubleshooting instead of silently
waiting or repeatedly triggering the function.

For connector actions with visible side effects, such as Teams posts or Outlook messages, verify
the downstream side effect after the first run. If the user reports it is missing, do not keep
triggering the agent. Inspect the recorded tool result/session and run a focused connector smoke
test with the same arguments before changing model settings or rerunning the full workflow.

Be hands-on after scaffolding. Do not stop at a command list when the next command is safe and the
user already approved the direction. Run `azd up`, open authorization URLs, run `azd env
get-values`, test deployed endpoints, and report the results. Stop only for user-only actions such
as signing in to authorize a connector, selecting an ambiguous option, or entering secrets.

When creating backing Azure resources beyond this skill's bundled Bicep, use Azure docs. If the
agent needs searchable docs context, ask the user to connect the Microsoft Learn MCP server at
`https://learn.microsoft.com/api/mcp`.

Useful endpoints:

- Chat UI, when enabled: `/agents/<agent-file-stem>/`
- Chat API, when enabled: `POST /agents/<agent-file-stem>/chat`
- Streaming chat API, when enabled: `POST /agents/<agent-file-stem>/chatstream`
- MCP endpoint, when enabled: `/runtime/webhooks/mcp`
- Manual non-HTTP trigger: `POST /admin/functions/<agent-file-stem>`