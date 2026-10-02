---
name: azure-functions-connector-create
title: Create a Connector for Azure Functions Hosted Skills
description: "Create and authorize a Connector Namespace connection for an Azure Functions Hosted Skill. Use when the user needs to add Outlook, Teams, SharePoint, Azure DevOps, or another managed connector; determine connector authentication requirements; provision connection access policies; or prepare an authorized connection for MCP configuration. Do not use for MCP schema generation alone or ordinary Hosted Skill authoring."
category: task
---

# Create a Connector for Azure Functions Hosted Skills

Create the Connector Namespace, connection, and identity boundary that a Hosted Skill needs before
an MCP server config can expose connector operations. Treat connection creation as privileged
control-plane work. A Hosted Skill must not create connections or complete consent during an
ordinary runtime invocation.

## Ownership

This skill owns:

- connector catalog and authentication discovery,
- Connector Namespace and connection planning,
- connection creation parameters,
- access policies for the Function App identity and approved deployment principals,
- the interactive authorization handoff,
- verification that the intended account is connected.

It does not own:

- generating or registering connector MCP operation schemas; use
  `azure-functions-connector-mcp`,
- validating the complete deployed MCP contract and side effects; use
  `azure-functions-connector-validate`,
- writing the Hosted Skill's instructions, triggers, or business behavior; use
  `azure-functions-hosted-skills`,
- general Azure deployment execution when Azure Skills should own it.

## Required inputs

Establish these facts before creating resources:

- Hosted Skill goal and the external system it needs.
- Required reads, writes, triggers, and user-visible side effects.
- Azure subscription, resource group, Connector Namespace name, and supported region.
- Function App managed identity principal ID and tenant ID.
- Account or service identity that should own downstream authorization.
- Whether the user wants a new connection or to reuse an existing authorized connection.

Ask only for unresolved decisions. Never request secrets in chat. For Teams targets, ask for a
Teams link rather than raw team, channel, or chat IDs.

## Workflow

1. **Inspect the application.** Read `azure.yaml`, `infra/`, `src/mcp.json`, agent definitions, and
   existing `Microsoft.Web/connectorGateways` resources. Preserve existing naming and infrastructure
   patterns.
2. **Translate intent into capabilities.** Identify the minimum connector operations and side
   effects needed. Prefer read, draft, or review capabilities over send, delete, or update when
   those satisfy the goal.
3. **Discover the connector contract.** Read the managed API metadata for the target connector and
   region. Inspect both `connectionParameters` and `connectionParameterSets`; do not assume the
   Office 365 OAuth pattern applies to another connector.
4. **Choose authentication explicitly.** Select a named parameter set only after verifying its
   required values. Distinguish delegated OAuth, service-principal, certificate, and value-based
   authentication. Source secrets from an approved secret store.
5. **Plan the identity boundary.** Grant connection access only to the Function App identity,
   approved deployment/local-development principals, and provider identities that the Connector
   Namespace contract requires.
6. **Create stable infrastructure.** Prefer Bicep and `azd` for the Connector Namespace, connection,
   identities, access policies, non-secret settings, and outputs. Do not hand-author an MCP
   operation schema in this phase.
7. **Complete authorization explicitly.** Open the Connector Namespace experience at
   `connectors.azure.com` for delegated consent. Explain which downstream account will own the
   connection and what capabilities it grants. OAuth consent remains a human action.
8. **Verify the connection.** Require `properties.overallStatus == Connected` for the intended
   account and verify the Function App identity has an explicit access policy.
9. **Hand off to MCP publication.** Pass the exact connector name, connection resource ID/name,
   selected operations, authentication result, and safety decisions to
   `azure-functions-connector-mcp`.

Load [connection-lifecycle.md](./references/connection-lifecycle.md) for discovery rules,
authentication cases, recreation behavior, and the handoff record.

## Safety rules

- Use least privilege at both the connection-access and operation levels.
- Do not infer authentication schemes or required values from connector display names.
- Do not print connection runtime URLs, tokens, consent artifacts, callback URLs, or secrets.
- Do not automate delegated OAuth sign-in.
- Do not treat a successfully created resource as an authorized connection.
- Do not silently reuse a connection authorized as the wrong downstream user.
- If a connector's required value-based connection shape is not verified, report it as unsupported
  rather than guessing.
- Do not emit the internal `azure_deployment_observed` event. Its supported owners remain
  `azure-functions-deploy` and `azure-functions-hosted-skills`.

## Definition of done

The connection phase is complete only when:

- the selected connector and authentication scheme are recorded,
- the connection exists in the intended Connector Namespace and region,
- required access policies include the Hosted Skill's Function App identity,
- delegated consent or credential configuration is complete,
- connection status is `Connected`,
- no MCP operation schema was manually simplified during connection creation,
- the MCP publication handoff contains the exact selected operation IDs and safety constraints.
