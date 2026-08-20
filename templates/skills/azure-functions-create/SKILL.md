---
name: azure-functions-create
title: Create or Extend Azure Functions App
description: Scaffold a new Azure Functions project, or add a new function/trigger to an existing project without re-initializing it
category: task
---

> **Language**: Always respond in the same language the user is using.

# azure-functions-create — Create or Extend Azure Functions App

Guide the user through creating a new Azure Functions project or adding a function to an existing Azure Functions project.

## Prerequisites

Ensure `func` (Azure Functions Core Tools v4) is installed. If not, suggest running **azure-functions-setup** first.

Template discovery and application use the manifest-backed CLI released in
`@azure/functions-skills@0.0.6-preview`. Invoke it with:

```bash
npx -y @azure/functions-skills@0.0.6-preview
```

## Workflow

### Step 0 — Check for Go

If the user asks for **Go** (or Golang), use **Path C** below. Neither the Azure MCP template set nor the templates manifest contains Go templates, so the other paths cannot produce a working Go project.

For every other language, continue with Step 1.

### Step 1 — Gather requirements and best practices

Check for the best practices tool:

- `get_azure_bestpractices` / `get_azure_bestpractices_get` with `resource: azurefunctions`

If available, call it before generating code:

```text
Tool: get_azure_bestpractices
resource: azurefunctions
action: code-generation
```

Apply the returned guidelines (programming models, extension bundles version, authentication levels, project structure, etc.) to every file you generate in the steps below.

Ask the user (or detect from context):

- **Language**: `csharp` | `python` | `typescript` | `javascript` | `java` | `powershell`
- **Trigger / template**: let the CLI list decide (Path A.1)
- **Project name**: directory name
- **Runtime version** (optional): e.g. Node.js `22`, Python `3.11`, Java `21`

Resolve the target directory to an absolute path. Pass it with `--dir` on every apply command so files never land in the wrong workspace.

---

### Path A — Manifest-backed CLI (recommended)

The Azure Functions Skills CLI writes official templates directly to disk. This keeps template source files out of the LLM transcript. Do **not** call `functions_template_get`, fetch repository trees, download raw template files, or reproduce template contents manually while this path works.

#### A.1 Browse available templates

List matching template metadata:

```bash
npx -y @azure/functions-skills@0.0.6-preview template list --language <language>
```

Add `--resource <resource>` or `--iac <iac>` when the user supplied those constraints. Use `--json` only when structured metadata is needed for filtering; the default text list consumes fewer tokens. Neither format contains the full template payload. Use the result to confirm language support, available runtime choices, and the exact template ID. Present relevant matches and let the user choose when intent is ambiguous.

Do **not** invent or guess template identifiers such as `HttpTrigger`. Template IDs are versioned, language-specific strings returned by `template list`. For example, the TypeScript HTTP trigger template is currently returned as `http-trigger-typescript-azd`.

When the user asks for a common trigger name, map it to one of the IDs returned by the list. Examples:

| User intent | Language | Prefer a returned template ID like |
| --- | --- | --- |
| HTTP trigger | `typescript` | `http-trigger-typescript-azd` |
| Timer trigger | `typescript` | `timer-trigger-typescript-azd` |
| Blob trigger | `typescript` | `blob-eventgrid-trigger-typescript-azd` |
| Queue / Service Bus trigger | `typescript` | `servicebus-trigger-typescript-azd` |

If apply reports "template not found", immediately run `template list` again with the same language and filters, then select the closest returned ID instead of retrying a guessed alias.

#### A.2 Apply a new project

For a new project, apply the chosen template directly into the absolute target directory:

```bash
npx -y @azure/functions-skills@0.0.6-preview template apply --language <language> --template <returned-template-id> --mode new --dir <absolute-target-directory>
```

When the user selected a runtime version, also pass `--runtime-version <version>`. Do not add `--force` unless the user explicitly approves overwriting conflicts.

The command downloads and writes the template locally, performs runtime placeholder substitution, and prints only a concise file summary. Do not read every generated file back into the conversation. Inspect only files needed for user-requested customization or verification.

