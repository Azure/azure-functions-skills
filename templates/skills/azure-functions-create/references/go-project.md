# Creating a Go Azure Functions project (preview)

Load this file only when the user asks for Go. It is not needed for any other language.

Go support on Azure Functions is in **public preview**. Say so before scaffolding, and do not recommend it for production without the user acknowledging the preview status.

Primary reference: [Go developer reference for Azure Functions](https://learn.microsoft.com/azure/azure-functions/functions-reference-go).

## Why Go has its own path

Neither the Azure MCP template set nor the templates manifest contains Go templates. Do not call `functions_template_get` with a Go language value, do not invent a Go template ID, and do not silently scaffold a different language instead. Use Core Tools, as described below.

## Step 1 — Verify prerequisites

| Tool | Minimum | Check |
| --- | --- | --- |
| Go | 1.24 | `go version` |
| Azure Functions Core Tools | 4.12 | `func --version` |
| Azure CLI | 2.87.0, only when creating Azure resources or deploying | `az version` |

Core Tools before 4.12 does not ship the `native` worker and rejects Go projects with a misleading "unsupported worker runtime" error. If a prerequisite is missing or too old, stop and suggest **azure-functions-setup**.

## Step 2 — Scaffold with Core Tools (preferred)

```bash
func init <project-name> --worker-runtime go
cd <project-name>
```

Omit the project name to scaffold into the current directory instead of a subdirectory.

This is the supported path and it is what the official documentation describes. It generates a complete, buildable project.

| File | Notes |
| --- | --- |
| `main.go` | Entry point with a registered HTTP function |
| `go.mod`, `go.sum` | Module with the worker dependency already resolved |
| `host.json` | Extension bundle `[4.*, 5.0.0)` and Application Insights sampling |
| `local.settings.json` | `FUNCTIONS_WORKER_RUNTIME`, `FUNCTIONS_CLI_NATIVE_LANGUAGE`, `AzureWebJobsStorage` |
| `.funcignore`, `.gitignore` | Packaging and source control excludes |

Add `--docker` to also generate a `Dockerfile`.

The generated `local.settings.json` looks like this:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "native",
    "FUNCTIONS_CLI_NATIVE_LANGUAGE": "go",
    "AzureWebJobsStorage": ""
  }
}
```

`AzureWebJobsStorage` is intentionally empty for Go. Set it to a storage connection string or `UseDevelopmentStorage=true` only when a trigger needs host storage during local development.

Then edit `main.go` to register the functions the user actually asked for, using the trigger table below.

## Step 3 — Manual scaffold (fallback only)

Use this only when `func init` is unavailable or fails. **Order matters.**

```bash
mkdir <project-name>
cd <project-name>
go mod init <module-name>
go get github.com/azure/azure-functions-golang-worker
```

Write `main.go` **before** running `go mod tidy`. `go mod tidy` removes any requirement that no source file imports, so running it on a module with no Go source strips the worker dependency and the subsequent build fails with `no required module provides package .../sdk`.

```bash
# only after main.go exists
go mod tidy
go build ./...
```

Two more things to get right:

- **Module path casing.** The GitHub repository is `Azure/azure-functions-golang-worker`, but the Go module path is lowercase `github.com/azure/azure-functions-golang-worker`. Go module paths are case sensitive, so the uppercase form does not resolve.
- **Published versions.** Every published version is a preview tag such as `v0.6.0-preview`. A bare `go get` resolves to the newest one, which is fine. Run `go list -m -versions github.com/azure/azure-functions-golang-worker` to see what exists. Do not depend on `main`, and never invent a tag.

You must also hand-write `host.json` and `local.settings.json` to match the shapes shown in step 2.

## Step 4 — Register functions

Go uses worker-driven indexing. Triggers are declared in code with the fluent builder and functional options.

```go
package main

import (
	"fmt"
	"net/http"

	"github.com/azure/azure-functions-golang-worker/sdk"
	"github.com/azure/azure-functions-golang-worker/worker"
)

func main() {
	app := sdk.FunctionApp()

	app.HTTP("hello", hello,
		sdk.WithMethods("GET", "POST"),
		sdk.WithAuth("anonymous"),
	)

	worker.Start(app)
}

