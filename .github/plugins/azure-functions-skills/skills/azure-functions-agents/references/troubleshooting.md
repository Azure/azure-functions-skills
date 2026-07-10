# Troubleshooting

Start with actual logs. The runtime often logs warnings for skipped agents, unresolved MCP
servers, missing environment variables, and failed tool setup.

## Local Startup

Common checks:

- Run `azd provision` first when the app uses Foundry, dynamic sessions, or Connector Namespace
  MCP tools.
- Start Azurite with `azurite --skipApiVersionCheck` when using `UseDevelopmentStorage=true`.
- Run from `src`, where `function_app.py` and `host.json` live.
- Activate the virtual environment before `func start`.
- Install `requirements.txt`; the current scaffold uses the `azurefunctions-agents-runtime` PyPI package.
- Ensure `src/local.settings.json` has valid Foundry, session pool, and MCP values.

If no functions are found, verify:

- `function_app.py` imports `create_function_app()`.
- `app = create_function_app()` is module-level.
- Agent frontmatter is valid YAML.
- Triggered agents use `trigger.type` and `trigger.args`.
- Built-in endpoint agents set `builtin_endpoints`.

## Deployment Upload 403

If `azd deploy` fails with a storage 403 while uploading the Function App package, check the
deployer's data-plane role on the deployment storage account. The current scaffold grants the
deployer `Storage Blob Data Contributor` in `app/rbac.bicep` because deployment package upload is
performed by the deploying identity, not the Function App managed identity.

If working on an older scaffold, add or manually assign `Storage Blob Data Contributor` on the
storage account to the deployer user, then rerun `azd deploy` or `azd up`.

## Model Provider Failures

If model calls fail:

- Check `AZURE_FUNCTIONS_AGENTS_PROVIDER` is `foundry` for scaffolded apps.
- Check `FOUNDRY_PROJECT_ENDPOINT` points to the Foundry project endpoint.
- Check `FOUNDRY_MODEL` matches the deployment name.
- Check `AZURE_CLIENT_ID` when using a user-assigned managed identity in Azure.
- Check the function app identity has Foundry/Cognitive Services user roles from Bicep.
- For local runs, check the deployer user has Foundry/Cognitive Services user roles from Bicep
  and is signed in with `az login`.
- Remove `AZURE_FUNCTIONS_AGENTS_REASONING_*` settings when using older models such as
  `gpt-4.1`.

Reasoning settings are not harmless defaults. Only add them for reasoning-capable models such as
`gpt-5.x`.

### Foundry 429 Or TPM Exhaustion

When model calls fail with 429s or token-per-minute exhaustion, do not immediately lower model
quality. First check whether deployment capacity is too low for the selected model and tool-heavy
workflow.

Check regional usage/quota for the selected model/SKU:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
REGION="eastus2"

az cognitiveservices usage list \
  --subscription "$SUBSCRIPTION_ID" \
  --location "$REGION" \
  --query "[?starts_with(name.value, 'OpenAI.GlobalStandard.gpt')].{usage:name.value,limit:limit,current:currentValue,remaining:limit-currentValue,unit:unit,scope:scopeId}" \
  --output table
