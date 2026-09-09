# Agent Files

Each `.agent.md` file defines one agent. YAML frontmatter configures runtime behavior. The
markdown body is the agent's instructions.

The file stem is important. `main.agent.md` uses route segment `main` and function name `main`.
`daily_report.agent.md` uses `daily_report`.

## Frontmatter Fields

| Field | Required | Notes |
| --- | --- | --- |
| `name` | Yes | Display name for logs and labels. |
| `description` | Yes | What the agent does and when it should run. |
| `trigger` | For event agents | One trigger per file. Not needed when only built-in endpoints are enabled. |
| `builtin_endpoints` | Optional | Enables debug chat UI, chat API, streaming API, and/or MCP endpoint. Add only when the user wants an interactive/API/MCP surface. |
| `model` | Optional | Per-agent model override. Prefer app defaults first. |
| `timeout` | Optional | Per-agent timeout in seconds. Runtime default is 900. Use 1800 for timer, connector-triggered, queue, and other background agents unless the task clearly needs more. |
| `mcp` | Optional | `false` disables MCP. `exclude` removes selected servers. |
| `skills` | Optional | `false` disables Agent Skills. `exclude` removes selected skills. |
| `tools` | Optional | `false` disables custom Python tools. `exclude` removes selected tools. |
| `system_tools` | Optional | Disable inherited system tools such as dynamic sessions per agent. |
| `input_schema` | Optional | JSON Schema for HTTP request validation. |
| `response_schema` | Optional | JSON Schema for structured HTTP responses. |
| `response_example` | Optional | Example response shape for HTTP agents. |
| `metadata` | Optional | App-specific metadata for your tooling. |
| `substitute_variables` | Optional | Defaults to `true`. |

## Built-In Endpoint Agent

Use built-in endpoints when the user asks for a chat bot, debug chat UI, chat API, streaming API,
or built-in MCP tool. Do not add them to scheduled-only or background-only agents just to smoke
test the function; use the admin endpoint and Application Insights for those runs.

```markdown
---
name: Chat Agent
description: A helpful agent with Python code execution capabilities.

builtin_endpoints:
  debug_chat_ui: true
  chat_api: true
  mcp: true

mcp: false
---

You are a helpful assistant running in Azure Functions.

Use Python code execution, including Playwright for browsing the web, when it helps answer
questions, inspect data, transform files, or retrieve current public information.
```

Use `builtin_endpoints: true` to enable all built-in endpoints, or the object form above for
clarity. Prefer the object form when only one surface is needed, such as `chat_api: true` without
`debug_chat_ui`.

## Timer Agent with MCP

```markdown
---
name: Daily Blog Summary
description: Fetches recent blog posts daily and emails a digest when email is configured.

trigger:
  type: timer_trigger
  args:
    schedule: "0 0 15 * * *"

mcp: true
timeout: 1800
---

Gather recent posts, summarize them, and send the digest if `$TO_EMAIL` is set and the Office
365 Outlook MCP email tool is available. If email is not configured, return the digest so it is
visible in logs.
```

For background agents, align the per-agent `timeout` with `host.json` `functionTimeout`. A
30-minute default is a good starting point for timer and connector-triggered agents that may call
models, use dynamic sessions, or invoke connector MCP tools. Keep simple built-in chat/API agents
at the default unless the app has a separate deferred workflow for long-running work.

## HTTP Agent with Structured Response

```markdown
---
name: Resource Summary
description: Returns a structured summary of Azure resources.

trigger:
  type: http_trigger
  args:
    route: resource-summary
    methods: ["POST"]
    auth_level: function

response_example: |
  {
    "total_resources": 42,
    "by_type": {
      "Microsoft.Web/sites": 5
    }
  }
---

Use the request body and available tools to return JSON matching the response example.
```

## Variable Substitution

The runtime substitutes `$VAR` and `%VAR%` in string values in agent frontmatter, agent body,
`agents.config.yaml`, and `mcp.json`. Substitution is single-pass and does not apply to object
keys. Fenced code blocks in agent instructions are not substituted.

Use `substitute_variables: false` on an agent if literal `$VALUE` text is needed in both
frontmatter and instructions.

## Capability Filters

Disable all MCP servers:

```yaml
mcp: false
```

Exclude one MCP server:

```yaml
mcp:
  exclude:
    - office365-outlook
```

Disable dynamic sessions for one agent:

```yaml
system_tools:
  dynamic_sessions_code_interpreter: false
```

Disable custom tools or skills similarly:

```yaml
tools: false
skills: false
```