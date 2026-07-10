# Connector Namespaces Overview

Use Connector Namespaces for Microsoft and third-party service integrations. In Bicep and ARM,
the resource type is still `Microsoft.Web/connectorGateways`, so infrastructure files use the
term connector gateway even when docs and marketing say Connector Namespace.

Load the more specific connector reference for the task at hand:

| Need | Reference |
| --- | --- |
| Connector Namespace pattern, Bicep assets, naming, and safety boundaries | This file |
| Connector MCP server configs, `mcp.json`, access control, authorization, and cleanup | [connector-mcp.md](./connector-mcp.md) |
| Connector operation IDs, action parameters, exported Swagger, and `dynamicInvoke` | [connector-schemas.md](./connector-schemas.md) |
| Microsoft Teams connector targets, links, schemas, and troubleshooting smoke tests | [connector-teams.md](./connector-teams.md) |
| Connector side-effect smoke tests for Teams, Outlook, and MCP tools | [connector-smoke-tests.md](./connector-smoke-tests.md) |
| Connector-triggered agents, trigger configs, callback URLs, and trigger operation discovery | [connector-triggers.md](./connector-triggers.md) |

## Current Pattern

For connector tools that agents call:

1. Bicep creates a `Microsoft.Web/connectorGateways` resource.
2. Bicep creates a nested connector connection, such as Office 365 Outlook.
3. Bicep creates access policies for the function app managed identity, the deployer user, and
   the Connector Gateway identity.
4. Bicep creates an MCP server config that allow-lists only the connector operations the agent
   needs.
5. `mcp.json` points to the MCP endpoint URL and uses Microsoft Entra auth.
6. Agent frontmatter uses `mcp: true`, `mcp: false`, or `mcp.exclude` to control which MCP
   servers an agent can see.

For connector triggers that start agents from external events, add a trigger config resource after
the function app has started and created the `connector_extension` system key.

## Resource Model

Connector Namespace resources are not the same as legacy top-level Logic Apps/API Connections
resources. Do not look for Connector Namespace connections with `az resource list` filters such as
`type == 'Microsoft.Web/connections'`; they will not appear there.

Use this hierarchy instead:

```text
Microsoft.Web/connectorGateways
  connections
    accessPolicies
  mcpserverconfigs
  triggerconfigs
  managedApis/<connector>
```

