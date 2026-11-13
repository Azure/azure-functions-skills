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

Start from the official template that is closest to the goal, write it at once, and change only what differs. Writing a template takes seconds; writing a project from scratch takes minutes and misses the infrastructure.

### The tool

A bundled script picks, writes, and checks templates, so you do not copy file contents by hand. `<skill-dir>` is the folder that contains this `SKILL.md`.

```text
node "<skill-dir>/../azure-functions-common/scripts/functions-tools.mjs" <command> [options]
```

| Command | What it does |
| --- | --- |
| `template write --language <name> --resource <name> --dir <target>` | Picks the manifest's recommended template for the language and trigger, downloads it, and writes it. `data.selection.alternatives` lists the next-closest templates. |
| `template write --template <id> --dir <target>` | Writes one named template. |
| `template write ... --dir <project> --stage` | Writes the template into `<project>/.azure-functions-skills/templates/<id>` instead, so you can copy one function into an existing project. |
| `template write --from <file> --dir <target>` | Writes the files from a saved Azure MCP template result. |
| `template find --language <name> [--resource <name>] [--iac <name>]` | Lists templates. Use it only when the user wants to browse. |
| `local verify --dir <project> [--start-azurite]` | Installs dependencies, starts the host, waits until it is running, and calls one HTTP function. |

Resources in the manifest: `http`, `timer`, `blob`, `eventhub`, `servicebus`, `cosmos`, `sql`, `durable`, `MCP`, `connector`. Languages: `python`, `typescript`, `javascript`, `csharp`, `java`, `powershell`.

Each run prints one JSON object. Read `ok`, `summary`, `data`, `findings`, and `next`. The tool never overwrites an existing file; it lists such files in `data.skipped`. Add `--dry-run` to see the file list without writing.

| Exit code | What to do |
| --- | --- |
| 0 | Follow the JSON. `ok: false` means it found a problem. |
| 2 | Fix the arguments and run once more. |
| 3 | Apply `findings[].fix`. For `TEMPLATE-UNSAFE-PATH`, stop and tell the user. |
| 4 | A step failed. Read `findings` and the step output, fix the cause, then run once more. |
| 1 | Write the files by hand as described in Path B. Do not run the same command again. |

If `node` is missing or the tool file does not exist, use Path B. Do not install Node or download the tool.

### Step 0 — Go

If the user asks for **Go** (or Golang), use **Path C**. The templates manifest and the Azure MCP template set have no Go templates.

### Step 1 — Ask only what is missing

You need two facts: the **language** and the **trigger** (the resource that starts the function). Take them from the request or the workspace. When one is missing, ask one short question for it and offer the likely choices. Do not ask about anything else before writing the template: the folder name, the runtime version, and the business logic can follow.

Map the request to a resource: a web API, webhook, or endpoint is `http`; a schedule is `timer`; a file upload is `blob`; a message queue is `servicebus` (use the Azure Storage queue pattern only when the user names Storage queues); a stream is `eventhub`; a database change is `cosmos` or `sql`; a long-running workflow is `durable`; a tool for an AI agent is `MCP`.

### Step 2 — Write the closest template now

For a new project, write the recommended template into the target folder:

```text
node "<tool>" template write --language <language> --resource <resource> --dir "<project-dir>"
```

- The template is a complete project: `host.json`, the dependency manifest, function source, `azure.yaml`, and `infra/`. `azure-functions-deploy` can deploy it unchanged.
- Report the template id and the number of files written, not the whole file list.
- When the user needs a binding that another template shows (for example an HTTP API that writes to Cosmos DB), write the template for the **trigger** as the base. Then write the other template with `--stage` and copy only the binding code, its settings, and its infrastructure resources and role assignments into the base.
- On `TEMPLATE-NONE-MATCH`, read `findings[].detail` for the resources that exist for the language and pick the closest one.
- On `TEMPLATE-FETCH-FAILED`, run the same command once more, then use the Azure MCP fallback below.

### Step 3 — Change only what differs

Edit the template toward the request: rename the function, change the route, schedule, or binding names, and add the user's business logic. Keep the template's project layout, `AzureWebJobsStorage`, the extension bundle, and the infrastructure. Remove demo code only when the user does not need it.

If the `get_azure_bestpractices` tool (`resource: azurefunctions`, `action: code-generation`) is available, apply its guidance to the code you write in this step.

### Step 4 — Verify locally

```text
node "<tool>" local verify --dir "<project-dir>"
```

