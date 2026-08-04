# Azure Functions Diagnostics Reference — Go

Use this file when investigating Azure Functions issues involving Go apps, the Go worker, worker-driven indexing in Go, or Go runtime support.

> **Preview.** Go support on Azure Functions is in public preview. Behavior, APIs, and supported triggers can change between releases. State the preview status when reporting findings, and do not assume parity with GA languages.

## Public documentation and registries

| Topic | URL |
|------|-----|
| **Go developer reference (primary)** | https://learn.microsoft.com/azure/azure-functions/functions-reference-go |
| Go worker samples | https://github.com/Azure/azure-functions-golang-worker/tree/main/samples |
| Go worker releases | https://github.com/Azure/azure-functions-golang-worker/releases |
| Go module reference | https://pkg.go.dev/github.com/azure/azure-functions-golang-worker |
| OpenTelemetry with Azure Functions | https://learn.microsoft.com/azure/azure-functions/opentelemetry-howto?pivots=programming-language-go |
| Flex Consumption plan | https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan |
| Core Tools package | https://www.npmjs.com/package/azure-functions-core-tools |
| Go downloads | https://go.dev/dl/ |
| Supported languages | https://learn.microsoft.com/azure/azure-functions/supported-languages |
| Diagnostics overview | https://learn.microsoft.com/azure/azure-functions/functions-diagnostics |

Start with the Go developer reference. It is the authoritative source for prerequisites, the programming model, supported triggers, deployment, and preview limitations.

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-golang-worker | https://github.com/Azure/azure-functions-golang-worker | Go worker runtime and SDK |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior that affects Go apps |
| azure-functions-core-tools | https://github.com/Azure/azure-functions-core-tools | Local `func` tooling, the `native` worker, and Go build/pack behavior |

## Identifying a Go app

`FUNCTIONS_WORKER_RUNTIME` is **`native`** for Go apps. It is never `go` or `golang`. If you find either of those values, that is the misconfiguration, and the fix is to set `native`.

Core Tools resolves the `native` worker to Go when a `go.mod` file is present, so `native` alone does not prove the app is Go. Confirm with at least one secondary signal before loading Go-specific guidance:

- `go.mod` in the project root, especially requiring `github.com/azure/azure-functions-golang-worker`.
- `main.go` calling `sdk.FunctionApp()` and `worker.Start(app)`.
- `FUNCTIONS_CLI_NATIVE_LANGUAGE` set to `go` in `local.settings.json`. Core Tools writes this when scaffolding with `func init --worker-runtime go`.
- A compiled binary as the deployment entry point. Core Tools builds `bin/app` locally and places it at the root of the deployment package as `app`.

If none of these are present, the app is more likely a custom handler. Use custom-handler guidance instead.

> **Module path casing.** The GitHub repository is `Azure/azure-functions-golang-worker`, but the Go module path is lowercase, `github.com/azure/azure-functions-golang-worker`. Go module paths are case-sensitive, so `go get` and every import must use the lowercase form.

> **Worker descriptor.** Current Core Tools ships `nativeWorkerConfig.json` declaring `"language": "native"` with a `defaultExecutablePath` of `bin/app`. Older Go worker specification material still shows a `golang` descriptor. Treat that as an out-of-date spec rather than current runtime behavior, and never use it to justify a `golang` runtime value.

## Preview constraints

These come from the Go developer reference and change what is even possible, so check them before diagnosing deeper.

- Go function apps are supported **only on the Flex Consumption plan**.
- Go function apps run on **Linux only** in Azure.
- **Durable Functions is not supported** for Go.
- **`func new` is not supported.** Functions are added by editing `main.go`.
- Only the triggers listed below are supported.
- Go packaging in Core Tools targets Linux x64.

## Programming model essentials

- **Worker-driven indexing.** Triggers are declared in Go code through the fluent builder and functional options. Go projects do **not** use `function.json`. A `function.json` in a Go project is a migration leftover or a mistake, not the source of truth.
- **Triggers only, no bindings.** The Go worker does not support input or output bindings. A handler that needs to write to a queue, blob, table, or Cosmos DB container calls the Azure SDK for Go directly. Do not diagnose an output binding misconfiguration in a Go app, and do not recommend one as a fix.
- **Registration shape.** `app := sdk.FunctionApp()`, then `app.HTTP(...)` / `app.Timer(...)` and so on, then `worker.Start(app)`.
- **HTTP handlers** use standard `http.ResponseWriter` and `*http.Request`. HTTP streaming is supported through `http.Flusher`.
- **Extension bundles still apply.** Go is a non-.NET runtime, so non-HTTP triggers resolve their extensions through the bundle in `host.json`.
- **Logging.** Context-aware `log/slog` calls such as `slog.InfoContext` correlate logs with the current invocation. OpenTelemetry is available through the worker's middleware.

