---
name: azure-functions-connector-mcp
description: "Generate, register, and wire a Connector Namespace MCP server for an Azure Functions Hosted Skill using authoritative connector metadata. Use when selecting connector operations, preserving operation schemas and dynamic parameters, creating mcpserverconfigs, retrieving the generated MCP endpoint, or configuring mcp.json. Requires an existing authorized connector connection."
---


# Publish Connector MCP Tools for Azure Functions Hosted Skills

Publish a least-privilege MCP tool contract from an existing Connector Namespace connection.
Generate operation definitions from authoritative connector metadata rather than manually copying
or simplifying request schemas.

## Ownership

This skill owns:

- operation discovery and selection,
- authoritative input-schema retrieval,
- dynamic value and dynamic-schema resolution,
- generation and registration of the complete MCP server configuration,
- generated endpoint retrieval,
- Hosted Skill app-setting and `mcp.json` wiring,
- a handoff contract for release-gate validation.

It does not own connection creation or delegated consent; use
`azure-functions-connector-create`. It does not approve the connector for production use; use
`azure-functions-connector-validate`. Hosted Skill instructions and business behavior remain with
`azure-functions-hosted-skills`.

## Preconditions

Require:

- an existing Connector Namespace connection,
- connection status `Connected`,
- an explicit access policy for the Function App identity,
- exact intended connector operation IDs or an approved capability description,
- approval for any write or irreversible operation under consideration.

If these are missing, stop and hand off to `azure-functions-connector-create`.

## Workflow

1. **Inspect current state.** Read the application's `infra/`, app settings, `src/mcp.json`, agent
   definitions, and deployed MCP server configs. Identify all consumers before replacing a shared
   configuration.
2. **Select the minimum operations.** Query the connector operation catalog. Exclude triggers,
   notifications, unrelated writes, deprecated variants, and operations outside the approved
   capability.
3. **Retrieve authoritative contracts.** Start with `apiOperations`, then use an operation's
   `inputsDefinition` only when the supported operation-details response returns it. Use exported
   connector Swagger/OpenAPI and `dynamicInvoke` for references, dynamic values, or
   context-dependent schemas.
4. **Generate parameter schemas.** Preserve nested objects, arrays, required fields, formats, enums,
   descriptions, defaults, and dynamic constraints. Do not flatten nested bodies or invent version
   suffixes.
5. **Separate fixed and agent-provided inputs.** Put environment- or deployment-owned values in
   `userParameters`; expose only values the Hosted Skill should decide in `agentParameters`.
   Opaque values belong in `azd` environment values or app settings, not source control.
6. **Review the safety surface.** Show the selected operations and which inputs remain under model
   control. Require user approval for unexpected writes, broad search/export operations, or
   permission expansion.
7. **Register the complete configuration.** Use a repository-owned bootstrap/post-provision step
   and the supported Connector Namespace API. Replace the full operations configuration when it
   changes; do not rely on partial patches of nested operation schemas. Keep Bicep responsible for
   stable infrastructure and outputs, not generated connector operation schemas.
8. **Retrieve the generated endpoint.** Read `mcpEndpointUrl` from the registered configuration,
   persist it as an environment-scoped deployment value, and reconcile the Function App setting
   through the deployment source of truth. Redact the value from logs and reports.
9. **Wire the Hosted Skill.** Add a remote HTTP entry to `src/mcp.json` using
   `https://apihub.azure.com/.default` and the intended managed identity. Use a stable, descriptive
   server name. Restrict individual Hosted Skills through agent frontmatter when needed.
10. **Produce a validation handoff.** Record expected operation IDs, the exact deployed tool names
    observed from `tools/list`, full expected schemas or stable schema assertions, allowed side
    effects, and safe test inputs for
    `azure-functions-connector-validate`.

Load [metadata-to-mcp.md](./references/metadata-to-mcp.md) for source precedence, schema-preservation
rules, intent manifests, and the publication handoff.

## Safety rules

- The MCP server config is the primary operation-level safety boundary.
- Never expose a whole connector when the Hosted Skill needs only a few operations.
- Never rely on agent instructions to hide an operation that should not be callable.
- Do not copy direct connection-runtime URLs or troubleshooting token audiences into `mcp.json`.
- Do not commit endpoint values tied to an environment when an app setting can hold them.
- Do not register a schema assembled from operation names alone.
- Do not enable a configuration until the validation skill confirms its deployed contract.
- Do not emit the internal `azure_deployment_observed` event. Its supported owners remain
  `azure-functions-deploy` and `azure-functions-hosted-skills`.

## Definition of done

MCP publication is complete only when:

- every operation ID exists in current connector metadata,
- every operation schema was derived from authoritative metadata,
- nested and dynamic input contracts are preserved,
- fixed and agent-controlled parameters are deliberately separated,
- the complete MCP configuration is registered,
- the generated endpoint is wired through app settings into `mcp.json`,
- the validation handoff defines the exact expected tool surface and safe smoke tests.