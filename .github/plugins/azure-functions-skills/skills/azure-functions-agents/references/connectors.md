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
