# Creating a Go Azure Functions project

This file covers Go function apps using the Go worker, not Go custom handlers. For an existing app,
confirm the model from configuration and Go source/modules before using these
templates or registration APIs. Adding a function to a custom handler must preserve
its handler, runtime `custom`, `host.json.customHandler`, and `function.json` metadata;
use **azure-functions-update** only for an explicitly requested migration.

Go support is generally available on Linux Flex Consumption. Linux Elastic Premium
and Dedicated support is a preview rollout; confirm availability for the target
plan, SKU, and region, and obtain acceptance before a production preview deployment.

Primary reference: [Go developer reference for Azure Functions](https://learn.microsoft.com/azure/azure-functions/functions-reference-go).

## Template discovery

Prefer the MCP path in the parent skill: call `functions_language_list`, then
`functions_project_get` with `language: go`, and list/get the returned Go templates
with `functions_template_get`. The catalog includes Go HTTP and timer templates
with AZD/Bicep infrastructure. Discover current IDs rather than inventing them.

Project metadata alone is not a buildable app. Retrieve the selected template's
files and follow its setup instructions; validate Go worker settings, dependencies,
and actual local behavior before reporting creation complete. Template infrastructure
does not mean Azure resources exist or authorize provisioning/deployment.

Use the manifest fallback when MCP retrieval is unavailable or fails, then the
Core Tools scaffold below if no suitable template can be retrieved. Never substitute
another language. Check hosting status against the current Go developer reference;
a catalog's preview label can lag the service. The Go worker's version is not
the Go compiler version.

## Step 1 — Verify prerequisites

| Tool | Minimum | Check |
| --- | --- | --- |
| Go | 1.24 for the core worker; check extension modules for higher requirements | `go version` |
| Azure Functions Core Tools | Flex: 4.12+; Elastic Premium/Dedicated: use 4.16.0+ | `func --version` |
| Azure CLI | 2.87.0, only when creating Azure resources or deploying | `az version` |

Core Tools before 4.12 does not ship the `native` worker and rejects Go projects with a misleading "unsupported worker runtime" error. If a prerequisite is missing or too old, stop and suggest **azure-functions-setup**.

For Elastic Premium/Dedicated, use 4.16.0 or later: its
[release notes](https://github.com/Azure/azure-functions-core-tools/releases/tag/4.16.0)
confirm preview support. This is a verified baseline, not the earliest known
supporting release; do not declare those targets ready with 4.12.

## Step 2 — Scaffold with Core Tools (template fallback)

```bash
func init <project-name> --worker-runtime go
cd <project-name>
```

Omit the project name to scaffold into the current directory instead of a subdirectory.

This supported fallback generates a local project, not Azure resources. Run it
only in an approved empty directory, never over an existing custom-handler app.

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
- **Published versions.** `v1.0.0` is the first GA core-worker release. Select a published compatible tag and record the resolved version. Extension modules can have separate versions and Go requirements. Do not depend on `main`, and never invent a tag.

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

Go programming model rules:

- **Never author `function.json` for apps using the Go worker.** Worker-driven indexing means the registration options in code are the only source of truth. Go custom handlers still require their metadata.
- **General additional input bindings and non-HTTP output bindings are not supported.** The preview Durable middleware's `durabletask.ClientInput()` is a supported exception that registers a `durableClient` input binding. Verify its version/extension requirements below. HTTP responses use `http.ResponseWriter`. Other service I/O uses the Azure SDK for Go.
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

Event Hubs and Service Bus support batch handlers through `app.EventHubBatch`,
`app.ServiceBusQueueBatch`, and `app.ServiceBusTopicBatch`, taking slices of the
corresponding message type. Match handler shape and cardinality.

For other triggers, check the selected worker release and samples at
https://github.com/Azure/azure-functions-golang-worker/tree/main/samples before
concluding support. Do not invent registration APIs.

Durable orchestrations and activities are in preview through `middleware/durabletask`,
requiring Go 1.25+ and Durable Task extension 3.15.0+. Entities are not supported.
Consult that module's documentation when requested; do not generate legacy Durable
`function.json` bindings or add Durable implicitly.

## Step 5 — Verify

```bash
func start
```

`func start` builds for the local OS before starting the host: `bin\app.exe` on
Windows, or `bin/app` on Linux/macOS. A compile error surfaces as a host start
failure. Do not prefix it with a separate build step. Windows local development
does not imply Windows hosting support in Azure; deployment packaging targets Linux.

On a healthy start, verify worker initialization and the expected indexed function
list. Exact log text can vary by version. An empty list can indicate missing
registration or a missing extension-trigger blank import.

Then perform real end-to-end verification, not just a successful start:

- **HTTP triggers**: send an actual request and check the status code and body, for example `curl "http://localhost:7071/api/hello?name=World"`.
- **Non-HTTP triggers**: load `azure-functions-common/references/local-emulators.md`, and ask before installing or starting any emulator. If the user declines, skip emulator-backed verification and give manual or Azure test steps instead.

A `webjobs.storage` unhealthy warning is expected when `AzureWebJobsStorage` is empty or points at the storage emulator while Azurite is not running. It does not block HTTP triggers, but non-HTTP triggers need a real storage endpoint.

## Adding a function to an existing Go function project

Confirm use of the Go worker from configuration and Go source/modules first. If the app is
a Go custom handler, extend its existing handler and `function.json` instead;
do not introduce `app.*` registrations or change its runtime as part of adding a function.

Use an MCP template with `output: Add` when a suitable template is available, merging
only the needed function pattern, dependencies, and settings. Otherwise use the
verified worker APIs above. Register the function with another `app.*` call and add
the blank import for an extension trigger. `func new` is not supported for Go.
Do not run `func init` or `go mod init` again, replace existing infrastructure,
or create `function.json`.

## Deployment

Hand off to **azure-functions-deploy**. Go runs on Linux: Flex Consumption is GA;
Elastic Premium and Dedicated require confirmed preview availability for the target.
