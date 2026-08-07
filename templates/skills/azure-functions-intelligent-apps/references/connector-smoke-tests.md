# Connector Smoke Tests

Use these checks before trusting an agent to perform a user-visible connector action. A Function
run can succeed while the downstream side effect, such as a Teams message or Outlook draft, did
not happen.

## General Flow

1. Confirm the connection is `Connected` in the Connector Namespace portal or with the safe
   connection status commands in [connector-mcp.md](./connector-mcp.md).
2. Inspect the deployed MCP server config. Verify the operation ID, `userParameters`, and
   `agentParameters` match the connector schema in [connector-schemas.md](./connector-schemas.md).
3. Trigger the smallest possible action once.
4. Ask the user to verify the side effect in the downstream app: Teams, Outlook, SharePoint, etc.
5. If the side effect is missing, do not rerun the full agent loop. Inspect the agent session/tool
   result and test the connector call path with the same recorded arguments where practical.
6. Treat green Function execution or MCP transport logs as unverified until the downstream side
   effect is confirmed.

## Microsoft Teams Posts

Use [connector-teams.md](./connector-teams.md) for Teams-specific target choice, link parsing,
body shapes, and direct runtime troubleshooting calls. Do not load those details for apps that do
not use Teams.

Before trusting a Teams posting agent:

- Confirm the Teams connection is authorized by a user that can access the target chat, user, team,
  or channel. For Teams and other user-delegated connectors, the authorizing user's membership and
  permissions determine reachability, not the Function App managed identity.
- Validate `PostMessageToConversation` or `PostMessageToSelf` against `apiOperations`.
- Resolve dynamic schemas for the selected target type instead of guessing parameter names.
- Run one small side-effect smoke test and ask the user to confirm the message appeared.

Direct connection runtime calls with the `service.flow` token audience are for troubleshooting
only. Do not copy direct runtime scopes or URLs into generated agent code, `mcp.json`, or agent
instructions.

## Outlook Send Or Draft

For Outlook actions:

- Prefer draft/review operations over send operations unless the user explicitly wants automatic
  sending.
- Confirm the connection is authorized by the mailbox user that should own the action.
- Smoke test with a harmless subject/body and a known recipient before using the tool in a long
  agent workflow.
- If email delivery is optional, instruct the agent to return the generated message in its final
  response when the connector tool or recipient is unavailable.

## Reading Telemetry

MCP servers perform initialization, `tools/list`, and `tools/call` over the same MCP endpoint. Do
not treat a bare HTTP `200 OK` to `/mcp` as proof that the business action succeeded.

Look for evidence of the actual tool call, such as:

```text
Function name: teams_PostMessageToConversation
Function name: office365_SendEmailV2
Function name: office365_GetEmailsV3
```

Then inspect the tool result or session history for connector errors. Transport success means the
MCP protocol request was handled; it does not guarantee Teams, Outlook, or another downstream
system produced the intended side effect.
