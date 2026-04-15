# F10: af-durable — Durable Functions

**Status:** 📋 Proposed  
**Draft Spec Section:** 4.2, 6  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

Durable Functions is the most complex Azure Functions feature — orchestrations, activities, entities, and sub-orchestrations have unique patterns that generic Functions skills don't cover. Developers struggle with:

- Choosing the right pattern (chaining, fan-out/fan-in, human interaction, monitoring)
- Understanding deterministic orchestrator constraints
- Debugging long-running orchestrations
- Handling retries, timeouts, and error propagation
- State management with durable entities

## Feature

`af-durable` provides deep guidance on Durable Functions patterns, implementation, debugging, and best practices.

## Orchestration Patterns

| Pattern | Use Case | Complexity |
|---------|----------|-----------|
| **Function chaining** | Sequential steps, each depending on previous output | Low |
| **Fan-out / Fan-in** | Parallel processing of multiple items | Medium |
| **Async HTTP APIs** | Long-running operations with status polling | Medium |
| **Monitor** | Periodic checks until a condition is met | Medium |
| **Human interaction** | Wait for external approval/input | High |
| **Aggregator (Entity)** | Stateful singleton, event sourcing | High |

## Skill Metadata

```yaml
id: af-durable
title: Durable Functions
intent:
  - durable_functions_help
  - orchestration_patterns
  - workflow_design
  - fan_out_fan_in
completion_signals:
  - orchestration_implemented
  - durable_pattern_applied
suggestions:
  on_success:
    - target: af-observability
      reason: "Durable orchestrations need monitoring for long-running instances."
      priority: 90
    - target: af-feedback
      reason: "Durable Functions is complex. Share what worked or didn't."
      priority: 50
  on_failure:
    - target: af-help
      reason: "If the durable pattern is wrong, re-evaluate the approach."
      priority: 70
entry_conditions:
  - durable_functions_detected
  - workflow_question_asked
```

## Key Concepts

### Deterministic Orchestrator Rules

Orchestrator functions must be **deterministic** — they get replayed on every event:

| ❌ Don't | ✅ Do Instead |
|---------|-------------|
| `DateTime.Now` / `Date.now()` | `context.CurrentUtcDateTime` / `context.df.currentUtcDateTime` |
| `Math.random()` / `random()` | Activity function or deterministic seed |
| Direct I/O (HTTP, DB) | Activity function |
| `Thread.Sleep` / `setTimeout` | `context.CreateTimer()` / `context.df.createTimer()` |
| Non-deterministic GUID | `context.NewGuid()` / `context.df.newGuid()` |

### Example: Fan-Out / Fan-In (Python v2)

```python
import azure.functions as func
import azure.durable_functions as df

app = func.FunctionApp()
bp = df.Blueprint()

@bp.orchestration_trigger(context_name="context")
def batch_orchestrator(context: df.DurableOrchestrationContext):
    work_items = yield context.call_activity("get_work_items")
    
    # Fan-out: process all items in parallel
    tasks = [context.call_activity("process_item", item) for item in work_items]
    results = yield context.task_all(tasks)
    
    # Fan-in: aggregate results
    summary = yield context.call_activity("aggregate_results", results)
    return summary

@bp.activity_trigger(input_name="item")
def process_item(item: str) -> dict:
    # CPU-bound or I/O-bound work here
    return {"item": item, "status": "processed"}

app.register_functions(bp)
```

### Example: Human Interaction (Node.js v4)

```typescript
import * as df from "durable-functions";

df.app.orchestration("approvalWorkflow", function* (context) {
    const requestId = context.df.instanceId;
    
    // Send approval request
    yield context.df.callActivity("sendApprovalRequest", { requestId });
    
    // Wait for external event (with timeout)
    const approvalEvent = context.df.waitForExternalEvent("ApprovalResponse");
    const timeout = context.df.createTimer(
        new Date(context.df.currentUtcDateTime.getTime() + 72 * 60 * 60 * 1000) // 72h
    );
    
    const winner = yield context.df.Task.any([approvalEvent, timeout]);
    
    if (winner === approvalEvent) {
        yield context.df.callActivity("processApproval", approvalEvent.result);
    } else {
        yield context.df.callActivity("handleTimeout", { requestId });
    }
});
```

## Debugging Tips

1. **Durable Functions Monitor** — VS Code extension for viewing orchestration status
2. **Storage Explorer** — Inspect task hub tables (Instances, History)
3. **Application Insights** — Query `traces` table with `customDimensions.prop__InstanceId`
4. **Purge history** — `az functionapp durable purge-history` for stuck instances

## Common Pitfalls

| Pitfall | Impact | Fix |
|---------|--------|-----|
| Non-deterministic orchestrator code | Replay failures, stuck instances | Follow determinism rules strictly |
| Large orchestration payloads | Storage throttling | Use blob references for large data |
| Too many parallel activities | Storage contention | Batch with `context.task_all()` in chunks |
| Missing error handling | Orphaned sub-orchestrations | Use `try/catch` with `context.call_activity_with_retry()` |
| Infinite monitor loops | Resource waste | Always set a maximum iteration count or timeout |

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill provides pattern-specific code and debugging guidance |
| Claude Code | Skill file with orchestration patterns and anti-patterns |
| Codex | Agent instruction with durable-specific code generation rules |
| Repo Template | Durable Functions checklist in `copilot-instructions.md` |
