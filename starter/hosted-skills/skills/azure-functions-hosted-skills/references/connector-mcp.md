# Remote and Connector MCP Servers

Use this reference when adding remote MCP servers in `mcp.json`, including Connector Namespace
MCP tools that agents call. Read [connectors.md](./connectors.md) first for the Connector
Namespace pattern and safety model. Use [connector-schemas.md](./connector-schemas.md) to
validate connector operation IDs and parameters.

## MCP Server Configs

Example operation allow-list shape inside `mcpserverconfigs`:

```bicep
operations: [
  {
    name: 'SendEmailV2'
    displayName: 'Send an email'
    description: 'This operation sends an email message.'
    userParameters: []
    agentParameters: [
      // Parameters the agent may provide for this operation.
    ]
  }
]
```

Before deploying an MCP server config, validate every allow-listed operation name against the
managed API operation list. Do not infer version suffixes or tool names from memory; use the exact
operation ID returned by Azure. If an expected side effect does not happen, such as a Teams
message not appearing, repeat this validation against the deployed MCP server config before
assuming the model made a bad decision. See [connector-schemas.md](./connector-schemas.md) for the
validation commands.

## mcp.json

MCP server entries live beside the agent files in `src/mcp.json`. The runtime supports remote
HTTP MCP servers only. Local `stdio` MCP servers, `command`/`args` server configs, `local`, and
`sse` transports are not supported.

Do not add `uvx`, `npx`, `node`, `python -m`, or other local process commands to `mcp.json`.
Those stdio MCP servers depend on packages and executables that may not exist in the Azure
Functions runtime environment, and they require managing a child MCP process inside a serverless
host. When a user asks to use a stdio MCP server, choose one of these paths instead:

- Use the provider's hosted remote MCP endpoint when one exists.
- If the user already has a securely hosted remote MCP endpoint, configure it in `mcp.json`.
  Hosting and securing a remote MCP server is outside this skill's scope.
- Recreate only the required actions as Python custom tools in `src/tools/`. Load
  [tools-and-skills.md](./tools-and-skills.md) for the tool pattern.

Prefer the Python custom-tool path when the original stdio MCP server is just a wrapper around an
HTTP API, SDK, database, or deterministic local operation. Do not try to run the stdio MCP server
from a custom tool by shelling out to `uvx` or `npx`; implement the needed operations directly in
Python and add normal Python dependencies to `requirements.txt`.

Supported top-level shape:

```json
{
  "servers": {
    "server-name": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "tools": ["tool_name"],
      "headers": {
        "X-API-Key": "$MCP_API_KEY"
      },
      "auth": {
        "scope": "api://example-mcp/.default",
        "client_id": "$MCP_CLIENT_ID"
      }
    }
  }
}
```

Supported server fields:

| Field | Required | Purpose |
| --- | --- | --- |
| `type` | No | Use `http` or `streamable-http`. If omitted, a server with `url` is treated as remote HTTP. |
| `url` | Yes | Remote MCP endpoint URL. `$VAR` and `%VAR%` are substituted in values. If the URL still has unresolved placeholders, the server is skipped. |
| `tools` | No | Allowed tool names to expose from that server. Omit it or use `["*"]` to expose all server tools. |
| `headers` | No | Static request headers for API keys or static bearer tokens. Header values support env-var substitution; header names do not. |
| `auth.scope` | No | Microsoft Entra token scope for servers that accept Entra bearer tokens. Use the right scope for that MCP server. |
| `auth.client_id` | No | Optional user-assigned managed identity client ID for this server. If omitted, the runtime uses `AZURE_CLIENT_ID` when set, then the default credential chain. If unresolved, it is treated as omitted. |

The runtime loads tools from MCP servers, but does not load MCP prompts from them. It always loads
tools and sets prompt loading off for discovered servers.

Use env vars or app settings for secrets. Do not hard-code API keys or bearer tokens in
`mcp.json`; put them in `headers` with a placeholder such as `$MCP_API_KEY`.

