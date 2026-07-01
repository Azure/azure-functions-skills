# Built-In Endpoints and Sessions

Built-in endpoints are optional runtime surfaces for testing, programmatic chat, streaming chat,
and agent-to-agent MCP composition. They are not the same as the agent's event trigger.

Enable them based on the product scenario. If the user asks for a chat bot, debug UI, chat API,
streaming API, or built-in MCP tool, add the relevant endpoint fields. If the user asks only for a
scheduled, timer, connector-triggered, queue, or other background agent, omit `builtin_endpoints`
until the user asks to talk to it or expose it interactively. Test background agents with admin
invoke plus Application Insights instead.

## Enable Endpoints

```yaml
builtin_endpoints:
  debug_chat_ui: true
  chat_api: true
  mcp: true
```

`debug_chat_ui: true` automatically enables `chat_api: true`. `builtin_endpoints: true` enables
all three fields. Prefer the object form when only one surface is needed.

An agent may omit `trigger` when at least one built-in endpoint is enabled. An agent may also have
both a normal trigger and built-in endpoints when the user explicitly wants both background and
interactive access.

## Routes and Names

Routes use a sanitized slug derived from the `.agent.md` filename, not the display `name` field.
For example, `daily_report.agent.md` uses `daily_report`.

| Surface | Route or tool |
| --- | --- |
| Debug chat UI | `GET /agents/<slug>/` |
| Chat API | `POST /agents/<slug>/chat` |
| Streaming chat API | `POST /agents/<slug>/chatstream` |
| Built-in MCP tool | Tool named `<slug>` on `/runtime/webhooks/mcp` |

If two files sanitize to the same slug, the runtime suffixes later slugs, such as
`daily_report_2`.

## Chat API

In Azure, the debug chat UI and built-in chat APIs use the default function key. The chat UI
prompts for this key. Get it with:

```bash
az functionapp keys list \
  --resource-group <resource-group> \
  --name <function-app-name> \
  --query "functionKeys.default" \
  --output tsv
```

Pass it to API calls as `x-functions-key` or the `code` query string parameter. Local `func start`
does not require this key.

Request body:

```json
{
  "prompt": "Summarize the latest state"
}
```

Response body:

```json
{
  "session_id": "<session-id>",
  "response": "...",
  "tool_calls": []
}
```

The response also includes `x-ms-session-id` with the resolved session ID.

Use the returned session ID on later calls to continue the same conversation and reuse the same
dynamic session sandbox state:

```bash
curl -X POST "http://localhost:7071/agents/main/chat" \
  -H "Content-Type: application/json" \
  -H "x-ms-session-id: <session-id>" \
  -d '{"prompt":"continue"}'
```

Deployed example:

```bash
function_key=$(az functionapp keys list \
  --resource-group <resource-group> \
  --name <function-app-name> \
  --query "functionKeys.default" -o tsv)

curl -X POST "https://<function-app-name>.azurewebsites.net/agents/main/chat" \
  -H "Content-Type: application/json" \
  -H "x-functions-key: $function_key" \
  -d '{"prompt":"hello"}'
```

If `x-ms-session-id` is omitted, the runtime generates a new session ID.

## Streaming Chat API

The streaming endpoint accepts the same request body and `x-ms-session-id` header as the chat API:

```bash
curl -N -X POST "http://localhost:7071/agents/main/chatstream" \
  -H "Content-Type: application/json" \
  -H "x-ms-session-id: <session-id>" \
  -d '{"prompt":"show progress"}'
```

The response is Server-Sent Events with `data: {...}` lines. Event types include:

| Type | Meaning |
| --- | --- |
| `session` | First event; includes `session_id`. |
| `delta` | Incremental assistant text. |
| `message` | Full assistant message when emitted as a whole. |
| `intermediate` | Reasoning/intermediate text when the provider emits it. |
| `tool_start` | Tool call is starting. |
| `tool_end` | Tool call completed. |
| `done` | Stream completed normally. |
| `error` | Terminal error. |

Unlike the non-streaming chat API, the session ID is primarily delivered in the first `session`
SSE event.

## Built-In MCP Tool

When `builtin_endpoints.mcp: true`, the runtime registers an MCP tool named from the agent slug.
The tool description comes from the agent `description`.

Tool input:

```json
{
  "prompt": "Run the agent"
}
```

The MCP extension invokes the tool through the shared `/runtime/webhooks/mcp` endpoint. In Azure,
MCP clients need the `mcp_extension` system key unless the app is configured for anonymous access.

Get the key:

```bash
az functionapp keys list \
  --resource-group <resource-group> \
  --name <function-app-name> \
  --query "systemKeys.mcp_extension" \
  --output tsv
```

The built-in MCP tool can receive a top-level `sessionId` or `sessionid` in the MCP payload. The
runtime uses that value to resume history and bind dynamic session tools. If no session ID is
provided, the runtime generates a fresh session.

## Session Storage and Dynamic Sessions

Session history is keyed by session ID. In Azure, history uses the function app's storage account.
Locally, the runtime can fall back to local file-backed history when Azure storage is not
configured.

Dynamic session code execution is also session-aware. The runtime creates sandbox tools bound to
the same session ID used for the chat/API/MCP request. Reusing `x-ms-session-id` lets Python
variables, imports, and files persist across tool calls in the same conversation.

For non-HTTP event triggers, the runtime creates a fresh session ID for each invocation.

## MCP Extension Host Settings

The Azure Functions MCP extension can be configured in `host.json` with server metadata:

```json
{
  "version": "2.0",
  "extensions": {
    "mcp": {
      "instructions": "Tools exposed by this function app.",
      "serverName": "my-agent-app",
      "serverVersion": "1.0.0"
    }
  }
}
```

This metadata is optional for most scaffolded apps, but useful when the app is intended to be
consumed as a remote MCP server.