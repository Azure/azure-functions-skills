# AI Semantic Doctor Checks

Use this checklist for `doctor --deep`. Report only concrete issues with evidence. Prefer Warning when a finding depends on interpretation.

## Code behavior

| ID | Check | Typical severity | Evidence to look for |
|----|-------|------------------|----------------------|
| `CQ-001` | SDK/client reuse | Warning | `HttpClient`, `CosmosClient`, `ServiceBusClient`, storage clients created per invocation |
| `CQ-002` | Stateful function logic | Warning | Mutable global state used as durable business state |
| `CQ-003` | Long-running synchronous work | Warning | CPU-heavy loops, blocking file/network calls in request path |
| `CQ-004` | Background task completion | Warning/Fail | Fire-and-forget promises/tasks/threads that may outlive invocation |
| `CQ-005` | Idempotency | Warning | Timer/Queue/ServiceBus/EventHub processing without duplicate protection |
| `CQ-006` | Blocking calls | Warning | `.Result`, `.Wait()`, `time.sleep`, synchronous HTTP calls in async handlers |
| `CQ-007` | Structured error handling | Warning | Risky external calls without capture/logging/rethrow strategy |
| `CQ-008` | Output binding error strategy | Warning | Output binding used where SDK call is needed to handle remote-service errors |

## Azure Functions-specific patterns

| ID | Check | Typical severity | Evidence to look for |
|----|-------|------------------|----------------------|
| `EH-003` | Poison/dead-letter handling | Warning | Queue/Service Bus processing without poison/dead-letter plan |
| `EH-004` | Event Hub checkpoint delay | Warning | Large retry count around Event Hub trigger processing |
| `EH-005` | At-least-once idempotency | Warning | Message processing creates irreversible side effects before checkpoint/state update |
| `SC-002` | Anonymous HTTP trigger sensitivity | Warning/Fail | Anonymous endpoint performs sensitive/admin action |
| `SC-009` | Input validation | Warning | Trigger input used in SQL/commands/output binding without validation |

## Durable Functions

Report deterministic violations when an orchestrator uses non-deterministic APIs, wall-clock time, random values, external I/O, thread sleeps, or direct network calls inside orchestration code.

## Reporting rules

1. Do not repeat Tier 1 findings.
2. Include file and line whenever possible.
3. If a finding is only a design preference and not an issue, do not report it.
4. If unsure, use `status: "warn"` and lower severity.
