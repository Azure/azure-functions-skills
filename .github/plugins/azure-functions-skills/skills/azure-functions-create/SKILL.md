---
name: azure-functions-create
description: "Scaffold a new Azure Functions project, or add a new function/trigger to an existing project without re-initializing it"
---


> **Language**: Always respond in the same language the user is using.

# azure-functions-create — Create or Extend Azure Functions App

Guide the user through creating a new Azure Functions project or adding a function to an existing Azure Functions project.

## Prerequisites

Ensure `func` (Azure Functions Core Tools v4) is installed. If not, suggest running **azure-functions-setup** first.

## Workflow

### Step 0 — Check for Go

If the user asks for **Go** (or Golang), go straight to **Path C (Go)**. Neither the Azure MCP template set nor the templates manifest contains Go templates. Do not call `functions_template_get` with a Go language value, do not invent a Go template ID, and do not silently scaffold a different language instead.

For every other language, continue with Step 1.

### Step 1 — Detect Azure MCP tools

Check whether the following Azure MCP tools are available in your current tool list:

- `functions_language_list` — list supported languages and runtime versions
- `functions_project_get` — scaffold project-level files
- `functions_template_get` — list templates (language only) or get a specific template (language + template)

These are provided by the [Azure MCP Server](https://learn.microsoft.com/azure/developer/azure-mcp-server/tools/azure-functions) (`@azure/mcp`) and return officially maintained templates across C#, Python, TypeScript, JavaScript, Java and PowerShell.

Also check for the best practices tool:

- `get_azure_bestpractices` / `get_azure_bestpractices_get` with `resource: azurefunctions`

- **If available** → proceed with **Path A (MCP primary)**.
- **If not available** → proceed with **Path B (composition algorithm fallback)**.

---

### Path A — MCP primary (recommended)

Use the Azure MCP Server as the **authoritative source of truth** for Azure Functions templates. Do **not** write function code from scratch when these tools are available.

#### A.1 Gather requirements & best practices

If `get_azure_bestpractices` is available, call it first:

```
Tool: get_azure_bestpractices
resource: azurefunctions
action: code-generation
```

Apply the returned guidelines (programming models, extension bundles version, authentication levels, project structure, etc.) to every file you generate in the steps below.

Ask the user (or detect from context):

- **Language**: `csharp` | `python` | `typescript` | `javascript` | `java` | `powershell` — for Go, use **Path C** instead
- **Trigger / template**: let the MCP list decide (step A.3)
- **Project name**: directory name
- **Runtime version** (optional): e.g. Node.js `22`, Python `3.11`, Java `21`

#### A.2 Discover supported languages

Call `functions_language_list`. Returns supported languages with runtime versions, programming models, and prerequisites. Use this to confirm the user's language choice is supported and to suggest a default runtime version.

#### A.3 Browse available templates

Call `functions_template_get` with only the `language` parameter (omit `template`). This returns the list of available templates for the chosen language with descriptions. Present the templates to the user and let them pick.

Do **not** invent or guess template identifiers such as `HttpTrigger`. Azure MCP template IDs are versioned, language-specific strings returned by the template list. For example, the TypeScript HTTP trigger template is currently returned as `http-trigger-typescript-azd`.

When the user asks for a common trigger name, map it to one of the template IDs returned by the MCP list before calling the template-get operation. Examples:

| User intent | Language | Prefer a returned template ID like |
| --- | --- | --- |
| HTTP trigger | `typescript` | `http-trigger-typescript-azd` |
| Timer trigger | `typescript` | `timer-trigger-typescript-azd` |
| Blob trigger | `typescript` | `blob-eventgrid-trigger-typescript-azd` |
| Queue / Service Bus trigger | `typescript` | `servicebus-trigger-typescript-azd` |

If a template-get call fails with "template not found", immediately recover by calling `functions_template_get` again with only `language`, then select the closest returned template ID instead of retrying the failed alias.

#### A.4 Initialize the project

Call `functions_project_get`:

```
Tool: functions_project_get
language: <chosen language, e.g. typescript>
```

Returns project-level files (`host.json`, `local.settings.json`, `package.json` / `requirements.txt` / `pom.xml` / `.csproj`, `tsconfig.json`, etc.). Write these into the target directory.

#### A.5 Add the function

Call `functions_template_get` with both `language` and `template`:

```
Tool: functions_template_get
language: <chosen language, e.g. typescript>
template: <chosen returned template ID, e.g. http-trigger-typescript-azd>
runtime-version: <optional, e.g. 22>
output: <optional, "New" (default) or "Add" for existing projects>
```

Returns the full function source code plus any required app settings and additional package dependencies. Write the returned file(s) into the project and merge any extra settings into `local.settings.json` and any extra packages into the dependency manifest.

> ⚠️ **Large template output**: Some templates (especially `*-azd` variants that include infrastructure files) can produce very large output (100KB+). If the tool output is truncated or saved to a temporary file, read the file, parse the JSON `files` array, and write each file individually. After writing files, run `npm install` (or the equivalent package manager command) to generate lock files rather than relying on lock files from the template output.

#### A.6 Verify

For TypeScript and other compiled-language projects, build first:

```bash
npm run build   # TypeScript / JavaScript
# dotnet build  # C#
# mvn package   # Java
```

Then perform an end-to-end local verification, not just a host start:

```bash
func start
```

After the host reports the function endpoints/listeners:

- **HTTP triggers**: send an actual request to the local endpoint and verify the status code and response body, for example `curl http://localhost:7071/api/<FunctionName>?name=World`.
- **Timer triggers**: verify the listener starts and, when practical, temporarily use a short development-only schedule or manual invocation approach; restore the user's intended schedule before finishing.
- **Storage, Cosmos DB, SQL, Redis, Dapr, or other service-backed triggers/bindings**: load `azure-functions-common/references/local-emulators.md`, identify the required local emulator or development service, and run a realistic message/blob/document/event through the trigger when the user wants E2E verification.
- **Before installing or starting any emulator/local service**: ask the user for confirmation. If the user says the emulator is not needed, unavailable, or should be skipped, do not install it; record that emulator-backed E2E was skipped and provide manual/Azure test steps instead.
- **When no practical local emulator exists**: explain the limitation, suggest a temporary Azure dev resource or deployment-based test, and keep the local verification to build + host/listener startup.

---

### Path B — Composition algorithm fallback

Use this path **only when the Azure MCP tools are not available**. When falling back, show this notice to the user verbatim (translate to the user's language if needed):

> ℹ️ Azure MCP tools were not found; using the manifest-based fallback path. Enabling the Azure MCP Server unlocks dynamic template discovery and composition. Run `azure-functions-setup` to configure it.

#### B.1 Fallback algorithm

Follow this manifest-based fallback algorithm:

```
1. FETCH MANIFEST
   GET https://cdn.functions.azure.com/public/templates-manifest/manifest.json
   If fetch fails → fall back to:
     https://github.com/Azure/azure-functions-templates/blob/dev/Functions.Templates/Template-Manifest/manifest.json
   If both fail → fall back to known-good Azure-Samples/functions-quickstart-* repos
   If all fail → report error and ask user to retry later

2. FILTER TEMPLATES
   Filter by: language, resource, iac

3. CHECK SINGLE-TEMPLATE MATCH
   If one template covers ALL requirements → use it alone

4. SELECT TEMPLATES
   - Trigger template (REQUIRED) — base project with IaC
   - Binding templates (OPTIONAL) — extract patterns only

5. DOWNLOAD TEMPLATES
   For each template:
   - If folderPath == "." → ZIP download + unzip
   - If folderPath != "." → fetch tree + raw github url file downloads
   - Fallback: git clone --depth 1

6. COMPOSE
   - Use trigger template as BASE
   - EXTRACT binding patterns from binding templates
   - MERGE IaC resources, RBAC roles and settings
   - ADD user's custom business logic

7. TRIM unused demo code (keep AzureWebJobsStorage)

8. WRITE all files

9. DEPLOY: azd up --no-prompt
```

#### B.2 Quick code reference

For minimal HTTP trigger snippets per language (last-resort fallback when the manifest is also unavailable), see [references/language-snippets.md](references/language-snippets.md).

#### B.3 Verify

Build compiled projects first, then perform the same local E2E verification standard used in Path A:

```bash
func start
```

- For HTTP triggers, send a real request to the local endpoint and validate the response.
- For non-HTTP triggers, consult `azure-functions-common/references/local-emulators.md` and use an emulator/local service when practical.
- Ask before installing or starting emulators. If the user declines, skip emulator-backed E2E and document the skipped verification plus manual/Azure test steps.

---

### Path C — Go (preview)

Use this path for every Go request, whether or not the Azure MCP tools are available. Go is not represented in the Azure MCP template set or in the templates manifest, so there is nothing to discover — scaffold directly from the Go worker SDK.

Tell the user up front that **Go support on Azure Functions is in public preview** and may change before GA.

Load `azure-functions-common/references/languages/go.md` for background before writing files.

#### C.1 Verify prerequisites

- Go 1.24 or later — `go version`
- Azure Functions Core Tools **4.12.0 or later** — `func --version`

Core Tools before 4.12.0 does not ship the `native` worker and rejects Go projects with a misleading "unsupported worker runtime" error. If either prerequisite is missing or too old, stop and suggest **azure-functions-setup**.

#### C.2 Initialize the module

```bash
mkdir <project-name>
cd <project-name>
go mod init <module-name>
go get github.com/azure/azure-functions-golang-worker@<tag>
go mod tidy
```
Two things to get right:

- **Module path casing.** The GitHub repository is `Azure/azure-functions-golang-worker`, but the Go module path is lowercase `github.com/azure/azure-functions-golang-worker`. Go module paths are case-sensitive; the uppercase form will not resolve.
- **Pin a published tag.** Every published version is currently a preview tag (`vX.Y.Z-preview`); there is no stable release yet. Because they are all prereleases, a bare `go get` resolves to the newest preview, which is acceptable, but record the resolved version in `go.mod` and upgrade deliberately. Check https://github.com/Azure/azure-functions-golang-worker/releases or run `go list -m -versions github.com/azure/azure-functions-golang-worker` to see what exists. Do not depend on `main` — it is an active development branch. Never invent a tag; if you cannot list versions, let `go get` resolve and report the version it chose.

#### C.3 Write the project files

`main.go` — register functions in code and start the worker:

```go
package main

import (
	"fmt"
	"net/http"

	"github.com/azure/azure-functions-golang-worker/sdk"
	"github.com/azure/azure-functions-golang-worker/worker"
)

func hello(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "world"
	}
	fmt.Fprintf(w, "Hello, %s!", name)
}

func main() {
	app := sdk.FunctionApp()

	app.HTTP("hello", hello,
		sdk.WithMethods("GET", "POST"),
		sdk.WithAuth("function"),
	)

	worker.Start(app)
}
```

`host.json`:

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

`local.settings.json`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "native"
  }
}
```

Rules that differ from other languages:

- `FUNCTIONS_WORKER_RUNTIME` is **`native`**, not `go` or `golang`. This is the single most common mistake in Go projects.
- **Never author `function.json`.** The Go worker uses worker-driven indexing — triggers and bindings come from the registration options in code. A `function.json` file conflicts with indexing.
- The extension bundle is still required. Go is a non-.NET runtime, so non-HTTP triggers resolve their extensions through the bundle.
- Do not add `local.settings.json` to source control; make sure `.gitignore` covers it.

#### C.4 Trigger reference

Register triggers with the matching `app.*` method:

| Trigger | Registration | Tier |
| --- | --- | --- |
| HTTP | `app.HTTP(name, handler, ...)` | Core |
| Timer | `app.Timer(name, handler, ...)` | Core |
| Cosmos DB | `app.CosmosDB(name, handler, ...)` | Core |
| SQL | `app.SQL(name, handler, ...)` | Core |
| Event Grid | `app.EventGrid(name, handler, ...)` | Core |
| Storage Queue | `app.Queue(name, handler, ...)` | Core |
| Event Hubs | `app.EventHub(name, handler, ...)` | Core |
| Service Bus queue | `app.ServiceBusQueue(name, handler, ...)` | Core |
| Service Bus topic | `app.ServiceBusTopic(name, handler, ...)` | Core |
| Blob | `app.Blob(name, handler, ...)` | Extension — requires a blank import |

Extension triggers need their package activated with a blank import, for example:

```go
import _ "github.com/azure/azure-functions-golang-worker/triggers/blob"
```

Omitting the blank import is the usual cause of a trigger that never registers.

If the user asks for a trigger that is not in this table, say it is not available in the Go worker preview rather than improvising a binding. Check the worker samples at https://github.com/Azure/azure-functions-golang-worker/tree/main/samples before concluding.

**Durable Functions is not available for Go.** If the user asks for orchestrations, entities, or the `durableClient` binding, explain the gap and offer a supported language or a non-Durable pattern.

#### C.5 Verify

```bash
go build ./...
func start
```

`func start` compiles the Go application into `bin/app` (`bin\app.exe` on Windows) before starting the host, so a build error surfaces as a host start failure. Build first so the two failure modes stay distinguishable.

On a healthy start the host prints the preview notice, `Building Go worker binary ...`, `Worker process started and initialized.`, and the indexed function list. If the function list is empty, the registration call is missing or the trigger's extension package was not blank-imported.

Then perform real end-to-end verification, using the same standard as Path A:

- **HTTP triggers**: send an actual request and check the status code and body, for example `curl "http://localhost:7071/api/hello?name=World"`.
- **Non-HTTP triggers**: load `azure-functions-common/references/local-emulators.md`, and ask before installing or starting any emulator. If the user declines, skip emulator-backed E2E and give manual/Azure test steps instead.

A `webjobs.storage` unhealthy warning is expected when `AzureWebJobsStorage` points at the development storage emulator and Azurite is not running. It does not block HTTP triggers, but non-HTTP triggers need a real storage endpoint.

---

### Adding functions to existing projects

If `host.json` already exists, do **not** re-initialize. Instead:

- **MCP path**: call `functions_template_get` with the same language as the existing project and specify the desired template name. Write the returned file.
- **Fallback path**: fetch the manifest, filter for the desired template by language and resource, download the template source, and merge the function files into the existing project.
- **Go path**: add another `app.*` registration in the existing project and, for an extension trigger, add the blank import. Do not run `go mod init` again and do not create `function.json`.

## After Creation

> ✅ Your project is scaffolded! Next: use **azure-functions-deploy** to deploy to Azure.

## Next steps

- On success, suggest `azure-functions-deploy` because the project is ready to deploy to Azure.
- On failure, suggest `azure-functions-setup` to verify local tooling and prerequisites.