The command creates `local.settings.json` when it is missing, installs the dependencies (a Python virtual environment or `npm install` and `npm run build`), starts `func start`, waits for the host to report `Running`, lists the functions, and calls one HTTP function. It stops the host before it returns. A second run skips installation when the dependency file has not changed.

- `ok: true` means the functions were indexed and the HTTP call did not return a server error. Report the function names and the HTTP status.
- `AZURITE-NOT-RUNNING`: the project has a timer, blob, queue, Event Hubs, or Durable trigger that needs Azurite. Ask the user once whether you may start Azurite. If yes, run the command again with `--start-azurite`; the tool starts Azurite and stops it at the end (add `--keep-azurite` to leave it running). If no, report that the non-HTTP triggers were not run locally.
- `INSTALL-FAILED`, `HOST-EXITED`, or `NO-FUNCTIONS-INDEXED`: read `data.outputTail`, fix the code or the dependency file, and run once more.
- To call a specific function, add `--invoke <name>`. To send a real message to a non-HTTP trigger, see `azure-functions-common/references/local-emulators.md`.
- For Cosmos DB, SQL, and other services without a local emulator, keep the result as host start and indexing, and offer a test against a development resource in Azure.

### Azure MCP fallback

Use the Azure MCP Server only when the tool cannot run or keeps reporting `TEMPLATE-FETCH-FAILED`, or when the user asks to browse the MCP template set.

1. Call `functions_template_get` with only `language` to list template IDs. Do not invent IDs such as `HttpTrigger`; MCP IDs are versioned strings such as `http-trigger-typescript-azd`.
2. Call `functions_template_get` with the language and the chosen ID. If the host saved the result to a file, run `template write --from "<saved-result.json>" --dir "<project-dir>"`. Otherwise write each returned file into the project.
3. When `data.mergeInstructions` or `data.skipped` is present, merge the needed settings and dependencies by hand. Do not delete or replace the user's files.
4. Continue with Step 3 and Step 4.

---

### Path B — Without the tool

Use this path only when `node` or the tool is unavailable. Show this notice to the user (translate it to the user's language):

> ℹ️ The bundled template tool is unavailable; writing the template by hand.

1. Fetch `https://cdn.functions.azure.com/public/templates-manifest/manifest.json`. Filter by language and resource and choose the entry with the highest priority.
2. Download the files under the entry's `repositoryUrl`, `folderPath`, and `gitRef`, and write them into the project folder.
3. Continue with Step 3. Verify with `func start` and one real HTTP request; for non-HTTP triggers, use `azure-functions-common/references/local-emulators.md` and ask before starting an emulator.

If the manifest is also unavailable, use the minimal snippets in [references/language-snippets.md](references/language-snippets.md).

---
### Path C — Go (preview)

Go is not represented in the Azure MCP template set or in the templates manifest, so there is nothing to discover. Go also has its own scaffolding command, its own worker runtime value, and preview constraints that apply to no other language.

Load [references/go-project.md](references/go-project.md) and follow it. Do not improvise a Go project from the templates or from Path B.

Tell the user up front that **Go support on Azure Functions is in public preview** and may change before GA.

---

### Adding functions to existing projects

If `host.json` already exists, do **not** re-initialize the project. Start from the template for the new trigger:

1. Stage the template inside the project. Use the project's language.

   ```text
   node "<tool>" template write --language <language> --resource <resource> --dir "<project-dir>" --stage
   ```

2. Copy the function source from `data.stagedDir` into the project and follow the project's layout (for Python v2, a new blueprint or the main file; for Node v4, a new file under `src/functions`). Merge new packages into the dependency manifest, new settings into `local.settings.json`, and new resources and role assignments into `infra/`. Do not replace the user's files.
3. Delete the staged folder, then run `local verify`.

Do not run `template write` without `--stage` on an existing project. The tool refuses a full-project template there (`TEMPLATE-NEEDS-NEW-FOLDER`), because it would add a second project layout. When the tool is unavailable, call `functions_template_get` with `output: "Add"` and apply its merge instructions.

**Go**: `func new` is not supported for Go. Edit `main.go`, add another `app.*` registration and, for an extension trigger, the blank import. Do not run `func init` or `go mod init` again, and do not create `function.json`. See [references/go-project.md](references/go-project.md).

## After Creation

> ✅ Your project is scaffolded! Next: use **azure-functions-deploy** to deploy to Azure.

## Next steps

- On success, suggest `azure-functions-deploy` because the project is ready to deploy to Azure.
- On failure, suggest `azure-functions-setup` to verify local tooling and prerequisites.