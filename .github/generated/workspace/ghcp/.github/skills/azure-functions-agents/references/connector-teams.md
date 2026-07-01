# Microsoft Teams Connector

Use this reference only when the app needs Microsoft Teams connector actions or when debugging a
missing Teams side effect. Keep generic connector work in [connectors.md](./connectors.md),
[connector-mcp.md](./connector-mcp.md), [connector-schemas.md](./connector-schemas.md), and
[connector-smoke-tests.md](./connector-smoke-tests.md).

## Target Selection

Ask the user for a Teams link and parse the target for them. Do not ask users to manually find
Teams IDs.

| User intent or link | Connector target | Operation and path | Body shape |
| --- | --- | --- | --- |
| Personal note to the signed-in user, `48:notes` link | Notes to self | `PostMessageToSelf`, `POST /v1.0/chats/48:notes/messages` | `{ "body": { "contentType": "html", "content": "<p>...</p>" } }` |
| Existing group or 1:1 chat link with a `19:...@thread.v2` chat ID | Group chat | `PostMessageToConversation`, `POST /beta/teams/conversation/message/poster/Flow%20bot/location/Group%20chat` | `{ "recipient": "<chat-id>", "messageBody": "<p>...</p>" }` |
| Existing group or 1:1 chat link with a `19:...@unq.gbl.spaces` chat ID | Group chat | `PostMessageToConversation`, `POST /beta/teams/conversation/message/poster/Flow%20bot/location/Group%20chat` | `{ "recipient": "<chat-id>", "messageBody": "<p>...</p>" }` |
| One recipient by email or name | Chat with Flow bot | `PostMessageToConversation`, `POST /beta/teams/conversation/message/poster/Flow%20bot/location/Chat%20with%20Flow%20bot` | `{ "recipient": "<email-or-name>", "messageBody": "<p>...</p>" }` |
| Team/channel link | Channel | `PostMessageToConversation`, `POST /beta/teams/conversation/message/poster/Flow%20bot/location/Channel` | `{ "recipient": { "groupId": "<team-id>", "channelId": "<channel-id>" }, "messageBody": "<p>...</p>" }` |

For a single-user daily brief, prefer `Chat with Flow bot` unless the user specifically wants a
team/channel audience. Use a channel post only for shared updates, and confirm the authorizing
Teams connector user can access the team and channel. The Function App managed identity does not
grant Teams membership for user-delegated connector actions.

Do not document Teams posting as unreliable. The connector is sensitive to target type, schema,
and token audience. Validate the operation and run a focused smoke test before blaming the model
or the agent runtime.

## Operation Discovery

Validate Teams operation IDs with `apiOperations` before deploying an MCP server config:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
LOCATION="westcentralus"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/teams/apiOperations?api-version=2016-06-01" \
  --query "value[?properties.trigger == null].{name:name,summary:properties.summary,visibility:properties.visibility}" \
  --output table
```

Known posting operations:

- `PostMessageToConversation` posts to Flow bot DMs, group chats, and channels.
- `PostMessageToSelf` posts to the signed-in user's Notes chat, `48:notes`.
- Do not use deprecated channel operations such as `PostMessageToConversationV3` for Connector
  Namespace MCP unless `apiOperations` explicitly returns them for the connection and scenario.

Fetch the exported Swagger. Prefer the Connector Namespace export when it contains the path you
need:

```bash
RESOURCE_GROUP="<resource-group>"
CONNECTOR_GATEWAY="<connector-namespace-name>"
API_VERSION="2026-05-01-preview"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/managedApis/teams?api-version=$API_VERSION&export=true" \
  --output json > /tmp/teams-swagger.json
```

If `apiOperations` lists a Teams operation but the Connector Namespace export omits its path, check
the location-level export before assuming the operation is unavailable. In testing,
`managedApis/teams?export=true` under the gateway included `PostMessageToSelfRequest` but omitted
the `PostMessageToSelf` path, while the location-level export showed:

```text
/{connectionId}/v1.0/chats/48:notes/messages
```

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/teams?api-version=2022-09-01-preview&export=true" \
  --output json > /tmp/teams-location-swagger.json
```

## Dynamic Schemas

For `PostMessageToConversation`, the exported Swagger currently shows:

