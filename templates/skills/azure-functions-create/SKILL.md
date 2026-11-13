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

## Workflow

### The template tool

A bundled script lists templates and writes their files in one call, so you do not copy file contents by hand. `<skill-dir>` is the folder that contains this `SKILL.md`.

```text
node "<skill-dir>/../azure-functions-common/scripts/functions-tools.mjs" template <command> [options]
```

| Command | What it does |
| --- | --- |
| `template find --language <name> [--resource <name>] [--iac <name>]` | Lists template IDs from the Azure Functions template manifest. |
| `template write --template <id> --dir <target>` | Downloads the template from its GitHub repository and writes it into `<target>`. |
| `template write --from <file> --dir <target>` | Writes the files from a saved Azure MCP template result. |

Each run prints one JSON object. Read `ok`, `summary`, `data`, `findings`, and `next`. The tool never overwrites an existing file; it lists such files in `data.skipped`. Add `--dry-run` to see the file list without writing.

| Exit code | What to do |
| --- | --- |
| 0 | Follow the JSON. `ok: false` means it found a problem. |
| 2 | Fix the arguments and run once more. |
| 3 | Apply `findings[].fix`. For `TEMPLATE-UNSAFE-PATH`, stop and tell the user. |
| 1 | Write the files by hand as described in each path. Do not run the same command again. |

If `node` is missing or the tool file does not exist, write the files by hand as described in each path. Do not install Node or download the tool.

### Step 0 — Check for Go

If the user asks for **Go** (or Golang), use **Path C** below. Neither the Azure MCP template set nor the templates manifest contains Go templates, so the other paths cannot produce a working Go project.

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

- **Language**: `csharp` | `python` | `typescript` | `javascript` | `java` | `powershell`
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

#### A.4 Write the project

For a new project, write the chosen template with the tool. Use the template ID from step A.3 unchanged.

```text
node "<tool>" template write --template <template-id> --dir "<project-dir>" [--runtime-version <version>]
```

The `*-azd` templates are complete projects. They include `host.json`, the dependency manifest, the function source, `azure.yaml`, and `infra/`, so `azure-functions-deploy` can deploy the result without more setup.

Report `data.written` to the user as a count and the main files, not as a full list. Then install dependencies (`npm install`, or the equivalent for the language) to create the lock file for this machine.

**Fallback when the tool cannot run or reports `TEMPLATE-FETCH-FAILED` twice**: call `functions_project_get` with the language, then `functions_template_get` with the language and the template ID.

```
Tool: functions_template_get
language: <chosen language, e.g. typescript>
template: <chosen returned template ID, e.g. http-trigger-typescript-azd>
runtime-version: <optional, e.g. 22>
output: <optional, "New" (default) or "Add" for existing projects>
```

If the host saved the result to a file, pass that file to the tool instead of copying its contents:

```text
node "<tool>" template write --from "<saved-result.json>" --dir "<project-dir>"
```

Otherwise write each returned file into the project, and merge any extra settings into `local.settings.json` and any extra packages into the dependency manifest.

#### A.5 Apply merge instructions

When `data.mergeInstructions` or `data.skipped` is present, the tool left existing files alone. Read the instructions and the skipped files, then merge the needed settings and dependencies by hand. Do not delete or replace the user's files.

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

1. **Find templates.** The tool reads the manifest from the Azure Functions CDN and falls back to the copy on GitHub.

   ```text
   node "<tool>" template find --language <language> [--resource <resource>] [--iac bicep]
   ```

   Present `data.templates` and let the user choose. If one template covers all requirements, use it alone.

2. **Write the trigger template.** It is the base project and includes the infrastructure files.

   ```text
   node "<tool>" template write --template <template-id> --dir "<project-dir>"
   ```

3. **Compose (your work).** When the user also needs bindings from another template, write that template into a separate temporary folder with `template write`, read the binding pattern from it, and add the pattern to the base project. Merge its infrastructure resources, role assignments, and settings. Add the user's business logic.

4. **Trim (your work).** Remove demo code the user does not need. Keep `AzureWebJobsStorage`.

5. **Deploy.** Do not deploy from this skill. Suggest `azure-functions-deploy`.

If the tool cannot run, do steps 1 and 2 by hand: fetch `https://cdn.functions.azure.com/public/templates-manifest/manifest.json`, filter by language, resource, and IaC, and download the files under the template's `repositoryUrl`, `folderPath`, and `gitRef`. If the manifest is also unavailable, use B.2.

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

- **MCP path**: call `functions_template_get` with the same language as the existing project, the desired template ID, and `output: "Add"`. If the host saved the result to a file, run `template write --from <file> --dir <project-dir>`; otherwise write the returned function files by hand. Then follow A.5.
- **Fallback path**: run `template write --template <template-id> --dir <temporary-folder>` to get the template source in a separate folder, then copy the function files into the existing project and merge the settings and dependencies by hand.
- Do not run `template write --template` directly on an existing project with a full-project template. The tool refuses it (`TEMPLATE-NEEDS-NEW-FOLDER`), because such a template would bring a second project layout.
- **Go path**: `func new` is not supported for Go. Edit `main.go`, add another `app.*` registration and, for an extension trigger, the blank import. Do not run `func init` or `go mod init` again, and do not create `function.json`. See [references/go-project.md](references/go-project.md).

## After Creation

> ✅ Your project is scaffolded! Next: use **azure-functions-deploy** to deploy to Azure.

## Next steps

- On success, suggest `azure-functions-deploy` because the project is ready to deploy to Azure.
- On failure, suggest `azure-functions-setup` to verify local tooling and prerequisites.