```

Then present explicit options to the user:

- raise `FOUNDRY_DEPLOYMENT_CAPACITY` if remaining quota allows,
- reduce `AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT` from `high` to `medium`,
- trim the MCP/tool surface or reduce unnecessary tool calls,
- switch region/SKU/model when quota is insufficient.

For reasoning models plus web browsing, dynamic sessions, and connector MCP tools, capacity is a
budget, not a boolean access check. A model can be deployable but still too small for a multi-step
agent run.

## Dynamic Sessions

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `execute_python` missing | `agents.config.yaml` lacks dynamic session config | Add `system_tools.dynamic_sessions_code_interpreter.endpoint`. |
| Session endpoint unresolved | `ACA_SESSION_POOL_ENDPOINT` missing | Set it in app settings or `local.settings.json`. |
| 403 from session pool | Identity lacks role | Assign `Azure ContainerApps Session Executor` to app identity and local user. |
| Browser/code work unavailable | Agent instructions do not mention using Python/Playwright | Tell the agent when to use `execute_python`. |

## MCP and Connectors

For generic remote MCP servers, load [connector-mcp.md](./connector-mcp.md) and check:

- `src/mcp.json` has a top-level `servers` object and each server has a remote `url`.
- `type` is omitted, `http`, or `streamable-http`; `stdio`, `local`, `command`/`args`, and `sse`
  configs are not supported by the runtime.
- If the user supplied a stdio MCP server that uses `uvx`, `npx`, or another local command,
  convert the needed actions to Python custom tools with [tools-and-skills.md](./tools-and-skills.md)
  or use an already-hosted remote MCP endpoint instead. Hosting and securing that endpoint is out
  of scope for this skill.
- Any API keys or static bearer tokens are supplied through `headers` using app settings, not
  hard-coded in `mcp.json`.
- Header values are substituted from `$VAR` or `%VAR%`, but header names are not. An unset header
  value can be sent literally as `$VAR`, so verify the app setting exists.
- Entra-authenticated MCP servers use `auth.scope` with that server's required scope. Optional
  `auth.client_id` is only for selecting a specific user-assigned managed identity.

If connector tools are missing or fail:

- Check `src/mcp.json` exists and contains the connection MCP server.
- Check the MCP server URL env var, such as `O365_MCP_SERVER_URL`, is populated.
- Check `auth.scope` is `https://apihub.azure.com/.default` for Connector Namespace MCP.
  Do not use the direct connection runtime `service.flow` smoke-test scope in `mcp.json`.
- Check `auth.client_id` only when a specific managed identity should be used.
- Check agent frontmatter has not disabled MCP with `mcp: false`.
- Look for Connector Namespace resources under `Microsoft.Web/connectorGateways`, not legacy
  top-level `Microsoft.Web/connections`. Connections, MCP server configs, and trigger configs are
  gateway child resources and usually need `az rest` calls under the connector gateway path.
- Authorize the connector connection in the Connector Namespace portal at
  `https://connectors.azure.com/<subscription-id>/<resource-group>/<connector-gateway-name>/overview`.
  Do not use the generic `portal.azure.com/#@/resource/.../connectorGateways/.../overview` URL
  for connector authorization.
- Verify the app identity and deployer have connection access policies.

Check connection status:

```bash
az resource show --ids "$(azd env get-value O365_CONNECTION_ID)" --query properties.overallStatus -o tsv
```

### Connection Never Reaches `Connected` / OAuth Sign-In Fails With a Generic 500

