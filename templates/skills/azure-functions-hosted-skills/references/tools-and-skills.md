# Custom Tools and Agent Skills

Agents inherit discovered custom Python tools and Agent Skills by default. Use them for
app-specific behavior and reusable domain knowledge.

Use dynamic sessions, not custom tools, for generic web browsing, page fetching, browser
automation, code execution, data analysis, and file transformation.

## Custom Python Tools

Put tools in `src/tools/`. Use one tool per file for predictable discovery.

Preferred decorator style:

```python
from azure_functions_agents import tool


@tool(name="submit_ticket", description="Create a support ticket with a title and summary.")
async def submit_ticket(title: str, summary: str) -> str:
    return f"Created ticket for {title}: {summary}"
```

With Pydantic schema:

```python
from pydantic import BaseModel, Field
from azure_functions_agents import tool


class LookupCustomerParams(BaseModel):
    customer_id: str = Field(description="Customer identifier from the CRM system.")


@tool(schema=LookupCustomerParams, description="Look up customer details by customer ID.")
async def lookup_customer(params: LookupCustomerParams) -> str:
    return f"Customer details for {params.customer_id}"
```

Plain functions are supported, but the decorator makes the tool name and description explicit.
Add package dependencies to `requirements.txt`.

## Converting Stdio MCP Servers to Python Tools

The Azure Functions agents runtime supports remote HTTP MCP servers in `mcp.json`, not local
stdio MCP servers. Do not scaffold `mcp.json` entries with `command`, `args`, `uvx`, `npx`, or a
long-running local MCP process. The Azure Functions runtime environment may not have those
executables or package-manager caches, and serverless app startup is the wrong place to install
and supervise a child MCP server.

When a user provides a stdio MCP server config, first identify which MCP tools the agent actually
needs. Then implement those actions as normal Python custom tools:

1. Create one focused file per tool or small tool family under `src/tools/`.
2. Use `@tool` with a clear name and description. Use a Pydantic schema when inputs are nested,
   optional, or need field descriptions.
3. Call the underlying service directly with a Python SDK, HTTP API, database client, or
   deterministic Python code. Do not call the MCP server executable from the tool.
4. Read configuration from environment variables or app settings. Do not hard-code secrets.
5. Add Python dependencies to `requirements.txt`, and add RBAC or app settings in Bicep when the
   tool needs cloud resources.
6. Return simple JSON-serializable values such as strings, dicts, or lists. Do not return MCP
   protocol envelopes.

If the stdio MCP server is the only implementation available and cannot reasonably be rewritten in
Python, tell the user they must provide a securely hosted remote HTTP MCP endpoint before this
runtime can use it. Do not scaffold or explain how to host and secure that MCP server as part of
this skill.

Example replacement for a stdio MCP tool that calls a REST API:

```python
import os

import httpx
from pydantic import BaseModel, Field
from azure_functions_agents import tool


class LookupIssueParams(BaseModel):
    issue_id: str = Field(description="Issue identifier from the tracker.")


@tool(schema=LookupIssueParams, description="Look up an issue by ID in the tracker.")
async def lookup_issue(params: LookupIssueParams) -> dict:
    base_url = os.environ["ISSUE_TRACKER_URL"].rstrip("/")
    token = os.environ["ISSUE_TRACKER_API_KEY"]
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            f"{base_url}/issues/{params.issue_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        response.raise_for_status()
        return response.json()
```

If using this example shape, add `httpx` to `requirements.txt` unless the app already depends on
it.

## Azure REST Tool Pattern

Write custom Azure tools only when the agent needs deterministic app-specific Azure operations
that are not better handled by MCP, dynamic sessions, or normal Functions bindings. The function
app should use managed identity, and the infrastructure must grant the right RBAC roles to that
identity for whatever the tool calls.

For Azure resource inspection, a custom `azure_rest` tool is appropriate because it uses managed
identity and ARM permissions. It should:

- use `DefaultAzureCredential`,
- request the `https://management.azure.com/.default` scope,
- require callers to include `api-version`,
- support optional JMESPath filtering to reduce response size,
- rely on RBAC such as subscription Reader for access.

For local development, the signed-in user must also have access to the target Azure resources.
When a generated app depends on a custom Azure tool locally, assign the same minimum practical
role to the deployer user in Bicep. Keep RBAC scoped as narrowly as the app allows; for example,
use subscription Reader only for a subscription-wide reporting tool.

## Tool Filters

Disable tools for one agent:

```yaml
tools: false
```

Exclude selected tools:

```yaml
tools:
  exclude:
    - submit_ticket
```

## Agent Skills

Put skills under `src/skills/<skill-name>/SKILL.md`.

Rules:

- Every skill folder must contain `SKILL.md`.
- `name` and `description` are required.
- Names use lowercase letters, numbers, and single hyphens.
- Names must be unique in the app.
- Descriptions should say what the skill does and when to use it.
- Skills can include additional markdown files referenced by relative links.
- Only markdown content is supported as skill content; executable behavior belongs in custom
  tools.

Example:

```markdown
---
name: azure-resources
description: Query and manage Azure resources using the ARM REST API via the azure_rest custom tool. Use when listing, filtering, or inspecting Azure resources.
---

# Azure Resources

Use the azure_rest tool for ARM calls. Include api-version in every path.
```

Skill filters:

```yaml
skills: false
```

```yaml
skills:
  exclude:
    - azure-resources
```