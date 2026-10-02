---
name: azure-functions-connector-validate
description: "Validate a Connector Namespace connection and MCP tool contract before an Azure Functions Hosted Skill uses it. Use for connection and identity gates, MCP initialize and tools/list checks, schema comparison, safe read/write smoke tests, downstream side-effect verification, and Hosted Skill tool-selection testing."
---


# Validate Connectors for Azure Functions Hosted Skills

Treat connector readiness as a release gate. Validate the deployed connection, identity boundary,
MCP contract, connector behavior, and Hosted Skill integration before enabling scheduled,
event-driven, or autonomous use.

## Ownership

This skill owns validation and evidence. It may create bounded test artifacts only when the user
approves the side effect and cleanup. It does not broaden the operation set, change authentication,
or silently repair infrastructure. Route those failures to:

- `azure-functions-connector-create` for connection, identity, or authorization problems,
- `azure-functions-connector-mcp` for missing tools or schema-contract problems,
- `azure-functions-hosted-skills` for agent instructions, trigger behavior, or result handling.

## Required inputs

Obtain:

- connection and MCP server config resource identifiers,
- expected downstream authorization owner/purpose,
- expected tools and schema assertions,
- explicitly excluded operations,
- safe read-only test inputs,
- approved controlled-write test, verification method, and cleanup,
- Hosted Skill definition that should consume the tools.

Do not invent a write target or recipient. If a safe write test is unavailable, report the gate as
not verified rather than substituting a production side effect.

## Validation sequence

Run gates in order and stop dependent tests after a failure:

1. **Connection status.** Verify the intended connection is `Connected` and belongs to the expected
   downstream account or purpose.
2. **Identity access.** Verify the deployed Function App managed identity has an explicit connection
   access policy. Developer access does not prove managed-identity access.
3. **Configuration state.** Verify the intended MCP server config is enabled, references the correct
   connection, has an endpoint, and exposes no unexpected operations.
4. **Runtime configuration.** Verify the deployed endpoint app setting and optional managed
   identity client ID resolve to real values. An unresolved MCP URL causes the runtime to skip the
   server.
5. **Protocol initialization.** Run MCP `initialize`. A local test normally proves the approved
   developer identity path; the managed-identity path is proven by the access-policy gate and the
   Hosted Skill smoke test.
6. **Tool discovery.** Run `tools/list`. Map every expected operation ID to its exact deployed tool
   name and reject unintended write or high-risk tools.
7. **Schema contract.** Compare required fields, nested objects, arrays, formats, enums, and
   descriptions with the publication handoff and authoritative connector metadata.
8. **Read-only smoke test.** Call the least risky representative operation and verify its business
   result, not merely HTTP or MCP transport success.
9. **Controlled write test.** When approved, create one bounded side effect. Verify it in the
   downstream system and remove or reverse it when cleanup is supported.
10. **Hosted Skill smoke test.** Invoke the actual Hosted Skill through its intended trigger or
   endpoint. Confirm it selects the intended MCP server/tool, supplies valid arguments, handles the
   result, and respects confirmation or fallback behavior.
11. **Record the decision.** Report each gate as pass, fail, or not verified with evidence and
    blockers. Do not enable automation when a required gate failed.

Load [deployment-gates.md](./references/deployment-gates.md) for the evidence table, failure routing,
and release decision.

## Safety rules

- A bare HTTP `200` from an MCP endpoint is not connector success.
- Successful Function execution is not proof of a downstream side effect.
- Never repeat a user-visible write because telemetry is delayed or ambiguous.
- Use synthetic or clearly labeled test content.
- Avoid production recipients, channels, calendars, files, and records unless the user explicitly
  approves them.
- Do not print tokens, function keys, MCP endpoint URLs, connection runtime URLs, or connector
  callback URLs.
- Keep sensitive telemetry content disabled unless the user explicitly approves the data exposure.
- Do not emit the internal `azure_deployment_observed` event. Its supported owners remain
  `azure-functions-deploy` and `azure-functions-hosted-skills`.

## Definition of done

Validation is complete only when every required gate has an explicit status and evidence. The
connector is ready for Hosted Skill automation only when:

- the connection and managed identity gates pass,
- `initialize` and `tools/list` pass,
- the deployed tool set and schemas match the approved contract,
- required read and controlled-write tests pass,
- the downstream result is verified,
- the Hosted Skill selects and handles the intended tool correctly,
- no unintended operation is exposed.