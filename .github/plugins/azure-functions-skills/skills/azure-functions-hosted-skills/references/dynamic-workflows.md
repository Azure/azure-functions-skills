# Dynamic Workflows

Dynamic Workflows are a Preview feature of the Azure Functions agents runtime. The application
provides safe executable capabilities; the agent authors a DAG at runtime, and Durable Functions
executes it. Do not build a second orchestrator, invent a YAML workflow DSL, or confuse this feature
with a coding agent's own workflow/automation tools.

## Choose and Confirm

Recommend this model for parallel tool calls, several dependent steps, bounded data processing,
durable waits, restart recovery, or independently observable background execution. Short one-turn
requests and operations requiring an immediate final HTTP answer usually do not justify it.

Explain the feature and confirm adoption first. Then separately offer DTS, recommended for lower
orchestration latency and a dashboard with activity inputs/outputs, timelines, and execution history.
Mention additional resources, regional availability, and cost. Do not promise measured speedups.
If DTS is declined, use Azure Storage. Respect a choice already explicitly made.
Neither answer approves Azure provisioning, paid experiments, or external side effects.

Dynamic Workflows and ACA Dynamic Sessions are independent. Workflows do not need a session pool.
Use sessions only for approved browsing/code workloads under the existing Hosted Skills policy.
Preserve approved Connector/MCP/Python choices and migration exclusions: Durable execution does not
make an otherwise excluded operation supported.

## Enable the Selected Agent

Add to the selected `.agent.md`, preserving its trigger, model, endpoints and other filters:

```yaml
workflows:
  enabled: true
  exclude:
    - destructive_operation
  subagents:
    - agent: evidence_analyst
      when: Analyze one bounded set of evidence
```

`exclude` and `subagents` are optional. Enable only the intended owner agents; do not enable all
agents through shared defaults. Any directly invoked agent can own workflows, not just `main`.
One app-wide Durable engine serves immutable per-agent tool policies. Specialists are
deny-by-default: `workflows.subagents` grants only the named agents. Its `when` text is selection
guidance, not a runtime condition or a security boundary.

Keep `function_app.py` using `app = create_function_app()`. The runtime selects the Durable App and
registers orchestrator and Activity functions when an owner enables workflows. `tools: false` does
not disable workflow tools; use `workflows.exclude` to restrict them.
Use a published runtime supporting these APIs with Python 3.13+ and the `[monitor]` extra when
Application Insights is configured. The reviewed baseline is `azurefunctions-agents-runtime`
`0.1.0b17`; verify the installed package and its transitive Durable SDK rather than copying a
development checkout's SDK pin or adding an incompatible Durable SDK override.

The runtime injects `fhs_start_workflow`, `fhs_get_workflow_status`, `fhs_list_workflows`,
`fhs_cancel_workflow`, and `fhs_terminate_workflow`, plus its workflow guidance. Do not author tools
with these reserved names. Its packaged `data-driven-workflows` skill supplies the detailed
`when`/`for_each` grammar independently of project `skills` filters; do not copy that skill into
the generated app.

## Author Durable Activity Tools

Place focused handlers in `src/tools/`. `@workflow_tool` alone makes a handler available in
workflows, not as a normal chat tool. Use both `@tool` and `@workflow_tool` only when direct calls
are also intended. See [tools-and-skills.md](./tools-and-skills.md) for normal tool discovery.

```python
from azure_functions_agents import workflow_tool


@workflow_tool(description="Summarize bounded service inspection results.")
def summarize_scan(args: dict[str, object]) -> dict[str, object]:
    findings = args.get("findings")
    if not isinstance(findings, list):
        raise ValueError("findings must be the inspection result array")
    return {
        "inspected": sum(row["status"] == "completed" for row in findings),
        "skipped": sum(row["status"] == "skipped" for row in findings),
    }
```

