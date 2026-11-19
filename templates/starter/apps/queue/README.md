# Starter: queue-triggered hosted skill

The smallest useful hosted skill that reacts to an **Azure Storage queue**. Drop a support message on the `support-requests` queue and the skill triages it — category, urgency, sentiment, a one-line summary, and a suggested first reply. There are no custom tools: the whole skill is one Markdown file.

Use this as a starting point, the same way [functions-daily-blog-hosted-skills-azd](https://github.com/Azure-Samples/functions-daily-blog-hosted-skills-azd) is the starting point for timer-triggered skills.

```text
 support message ──► Storage queue 'support-requests' ──► support_triage.agent.md ──► logs (Application Insights)
   (JSON)                                                  hosted skill (Flex Consumption)    └─► email via Office 365 (optional)
                                                           └─ code interpreter (ACA dynamic sessions)
```

## What gets deployed

`azd up` creates a resource group with:

- A Flex Consumption function app (Python 3.13) with a user-assigned managed identity.
- A storage account (no shared key access) for the app and the `support-requests` queue. Messages that fail five times go to `support-requests-poison`.
- A Microsoft Foundry project with a `gpt-5.4` deployment.
- An Azure Container Apps dynamic session pool, so the skill can run Python when it needs to (calculations, formatting, dates).
- Optional: a Connector Namespace with an Office 365 Outlook connection, only when `TO_EMAIL` is set.
- Application Insights and Log Analytics.

All connections use the managed identity. Your signed-in account also gets data-plane roles so you can send messages and run the app locally.

## Prerequisites

- An Azure subscription with quota for `gpt-5.4` (GlobalStandard) in your region.
- [Azure Developer CLI](https://aka.ms/azd) (`azd`) and [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`).
- Python 3.13.
- For local runs: [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) 4.x and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite).

## Deploy to Azure

```bash
cd starter-queue
azd auth login
azd env new starter-queue
azd env set TO_EMAIL you@example.com   # optional: email each triage result
azd up
```

If you set `TO_EMAIL`, authorize the Office 365 connection once: open the Connector Namespace (`cg-...`) in the Azure portal, select the `office365` connection, and sign in. Without `TO_EMAIL`, no email is sent.

By default, the hosted-skills runtime does not include the full model response in traces. To inspect sample JSON in Application Insights, add `ENABLE_SENSITIVE_DATA=true` to the Function App's application settings and restart the app. This exposes full model responses in logs; use it only with sample or otherwise non-sensitive data, since responses may contain personal data and are subject to your log access and retention settings.

## Try it

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install --pre -r requirements-dev.txt

python scripts/demo.py send                 # send both samples in samples/
python scripts/demo.py send --sample T-1001
```

Each message starts one run. The skill ends with the triage as JSON, for example:

```json
{"ticket_id": "T-1001", "category": "billing", "urgency": "high", "sentiment": "negative",
 "summary": "Customer was charged twice for order 58213 and needs the duplicate refunded before Friday.",
 "suggested_reply": "Hi Maria, I'm sorry about the double charge on order 58213..."}
```

Find invocation details in Application Insights (`traces` for the `support_triage` operation), or the result in your inbox when `TO_EMAIL` is set. You can also put any JSON or plain-text message on the queue from the Azure portal.

`python scripts/demo.py e2e` sends unique copies and runs a best-effort smoke check for successful invocations in Application Insights. It does not correlate invocations with the submitted messages, so it is not proof that each sample was processed; unrelated runs or telemetry delays can affect the result.

## Run locally

1. Run `azd up` (or `azd provision`) once. Local runs still use the deployed Foundry project and session pool.
2. Start Azurite.
3. Create the settings file and fill in the values from `azd env get-values` (`FOUNDRY_PROJECT_ENDPOINT`, `ACA_SESSION_POOL_ENDPOINT`, and optionally `TO_EMAIL` / `O365_MCP_SERVER_URL`):

   ```bash
   cp src/local.settings.json.sample src/local.settings.json
   ```

4. Start the app and send messages to Azurite from another terminal:

   ```bash
   cd src && func start
   python scripts/demo.py send --local
   ```

Locally the app uses your `az login` identity.

## Make it yours

| To change | Edit |
|---|---|
| What the skill does with each message | the Markdown body of `src/support_triage.agent.md` |
| Queue name or connection | `trigger.args` in `src/support_triage.agent.md`, plus `queueName` in `infra/main.bicep` |
| Retries before poison queue, batch size | `extensions.queues` in `src/host.json` |
| Model or timeout | `src/agents.config.yaml`, and `azd env set FOUNDRY_MODEL ...` |
| Add tools | Add Python tools under `src/tools/` or remote MCP servers to `src/mcp.json` |

## Files

```text
starter-queue/
├── azure.yaml
├── infra/                       Bicep: function app, storage + queue, Foundry, session pool, optional connector
├── samples/                     sample support messages
├── scripts/demo.py              send samples, run the e2e check
└── src/
    ├── support_triage.agent.md  the hosted skill (trigger + instructions)
    ├── agents.config.yaml       model, timeout, code interpreter
    ├── mcp.json                 optional Office 365 Outlook MCP server
    ├── function_app.py          create_function_app()
    └── host.json
```
