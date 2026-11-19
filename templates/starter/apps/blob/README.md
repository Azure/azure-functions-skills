# Starter: Blob-triggered hosted skill

The smallest useful hosted skill that reacts to **files uploaded to Azure Blob Storage**. Upload a text document (notes, a report, a CSV export) to the `documents` container and the skill summarizes it: a short summary, key points, and action items. There are no custom tools: the skill is one Markdown file plus a few lines of code that read the file.

Use this as a starting point, the same way [functions-daily-blog-hosted-skills-azd](https://github.com/Azure-Samples/functions-daily-blog-hosted-skills-azd) is the starting point for timer-triggered skills.

```text
 upload ──► Blob container 'documents' ──Event Grid──► summarize_document (function_app.py) ──► document_summary.agent.md ──► logs
                                                       reads the file text                      hosted skill               └─► email via Office 365 (optional)
                                                                                                └─ code interpreter (ACA dynamic sessions)
```

## Why there is a small function

The queue, Service Bus, and Cosmos DB starters put the trigger directly in the `.agent.md` file, because the message or document is the trigger data. A blob trigger only passes the blob's name, URI, and size, not its contents. So `src/function_app.py` has one blob-triggered function that reads the file and calls the skill through `@app.hosted_skill`:

```python
@app.blob_trigger(arg_name="blob", path="documents/{name}", connection="AzureWebJobsStorage", source=BLOB_SOURCE)
@app.hosted_skill(arg_name="skill", agent_name="document_summary")
async def summarize_document(blob: func.InputStream, skill: HostedSkill) -> None:
    text = blob.read().decode("utf-8", errors="replace")
    result = await skill.run(f"Document name: ...\n<document>\n{text}\n</document>")
```

The skill (`document_summary.agent.md`) has no trigger of its own. It only summarizes what it's given. Only text files (`.txt`, `.md`, `.csv`, `.json`, `.log`, `.html`, `.xml`) are summarized, up to the first 100,000 characters. For PDFs and images, add a tool that calls Azure AI Document Intelligence, as in [invoice-review-blob](../invoice-review-blob).

## What gets deployed

`azd up` creates a resource group with:

- A Flex Consumption function app (Python 3.13) with a user-assigned managed identity.
- A storage account (no shared key access) for the app and the `documents` container.
- An Event Grid system topic on the storage account. Flex Consumption runs blob triggers through Event Grid; the azd `postdeploy` hook (`scripts/postdeploy.py`) subscribes the function's blob webhook to `BlobCreated` events in `documents` after the code is deployed.
- A Microsoft Foundry project with a `gpt-5.4` deployment.
- An Azure Container Apps dynamic session pool, so the skill can run Python (for example, to total a CSV).
- Optional: a Connector Namespace with an Office 365 Outlook connection, only when `TO_EMAIL` is set.
- Application Insights and Log Analytics.

All connections use the managed identity. Your signed-in account also gets data-plane roles so you can upload files and run the app locally.

## Prerequisites

- An Azure subscription with quota for `gpt-5.4` (GlobalStandard) in your region.
- [Azure Developer CLI](https://aka.ms/azd) (`azd`) and [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`). The postdeploy hook uses `az`.
- Python 3.13.
- For local runs: [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) 4.x and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite).

## Deploy to Azure

```bash
cd starter-blob
azd auth login
az login
azd env new starter-blob
azd env set TO_EMAIL you@example.com   # optional: email each summary
azd up
```

If you set `TO_EMAIL`, authorize the Office 365 connection once: open the Connector Namespace (`cg-...`) in the Azure portal, select the `office365` connection, and sign in. Without `TO_EMAIL`, no email is sent.

## Try it

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install --pre -r requirements-dev.txt

python scripts/demo.py upload                              # upload both samples in samples/
python scripts/demo.py upload --sample team-sync-notes.md
```

For `team-sync-notes.md`, expect something like:

```json
{"document": "team-sync-notes.md",
 "summary": "Weekly sync on the website relaunch (still 24 June) and rising returns driven by boot sizing.",
 "key_points": ["Product pages 80% done; tent photos outstanding", "Returns rose from 4.1% to 6.3% in May", "..."],
 "action_items": ["Carla: get tent photos from the studio by 14 June", "Ben: draft the boot size guide by 10 June", "Dev: pull returns by product for the July review"]}
```

Find invocation details in Application Insights (`traces` for the `summarize_document` operation), or the result in your inbox when `TO_EMAIL` is set. You can also upload files in the Azure portal or Storage Explorer.

`python scripts/demo.py e2e` uploads unique copies and runs a best-effort smoke check for successful invocations in Application Insights. It does not correlate invocations with the uploaded files, so it is not proof that each sample was processed; unrelated runs or telemetry delays can affect the result.

## Run locally

1. Run `azd up` (or `azd provision`) once. Local runs still use the deployed Foundry project and session pool.
2. Start Azurite. Locally the trigger scans the container (`DOCUMENTS_BLOB_SOURCE=LogsAndContainerScan`) because Azurite has no Event Grid.
3. Create the settings file and fill in values from `azd env get-values` (`FOUNDRY_PROJECT_ENDPOINT`, `ACA_SESSION_POOL_ENDPOINT`, and optionally `TO_EMAIL` / `O365_MCP_SERVER_URL`):

   ```bash
   cp src/local.settings.json.sample src/local.settings.json
   ```

4. Start the app and upload files to Azurite from another terminal:

   ```bash
   cd src && func start
   python scripts/demo.py upload --local
   ```

Locally the app uses your `az login` identity.

## Make it yours

| To change | Edit |
|---|---|
| What the summary contains | the Markdown body of `src/document_summary.agent.md` |
| Container, file types, size limit | `src/function_app.py` (path, `TEXT_EXTENSIONS`, `MAX_CHARS`), `documentsContainerName` in `infra/main.bicep`, and `DOCUMENTS_CONTAINER` for the postdeploy hook |
| Model or timeout | `src/agents.config.yaml`, and `azd env set FOUNDRY_MODEL ...` |
| Save summaries or read PDFs | Add Python tools under `src/tools/`, an output binding to the function, or remote MCP servers to `src/mcp.json` |

## Files

```text
starter-blob/
├── azure.yaml                     includes the postdeploy hook
├── infra/                         Bicep: function app, storage + container, Event Grid topic, Foundry, session pool, optional connector
├── samples/                       sample documents
├── scripts/
│   ├── demo.py                    upload samples, run the e2e check
│   └── postdeploy.py              subscribe the blob trigger to Event Grid
└── src/
    ├── function_app.py            blob trigger that reads the file and calls the skill
    ├── document_summary.agent.md  the hosted skill (instructions only)
    ├── agents.config.yaml         model, timeout, code interpreter
    ├── mcp.json                   optional Office 365 Outlook MCP server
    └── host.json
```