Public remote MCP server example:

```json
{
  "servers": {
    "microsoft-learn": {
      "type": "streamable-http",
      "url": "https://learn.microsoft.com/api/mcp"
    }
  }
}
```

API-key remote MCP server example:

```json
{
  "servers": {
    "custom-api": {
      "type": "streamable-http",
      "url": "$CUSTOM_MCP_URL",
      "headers": {
        "X-API-Key": "$CUSTOM_MCP_API_KEY"
      }
    }
  }
}
```

Static bearer-token remote MCP server example:

```json
{
  "servers": {
    "partner-tools": {
      "type": "http",
      "url": "$PARTNER_MCP_URL",
      "headers": {
        "Authorization": "Bearer $PARTNER_MCP_TOKEN"
      }
    }
  }
}
```

Microsoft Entra-authenticated remote MCP server example:

```json
{
  "servers": {
    "internal-tools": {
      "type": "http",
      "url": "$INTERNAL_MCP_URL",
      "auth": {
        "scope": "api://internal-tools/.default",
        "client_id": "$INTERNAL_MCP_CLIENT_ID"
      }
    }
  }
}
```

Any Entra-authenticated MCP server can use the same `auth` section as Connector Namespace MCP
servers, but the scope must match that server's expected token audience. When `auth.scope` is
set, the runtime obtains a token with `DefaultAzureCredential`, caches it until near expiry, and
adds `Authorization: Bearer <token>` to MCP requests. If `headers` are also present, they are
merged with the auth header; do not set an `Authorization` header in `headers` when also using
`auth.scope` because the Entra auth header is the one the runtime sends.

Connection MCP server example:

```json
{
  "servers": {
    "office365-outlook": {
      "type": "http",
      "url": "$O365_MCP_SERVER_URL",
      "auth": {
        "scope": "https://apihub.azure.com/.default",
        "client_id": "$O365_MCP_CLIENT_ID"
      }
    }
  }
}
```

Use `https://apihub.azure.com/.default` for Connector Namespace MCP server auth. Do not replace
it with direct connection runtime troubleshooting scopes such as
`https://service.flow.microsoft.com//.default`; those are only for manual smoke tests against a
connection's `connectionRuntimeUrl`. See [connector-teams.md](./connector-teams.md#direct-runtime-smoke-tests)
when debugging direct Teams runtime calls.

Use `auth.client_id` only when this MCP server should use a specific user-assigned identity. If
it is empty or omitted, the runtime falls back to `AZURE_CLIENT_ID`, then the default credential
chain.

Variable substitution is single-pass and applies only to string values, not object keys. Server
names and header names are literal. Undefined variables stay as placeholders in most values;
unresolved placeholders in `url` cause the server to be skipped, and unresolved placeholders in
`auth.client_id` are treated as empty. Unresolved placeholders in `headers` stay literal, so check
app settings carefully before relying on API-key or static-token auth.

## Agent Access Control

Agents inherit MCP servers by default. Use agent frontmatter to control access to whole MCP
servers, not to safely trim connector actions inside a server. For connector action safety,
allow-list operations in the MCP server config first.

Disable all MCP servers for an agent:

```yaml
mcp: false
```

Exclude one server:

```yaml
mcp:
  exclude:
    - office365-outlook
```

Use `mcp: false` for a general chat/debug agent if it should not be able to send email or call
business systems. Use `mcp.exclude` when one agent should not see a particular MCP server at all.

## Authentication

Connector connections must be authorized after provisioning. Use the Connector Namespace portal at
`connectors.azure.com`, not the generic Azure portal resource blade. Do not open or provide
`https://portal.azure.com/#@/resource/.../providers/Microsoft.Web/connectorGateways/.../overview`
for connector authorization; that is the wrong portal experience for Connector Namespace
connections.

Build a deep link from the subscription ID, resource group, and Connector Namespace name:

```text
https://connectors.azure.com/<subscription-id>/<resource-group>/<connector-gateway-name>/overview
```