The handler accepts one dictionary and returns a JSON-serializable value. Both `def` and
`async def` work; sync handlers run in a worker thread. With both decorators and `@tool(schema=...)`,
the runtime can adapt the dictionary to the Pydantic input model. Prefix private helpers with `_`.
Keep I/O in activities, not an authored orchestrator. Validate business inputs, bound collection
sizes and API calls, use explicit client timeouts, and surface failures rather than fabricating
successful results. Add required dependencies to `requirements.txt`.

### Retry and Side Effects

Durable Activity delivery is at-least-once, even without an explicit retry policy. Make publishers
idempotent: overwrite a stable Blob destination, upsert with a business key, or use an external
service's supported idempotency contract. Email/post/create actions need a deduplication strategy.
`current_workflow_task_context()` exposes a stable `idempotency_key` for each task instance across
retry deliveries. It does not deduplicate separate workflow starts; use a source event/business
identifier for that boundary.

Declare retry only for safe-to-repeat work:

```python
from azure_functions_agents import WorkflowRetryBackoff, WorkflowRetryPolicy, workflow_tool


@workflow_tool(
    description="Read one service's status through an approved read-only client.",
    retry=WorkflowRetryPolicy(
        max_attempts=3,
        backoff=WorkflowRetryBackoff(initial="PT1S", multiplier=2.0, max="PT4S"),
    ),
    timeout="PT30S",
)
async def read_service_status(args: dict[str, object]) -> dict[str, object]:
    return await _read_status_from_approved_client(args)
```

The client/helper in this illustrative retry example must be implemented for the approved service;
do not scaffold an undefined helper as a finished app. Raise `WorkflowRetryableError` only for known
transient failures and `WorkflowTerminalError` for known terminal application failures. Unknown
outcomes are not a reason to blindly retry an external write.

Plans can carry `execution.retry`, `execution.timeout`, and `execution.continue_on_error`.
Decorator retry/timeout declarations take precedence field by field. `continue_on_error` is
plan-only and must preserve/report the failure, not turn it into business success.
There are at most five attempts; each attempt timeout is between `PT1S` and `PT10M`.
Retry delays plus declared attempt timeouts are bounded to one hour by admission validation.
Keep the host timeout longer than a single Activity's work with finalization margin; durable timer
waits do not hold a worker for the whole workflow. A timeout/cancel/terminate does not guarantee
that an in-flight external operation or sync thread stops, nor does it roll back side effects.

## What Plans Can Express

These JSON examples illustrate plans the runtime agent may author, not static workflow files
that the application should register or execute during scaffolding.

| Task/field | Contract |
| --- | --- |
| `tool` | An authorized, discovered `@workflow_tool` target with `args`. MCP/system tool names are not automatically Activity targets. |
| `wait` | A Durable timer with ISO-8601 `duration` or absolute `until`. |
| `sub_agent` | An authorized specialist slug plus a self-contained `task`. |
| `depends_on` | Execution order only; it does not transfer outputs. |
| `${node.result}` / `${node.result.field}` | Explicit upstream result references in value fields. |
| `when` | One scalar comparison: `ref`, `equals` or `not_equals`, and scalar `value`. No arbitrary expressions or boolean composition. |
| `for_each` | One full reference to an upstream JSON array, on `tool` or `sub_agent` only. `${item}`, `${item.field}`, `${index}` are iteration-local values. |

### Parallel Collection Processing and Aggregation

```json
{
  "tasks": [
    {"id": "discover", "type": "tool", "tool": "list_services", "args": {}},
    {
      "id": "inspect",
      "type": "tool",
      "tool": "inspect_service",
      "args": {"service": "${item.name}"},
      "depends_on": ["discover"],
      "for_each": "${discover.result.services}",
      "when": {"ref": "${item.in_scope}", "operator": "equals", "value": true}
    },
    {
      "id": "summarize",
      "type": "tool",
      "tool": "summarize_scan",
      "args": {"findings": "${inspect.result}"},
      "depends_on": ["inspect"]
    },
    {
      "id": "publish",
      "type": "tool",
      "tool": "publish_report",
      "args": {"summary": "${summarize.result}"},
      "depends_on": ["summarize"]
    }
  ]
}
```

