# Connector Connection Lifecycle

Use this reference while creating a Connector Namespace connection for an Azure Functions Hosted
Skill.

## Resource model and API versions

Connector Namespace resources use this hierarchy:

```text
Microsoft.Web/connectorGateways
  connections
    accessPolicies
  mcpserverconfigs
  triggerconfigs
```

Use `2026-05-01-preview` for Connector Namespace gateway and child resources. Use `2016-06-01`
for location-level managed connector metadata.

## Discovery order

1. Inspect existing `Microsoft.Web/connectorGateways` resources and connections.
2. Query the location-level managed connector metadata for the target connector.
3. Read both `properties.connectionParameters` and
   `properties.connectionParameterSets.values`.
4. For each candidate parameter set, inspect its required parameters before selecting it.
5. If a working portal-created connection exists for the same organization, compare its
   `properties.parameterValueSet` without exposing secrets.

Do not assume that all connectors use delegated OAuth. A connector may require:

- delegated interactive OAuth,
- a service principal and client secret,
- a client certificate,
- server, database, username, and password values,
- connector-specific configuration before authorization begins.

Inspect the authentication schemes and required values before writing Bicep:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
LOCATION="<connector-namespace-region>"
CONNECTOR_NAME="<managed-connector-name>"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME?api-version=2016-06-01" \
  --query "{parameters:properties.connectionParameters,parameterSets:properties.connectionParameterSets.values[].{name:name,displayName:uiDefinition.displayName,parameters:parameters}}" \
  --output jsonc
```

When a named scheme is required, select it explicitly at creation time:

```bicep
resource connection 'Microsoft.Web/connectorGateways/connections@2026-05-01-preview' = {
  parent: connectorGateway
  name: connectionName
  properties: {
    connectorName: connectorName
    displayName: connectionDisplayName
    parameterValueSet: {
      name: authenticationSchemeName
      values: authenticationValues
    }
  }
}
```

Keep secrets in `azd` environment values or Key Vault-backed deployment inputs. Do not put them in
the intent record, Bicep defaults, outputs, or chat.

## Stable infrastructure boundary

Bicep and `azd` own the gateway, connection, identities, access policies, stable app-setting
declarations, and outputs. This phase must not create a placeholder or partial MCP server config,
and it must not hard-code an environment's generated MCP endpoint. Generated operation schemas and
the endpoint value are produced later by `azure-functions-connector-mcp`.

Grant access policies to every intended caller:

- the Function App managed identity used in Azure,
- the local/deployer identity used for development validation,
- the Connector Gateway identity when required by the deployed pattern.

The important invariant is that each access-policy principal object ID and tenant ID match the
actual caller. Do not infer authorization from RBAC on the resource group alone.

List deployed connections without printing runtime URLs:

```bash
RESOURCE_GROUP="<resource-group>"
CONNECTOR_GATEWAY="<connector-namespace-name>"
API_VERSION="2026-05-01-preview"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections?api-version=$API_VERSION" \
  --query "value[].{name:name,connector:properties.connectorName,status:properties.overallStatus,runtimeUrlSet:properties.connectionRuntimeUrl != null}" \
  --output table
```

## Creation and recreation

For preview Connector Namespace connections, authentication selection can be creation-time state.
Changing `parameterValueSet` on an existing connection may not update the live resource. When the
wrong scheme was used:

1. Record the current connection consumers and authorization owner.
2. Confirm deletion and recreation are acceptable.
3. Delete only the specific connection resource.
4. Reconcile Bicep against live Azure state. If `azd` reports no changes because of recorded state,
   use the repository-approved no-state or direct deployment path.
5. Repeat authorization and access-policy verification.

Never delete an existing connection merely because metadata differs. Confirm whether other Hosted
Skills or applications use it first.

## Authorization boundary

Delegated OAuth consent determines which downstream user the connector acts as. Function App
managed identity authorizes access to the Connector Namespace connection; it does not replace the
downstream user's consent or permissions.

For delegated connections, record:

- authorizing account purpose, without storing credentials,
- expected tenant or organization,
- connection status,
- operations the application intends to publish,
- whether writes require confirmation or approval.

Open the Connector Namespace experience, not the generic Azure portal resource blade:

```text
https://connectors.azure.com/<subscription-id>/<resource-group>/<connector-gateway-name>/overview
```

Authorization is a human action. After the user completes it, verify the status without returning
the connection runtime URL:

```bash
CONNECTION_NAME="<connection-name>"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections/$CONNECTION_NAME?api-version=$API_VERSION" \
  --query "{name:name,connector:properties.connectorName,status:properties.overallStatus,runtimeUrlSet:properties.connectionRuntimeUrl != null}" \
  --output jsonc
```

The required status is `Connected`.

## Handoff record

Provide this bounded record to `azure-functions-connector-mcp`:

```text
Connector Namespace:
Connection resource ID and name:
Connector name:
Region:
Authentication scheme:
Authorization owner/purpose:
Connection status:
Function App identity:
Selected operation IDs:
Excluded high-risk operations:
Required fixed user parameters:
Required dynamic values or schemas:
Safety and approval requirements:
```
