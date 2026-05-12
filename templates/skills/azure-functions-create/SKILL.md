---
name: azure-functions-create
title: Create Azure Functions App
description: Scaffold a new Azure Functions project with language and template selection
category: task
---

> **Language**: Always respond in the same language the user is using.

# azure-functions-create — Create Azure Functions App

Guide the user through creating a new Azure Functions project.

## Prerequisites

Ensure `func` (Azure Functions Core Tools v4) is installed. If not, suggest running **azure-functions-setup** first.

## Workflow

### Step 1 — Detect Azure MCP tools

Check whether the following Azure MCP tools are available in your current tool list:

- `functions language list`
- `functions project get`
- `functions list or get template`

These are provided by the [Azure MCP Server](https://learn.microsoft.com/azure/developer/azure-mcp-server/tools/azure-functions) (`@azure/mcp`) and return officially maintained templates across C#, Python, TypeScript, JavaScript, Java and PowerShell.

Also check for the best practices tool:

- `get_azure_bestpractices` with `resource: azurefunctions`

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

Call `functions language list`. Returns supported languages with runtime versions, programming models, and prerequisites. Use this to confirm the user's language choice is supported and to suggest a default runtime version.

#### A.3 Browse available templates

Call `functions list or get template` with only the `language` parameter (omit `template`). This returns the list of available templates for the chosen language with descriptions. Present the templates to the user and let them pick.

Do **not** invent or guess template identifiers such as `HttpTrigger`. Azure MCP template IDs are versioned, language-specific strings returned by the template list. For example, the TypeScript HTTP trigger template is currently returned as `http-trigger-typescript-azd`.

When the user asks for a common trigger name, map it to one of the template IDs returned by the MCP list before calling the template-get operation. Examples:

| User intent | Language | Prefer a returned template ID like |
| --- | --- | --- |
| HTTP trigger | `typescript` | `http-trigger-typescript-azd` |
| Timer trigger | `typescript` | `timer-trigger-typescript-azd` |
| Blob trigger | `typescript` | `blob-eventgrid-trigger-typescript-azd` |
| Queue / Service Bus trigger | `typescript` | `servicebus-trigger-typescript-azd` |

If a template-get call fails with "template not found", immediately recover by calling `functions list or get template` again with only `language`, then select the closest returned template ID instead of retrying the failed alias.

#### A.4 Initialize the project

Call `functions project get`:

```
Tool: functions project get
language: <chosen language, e.g. typescript>
```

Returns project-level files (`host.json`, `local.settings.json`, `package.json` / `requirements.txt` / `pom.xml` / `.csproj`, `tsconfig.json`, etc.). Write these into the target directory.

#### A.5 Add the function

Call `functions list or get template` with both `language` and `template`:

```
Tool: functions list or get template
language: <chosen language, e.g. typescript>
template: <chosen returned template ID, e.g. http-trigger-typescript-azd>
runtime-version: <optional, e.g. 22>
output: <optional, "New" (default) or "Add" for existing projects>
```

Returns the full function source code plus any required app settings and additional package dependencies. Write the returned file(s) into the project and merge any extra settings into `local.settings.json` and any extra packages into the dependency manifest.

#### A.6 Verify

```bash
func start
```

Then invoke the function (for HTTP triggers: `curl http://localhost:7071/api/<FunctionName>`).

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

```bash
func start
```

---

### Adding functions to existing projects

If `host.json` already exists, do **not** re-initialize. Instead:

- **MCP path**: call `functions list or get template` with the same language as the existing project and specify the desired template name. Write the returned file.
- **Fallback path**: fetch the manifest, filter for the desired template by language and resource, download the template source, and merge the function files into the existing project.

## After Creation

> ✅ Your project is scaffolded! Next: use **azure-functions-deploy** to deploy to Azure.

## Next steps

- On success, suggest `azure-functions-deploy` because the project is ready to deploy to Azure.
- On failure, suggest `azure-functions-setup` to verify local tooling and prerequisites.
