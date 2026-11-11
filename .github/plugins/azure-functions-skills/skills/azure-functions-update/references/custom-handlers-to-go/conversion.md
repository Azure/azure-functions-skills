# Convert the approved Go model and configuration

Load only for common step 4, after inventory and approval. Keep the agreed Go
version and business contracts. Consult [validation.md](validation.md)'s completion
table when defining the acceptance checks; do not deploy as part of local conversion.

## Module and entry point

Keep the existing module and application code. Do not run `func init` or `go mod init`
over a customer project. If no module exists, agree its path and initialization first.
Add `github.com/azure/azure-functions-golang-worker` at the approved compatible
published tag. Imports use lowercase `azure`. Inspect feeds/hooks before resolving
dependencies, and run `go mod tidy` only after imports exist.

Replace the custom-handler listener with `app := sdk.FunctionApp()`, explicit
registrations, and `worker.Start(app)`. Remove only retired dispatch/protocol glue;
preserve shared initialization, clients, business handlers, and middleware.

## Trigger and binding mapping

Inspect the selected release's registration and options APIs for each used trigger.
Keep exact function names unless renaming is separately approved.

| Custom-handler surface | Go worker equivalent |
| --- | --- |
| `httpTrigger` and HTTP response output | `app.HTTP` with `func(http.ResponseWriter, *http.Request)` |
| `timerTrigger` | `app.Timer` with `bindings.TimerInfo` and `sdk.WithSchedule` |
| `eventHubTrigger`, cardinality `one` | `app.EventHub` with `bindings.EventHubMessage` |
| `eventHubTrigger`, cardinality `many` | `app.EventHubBatch` with `[]bindings.EventHubMessage` |
| Single Service Bus queue/topic | `app.ServiceBusQueue` / `app.ServiceBusTopic` with `bindings.ServiceBusMessage` |
| Batched Service Bus queue/topic | `app.ServiceBusQueueBatch` / `app.ServiceBusTopicBatch` with `[]bindings.ServiceBusMessage` |
| Other triggers | Find the actual supported registration/type; unsupported or unproven parity remains blocked |
| Unsupported additional input or non-HTTP output binding | Agreed Azure SDK for Go integration, not deletion of the binding's behavior |

The preview Durable middleware's `durabletask.ClientInput()` registers a supported
`durableClient` input binding. Verify the selected middleware/extension compatibility,
Go version, and preview acceptance separately; do not introduce Durable implicitly
or assume that this exception enables general additional input bindings.

`sdk.WithConnection` takes the setting name, not a credential. Preserve entity names,
`%SETTING%` resolution, consumer groups, subscriptions, sessions, schedules, and retry
policy. Use `sdk.WithRetry` only where the trigger supports the original retry behavior;
do not replace Service Bus broker delivery/settlement with a generic function retry.

For HTTP functions, explicitly preserve `sdk.WithRoute`, `sdk.WithMethods`,
`sdk.WithAuth`, and `host.json`'s route prefix. The host invocation URL is not
necessarily the public route. An omitted legacy methods list must not accidentally
become the SDK default GET/POST, and auth must not become anonymous.
Replace HTTP `Outputs`/`ReturnValue` envelopes with response-writer operations,
preserving status, headers, body, redirects, and streaming. Apply these checks to
both envelope-based and forwarded-HTTP apps.

For non-HTTP functions, use typed handlers taking `context.Context` and returning
`error`. Preserve payload/metadata and batch shape; return processing errors rather
than logging them and reporting success. Preserve agreed cancellation, idempotency,
partial failure, checkpoint, and settlement behavior. Verify support for any manual
settlement or dead-letter handling before claiming parity.

For unsupported bindings, agree an SDK replacement that preserves lookup/write,
serialization, destination, credentials/identity, retries, and duplicate handling.
Host-managed I/O becoming application code can change behavior. Keep the function
blocked if no safe replacement is agreed.

## Configuration and telemetry

Remove `host.json`'s `customHandler` block after the new entry point exists.
Keep applicable extension bundles, connection setting names, HTTP options, retries,
service settings, and logging. Translate obsolete extension schemas only with
version-specific evidence and record the change. Remove each old `function.json`
only after all its binding and retry behavior has implemented, verified Go worker
mappings or approved, verified replacements. Recording a blocker is not sufficient:
retain the original metadata and pause conversion while any behavior is blocked.
When metadata is retired, keep a copy in the rollback source/snapshot outside the
active migrated app and package. Do not mix legacy metadata indexing with Go worker
registrations or cut over while any behavior is blocked.

Under `Values`, preserve unrelated values and set:

Set FUNCTIONS_WORKER_RUNTIME=native in local.settings.json.

Set FUNCTIONS_CLI_NATIVE_LANGUAGE=go in local.settings.json.

Keep this file ignored and outside the package. Preserve `AzureWebJobsStorage` and
connection setting names; never commit secrets. Remove a custom-handler port setting
only if nothing else needs it.

Propose Go runtime configuration for the Azure target/IaC separately.

Verify and record the exact target-plan schema and values in the plan/report:
Flex uses `functionAppConfig.runtime`, not a blind copy of local app settings.
For plans that use the worker-runtime app setting, propose replacing `custom`
with `native`. `FUNCTIONS_CLI_NATIVE_LANGUAGE` is a local Core Tools setting,
not an Azure runtime setting. Keep all Azure changes as proposals unless approved;
local values do not prove Azure configuration changed.

Replace protocol `Logs` deliberately with context-aware `log/slog` calls while
preserving required levels/correlation. OpenTelemetry needs host configuration and
worker middleware; it is not automatic. Do not replace an existing telemetry pipeline
without agreement. See the [observability guide](https://azure.github.io/azure-functions-golang-worker/guides/observability/).

Update CI/package entry points for the Go worker build, excluding retired executables
and custom-handler metadata without deleting shared files or business data.
Continue with [validation.md](validation.md) for common steps 5-7.
