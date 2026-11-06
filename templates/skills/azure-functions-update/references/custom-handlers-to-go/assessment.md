# Assess a Go custom handler

Use during common steps 1-3. Follow the common processing-permission rules before
reading customer source. Inventory setting names and redacted shapes, not credentials.
Use synthetic examples; do not copy private customer samples into public fixtures.

## Confirm the scenario

Trace `host.json`'s custom-handler executable to Go source or its build script.
`FUNCTIONS_WORKER_RUNTIME=custom` alone does not identify a language. Do not convert
another language's custom handler to Go under this scenario.

Check the source tree, `go.mod` if present, build/package commands, and each
`function.json`. A custom handler can predate Go modules; missing `go.mod` does not
prove that it is not Go. Record whether module initialization needs approval.

## Inventory the contracts

| Surface | Required facts |
| --- | --- |
| Invocation | Exact function name, trigger, binding names, handler entry point, invocation envelope versus forwarded HTTP |
| HTTP | Public route, host route prefix, methods, auth, status, headers, body/encoding, redirects, streaming, middleware |
| Events | Payload/metadata, single/batch cardinality, entity names, consumer group, retry policy, settlement/checkpoints, sessions, dead-letter handling |
| Service access | Additional input/output bindings, direct SDK calls, connection setting names, identity, network requirements, side effects |
| Runtime | Go/modules, host/extensions, local configuration, IaC, CI, binary/package entry point, OS and hosting plan |
| Baseline | Existing tests, synthetic fixtures, expected business results, logs, known failures, rollback artifact |

Identify each function's trigger, inputs, outputs, and processing behavior from its
configuration and implementation. Record missing or unclear behavior as an
assessment gap.

## Classify each function

Save one row per function/binding with its current behavior, proposed native
registration and handler shape, preserved settings, validation, and status:

- **Direct mapping**: supported trigger and compatible payload/HTTP contract.
- **Code adaptation**: protocol parsing, middleware, or service I/O needs an agreed rewrite.
- **Blocked**: unsupported trigger, unverified parity, missing source, or no agreed
  replacement for an additional input/non-HTTP output binding.

Preserve batch cardinality explicitly. An Event Hubs batch maps to
`app.EventHubBatch`, not a single-message handler with a cardinality option.
Do not drop an unsupported output to make a plan look feasible.

## Deliver the starting-point plan

Record scope, versions, baseline/accepted substitute, function mappings, risks,
concrete local checks, restore point, and the next approved action. Plan build,
function/listener discovery, HTTP contracts, message success/failure, outputs,
telemetry, packaging, and rollback as applicable.

Record whether an Azure target already exists or must be provisioned; do not assume
native Go app creation has succeeded. Use `azure-functions-create` only for an
approved empty local comparison/target project, not to reinitialize the source.

Separate local conversion from Go/tool upgrades, Azure configuration/provisioning,
deployment, and traffic/event cutover. Windows requires a supported Linux hosting target;
changing a worker setting does not change an app's OS. Confirm preview availability
before proposing Premium/Dedicated as ready to deploy. Record unavailable cloud
evidence as unverified, not as a reason to block unrelated local analysis.

For assessment or plan-only requests, save the plan and stop without source changes,
dependency restore, tool installation, `func init`, publish, or Azure writes.
Report assessment completion separately from migration completion.