- Operation ID: `PostMessageToConversation`
- Path: `/{connectionId}/beta/teams/conversation/message/poster/{poster}/location/{location}`
- Required path parameters: `poster` and `location`
- Required dynamic body parameter: `body`, resolved from `GetUnifiedActionSchema`

Evaluate locations for `poster=Flow bot`:

```bash
CONNECTION_NAME="teams"

cat > /tmp/teams-message-locations.json <<'JSON'
{
  "request": {
    "method": "GET",
    "path": "/flowbot/messageType/ParentMessage/poster/Flow%20bot"
  }
}
JSON

az rest --method post \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections/$CONNECTION_NAME/dynamicInvoke?api-version=$API_VERSION" \
  --body @/tmp/teams-message-locations.json \
  --headers Content-Type=application/json \
  --query "response.body" \
  --output jsonc
```

For `poster=Flow bot`, message locations currently include `Channel`, `Group chat`, and
`Chat with Flow bot`.

Resolve the dynamic body schema for each target before writing MCP parameters:

```bash
RECIPIENT_TYPE="Group%20chat" # Channel, Group%20chat, or Chat%20with%20Flow%20bot

cat > /tmp/teams-message-schema.json <<JSON
{
  "request": {
    "method": "GET",
    "path": "/flowbot/actions/Message/posters/Flow%20bot/recipienttypes/${RECIPIENT_TYPE}/schema"
  }
}
JSON

az rest --method post \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections/$CONNECTION_NAME/dynamicInvoke?api-version=$API_VERSION" \
  --body @/tmp/teams-message-schema.json \
  --headers Content-Type=application/json \
  --query "response.body.schema" \
  --output jsonc
```

Observed dynamic body shapes:

- `Channel`: requires `messageBody` and `recipient` object with `groupId` and `channelId`.
- `Group chat`: requires `messageBody` and `recipient` string containing the chat ID.
- `Chat with Flow bot`: requires `messageBody` and `recipient` string containing a name or email.

## Teams Link Parsing

Channel links often look like this:

```text
https://teams.microsoft.com/l/channel/<encoded-channel-id>/<channel-name>?groupId=<team-id>&tenantId=<tenant-id>
```

Parsing guidance:

- `groupId` is the team ID.
- URL-decode the `/l/channel/<encoded-channel-id>/...` path segment to get the channel ID, often
  shaped like `19:...@thread.tacv2`.
- `tenantId` helps validate tenant context but is usually not the Teams target ID.

Notes links can look like this:

```text
https://teams.microsoft.com/l/chat/48:notes/conversations?context=...
```

Use `PostMessageToSelf` and `48:notes` for this target.

Group or 1:1 chat links can look like either of these:

```text
https://teams.microsoft.com/l/chat/19:49fc0a217754474cb887f684c0bc70ae@thread.v2/conversations?context=...
https://teams.microsoft.com/l/chat/19:...@unq.gbl.spaces/conversations?context=...
```

Use the decoded `/l/chat/<chat-id>/...` path segment as `recipient` with `location=Group chat`.
Confirm the parsed target in plain language before wiring it into app settings, MCP server config,
or agent instructions.

## MCP Server Config Patterns

For Connector Namespace MCP server configs, expose or pre-fill dynamic body properties at the
top-level body property path returned by the dynamic schema. Do not split nested object properties
into separate MCP parameters unless the deployed MCP server config proves that exact parameter path
is accepted.

For a fixed Teams channel target with `PostMessageToConversation`:

```text
poster = Flow bot
location = Channel
body/recipient = { groupId, channelId }
```

Expose only this agent-provided parameter:

```text
body/messageBody
```

Do not use `body/recipient/groupId` or `body/recipient/channelId` as MCP parameter names for
`PostMessageToConversation`; the operation can fail with:

```text
The API operation does not contain a definition for parameter 'body/recipient/groupId'.
```

Example operation inside `mcpserverconfigs`:

```bicep
operations: [
  {
    name: 'PostMessageToConversation'
    displayName: 'Post message to Teams channel'
    description: 'Posts a message to a specific Teams channel.'
    userParameters: [
      {
        name: 'poster'
        value: 'Flow bot'
      }
      {
        name: 'location'
        value: 'Channel'
      }
      {
        name: 'body/recipient'
        value: {
          groupId: teamsGroupId
          channelId: teamsChannelId
        }
      }
    ]
    agentParameters: [
      {
        name: 'body/messageBody'
        schema: {
          type: 'string'
          format: 'html'
          description: 'The HTML message body to post to the Teams channel'
        }
      }
    ]
  }
]
```