Tailor the generated project to the user's requested trigger and business logic. Remove unrelated demo functions or sample data that the selected repository template included.

#### A.3 Add to an existing project

When `host.json` already exists, apply the selected template in add mode:

```bash
npx -y @azure/functions-skills@0.0.6-preview template apply --language <language> --template <returned-template-id> --mode add --dir <absolute-existing-project-directory>
```

Add `--runtime-version <version>` when selected. Add mode preserves root project files and existing conflicts by default. Never use `--force` without explicit confirmation.

Review the concise apply summary. When dependency or settings files such as `package.json`, `requirements.txt`, or `local.settings.json` are skipped, apply the same template with `--mode new` into an isolated temporary directory. Compare only the skipped dependency/settings files, merge required entries into the existing project, then delete the temporary directory. This keeps template source local while ensuring the added trigger has every required package and setting.

Keep only the requested function and its supporting code. Remove repository-level documentation, licenses, changelogs, and unrelated demo files that the apply summary shows as newly added to the existing project; never remove files that existed before the command.

If the CLI rejects a nested full-project template in add mode, run `template list` again and choose an add-compatible template. If none exists, use Path B rather than forcing or reinitializing the project.

#### A.4 Install dependencies and verify

Run the appropriate dependency restore in the target directory (`npm install`, `pip install -r requirements.txt`, `dotnet restore`, or `mvn package` as applicable). Generate lock files through the package manager rather than asking the model to recreate them.

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

Use this path only after the CLI command produces an actual error and retrying discovery cannot resolve it. Do not treat a long-running download as failure without waiting for the command result.

When falling back, show this notice to the user verbatim (translate to the user's language if needed):

> ℹ️ The manifest-backed template CLI could not complete, so I am using a higher-token fallback path. I will keep template content handling local where possible.

#### B.1 Fallback algorithm

Prefer the first available fallback:

1. If Azure MCP `functions_template_get` is available, use it only for the selected template after CLI failure. Write returned files directly and avoid echoing their contents in the final response.
2. Otherwise fetch the public manifest, select the exact entry, and download its repository/folder locally with a ZIP download or shallow clone.
3. For a new project, use the selected template as the base. For an existing project, copy only the required function/binding files and merge dependencies/settings without replacing user-owned files.
4. For requests that combine multiple triggers or bindings, use one project template as the base, extract only the additional binding patterns, and merge required IaC resources, RBAC roles, app settings, and dependencies.
5. If all sources fail, report the exact errors and ask the user to retry later.

Do not deploy automatically as part of creation. Deployment remains the responsibility of **azure-functions-deploy**.

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

Go is not represented in the Azure MCP template set or in the templates manifest, so there is nothing to discover. Go also has its own scaffolding command, its own worker runtime value, and preview constraints that apply to no other language.

Load [references/go-project.md](references/go-project.md) and follow it. Do not improvise a Go project from Path A or Path B.

Tell the user up front that **Go support on Azure Functions is in public preview** and may change before GA.

---

### Adding functions to existing projects

If `host.json` already exists, do **not** re-initialize. Instead:

- **CLI path**: run `template list` for the existing language, then `template apply` with the exact returned ID, `--mode add`, and the absolute project directory.
- **Fallback path**: only after an actual CLI error, retrieve the selected template through Azure MCP or the manifest and merge function files, dependencies, and settings without replacing user-owned files.
- **Go path**: `func new` is not supported for Go. Edit `main.go`, add another `app.*` registration and, for an extension trigger, the blank import. Do not run `func init` or `go mod init` again, and do not create `function.json`. See [references/go-project.md](references/go-project.md).

## After Creation

> ✅ Your project is scaffolded! Next: use **azure-functions-deploy** to deploy to Azure.

## Next steps

- On success, suggest `azure-functions-deploy` because the project is ready to deploy to Azure.
- On failure, suggest `azure-functions-setup` to verify local tooling and prerequisites.