### Supported triggers

Core triggers receive their payload inline over gRPC and need no external Azure SDK.

| Trigger | Registration | Handler signature |
|---|---|---|
| HTTP | `app.HTTP` | `func(http.ResponseWriter, *http.Request)` |
| Timer | `app.Timer` | `func(context.Context, bindings.TimerInfo) error` |
| Cosmos DB | `app.CosmosDB` | `func(context.Context, []bindings.CosmosDocument) error` |
| Azure SQL | `app.SQL` | `func(context.Context, []bindings.SQLChange) error` |
| Event Grid | `app.EventGrid` | `func(context.Context, bindings.EventGridEvent) error` |
| Storage Queue | `app.Queue` | `func(context.Context, bindings.QueueMessage) error` |
| Event Hubs | `app.EventHub` | `func(context.Context, bindings.EventHubMessage) error` |
| Service Bus queue | `app.ServiceBusQueue` | `func(context.Context, bindings.ServiceBusMessage) error` |
| Service Bus topic | `app.ServiceBusTopic` | `func(context.Context, bindings.ServiceBusMessage) error` |

Extension triggers inject an authenticated Azure SDK client instead of raw data, which allows streaming without buffering the payload through gRPC.

| Trigger | Registration | Handler receives |
|---|---|---|
| Blob Storage | `app.Blob` | `*blob.Client` |

Extension triggers must have their package activated with a blank import such as `_ "github.com/azure/azure-functions-golang-worker/triggers/blob"`. A missing blank import is a common cause of "trigger not registered" symptoms.

## Local and deployment behavior

Core Tools 4.12 or later owns the Go build. Knowing which command builds what avoids chasing phantom packaging problems.

| Command | What it does |
|---|---|
| `func start` | Runs `go build -o bin/app .` for the local OS, then starts the host. A compile error surfaces as a host start failure. |
| `func azure functionapp publish <APP_NAME>` | Builds, packages, and deploys to an existing function app. |
| `func pack` | Builds for Linux x64 and produces a deployable zip. The binary is placed at the package root as `app`. |
| `func pack --no-build` | Skips the build. Only in this case must the binary be cross-compiled first with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/app .`. |

A package produced by `func pack` is ready to run, so a remote build should not be requested when deploying it.

## Common failure modes

| Symptom | Likely cause |
|--------|-------------|
| Host rejects the runtime, or the worker never starts locally | Core Tools older than 4.12. The `native` worker that supports Go ships in 4.12 and later. |
| `FUNCTIONS_WORKER_RUNTIME` parse failure in host logs | Runtime set to `go` or `golang` instead of `native`. |
| Worker exits and all in-flight invocations fail together | Unrecovered panic in a user-started goroutine. A panic in any goroutine terminates the whole process, so one goroutine takes down every concurrent invocation on that worker. |
| Invocation fails with no useful stack in Application Insights | Panic escaped outside the handler. Panics inside the handler are recovered and reported with a stack trace. |
| Host starts but indexes no functions | Missing `app.*` registration, or a missing blank import for an extension trigger. |
| Trigger indexes but never fires | Missing or incompatible extension bundle, or a connection setting that does not resolve. |
| Deployment succeeds but the app never becomes healthy | Package built for the wrong platform, or a hand-rolled zip that lost the execute bit on the binary. Prefer `func pack` or `func azure functionapp publish`, which handle both. |
| App will not deploy to the chosen plan | Go is supported only on Flex Consumption, Linux only, during preview. |
| Behavior changes unexpectedly between builds | Project tracking `main` instead of a tagged worker release. |

## Investigation guidance

- Check the Core Tools version for any local reproduction. Versions before 4.12 do not support Go at all and produce misleading "unsupported runtime" errors.
- Confirm the worker module version. Every published version is a `vX.Y.Z-preview` tag, and `go list -m -versions github.com/azure/azure-functions-golang-worker` lists what exists. Compare it against `go.mod`.
- For crashes, look for whole-worker termination rather than a single failed invocation. That pattern points at goroutine panics, and the fix is propagating panics as errors with `sdk.RecoverTo` rather than adding handler-level recovery.
- For trigger problems, verify the Go registration call and the `host.json` extension bundle together. There is no `function.json` to inspect.
- Do not diagnose an input or output binding problem in a Go app. Bindings do not exist there, and the equivalent code is a direct Azure SDK call in the handler.
- Include `azure-functions-host` when trigger indexing, host startup, scale, or cross-worker behavior is involved.
- Prefer the worker repository's samples over hand-written registration when reproducing an issue.