func hello(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "world"
	}
	fmt.Fprintf(w, "Hello, %s!", name)
}
```

Rules that differ from every other language:

- **Never author `function.json`.** Worker-driven indexing means the registration options in code are the only source of truth. A `function.json` file does not belong in a Go project.
- **There are no input or output bindings.** Go supports triggers only. If the user wants to write to a queue, blob, or Cosmos DB container, call the Azure SDK for Go directly from the handler.
- `FUNCTIONS_WORKER_RUNTIME` is `native`. It is never `go` or `golang`.
- The extension bundle is still required, because Go is a non-.NET runtime.
- Do not commit `local.settings.json`.

### Trigger reference

Core triggers receive their payload inline over gRPC and need no external SDK.

| Trigger | Registration | Handler signature | Common options |
| --- | --- | --- | --- |
| HTTP | `app.HTTP` | `func(http.ResponseWriter, *http.Request)` | `WithMethods`, `WithAuth`, `WithRoute` |
| Timer | `app.Timer` | `func(context.Context, bindings.TimerInfo) error` | `WithSchedule` |
| Cosmos DB | `app.CosmosDB` | `func(context.Context, []bindings.CosmosDocument) error` | `WithDatabase`, `WithContainer`, `WithConnection`, `WithLeaseContainer` |
| Azure SQL | `app.SQL` | `func(context.Context, []bindings.SQLChange) error` | `WithTable`, `WithConnection`, `WithLeasesTable` |
| Event Grid | `app.EventGrid` | `func(context.Context, bindings.EventGridEvent) error` | none, the registration takes only a name and handler |
| Storage Queue | `app.Queue` | `func(context.Context, bindings.QueueMessage) error` | `WithQueueName`, `WithConnection` |
| Event Hubs | `app.EventHub` | `func(context.Context, bindings.EventHubMessage) error` | `WithEventHubName`, `WithConsumerGroup`, `WithConnection`, `WithCardinality` |
| Service Bus queue | `app.ServiceBusQueue` | `func(context.Context, bindings.ServiceBusMessage) error` | `WithQueueName`, `WithConnection`, `WithIsSessionsEnabled` |
| Service Bus topic | `app.ServiceBusTopic` | `func(context.Context, bindings.ServiceBusMessage) error` | `WithTopicName`, `WithSubscriptionName`, `WithConnection` |

Extension triggers inject an authenticated Azure SDK client instead of raw data, so they support streaming large payloads.

| Trigger | Registration | Handler receives | Common options |
| --- | --- | --- | --- |
| Blob Storage | `app.Blob` | `*blob.Client` | `WithPath`, `WithConnection`, `WithSource` |

An extension trigger must have its package activated with a blank import, otherwise it never registers:

```go
import _ "github.com/azure/azure-functions-golang-worker/triggers/blob"
```

Retries are configured per function with `sdk.WithRetry`.

`WithConnection` applies to the Cosmos DB, Azure SQL, Storage Queue, Event Hubs, Service Bus, and Blob triggers. It does not apply to Event Grid or Timer, so do not add it there. Cosmos DB has a further family of lease options beyond `WithLeaseContainer`, including `WithLeaseDatabase`, `WithLeaseConnection`, and the lease interval settings.

If the user asks for a trigger that is not in these tables, say it is unavailable in the Go worker preview rather than improvising. Check the worker samples at https://github.com/Azure/azure-functions-golang-worker/tree/main/samples before concluding.

**Durable Functions is not supported for Go.** If the user asks for orchestrations, entities, or the `durableClient` binding, explain the gap and offer a supported language or a non-Durable pattern such as queue or Event Hubs chaining.

## Step 5 — Verify

```bash
func start
```

`func start` runs `go build -o bin/app .` itself before starting the host, so a compile error surfaces as a host start failure. Do not prefix it with a separate build step.

On a healthy start the host prints the preview notice, `Building Go worker binary ...`, `Worker process started and initialized.`, and the indexed function list. An empty function list means a registration call is missing, or an extension trigger's package was not blank-imported.

Then perform real end-to-end verification, not just a successful start:

- **HTTP triggers**: send an actual request and check the status code and body, for example `curl "http://localhost:7071/api/hello?name=World"`.
- **Non-HTTP triggers**: load `azure-functions-common/references/local-emulators.md`, and ask before installing or starting any emulator. If the user declines, skip emulator-backed verification and give manual or Azure test steps instead.

A `webjobs.storage` unhealthy warning is expected when `AzureWebJobsStorage` is empty or points at the storage emulator while Azurite is not running. It does not block HTTP triggers, but non-HTTP triggers need a real storage endpoint.

## Adding a function to an existing Go project

`func new` is not supported for Go. Add a function by editing `main.go` directly, registering it with another `app.*` call, and adding the blank import if it is an extension trigger. Do not run `func init` or `go mod init` again, and do not create `function.json`.

## Deployment

Hand off to **azure-functions-deploy**. Two preview constraints matter enough to state during scaffolding: Go function apps are supported only on the **Flex Consumption** plan, and they run on **Linux only** in Azure.