For an `azd`-deployed app:

```bash
gateway_name=$(azd env get-value CONNECTOR_GATEWAY_NAME 2>/dev/null || azd env get-value O365_CONNECTOR_GATEWAY_NAME)
CONNECTOR_PORTAL_URL="https://connectors.azure.com/$(az account show --query id -o tsv)/rg-$(azd env get-value AZURE_ENV_NAME)/${gateway_name}/overview"
echo "$CONNECTOR_PORTAL_URL"
open "$CONNECTOR_PORTAL_URL"
```

In the Connector Namespace portal, open the connection and authorize it with the account that
should own the downstream OAuth consent.

When helping the user, open this URL for them when possible. Authorization itself is a user action:
do not try to automate OAuth sign-in. After the user authorizes, run the connection status check
below.

For local MCP calls, the developer identity from `az login` needs access to the connection. The
scaffolded Bicep grants a connection access policy to the deployer user. The access policy
resource name can be deterministic or provider-generated; the important part is that
`properties.principal.identity.objectId` and `tenantId` match the caller or managed identity.

Check connection state with the deployed connection ID:

```bash
az resource show --ids "$(azd env get-value O365_CONNECTION_ID)" --query properties.overallStatus -o tsv
```

Expected connected state is `Connected` after authorization.

## Inspect Existing Connector Namespaces

Use `az rest` with API version `2026-05-01-preview` to inspect Connector Namespace resources.
Avoid printing full trigger config resources because `properties.notificationDetails.callbackUrl`
contains the `connector_extension` system key.

Connector Namespace connections are child resources under `Microsoft.Web/connectorGateways`; they
are not top-level `Microsoft.Web/connections`. If `az resource list --query "[?type=='Microsoft.Web/connections']"`
returns nothing, that does not mean the Connector Namespace has no connections. Query the gateway
child collection instead.

List Connector Namespaces:

```bash
az resource list \
  --resource-type Microsoft.Web/connectorGateways \
  --query "[].{name:name,resourceGroup:resourceGroup,location:location,id:id}" \
  --output table
```

Inspect connections without exposing runtime URLs:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
RESOURCE_GROUP="<resource-group>"
CONNECTOR_GATEWAY="<connector-namespace-name>"
API_VERSION="2026-05-01-preview"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections?api-version=$API_VERSION" \
  --query "value[].{name:name,connector:properties.connectorName,displayName:properties.displayName,status:properties.overallStatus,runtimeUrlSet:properties.connectionRuntimeUrl != null}" \
  --output table
```

Inspect one connection by name:

```bash
CONNECTION_NAME="office365-outlook"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections/$CONNECTION_NAME?api-version=$API_VERSION" \
  --query "{name:name,connector:properties.connectorName,displayName:properties.displayName,status:properties.overallStatus,runtimeUrlSet:properties.connectionRuntimeUrl != null}" \
  --output jsonc
```

Inspect MCP server configs without printing endpoint URLs:

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/mcpserverconfigs?api-version=$API_VERSION" \
  --query "value[].{name:name,state:properties.state,description:properties.description,endpointSet:properties.mcpEndpointUrl != null,connectors:join(',', properties.connectors[].name)}" \
  --output table
```

Inspect trigger configs without printing callback URLs:

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/triggerconfigs?api-version=$API_VERSION" \
  --query "value[].{name:name,state:properties.state,operation:properties.operationName,connector:properties.connectionDetails.connectorName,connection:properties.connectionDetails.connectionName,method:properties.notificationDetails.httpMethod,hasCallback:properties.notificationDetails.callbackUrl != null}" \
  --output table
```

## Optional Connectors

The quickstart provisions Office 365 only when `TO_EMAIL` is set. If email delivery is optional,
write agent instructions so the agent returns the result in logs when the tool or recipient is
not configured.

If the app never needs connector tools, remove connector modules, connector outputs, app settings,
and connection MCP server entries.