For a fixed group chat target, pre-fill:

```text
poster = Flow bot
location = Group chat
body/recipient = <chat-id>
```

Expose only `body/messageBody` for the agent.

For a fixed Flow bot DM target, pre-fill:

```text
poster = Flow bot
location = Chat with Flow bot
body/recipient = <recipient-email-or-name>
```

Expose only `body/messageBody` for the agent.

In the agent instructions for any fixed Teams target, tell the agent the Teams recipient, poster,
and location are pre-configured and that it should provide only the sanitized HTML message body,
usually the MCP tool argument derived from `body/messageBody`.

## Direct Runtime Smoke Tests

Use direct connection runtime calls only for focused troubleshooting or smoke tests. Do not put
direct runtime URLs or `service.flow` scopes in generated agent code, `mcp.json`, or agent
instructions. Agents should use Connector Namespace MCP servers with the MCP auth scope documented
in [connector-mcp.md](./connector-mcp.md).

Direct runtime calls require:

- the connector connection is `Connected`,
- the caller has a connection access policy under
  `connectorGateways/<gateway>/connections/<connection>/accessPolicies`,
- the token audience is `https://service.flow.microsoft.com/`, including the trailing slash.

Working token commands:

```bash
az account get-access-token --resource https://service.flow.microsoft.com/
```

or, using v2 scope syntax:

```bash
az account get-access-token --scope https://service.flow.microsoft.com//.default
```

The double slash before `.default` is intentional because the resource URI itself ends with `/`.
For direct connection runtime calls, do not use `https://apihub.azure.com/.default`; that audience
can reach token exchange and still fail with a misleading missing-ACL error. Keep
`https://apihub.azure.com/.default` for Connector Namespace MCP server auth.

Get the runtime URL for a troubleshooting call:

```bash
RUNTIME_URL=$(az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/connections/$CONNECTION_NAME?api-version=$API_VERSION" \
  --query properties.connectionRuntimeUrl \
  --output tsv)
```

Post to Notes to self:

```bash
TOKEN=$(az account get-access-token --scope https://service.flow.microsoft.com//.default --query accessToken -o tsv)

jq -n \
  --arg content '<p>Connector runtime PostMessageToSelf smoke test.</p>' \
  '{body:{contentType:"html",content:$content}}' > /tmp/teams-self-body.json

curl -sS -X POST \
  "$RUNTIME_URL/v1.0/chats/48:notes/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/teams-self-body.json
```

Post to a group chat by chat ID:

```bash
CHAT_ID="19:...@thread.v2"

jq -n \
  --arg recipient "$CHAT_ID" \
  --arg messageBody '<p>Connector runtime group chat smoke test.</p>' \
  '{recipient:$recipient,messageBody:$messageBody}' > /tmp/teams-group-chat-body.json

curl -sS -X POST \
  "$RUNTIME_URL/beta/teams/conversation/message/poster/Flow%20bot/location/Group%20chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @/tmp/teams-group-chat-body.json
```

A successful Teams direct runtime post returns HTTP `201` and a message ID. Still ask the user to
verify the message appeared in Teams before trusting the side effect.

## Troubleshooting Teams Posts

- `Bad authorization token. Audience:https://service.flow.microsoft.com is not found...` usually
  means the token audience is missing the trailing slash. Use `https://service.flow.microsoft.com/`
  or `https://service.flow.microsoft.com//.default`.
- `Permission denied due to missing connection ACL` with an `apihub.azure.com` token can be an
  audience issue, not a real missing ACL. For direct runtime calls, retry with the `service.flow`
  trailing-slash audience after confirming the access policy exists.
- `Resource not found` from `POST /v1.0/chats/<19:...>/messages` means the raw Graph-style chat
  path is not the right connector runtime path for normal group chat posting. Use
  `PostMessageToConversation` with `location=Group chat`.
- Target errors such as `Group ID does not exist` usually mean the authorizing Teams connector
  user cannot access the team/channel or the parsed target ID is wrong. Verify membership and
  the parsed link before changing model or agent behavior.