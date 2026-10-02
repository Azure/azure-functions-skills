# Connector Deployment Gates

Use this table to record connector readiness for an Azure Functions Hosted Skill.

| Gate | Required evidence | Failure owner |
| --- | --- | --- |
| Connection | `Connected` status and expected authorization purpose | `azure-functions-connector-create` |
| Identity | Function App managed identity access policy | `azure-functions-connector-create` |
| MCP configuration | Enabled config, correct connection, endpoint present | `azure-functions-connector-mcp` |
| Runtime settings | MCP endpoint and identity settings resolve in the deployed Function App | `azure-functions-connector-mcp` |
| Tool surface | Exact expected tools and no unintended writes | `azure-functions-connector-mcp` |
| Schema | Required fields, nested objects, formats, enums, and descriptions match | `azure-functions-connector-mcp` |
| Read behavior | Harmless operation returns the expected business result | Connector create or MCP, based on failure |
| Write behavior | Approved side effect is visible and cleanup is complete | Connector create or MCP, based on failure |
| Hosted Skill | Intended tool is selected once and the result is handled correctly | `azure-functions-hosted-skills` |

Connector trigger configs remain owned by `azure-functions-hosted-skills` because they define how
an external event invokes an agent, including the second deployment after the
`connector_extension` system key exists. When the scenario uses a connector trigger, add a
scenario-specific gate for the enabled trigger config, redacted callback presence, one delivered
event, and one Hosted Skill invocation.

## Evidence record

For each gate, record:

```text
Gate:
Status: pass | fail | not verified
Environment:
Identity used:
Command or invocation:
Expected result:
Observed result:
Redacted evidence:
Failure owner:
Required follow-up:
```

Do not store bearer tokens, function keys, MCP endpoint URLs, connection runtime URLs, callback
URLs, message contents containing customer data, or full connector responses containing personal
information.

For gates that can run under the developer identity, record that identity explicitly. Do not claim
that a local `initialize`, `tools/list`, or `tools/call` proves the Function App managed identity
path. That path requires both a matching connection access policy and a successful invocation from
the deployed Hosted Skill.

## Failure routing

- `Unauthenticated`, wrong authorization owner, wrong parameter set, or missing access policy:
  return to connector creation.
- Missing tool, unexpected operation, malformed nested input, or schema mismatch: return to MCP
  publication.
- Tool call succeeds but the Hosted Skill chooses the wrong tool, retries a write, or mishandles the
  result: return to Hosted Skill authoring.
- Transport succeeds but no downstream result appears: inspect the connector tool result once.
  Do not rerun the full Hosted Skill until the connector path is understood.

## Release decision

Use one of these outcomes:

- **Ready:** every required gate passed.
- **Conditionally ready:** optional gates are not verified, with explicit runtime restrictions.
- **Blocked:** one or more required gates failed or could not be verified.

Never convert `not verified` into `pass` because infrastructure deployment or MCP transport
succeeded.
