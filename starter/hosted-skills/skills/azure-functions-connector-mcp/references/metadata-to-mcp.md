# Connector Metadata to MCP Contract

Use this reference to turn selected connector operations into a Connector Namespace MCP server
configuration.

## Source precedence

Use the richest supported source available:

1. `apiOperations` for exact operation IDs and action-versus-trigger filtering.
2. An operation-details response's `properties.inputsDefinition`, only when that supported
   response actually returns it.
3. Connector Namespace or location-level exported Swagger/OpenAPI with `export=true`.
4. `dynamicInvoke` on the authorized connection for `x-ms-dynamic-values`,
   `x-ms-dynamic-schema`, or `x-ms-dynamic-list`.
5. Official connector documentation only when the platform metadata is incomplete.

Record which source produced each operation contract. Names, examples, or an existing prompt are
not authoritative schema sources.

Use these API versions:

- managed connector operation list/details: `2016-06-01`
- Connector Namespace resources and gateway-level export: `2026-05-01-preview`
- location-level exported managed API: `2022-09-01-preview`

List action operations:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
LOCATION="<connector-namespace-region>"
CONNECTOR_NAME="<managed-connector-name>"
OPERATION_NAME="<selected-operation-id>"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME/apiOperations?api-version=2016-06-01" \
  --query "value[?properties.trigger == null].{name:name,summary:properties.summary,visibility:properties.visibility}" \
  --output table
```

Conditionally inspect operation details. Do not assume `inputsDefinition` exists merely because
the endpoint succeeds:

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME/apiOperations/$OPERATION_NAME?api-version=2016-06-01" \
  --query "{name:name,summary:properties.summary,inputsDefinition:properties.inputsDefinition}" \
  --output jsonc
```

Export Swagger from the gateway when possible:

```bash
RESOURCE_GROUP="<resource-group>"
CONNECTOR_GATEWAY="<connector-namespace-name>"
API_VERSION="2026-05-01-preview"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/managedApis/$CONNECTOR_NAME?api-version=$API_VERSION&export=true" \
  --output json > /tmp/${CONNECTOR_NAME}-swagger.json
```

If the gateway export omits an operation returned by `apiOperations`, compare the location-level
export:

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME?api-version=2022-09-01-preview&export=true" \
  --output json > /tmp/${CONNECTOR_NAME}-location-swagger.json
```

Use `dynamicInvoke` only after the connection is authorized. Send the exact request template from
the exported dynamic extension and query only `response.body` or `response.body.schema`; the full
response can include caller and subscription metadata:

```bash
CONNECTION_NAME="<connection-name>"

az rest --method post \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections/$CONNECTION_NAME/dynamicInvoke?api-version=$API_VERSION" \
  --body @/tmp/dynamic-invoke-request.json \
  --headers Content-Type=application/json \
  --query "response.body" \
  --output json
```

## Schema preservation

For each selected operation, preserve:

- exact operation ID,
- display name and description,
- top-level and nested required fields,
- object properties and array item schemas,
- string formats such as email, date-time, or HTML,
- enums, defaults, and descriptions,
- connector references and dynamic-value dependencies,
- object-valued parameters that must remain atomic.

Do not move a nested property's `required` marker into an incompatible schema shape. Compare the
generated contract with the connector metadata after registration, not only before it.

## Optional intent manifest

An application may keep a small deployment-owned intent file instead of checking generated
connector schemas into source control:

```json
{
  "connector": "office365",
  "connectionName": "oncall-outlook",
  "mcpServerName": "oncall-outlook",
  "operations": [
    "GetEmailsV3",
    "V4CalendarPostItem"
  ]
}
```

This file is not an Azure requirement. It declares application intent; the publication workflow
still retrieves authoritative schemas from Azure. Do not add a manifest when parameters or existing
deployment code already express the intent clearly.

## Full replacement

Treat the registered operations array as one contract:

1. Read the current config and identify consumers.
2. Generate the complete desired config.
3. Compare operation additions, removals, and schema changes.
4. Obtain approval for permission or side-effect expansion.
5. Register the complete desired config through the supported API.
6. Retrieve the platform-generated endpoint.
7. Validate the deployed contract before enabling Hosted Skill automation.

## Registration ownership

For a generic connector workflow, Bicep owns stable Connector Namespace infrastructure while a
repository-owned bootstrap or post-provision script owns the generated MCP contract. Do not define
the same `mcpserverconfigs` resource in both places. A static Bicep config is acceptable only for a
fixed, reviewed quickstart contract; once metadata-derived publication is adopted, remove that
resource from Bicep or make the bootstrap path the single explicit owner.

Persist the generated endpoint into the deployment environment and feed that value back into the
Function App setting managed by the application's deployment source of truth. If a bootstrap step
sets the app setting directly, it must also update the value consumed by subsequent `azd`
provisions so the next deployment does not remove or replace the working endpoint.

Build the complete request body in a temporary file. The connector entry contains the exact
connection name and the full selected operations array:

```json
{
  "properties": {
    "state": "Enabled",
    "description": "Least-privilege connector tools for the Hosted Skill.",
    "connectors": [
      {
        "name": "<managed-connector-name>",
        "connectionName": "<connection-name>",
        "operations": [
          {
            "name": "<operation-id>",
            "displayName": "<operation-display-name>",
            "description": "<operation-description>",
            "userParameters": [],
            "agentParameters": []
          }
        ]
      }
    ]
  }
}
```

Register the complete desired contract:

```bash
MCP_SERVER_NAME="<mcp-server-config-name>"

az rest --method put \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/mcpserverconfigs/$MCP_SERVER_NAME?api-version=$API_VERSION" \
  --body @/tmp/mcp-server-config.json \
  --headers Content-Type=application/json \
  --output none
```

Inspect state and contract without printing the generated endpoint:

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/mcpserverconfigs/$MCP_SERVER_NAME?api-version=$API_VERSION" \
  --query "{name:name,state:properties.state,endpointSet:properties.mcpEndpointUrl != null,connectors:properties.connectors[].{name:name,connectionName:connectionName,operations:operations[].name}}" \
  --output jsonc
```

Read `properties.mcpEndpointUrl` only into a deployment output/app setting; redact it from logs,
reports, and validation evidence. Wire `src/mcp.json` through variables:

```json
{
  "servers": {
    "<stable-server-name>": {
      "type": "http",
      "url": "$CONNECTOR_MCP_SERVER_URL",
      "auth": {
        "scope": "https://apihub.azure.com/.default",
        "client_id": "$CONNECTOR_MCP_CLIENT_ID"
      }
    }
  }
}
```

Omit `auth.client_id` when the system-assigned identity or normal default credential chain is
intended. An unresolved URL placeholder causes the runtime to skip the MCP server; validate the
deployed app setting before testing tools.

## Tool names

Operation IDs are authoritative for publication, but do not predict the externally exposed MCP
tool-name prefix. Capture the exact names from deployed `tools/list` and use those observed names
for any `mcp.json` `tools` filter or exact validation assertion. Prefer omitting the runtime
`tools` filter because the Connector Namespace MCP configuration already defines the
least-privilege operation surface.

## Validation handoff

Provide:

```text
MCP server config resource ID/name:
Connector and connection:
Generated endpoint setting name:
Managed identity client ID setting, if applicable:
Expected operation IDs:
Observed tool names from `tools/list`:
Expected required fields by tool:
Expected nested objects, formats, and enums:
Explicitly excluded operations:
Read-only smoke operation and arguments:
Controlled write operation, arguments, verification, and cleanup:
Hosted Skill or agent definition that should consume the tools:
```
