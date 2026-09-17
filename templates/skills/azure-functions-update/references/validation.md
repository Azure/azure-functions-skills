# Validation: contracts, environments, and data

Agree required checks per function, checkpoint, and environment before execution.
Use this reference in steps 4 through 8 of [the workflow](../SKILL.md).
Confirm original behavior with the user; do not derive expectations from changed code.
Only select relevant checks. Do not load every service's full documentation.

## What each check proves

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

Use the service and identity limits below. Real Azure checks use [the handoff](azure-handoff.md).

## Select behavior probes from observed code

These are proposed selection rules, not measured trial results.
Set expected outcomes from baseline evidence, existing tests, or user confirmation
before changes. Link selected probes to [requirement rows](plan.md).

| Observed signal | Possible regression | Smallest useful probe |
| --- | --- | --- |
| JSON settings/converters, HTTP integration change | Response/message schema differs despite a passing build | Accepted enum/null/date fixture; semantic output and headers through the selected handler/host |
| Explicit HTTP route/auth/status/error handling | Endpoint or error behavior changes | Valid/invalid requests with original expected status/body/headers; local host does not prove deployed auth |
| Message batches, settlement, locks/sessions, retries | Completion, redelivery, shape, duplicates change | Controlled success/failure messages with business output and selected broker settlement/redelivery observations |
| Event Hubs partition/checkpoint logic | Loss, replay, or assignment changes | Bounded identified events and controlled restart; compare outputs/checkpoint effects, not listener logs alone |
| Timer schedule/time zone | Wrong execution time | Check schedule semantics and invoke business logic with controlled time/input; invocation does not prove platform scheduling |
| Durable history, entity, or serializer changes | Resume/replay breaks | Approved synthetic history across supported versions; separate new-instance and existing-history acceptance |
| Custom registration or generated build helper | Functions/bindings omitted | Expected inventory versus actual target SDK/host indexing |
| Shared signature or TFM change | Another consumer breaks | Build/test identified consumers and relevant boundaries; report inaccessible consumers |

Do not inject restarts, duplicates, or failures into live customer services.
For example, an emulator restart that loses its data cannot prove production
retention/checkpoint behavior. Select a suitable approved environment instead.

## E2E witness, placement, and ownership

For each agreed business scenario, record input/trigger, path through the migrated app,
dependencies, expected business output, observation method, and artifact.
Execute that path and inspect the output. A unit call, host start, or function list
alone is not the E2E witness. A fake cannot close a required real-service contract.
An LLM judge cannot replace execution evidence or rename a weaker check E2E.
If baseline failure prevents observation, use the explicit conditional-baseline process.

Propose a distinct area that follows customer conventions, such as `tests/migration-e2e/`.
Agree its exact location, owner, and retention; keep generated E2E separate from existing
customer tests and product code. If declined, propose an isolated temporary location.
That path, commands, data, retention, and cleanup need their own approval.
If neither is accepted, new E2E creation is blocked; existing approved checks can run.

Record fixture owner, command, environment, data classification, service ownership,
and handoff. Preserve exact tests or an approved reproducible description before cleanup.
Remove only run-owned tests, fixtures, and credentials. Azure resource cleanup remains
with the Azure Skills handoff owner.

## Large apps and data

Begin with bounded metadata, not a full table or repository read. Ask for size estimates
if even metadata collection exceeds permission. Agree limits before content collection:
files/projects/functions/dependencies, rows/events/objects/bytes, time, model/network use,
service cost, retained data, and included/excluded paths and data classes.
Use reproducible strata, seed, query/time range, or a synthetic generator.
Record coverage, privacy, retention, and remaining risks.

No universal size threshold excludes an app. Prefer synthetic/redacted fixtures when
production records are not allowed. A runner's lower limit means partial results, not
a silently smaller sample. Keep functional checks separate from full-volume/load/
performance checks; emulator timing does not establish production capacity.
Prefer an approved local assertion and redacted result over sending business data
to the model. State what the sample reproduces and what still needs customer acceptance.

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

## Emulator capabilities

These are official documentation snapshots accessed on 2026-09-17, not image test
results. Confirm service, variant, exact version/image digest, client SDK, extension,
protocol, API, persistence, quotas, and source date before accepting evidence.

| Service/variant | Useful coverage | Material limits |
| --- | --- | --- |
| Azurite | Blob, Queue, Table APIs | No Files/ADLS Gen2; Table preview; not production scale |
| Service Bus emulator | AMQP TCP and administration-client entity management | No JMS, partitioned entities, WebSockets, Entra, VNet, autoscale, geo-DR, large messages |
| Event Hubs emulator | AMQP and Kafka streaming | Kafka producer/consumer only; no on-the-fly SDK management, Entra, VNet, Capture, schema registry, autoscale, geo-DR |
| Cosmos Windows/legacy Linux | Selected platform-specific APIs | Key/TLS access; no scale-out or geo-replication |
| Cosmos Linux vNext | NoSQL gateway and selected features | HTTP default; .NET/Java need HTTPS; some APIs return success without implementation |
| Event Grid/Key Vault | No official emulator identified in reviewed guidance | Replay/fakes do not prove service integration |

