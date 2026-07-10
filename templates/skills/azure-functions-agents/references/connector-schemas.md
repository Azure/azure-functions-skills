# Connector Operation Schemas

Use this reference to discover connector operation IDs, action parameters, dynamic schemas, and
connection authentication schemes. This is the source of truth before writing `mcpserverconfigs`
operations or a connection resource. For Microsoft Teams targets, links, posting body shapes, and
direct runtime smoke tests, use [connector-teams.md](./connector-teams.md) after reading the
generic discovery flow here.

## Discover Connection Authentication Schemes

Before writing a connection resource for a connector other than Office 365 Outlook, check whether
it exposes multiple named authentication schemes:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
LOCATION="westcentralus"
CONNECTOR_NAME="visualstudioteamservices"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME?api-version=2016-06-01" \
  --query "properties.connectionParameterSets.values[].{name:name,displayName:uiDefinition.displayName}" \
  --output table
```

If this returns any rows, the connection resource must set `properties.parameterValueSet.name` to
one of those exact names, or it silently falls back to a default scheme that may not work for the
target organization or tenant. See
[connectors.md](./connectors.md#connection-authentication-schemes) for the Bicep shape, why this
can fail with an opaque `500` during OAuth sign-in instead of a clear error, and why fixing it on
an already-created connection requires deleting and recreating it.

## Validate Operation IDs

Before deploying an MCP server config, validate every allow-listed operation name against the
managed API operation list. Do not infer version suffixes or tool names from memory; use the exact
operation ID returned by Azure.

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
LOCATION="westcentralus"
CONNECTOR_NAME="teams"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME/apiOperations?api-version=2016-06-01" \
  --query "value[?properties.trigger == null].{name:name,summary:properties.summary,visibility:properties.visibility}" \
  --output table
```

For example, the Microsoft Teams action for posting a chat or channel message is currently
`PostMessageToConversation`, not `PostMessageToConversationV3`. If the operation name in the MCP
server config does not exactly match an operation ID in `apiOperations`, fix the config before
running `azd up`.

## Discover Connector Action Schemas

Do not scrape Learn connector pages for action parameters unless the API surfaces below fail.
Use three increasingly detailed sources:

1. `apiOperations` lists operation IDs, summaries, trigger/action shape, and visibility.
2. `managedApis/<connector>?export=true` returns the connector Swagger/OpenAPI document with
   parameters, definitions, `x-ms-dynamic-values`, and `x-ms-dynamic-schema` hooks.
3. `connections/<connectionName>/dynamicInvoke` evaluates dynamic value/schema hooks for an
   authorized Connector Namespace connection and selected parameter values.

Fetch the exported Swagger for a connector already available in the Connector Namespace:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
RESOURCE_GROUP="<resource-group>"
CONNECTOR_GATEWAY="<connector-namespace-name>"
CONNECTOR_NAME="teams"
API_VERSION="2026-05-01-preview"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/managedApis/$CONNECTOR_NAME?api-version=$API_VERSION&export=true" \
  --output json > /tmp/${CONNECTOR_NAME}-swagger.json
```

For a connector that is not yet attached to a Connector Namespace, use the location-level managed
API export:

```bash
LOCATION="westcentralus"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME?api-version=2022-09-01-preview&export=true" \
  --output json > /tmp/${CONNECTOR_NAME}-swagger.json
```

The non-exported Connector Namespace managed API response only reports broad capability categories
such as `actions` and `triggers`. Add `export=true`; otherwise it will not contain action
parameters.

Extract and dereference an operation's parameters from the exported Swagger:

```bash
OPERATION_NAME="PostMessageToConversation"

jq --arg op "$OPERATION_NAME" '
  def deref($doc):
    if type == "object" and has("$ref") and (."$ref" | startswith("#/parameters/")) then
      $doc.parameters[(."$ref" | sub("^#/parameters/"; ""))]
    else
      .
    end;

  . as $doc
  | .paths
  | to_entries[] as $path
  | $path.value
  | to_entries[]
  | select(.value.operationId == $op)
  | {
      operationId: .value.operationId,
      path: $path.key,
      method: .key,
      summary: .value.summary,
      parameters: (.value.parameters // [] | map(deref($doc) | {
        name,
        in,
        required,
        type,
        summary: ."x-ms-summary",
        modelName: ."x-ms-name-for-model",
        description,
        enum,
        schema,
        dynamicValues: ."x-ms-dynamic-values"
      }))
    }
' /tmp/${CONNECTOR_NAME}-swagger.json
```

Find dynamic schema/value hooks referenced by that operation:

```bash
jq '
  ..
  | objects
  | select(has("x-ms-dynamic-schema") or has("x-ms-dynamic-values") or has("x-ms-dynamic-list"))
' /tmp/${CONNECTOR_NAME}-swagger.json
```

## Connector-Specific References

Some connectors have enough dynamic behavior to deserve their own focused reference. Load these
only when the task needs that connector:

- Microsoft Teams targets, links, posting schemas, MCP parameter patterns, and direct runtime
  smoke tests: [connector-teams.md](./connector-teams.md)