Implement every referenced handler; `list_services` must return a bounded `services` array whose
elements contain `name` and boolean `in_scope`. The aggregate `${inspect.result}` is an ordered
array of `{index, status, result}` entries, not a bare list of inspection outputs. Skipped entries
retain their original positions with `result: null`; an empty collection produces `[]`.
Skipping satisfies dependencies but does not automatically skip descendants. Missing paths and
non-array iterations fail explicitly. Add another `when` where a descendant must also be conditional.

### Parallel Specialists and a Final Writer

```json
{
  "tasks": [
    {"id": "analyze_a", "type": "sub_agent", "agent": "evidence_analyst", "task": "Analyze service A."},
    {"id": "analyze_b", "type": "sub_agent", "agent": "evidence_analyst", "task": "Analyze service B."},
    {
      "id": "write",
      "type": "sub_agent",
      "agent": "report_writer",
      "task": "Combine these findings: A: ${analyze_a.result.text}; B: ${analyze_b.result.text}.",
      "depends_on": ["analyze_a", "analyze_b"]
    }
  ]
}
```

Grant both `evidence_analyst` and `report_writer` in the owner's `workflows.subagents`. Specialists
use their own model, instructions, approved normal tools/MCP/skills, and timeout in fresh sessions.
They receive neither the parent's history nor workflow-management/delegation tools. A specialist
returns `{agent, text}`; transfer its `.result.text` explicitly. For background delivery, append an
idempotent publisher after the writer. Use an approved specialist or focused service handler when
MCP actions are needed, not a generic URL/method dispatcher or unauthorized integration.

### v1 Limits

The fixed caps are 50 nodes, parallelism 10, waits up to 24 hours, and 10 active workflows per owner
agent/session. Every `for_each` element consumes node budget, including skipped items. Bound arrays
upstream; node caps do not limit output bytes. Non-HTTP invocations use new sessions, so the active
session cap is not an app-wide rate limit. Do not promise configurable frontmatter caps, nested
`for_each`, sub-orchestrations, templated tool/agent targets, cross-app coordination, arbitrary
external-event/approval waits, automatic compensation, or automatic large-output Blob offloading.

## Completion, Infrastructure and Operations

`fhs_start_workflow` returns a Workflow ID immediately. The runtime agent ends that turn rather
than polling until completion. Built-in chat UI displays progress and prompts a follow-up on
terminal status; an external client must implement its own supported result/status handling.
An HTTP starter returns its initial agent response, not the eventual workflow result.

For timer/queue/connector and other non-HTTP triggers, include a final authorized tool that saves
or sends the result to the agreed destination. There is no background invocation reconnect API.
A trigger returning successfully proves only that the initial turn finished.

Use [infra-and-deployment.md](./infra-and-deployment.md#dynamic-workflow-backends) for Storage/DTS,
service resources, identity and matching local/cloud settings. Use
[testing.md](./testing.md#dynamic-workflows) for terminal-state and destination checks.
Keep Task Hubs isolated by app/environment. Do not change backend/hub or remove workflow owners
while instances are active without an approved drain/migration plan; state is not automatically
moved between backends. Preserve failed/partial results and never retry an unknown delivery blindly.
Configure approved backend retention/history cleanup so status queries do not grow without bound.

## Authoritative Sources

- [Runtime workflow contract and examples](https://github.com/Azure/azure-functions-agents-runtime/blob/v0.1.0b17/docs/workflows.md)
- [Incident triage sample](https://github.com/Azure/azure-functions-agents-runtime/tree/v0.1.0b17/samples/workflow-incident-triage)
- [Parallel specialist report sample](https://github.com/Azure/azure-functions-agents-runtime/tree/v0.1.0b17/samples/workflow-subagents-preview)
- [DTS configuration](https://learn.microsoft.com/azure/durable-task/scheduler/quickstart-durable-task-scheduler)
- [DTS architecture and latency](https://learn.microsoft.com/azure/durable-task/scheduler/durable-task-scheduler)