If a connection stays `Unauthenticated` no matter how many times the user signs in at
`connectors.azure.com`, and the sign-in page itself shows a generic `500 - Something went wrong!`
error with a correlation ID rather than a clear permission or consent error, suspect a missing or
wrong `parameterValueSet` before anything else. It is easy to mis-diagnose this as an organization
policy problem (such as Azure DevOps's "Third-party application access via OAuth") or a service
outage, when the real cause is that the connection was never told which authentication scheme to
use.

1. Check whether the connector exposes multiple authentication schemes:
   ```bash
   SUBSCRIPTION_ID=$(az account show --query id -o tsv)
   LOCATION="westcentralus"
   CONNECTOR_NAME="visualstudioteamservices"

   az rest --method get \
     --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME?api-version=2016-06-01" \
     --query "properties.connectionParameterSets.values[].{name:name,displayName:uiDefinition.displayName}" \
     --output table
   ```
2. If that returns rows, inspect the deployed connection for a `parameterValueSet`:
   ```bash
   RESOURCE_GROUP="rg-$(azd env get-value AZURE_ENV_NAME)"
   CONNECTOR_GATEWAY="$(azd env get-value CONNECTOR_GATEWAY_NAME 2>/dev/null || azd env get-value O365_CONNECTOR_GATEWAY_NAME)"
   CONNECTION_NAME="<connection-name>"

   az rest --method get \
     --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections/$CONNECTION_NAME?api-version=2026-05-01-preview" \
     --query "properties.parameterValueSet" \
     --output jsonc
   ```
   If this is empty or `null`, the connection was created without selecting a scheme and is
   falling back to the connector's default (often a legacy identity provider), which can 500 on
   Microsoft Entra-backed organizations. If a working connection to the same connector already
   exists elsewhere, reading its `parameterValueSet` is the fastest way to get the exact name to
   use instead of guessing from the managed API metadata alone.
3. Add `parameterValueSet: { name: '<scheme-name>', values: {} }` to the connection's Bicep
   properties — see [connectors.md](./connectors.md#connection-authentication-schemes). For
   `visualstudioteamservices` (Azure DevOps) against a Microsoft Entra-backed organization, this
   is normally `EntraOAuth`, which needs no other values. Other schemes on the same connector,
   such as `OauthSP` or `CertOauth`, require real (non-empty) `values` for fields like
   `token:TenantId`, `token:clientId`, and a secret — check that scheme's own `parameters` in the
   step 1 response before assuming `values: {}` is enough.
4. Delete the existing connection and redeploy; changing `parameterValueSet` on an already-created
   connection and redeploying does not update the live resource:
   ```bash
   az rest --method delete \
     --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections/$CONNECTION_NAME?api-version=2026-05-01-preview"

   azd provision --no-state
   ```
   Plain `azd provision` can report "no changes to provision" here because it diffs the template
   against its own recorded deployment state, not live Azure state, after an out-of-band delete
   like this.
5. Retry sign-in at `connectors.azure.com`. It should now present the scheme named in
   `parameterValueSet` (for example, "Log in with Microsoft Entra ID" instead of a legacy
   Azure DevOps credentials prompt).

Only investigate organization-level or tenant-level policies after ruling this out — they can
produce the exact same generic failure and are easy to chase first, wasting time on a policy that
was never the problem.

### Expected Connector Action Did Not Happen

Sometimes a connector action fails as a missing side effect rather than a clear exception. For
example, the user may say "I don't see the Teams message" even though the agent run completed.
Do not assume this is only a model behavior problem. Verify the connector wiring:

Before reading logs, ask the user to verify the downstream side effect exactly once: did the Teams
message, Flow bot DM, email, draft, ticket, or file change appear? If the answer is no, treat
green Function execution traces as unverified.

1. Inspect the agent response or Application Insights traces for the tool name the agent tried to
  call, or whether the expected tool was missing.
2. Inspect the deployed MCP server config and its allow-listed operation names without printing
  endpoint URLs:
  ```bash
  SUBSCRIPTION_ID=$(az account show --query id -o tsv)
  RESOURCE_GROUP="rg-$(azd env get-value AZURE_ENV_NAME)"
  CONNECTOR_GATEWAY="$(azd env get-value CONNECTOR_GATEWAY_NAME 2>/dev/null || azd env get-value O365_CONNECTOR_GATEWAY_NAME)"

  az rest --method get \
    --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/mcpserverconfigs?api-version=2026-05-01-preview" \
    --query "value[].{name:name,state:properties.state,connectors:properties.connectors[].{name:name,connectionName:connectionName,ops:operations[].name},endpointSet:properties.mcpEndpointUrl != null}" \
    --output jsonc
  ```
3. Compare each allow-listed operation name with the connector's managed API operation list:
  ```bash
  CONNECTOR_NAME="teams"
  LOCATION="westcentralus"

  az rest --method get \
    --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME/apiOperations?api-version=2016-06-01" \
    --query "value[?properties.trigger == null].{name:name,summary:properties.summary,visibility:properties.visibility}" \
    --output table
  ```
4. Fix any mismatched operation IDs in Bicep and redeploy. For example, Teams posting currently
  uses `PostMessageToConversation`, not `PostMessageToConversationV3`.
5. If the operation ID is correct but the side effect still does not happen, inspect the exported
  connector Swagger and dynamic schemas instead of guessing parameter names:
  ```bash
  az rest --method get \
    --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/managedApis/$CONNECTOR_NAME?api-version=2026-05-01-preview&export=true" \
    --output json > /tmp/${CONNECTOR_NAME}-swagger.json
  ```
  For connector parameters with `x-ms-dynamic-values` or `x-ms-dynamic-schema`, evaluate the
  referenced read operation through
  `connectorGateways/<gateway>/connections/<connectionName>/dynamicInvoke`. Query only
  `response.body` or `response.body.schema`; the full response headers can include caller and
  subscription metadata.
6. If the agent session or traces show an error like
  `The API operation does not contain a definition for parameter 'body/recipient/groupId'`, the
  MCP server config probably split a nested dynamic body object into unsupported parameter names.
  For Teams `PostMessageToConversation`, pre-fill `body/recipient` as one object-valued
  `userParameters` entry with `groupId` and `channelId`, and expose only `body/messageBody` as the
  agent-provided parameter for a fixed channel target.
7. Confirm the connection state is `Connected`, the MCP server URL app setting is populated, and
  the agent has not disabled the MCP server with `mcp: false` or `mcp.exclude`.
8. If the side effect is still missing after one run, do not trigger the full agent again. Inspect
  the recorded agent session/tool result and run a focused connector smoke test with the same
  arguments. See [connector-smoke-tests.md](./connector-smoke-tests.md).
9. Retry the full agent only after the connector smoke test succeeds or the wiring issue is fixed.

### Direct Connector Runtime Smoke Test Fails

Direct calls to a connection's `connectionRuntimeUrl` are troubleshooting-only checks. Agents and
MCP servers should keep using Connector Namespace MCP endpoints and the MCP auth scope in
[connector-mcp.md](./connector-mcp.md).

If a direct Teams runtime smoke test fails:

- Verify the connection is `Connected` and has an access policy for the caller under
  `connectorGateways/<gateway>/connections/<connection>/accessPolicies`.
- Decode token claims without printing the token. The caller `oid` should match an ACL principal.
- For direct runtime calls, use token audience `https://service.flow.microsoft.com/`. With v2
  scope syntax, use `https://service.flow.microsoft.com//.default`; the double slash is
  intentional.
- Do not use `https://apihub.azure.com/.default` for direct runtime calls. It can reach token
  exchange and still fail with a misleading missing-ACL error. Keep that scope for MCP server auth.
- If the runtime says `Audience:https://service.flow.microsoft.com is not found`, the trailing
  slash is missing.

For Teams target paths and request bodies, see [connector-teams.md](./connector-teams.md).

## Connector Triggers

If a connector-triggered agent does not fire:

- Check `host.json` uses `Microsoft.Azure.Functions.ExtensionBundle.Preview` with version
  `[4.42.0, 5.0.0)` or newer within 4.x.
- Check the agent frontmatter uses `generic_trigger` with `args.type: connectorTrigger`.
- Check the Function App has a `connector_extension` system key after startup.
- Check the Connector Namespace trigger config callback URL points to
  `/runtime/webhooks/connector?functionName=<agent-function-name>&code=<key>`.
- Check the trigger config operation name, such as `OnNewEmailV3`, and parameters match the
  connector operation.
- Check the Connector Gateway identity has an access policy on the connection; trigger polling
  needs this in addition to app/deployer access policies.
- Check the connector connection is authorized in the Connector Namespace portal.

Connector trigger callbacks require Azure-hosted Connector Namespace resources. Local testing is
usually limited to starting the function app and testing MCP/tool behavior; the external connector
event callback path is normally verified after deployment.

## Built-In Endpoints

Routes are based on the `.agent.md` file stem:

- `/agents/main/`
- `POST /agents/main/chat`
- `POST /agents/main/chatstream`
- `/runtime/webhooks/mcp`

If the chat UI does not exist, ensure the agent has:

```yaml
builtin_endpoints:
  debug_chat_ui: true
  chat_api: true
```

Only do this when the user expected an interactive chat/debug surface. Scheduled-only,
timer-triggered, connector-triggered, queue, and other background-only agents should not have a
chat UI unless the user asked to talk to them.

The MCP endpoint requires the MCP extension system key in Azure, not the default function key.

## Deployed Diagnostics

Use Application Insights for Flex Consumption diagnostics. Avoid `az functionapp log tail` for
agent output.

After a manual admin trigger or external connector event, query Application Insights directly and
report what happened instead of merely telling the user where logs are.

If telemetry is delayed, tell the user that delay can be normal for background agents and keep them
updated while you wait. Do not leave the user wondering whether the task is stuck. If no request,
trace, or exception data appears after a reasonable wait, move into the relevant troubleshooting
section instead of repeatedly triggering the function.

Useful KQL:

```kql
exceptions
| where timestamp > ago(1h)
| order by timestamp desc
| project timestamp, problemId, outerMessage, details
```

```kql
requests
| where timestamp > ago(1h)
| where name contains "agent"
| order by timestamp desc
| project timestamp, name, resultCode, duration, success
```

```kql
traces
| where timestamp > ago(1h)
| where severityLevel >= 2
| order by timestamp desc
| project timestamp, message, severityLevel
```
