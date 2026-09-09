# Experimental workflow runner

Use `azure-functions-skills workflow` to batch **already-decided** commands and
explicit stdio MCP calls. The runner never calls an LLM. It is not a sandbox:
review the plan, fallbacks, and server configuration before executing them.
Existing skill routes and Azure Skills deployment approvals are unchanged.

```powershell
azure-functions-skills workflow validate --plan .\plan.json --dir .\app
azure-functions-skills workflow run --plan .\plan.json --dir .\app
azure-functions-skills workflow status --run <run-id> --dir .\app
azure-functions-skills workflow inspect --run <run-id> --node build --artifact stderr --dir .\app
```

## Plan

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

An exec action accepts an executable, argument array, workspace-relative `cwd`,
optional `output: "json"` (default text), and optional `stdinFrom` dependency.
No shell expression expansion is performed. Use a reviewed script and explicit
interpreter when necessary.

Use `exports: {"name": "/json/pointer"}` on a node to project its successful data.
An argument `{"$ref":"node.name"}` references that export without involving the
model. Declare the source in `dependsOn`. Exec arguments must resolve to strings;
MCP arguments preserve JSON types. Final `outputs` maps names to export references.
Intermediate outputs otherwise stay in local artifacts.

`stdinFrom` streams the source's primary artifact: exec stdout or MCP
CallToolResult JSON. It does not implicitly turn MCP responses into source files.
Use existing template tooling or a reviewed materialization helper.

## Explicit MCP configuration

```json
{
  "servers": {
    "azure": {
      "command": "npx",
      "args": ["-y", "@azure/mcp@<reviewed-version>", "server", "start"],
      "env": {}
    }
  }
}
```

Replace the version placeholder before use. `env` maps child variable names to
existing parent variable names, not literal credentials. No host configuration or
credentials are automatically imported.

```powershell
azure-functions-skills workflow tools --mcp-config .\workflow-mcp.json --server azure
azure-functions-skills workflow tools --mcp-config .\workflow-mcp.json --server azure --tool <actual-name>
azure-functions-skills workflow run --plan .\plan.json --dir .\app --mcp-config .\workflow-mcp.json
```

MCP actions use `kind: "mcp"`, `server`, `tool`, and JSON `arguments`.
`output` is `structured` by default; use `json` explicitly to parse text content,
or `text` for text. Missing structured output is an error, not an empty success.
Connections are run-scoped, calls to one server are serialized, and only stdio is
supported. Interactive sampling, elicitation, and host session reuse are absent.

## Recovery and reuse

Nodes default to no retry and `replaySafe: false`. Explicit retry accepts
`maxAttempts` (including the initial attempt), `delayMs`, and `on` error codes.
Known codes include `EXEC_START_ERROR`, `EXEC_EXIT_NONZERO`, `MCP_START_ERROR`,
`MCP_REQUEST_ERROR`, `MCP_TOOL_ERROR`, and `OUTPUT_INVALID`.

A fallback is `{"on":["MCP_TOOL_ERROR"],"action":{...}}`: one alternative action,
without another fallback or its own retries. Retrying a possibly executed action
requires a truthful read-only/idempotent `replaySafe` declaration.

Unrecovered failure stops new waves while active siblings finish. Timeout,
interruption, or lost response is **unknown**, never automatically replayed even
when declared replay-safe. Inspect the external state before replanning.

```powershell
azure-functions-skills workflow run --plan .\revised.json --dir .\app --from <old-run-id> --reuse prepare,build
```

Retain reused nodes unchanged in the revised plan. They and all their ancestors
must be successful, identical, in the same workspace/configuration, with intact
artifacts. Invalid reuse is rejected, never silently reexecuted. The new run owns
copies of imported artifacts and records provenance. Reuse also checks the
successful receipt and re-projects exports from the verified primary artifact;
editing exported values in state is not a valid way to change inputs.

Check that source files, credentials, tools, and external state remain valid:
definition equality does not check them for you. A live (including reused) owner
PID blocks import. If the OS confirms that the owner no longer exists, reads
classify unfinished operations as unknown without rewriting the old run.
Previously committed successes can still be explicitly reused; unfinished nodes
cannot. Unverifiable ownership blocks import. Never edit state to claim success.
There is no exactly-once guarantee.

## Limits, state, and reporting

At most 50 nodes and concurrency 1-8 (default 1). Default timeout is 300 seconds
per attempt, configurable up to one hour; at most three primary attempts and
60 seconds between attempts. Per-artifact limit is 16 MiB and run storage is
128 MiB. Output writes reserve 32 MiB of that budget for receipts and atomic state
updates. A command stopped for excessive output returns `unknown` with an
`ARTIFACT_LIMIT` receipt and inspectable partial logs, without retry. Unexpected
runner/storage errors also return the created run ID when available.
MCP stdio framing is bounded, but this is not a memory sandbox.

JSON summary is at most 8 KiB. Inspect returns bounded JSON pages, with raw
artifact chunks of at most 2048 bytes; use `--offset` and `--limit`.
`nextOffset` counts bytes, not characters. Avoid reconstructing arbitrary UTF-8
from displayed chunks; use the original artifact for programmatic consumption.

Exit codes: 0 successful operation, 1 execution failure/unknown, 2 invalid
run/validation input, 130 interruption. Inspect JSON status rather than treating
every exit 1 as retryable. Reading a failed run is a successful status operation.
`--format text` pretty-prints the same information.

State is local to `.azure-functions-workflows/runs/<id>`. Add this directory to
the target workspace's git exclusions. It may contain sensitive raw outputs;
keep permissions restricted and delete only completed runs you no longer need.
The runner does not automatically modify gitignore, clean up external resources,
or send raw workflow data through telemetry.

See [FRD-0001](frds/0001-workflow-runner.md) for the contract and
[FRD-0002](frds/0002-workflow-create-deploy-evaluation.md) for the separately gated
actual-agent effectiveness evaluation.