Service Bus needs its SQL Server container; Event Hubs needs Azurite. Identify dependent
images as well as the broker. Both messaging emulators lose data/entities on restart;
JSON configuration changes need restart. Service Bus guidance specifies sequential tests.
Event Hubs Kafka uses SASL plaintext/PLAIN, not the customer's TLS transport.

Cosmos vNext lists Change Feed support, but verify the selected Functions extension.
Custom index changes can return success without taking effect; that is not behavior
proof. Gateway mode does not prove direct mode. .NET/Java need HTTPS and approved
certificate trust, not disabled validation. Health probes do not prove listener readiness.
Cosmos vNext enables usage telemetry by default: approve its destination/data or disable
it through documented configuration before startup. Check each emulator's external effects.

Use existing compatible emulators only within their ownership and permission.
Ask before downloads, licenses, image pulls, container start/stop, ports, volumes, or
trust changes. Do not fall back to production. A scoped transport change needs approval
and leaves the original transport unproved. Missing features remain blocked and can need
Azure handoff. Microsoft publication does not mean production parity, an SLA, or support.

## Identity, certificates, CORS, and external APIs

Record actual identity and environment. Distinguish fakes, emulator keys, developer
accounts, service principals, and deployed system/user-assigned managed identity.
Do not let credential chains fall back to unapproved identities.

| Contract | Local evidence | Additional acceptance |
| --- | --- | --- |
| Managed identity | Fake logic or approved developer access | Deployed token acquisition, RBAC, network |
| Key Vault | Fake provider or approved developer access | Actual tenant, token, firewall/private endpoint, selected identity/RBAC |
| Server TLS | Controlled trust-chain test | Customer domain/hosting certificate behavior |
| Client certificate/mTLS | Selected client/handler behavior | Platform forwarding/termination, required certificates, policy |
| CORS | CLI status/headers | Browser with actual origin, method, headers, credential mode, preflight |
| External platform API | Contract fixture or approved test tenant | Platform identity, rate limits, network, data, customer acceptance |

Developer access does not prove deployed MI. Local simulation cannot prove resource
token issuance. Key Vault and identity checks can be real Azure calls from a laptop.
Emulator certificates do not prove App Service mTLS or customer trust. Trust changes
need named scope and cleanup; do not remove pre-existing certificates or disable TLS.
A CLI HTTP request does not enforce browser CORS.

For external APIs, agree sandbox/tenant, identity, rate/cost limits, privacy, retention,
and credential revocation. Do not create accounts or send messages as implied tests.
Unsupported local contracts need Azure/customer evidence, not a success-shaped mock.

## Finish honestly

End migration with the agreed E2E scenarios and applicable best-practice review.
Build, host start, or indexing alone is a reached level, not migration completion.
If E2E is unavailable, use [result and requirement rules](plan.md).
Doctor output is advisory only. Local E2E can close the local contracts it actually
covers; required service delivery, deployed identity, and scheduling need their environment.

## Primary sources

Accessed 2026-09-17; recheck for the selected service/release:

[local development](https://learn.microsoft.com/azure/azure-functions/functions-develop-local),
[Event Grid local replay](https://learn.microsoft.com/azure/azure-functions/event-grid-how-tos),
[Function endpoints](https://learn.microsoft.com/azure/event-grid/handler-functions),
[delivery and retry](https://learn.microsoft.com/azure/event-grid/delivery-and-retry).

- [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite): updated 2025-10-23.
- [Service Bus](https://learn.microsoft.com/azure/service-bus-messaging/overview-emulator): dated 2026-02-05; updated 2026-08-28.
- [Event Hubs](https://learn.microsoft.com/azure/event-hubs/overview-emulator): dated 2026-08-25; updated 2026-08-26.
- [Cosmos emulator](https://learn.microsoft.com/azure/cosmos-db/emulator): dated 2026-09-01.
- [Cosmos Linux vNext](https://learn.microsoft.com/azure/cosmos-db/emulator-linux): dated 2026-06-02.
- [Developer identity](https://learn.microsoft.com/dotnet/azure/sdk/authentication/local-development-dev-accounts).
- [Managed identities](https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview).
- [Key Vault authentication](https://learn.microsoft.com/azure/key-vault/general/authentication).
- [Functions security](https://learn.microsoft.com/azure/azure-functions/security-concepts).
- [Functions networking](https://learn.microsoft.com/azure/azure-functions/functions-networking-options).
