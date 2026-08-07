# Agent Authoring Guidance

The runtime can wire up triggers and tools, but agent quality still depends heavily on the
instructions in `.agent.md` files.

## General Pattern

Write instructions that include:

- what event or request the agent handles,
- how to interpret the trigger/request payload,
- which tools to use and when,
- what to do when a tool, connector, or source is unavailable,
- what safety boundary applies, such as drafting but not sending email,
- what final response or log-visible output should contain.

Prefer numbered procedures for workflows that must happen reliably.

## Trigger Payloads

Non-HTTP triggers receive serialized trigger data in the prompt. Connector trigger payloads may be
batch-shaped even when the connector event feels singular. Tell the agent to inspect every item in
the payload and handle empty or unexpected shapes.

Example:

```markdown
When triggered, inspect every item in the trigger payload. If the payload contains a `body.value`
array, process each item. If the expected fields are missing, log a concise explanation and stop.
```

## Connector Actions

For email, Teams, and business-system tools, be explicit about allowed actions:

```markdown
Create a draft reply only. Never send an email. If you are unsure which message to reply to,
return a short explanation and do not call the draft tool.
```

When a connector tool is optional, include a fallback:

```markdown
If `$TO_EMAIL` is empty, the email tool is unavailable, or sending fails, return the digest in the
final response so it appears in logs.
```

## Single-Action Delivery Agents

Digest, briefing, notification, and posting agents should stop after the delivery action succeeds.
Broad tool surfaces can tempt an agent to keep browsing, listing tools, or making more model calls
after the goal is complete, which burns tokens and can trigger rate limits.

Use instructions like:

```markdown
After you successfully call the delivery tool exactly once, stop. Do not continue browsing,
summarizing, listing tools, or making additional connector calls. Return a concise final status.
```

If the delivery tool fails, return the prepared content and the error so it appears in logs.

## Web and Code Execution

If the task needs current public information, page inspection, calculations, parsing, or file
transforms, instruct the agent to use dynamic sessions:

```markdown
Use Python code execution, including Playwright for browser automation, when you need current
public information, need to inspect a page, transform data, parse files, or calculate results.
```

Do not write custom web-fetch tools for generic browsing/fetching needs.

## HTTP JSON Responses

For HTTP agents with `response_example` or `response_schema`, tell the agent to return only JSON:

```markdown
Return only a JSON object matching the response example. Do not wrap it in markdown or add prose.
If the request lacks required data, return a JSON object with an `error` field.
```

Use `input_schema` for deterministic request validation when practical.

## Tool Failure and Partial Results

Useful fallback language:

```markdown
If one source or tool fails, continue with the best available data. Include a brief note about
what failed and what you used instead. Do not invent missing facts.
```

## Skills vs Tools vs Dynamic Sessions

- Use Agent Skills for reusable instructions and domain knowledge.
- Use custom Python tools for deterministic app-specific APIs.
- Use MCP servers for remote tools and connector actions.
- Use dynamic sessions for code execution, web browsing, analysis, and file transforms.

Keep base agent instructions focused. Move reusable domain procedures into `src/skills/<name>/SKILL.md`.