When inspecting a deployed app, first list Connector Namespaces with `az resource list --resource-type
Microsoft.Web/connectorGateways`, then use `az rest` against the gateway child collection you need.
See [connector-mcp.md](./connector-mcp.md#inspect-existing-connector-namespaces) for safe commands
that inspect connections, MCP server configs, and trigger configs without printing endpoint or
callback URLs.

## Connection Authentication Schemes

Do not assume every connector uses one implicit authentication flow the way Office 365 Outlook
does in the quickstart. Some connectors expose multiple named authentication schemes
(`connectionParameterSets`), and the connection resource must select one explicitly or it silently
falls back to a default that may not work for the target organization or tenant.

Check before creating a new connection type:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
LOCATION="westcentralus"
CONNECTOR_NAME="visualstudioteamservices"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME?api-version=2016-06-01" \
  --query "properties.connectionParameterSets.values[].{name:name,displayName:uiDefinition.displayName}" \
  --output table
```

If this returns any rows, select one explicitly with `properties.parameterValueSet` on the
connection resource:

```bicep
resource connection 'Microsoft.Web/connectorGateways/connections@2026-05-01-preview' = {
  parent: connectorGateway
  name: connectionName
  properties: {
    connectorName: connectorName
    displayName: displayName
    parameterValueSet: {
      name: 'EntraOAuth'
      values: {}
    }
  }
}
```

Do not guess the parameter set name; read it from `connectionParameterSets.values[].name` for the
target connector and region, since names and defaults vary by connector. As one concrete example,
the `visualstudioteamservices` (Azure DevOps) connector exposes `EntraOAuth`, `OauthSP`, and
`CertOauth` in addition to its default legacy native OAuth identity provider. Signing in against
the wrong (default) scheme on a Microsoft Entra-backed organization typically fails with an opaque
`500` during the OAuth redirect rather than a clear permission error, and the connection stays
`Unauthenticated` no matter how many times the user retries sign-in. If a working connection
already exists elsewhere (created through the Azure portal or `connectors.azure.com`, for
example), reading its `properties.parameterValueSet` is the fastest way to confirm the correct
scheme name instead of guessing from the managed API metadata alone.

`parameterValueSet` only takes effect when the connection is created for this preview resource
type. Changing it on an already-created connection and redeploying does not update the live
resource. If a connection was created without it, or with the wrong scheme, delete the connection
and redeploy so Bicep recreates it correctly:

```bash
az rest --method delete \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/<resource-group>/providers/Microsoft.Web/connectorGateways/<gateway>/connections/<connection>?api-version=2026-05-01-preview"
```

`azd provision` compares the template against its own recorded deployment state, not live Azure
state, so it can report "no changes to provision" after a manual out-of-band delete like this. Use
`azd provision --no-state` (or `az deployment group create` directly against the resource group)
to force Bicep to reconcile against what is actually deployed.

See [troubleshooting.md](./troubleshooting.md#connection-never-reaches-connected--oauth-sign-in-fails-with-a-generic-500)
for the full diagnostic flow, including how this is easy to mis-diagnose as an organization policy
or service outage.

## Bicep Files

Use [../assets/infra/app/connector-gateway.bicep](../assets/infra/app/connector-gateway.bicep)
as the current example. It creates:

- `Microsoft.Web/connectorGateways@2026-05-01-preview`
- `Microsoft.Web/connectorGateways/connections@2026-05-01-preview`
- connection access policies for the app identity, deployer, and Connector Gateway identity
- `Microsoft.Web/connectorGateways/mcpserverconfigs@2026-05-01-preview`
- `trigger-config.bicep` can create `Microsoft.Web/connectorGateways/triggerconfigs@2026-05-01-preview`

Keep Connector Namespace child resource names simple and provider-safe. Connection names,
MCP server config names, and trigger config names should use short lowercase app names such as
`office365-outlook`, `teams-channel-post`, or `o365-outlook-send-email-only`. Avoid reserved or
product-owner words such as `microsoft` in resource names. Display names and descriptions can use
friendly product names like Microsoft Teams or Office 365 Outlook.

The asset's connection resource works as-is for Office 365 Outlook, which does not need an
explicit `parameterValueSet`. When adapting it to a different connector, check
[Connection Authentication Schemes](#connection-authentication-schemes) above first — do not
assume every connector behaves like Office 365 Outlook.

## Safety Boundary

The MCP server config is the primary safety boundary for connector tools. Expose only the actions
the app requires; do not publish a broad connector tool surface and rely on prompt instructions to
keep the agent away from unsafe actions. The quickstart exposes only Office 365 Outlook
`SendEmailV2`, which keeps the tool surface small. When adapting to another connector, change the
connector name, display metadata, operation allow-list, and operation schemas.

Be especially careful with connections authorized by a user signing in as themselves. Connector
tools can let an agent act on that user's behalf in email, Teams, files, CRM systems, and other
business apps. That is powerful, but unsafe if overexposed. For user-delegated connections:

- allow-list the smallest practical set of connector actions in the MCP server config,
- prefer read-only, draft, or review actions over send/delete/update actions when possible,
- require explicit confirmation in agent instructions before irreversible or user-visible actions,
- keep separate MCP server configs for different risk levels instead of mixing safe and risky
  actions in one broad server,
- make it clear which user account owns the downstream OAuth consent,
- never rely on prompt wording alone to prevent access to an action that should not be available.

## Common Next Steps

- Before creating a connection for a new connector, check whether it needs an explicit
  [`parameterValueSet`](#connection-authentication-schemes) — do not assume it behaves like
  Office 365 Outlook.
- Before deploying MCP server configs, validate operation IDs and parameter schemas with
  [connector-schemas.md](./connector-schemas.md).
- For Teams posts, parse Teams links and choose the correct Teams target shape with
  [connector-teams.md](./connector-teams.md).
- When adding connector MCP tools to an app, configure the server and authorization flow with
  [connector-mcp.md](./connector-mcp.md).
- Before relying on a user-visible connector action, run the side-effect checks in
  [connector-smoke-tests.md](./connector-smoke-tests.md).
- When adding connector-triggered agents, use [connector-triggers.md](./connector-triggers.md) for
  the preview bundle, `generic_trigger` shape, system key, callback URL, and trigger config flow.
