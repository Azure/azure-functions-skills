# Workflow authoring contract

The runner executes commands and explicit stdio MCP calls, without an LLM.
Use `azure-functions-skills workflow --help` for CLI options.

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "build",
      "action": {"kind": "exec", "command": "npm", "args": ["run", "build"]}
    },
    {
      "id": "test",
      "dependsOn": ["build"],
      "action": {"kind": "exec", "command": "npm", "args": ["test"]}
    }
  ]
}
```

Node IDs are lowercase letter-led names containing letters, digits, or hyphens,
up to 64 characters. At most 50 nodes. Default concurrency is 1; set
`maxConcurrency` to 1-8 only for independent work. Explicitly order conflicting
file/resource mutations.

## Actions and data

Exec accepts `command`, `args`, optional workspace-relative `cwd`, and optional
`output: "json"` (default text). Supply arguments individually; no shell string
evaluation is performed. A script must name its interpreter explicitly.

MCP accepts `{"kind":"mcp","server":"configured-id","tool":"actual-name","arguments":{}}`.
Use `workflow tools --mcp-config <file> --server <id>` to discover actual names,
then `--tool <name>` for a schema. Discovery starts that server. Do not guess host
tool aliases. MCP output defaults to `structured`; select `json` explicitly for
JSON encoded in text, or `text` when no structure is needed.

Set `exports: {"name": "/json/pointer"}` on a node. In a dependent action,
`{"$ref":"node.name"}` supplies that value. The source must appear in `dependsOn`.
Exec arguments must resolve to strings; MCP arguments retain JSON types. Missing
fields and invalid JSON are errors.

Use top-level `outputs: {"result":{"$ref":"node.name"}}` to select small final
values. Intermediate exports and raw successful logs are not automatically
returned to the model.

An exec action's `stdinFrom: "node"` streams the source primary artifact: stdout
for exec, CallToolResult JSON for MCP. Use approved deterministic scripts to
consume large responses; the runner does not itself merge or write template files.

## Recovery and limits

A node can specify `timeoutMs` (default 300000), `replaySafe` (default false),
`retry: {"maxAttempts":2,"delayMs":1000,"on":["EXEC_EXIT_NONZERO"]}`, and
`fallback: {"on":["MCP_TOOL_ERROR"],"action":{...}}`.

Retries include the initial attempt and are capped at three. One fallback action
is allowed, without its own retry or another fallback. Both actions must produce
the same declared exports. Do not use a dummy successful value to hide failure.

Never automatically replay unknown outcomes. The CLI's exit code 1 includes both
failed and unknown; inspect the JSON status rather than treating exit 1 as
retryable. A new run does not undo external side effects.

Artifacts are capped at 16 MiB, run data at 128 MiB, summaries at 8 KiB, and
inspect responses at 16 KiB. Inspect uses byte offsets and chunks up to 2048 bytes.
Use the original artifact, not text chunks, for programmatic data processing.

State under `.azure-functions-workflows` can contain sensitive outputs. Exclude it
from git, restrict access, and do not publish it without sanitization. Only remove
completed runs that are no longer needed; the runner does not clean Azure resources.
