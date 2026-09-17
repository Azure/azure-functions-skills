# Select checks from the original contracts

Agree required checks per function, checkpoint, and environment before execution.
Confirm behavior with the user through [intake](intake.md). Use
[contract probes](contract-probes.md) to map observed risks to expected results.
Store generated E2E tests using [test/data rules](testing-data.md).

| Check | Evidence | Does not prove |
| --- | --- | --- |
| Restore/build | Dependencies resolve; selected build tasks pass | Host, indexing, listener, service behavior |
| Unit/component | Covered original logic | Host or binding pipeline unless included |
| Host starts | Selected host and worker can start | All listeners ready |
| Expected functions indexed | Expected names are registered | Delivery or successful business output |
| Listener ready | Selected listener connects | All listeners or correct business result |
| Local replay | Sample dispatch and handler behavior | Real service validation, delivery, retry, identity |
| Emulator integration | Selected implemented service APIs | Cloud identity, topology, scale, omitted features |
| Azure sandbox | Selected real service contracts | Customer network, data, identity, load, policy |
| Customer/manual | Named customer acceptance | Unobserved contracts or regression automation |

Report `passed`, `failed`, `blocked`, `inconclusive`, `not applicable`, or `not selected`
for each check. Explain blockers with owner, required permission/environment, and
acceptance method. This draft has not established one readiness signal for all
extensions. Investigate the selected version's signal; otherwise report it inconclusive.

For service checks, load [emulator capability](emulators.md). For credentials, TLS,
CORS, or external APIs, load [identity boundaries](identity.md).
For real Azure checks, use [the handoff](azure-handoff.md).

## Event Grid

Local testing is possible. With an approved fixture and host, replay to
`/runtime/webhooks/eventgrid?functionName=<function-name>` using
`Content-Type: application/json` and `aeg-event-type: Notification` for the documented
Event Grid-schema notification path. Match the selected schema and endpoint protocol.
A synthetic fixture does not require prior Azure access; captured payloads do.

This is not evidence of subscription creation/validation, key lookup, delivery,
filters, batching, retry, duplicates, dead-lettering, or real identity. A direct handler
test is also distinct from replay through the Functions host.
The reviewed guidance does not identify an official Event Grid emulator. Do not claim
universal nonexistence or treat a mock as the Azure service.

Native Function Event Grid endpoints and generic HTTP webhooks differ. The official
handler guide uses a generic webhook/HTTP-trigger route for Entra-protected Functions.
A public callback/tunnel needs explicit exposure, identity, duration, and cleanup
approval; do not publish a local endpoint as an implied test step.

## Finish honestly

End migration with the agreed E2E scenarios and applicable best-practice review.
Build, host start, or indexing alone is a reached level, not migration completion.
If E2E is unavailable, use [blocked result rules](evidence.md).
Review [requirement dispositions](requirements.md); doctor output is advisory only.

Sources accessed 2026-09-17:
[local development](https://learn.microsoft.com/azure/azure-functions/functions-develop-local),
[Event Grid local replay](https://learn.microsoft.com/azure/azure-functions/event-grid-how-tos),
[Function endpoints](https://learn.microsoft.com/azure/event-grid/handler-functions),
[delivery and retry](https://learn.microsoft.com/azure/event-grid/delivery-and-retry).
