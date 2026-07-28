# Azure Functions Diagnostics Reference — Go

Use this file when investigating Azure Functions issues involving Go apps, the Go worker, worker-driven indexing in Go, or Go runtime support.

> **Preview.** Go support on Azure Functions is in public preview. Behavior, APIs, and supported triggers can change between releases. State the preview status when reporting findings, and do not assume parity with GA languages.

## Identifying a Go app

`FUNCTIONS_WORKER_RUNTIME` is **`native`** for Go apps, not `go` or `golang`.

| Signal | Meaning |
|-------|---------|
| `FUNCTIONS_WORKER_RUNTIME=native` | The host loads the `native` worker. Used by the Go worker. |
| `FUNCTIONS_WORKER_RUNTIME=golang` | Legacy/pre-release value. Some older Core Tools builds and samples still use it. Treat as Go. |
| `worker.config.json` with `"language": "golang"` | Worker-provider descriptor shipped by Core Tools. This is **not** the app setting. |

`native` is also the runtime value for other native-binary workers, so it does not by itself prove the app is Go. Confirm with at least one secondary signal before loading Go-specific guidance:

- `go.mod` in the project root, especially requiring `github.com/azure/azure-functions-golang-worker`.
- `main.go` calling `sdk.FunctionApp()` and `worker.Start(app)`.
- A compiled binary as the deployment entry point (commonly `bin/app`).

If none of these are present, the app is more likely a custom handler. Use custom-handler guidance instead.

> **Module path casing.** The GitHub repository is `Azure/azure-functions-golang-worker`, but the Go module path is lowercase: `github.com/azure/azure-functions-golang-worker`. Go module paths are case-sensitive, so `go get` and every import must use the lowercase form.

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-golang-worker | https://github.com/Azure/azure-functions-golang-worker | Go worker runtime and SDK |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior that affects Go apps |
| azure-functions-core-tools | https://github.com/Azure/azure-functions-core-tools | Local `func` tooling and the bundled `native` worker |

## Public documentation and registries

| Topic | URL |
|------|-----|
| Go worker README and getting started | https://github.com/Azure/azure-functions-golang-worker |
| Go worker samples | https://github.com/Azure/azure-functions-golang-worker/tree/main/samples |
| Go worker releases (tagged versions) | https://github.com/Azure/azure-functions-golang-worker/releases |
| Go module reference | https://pkg.go.dev/github.com/Azure/azure-functions-golang-worker |
| Core Tools package | https://www.npmjs.com/package/azure-functions-core-tools |
| Go downloads | https://go.dev/dl/ |
| Supported languages | https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages |
| Run functions locally | https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Programming model essentials

- **Worker-driven indexing.** Triggers and bindings are declared in Go code through functional options. Go projects do **not** use `function.json`. A `function.json` in a Go project is a migration leftover or a mistake, not the source of truth.
- **Registration shape.** `app := sdk.FunctionApp()`, then `app.HTTP(...)` / `app.Timer(...)` / etc., then `worker.Start(app)`.
- **Core triggers** (`sdk/`, payload delivered inline over gRPC): HTTP, Timer, Cosmos DB, SQL, Event Grid, Queue, Event Hubs, Service Bus queue, Service Bus topic.
- **Extension triggers** (`triggers/`, Azure SDK client injected): Blob. Activated with a blank import such as `_ "github.com/azure/azure-functions-golang-worker/triggers/blob"`. A missing blank import is a common cause of "trigger not registered" symptoms.
- **HTTP handlers** use standard `http.ResponseWriter` and `*http.Request`.
- **Extension bundles still apply.** Go is a non-.NET runtime, so non-HTTP triggers require an extension bundle in `host.json`.

## Common failure modes

| Symptom | Likely cause |
|--------|-------------|
| Host rejects the runtime, or worker never starts locally | Core Tools older than 4.12.0. The `native` worker that supports Go ships in 4.12.0 and later. |
| `FUNCTIONS_WORKER_RUNTIME` parse failure in host logs | Runtime set to `golang` on a build that only accepts `native` (or the reverse). |
| Worker exits and all in-flight invocations fail together | Unrecovered panic in a user-started goroutine. A panic in any goroutine terminates the whole process, so one goroutine takes down every concurrent invocation on that worker. |
| Invocation fails with no useful stack in Application Insights | Panic escaped outside the handler. Panics inside the handler are recovered and reported with a stack trace. |
| Trigger indexes but never fires | Missing blank import for an extension trigger, or missing/incompatible extension bundle. |
| Deployment starts then the platform proxy exits | Deployment package missing the execute permission on the compiled binary, or a binary built for the wrong `GOOS`/`GOARCH`. |
| Behavior changes unexpectedly between builds | Project tracking `main` instead of a tagged worker release. |

## Investigation guidance

- Confirm the worker module version first. Preview releases move quickly, and pinning to a published tag is the supported configuration. Every published version is currently a `vX.Y.Z-preview` tag; `go list -m -versions github.com/azure/azure-functions-golang-worker` lists what exists. Compare it against `go.mod`.
- Check the Core Tools version for any local reproduction. Versions before 4.12.0 do not support Go at all and produce misleading "unsupported runtime" errors.
- For crashes, look for whole-worker termination rather than a single failed invocation. That pattern points at goroutine panics, and the fix is propagating panics as errors (`sdk.RecoverTo`) rather than adding handler-level recovery.
- For binding or trigger problems, verify the Go registration call and the `host.json` extension bundle together. There is no `function.json` to inspect.
- Include `azure-functions-host` when trigger indexing, host startup, scale, or cross-worker behavior is involved.
- Prefer the worker repository's samples over hand-written binding configuration when reproducing an issue.
- Durable Functions is not yet available for Go. See `durable-functions.md` before proposing any Durable-based design.
