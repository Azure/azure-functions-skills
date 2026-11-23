# Starter: Service Bus-triggered hosted skill

The smallest useful hosted skill that reacts to an **Azure Service Bus queue**. Put an order on the `orders` queue and the skill reviews it — totals the items, flags risk signals (high value, large quantities, overnight shipping to a different address, a note asking to skip checks), and recommends `fulfill` or `hold_for_review`. It only recommends. There are no custom tools: the whole skill is one Markdown file.

Use this as a starting point, the same way [functions-daily-blog-hosted-skills-azd](https://github.com/Azure-Samples/functions-daily-blog-hosted-skills-azd) is the starting point for timer-triggered skills.

```text
 order ──► Service Bus queue 'orders' ──► order_review.agent.md ──► logs (Application Insights)
 (JSON)                                   hosted skill (Flex Consumption)  └─► email via Office 365 (optional)
                                          └─ code interpreter (ACA dynamic sessions)
```

Choose Service Bus over a Storage queue when you need larger messages, sessions or ordering, duplicate detection, dead-lettering, or topics. For a simpler queue, see [starter-queue](../starter-queue).

## What gets deployed

`azd up` creates a resource group with:

- A Flex Consumption function app (Python 3.13) with a user-assigned managed identity.
- A Service Bus namespace (Basic tier, Entra ID only) with an `orders` queue. The lock lasts 5 minutes and is renewed while the skill runs; messages that fail five times go to the dead-letter queue.
- A storage account (no shared key access) for the function app.
- A Microsoft Foundry project with a `gpt-5.4` deployment.
- An Azure Container Apps dynamic session pool, so the skill can run Python (for example, to total the order).
- Optional: a Connector Namespace with an Office 365 Outlook connection, only when `TO_EMAIL` is set.
- Application Insights and Log Analytics.

All connections use the managed identity. Your signed-in account gets Service Bus Data Sender and Receiver so you can send orders and run the app locally.

## Prerequisites

- An Azure subscription with quota for `gpt-5.4` (GlobalStandard) in your region.
- [Azure Developer CLI](https://aka.ms/azd) (`azd`) and [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`).
- Python 3.13.
- For local runs: [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) 4.x and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite).

## Deploy to Azure

```bash
cd starter-servicebus
azd auth login
azd env new starter-servicebus
azd env set TO_EMAIL you@example.com   # optional: email each review
azd up
```

If you set `TO_EMAIL`, authorize the Office 365 connection once: open the Connector Namespace (`cg-...`) in the Azure portal, select the `office365` connection, and sign in. Without `TO_EMAIL`, no email is sent.

By default, the hosted-skills runtime does not include the full model response in traces. To inspect sample JSON in Application Insights, add `ENABLE_SENSITIVE_DATA=true` to the Function App's application settings and restart the app. This exposes full model responses in logs; use it only with sample or otherwise non-sensitive data, since responses may contain personal data and are subject to your log access and retention settings.

## Try it

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install --pre -r requirements-dev.txt

python scripts/demo.py send                   # send both samples in samples/
python scripts/demo.py send --sample ORD-2002
```

`ORD-2001` is an ordinary order and should be `fulfill`. `ORD-2002` is high value, overnight to a different address, and its note tries to talk the reviewer out of the checks, so it should be `hold_for_review`:

```json
{"order_id": "ORD-2002", "total": 4290.0, "summary": "6 GPS units and 4 satellite messengers, overnight to an address that does not match billing.",
 "risk_signals": ["total above 1,000", "more than 3 units of GPS-PRO", "overnight shipping to a non-billing address", "note asks to skip review"],
 "recommendation": "hold_for_review"}
```

Find invocation details in Application Insights (`traces` for the `order_review` operation), or the result in your inbox when `TO_EMAIL` is set. You can also send messages with Service Bus Explorer in the Azure portal.

`python scripts/demo.py e2e` sends unique copies and runs a best-effort smoke check for successful invocations in Application Insights. It does not correlate invocations with the submitted messages, so it is not proof that each sample was processed; unrelated runs or telemetry delays can affect the result.

## Run locally

Service Bus has no local emulator in this template, so a local run listens to the deployed namespace. Stop the deployed app first if you don't want both to compete for messages.

1. Run `azd up` (or `azd provision`) once.
2. Start Azurite (the Functions host uses it for its own state).
3. Create the settings file and fill in values from `azd env get-values`: `SERVICEBUS__fullyQualifiedNamespace` (`SERVICEBUS_FULLY_QUALIFIED_NAMESPACE`), `FOUNDRY_PROJECT_ENDPOINT`, `ACA_SESSION_POOL_ENDPOINT`, and optionally `TO_EMAIL` / `O365_MCP_SERVER_URL`:

   ```bash
   cp src/local.settings.json.sample src/local.settings.json
   ```

4. Start the app and send orders from another terminal:

   ```bash
   cd src && func start
   python scripts/demo.py send
   ```

Locally the app uses your `az login` identity.

## Make it yours

| To change | Edit |
|---|---|
| Review rules and recommendation | the Markdown body of `src/order_review.agent.md` |
| Queue name or connection | `trigger.args` in `src/order_review.agent.md`, plus `queueName` in `infra/main.bicep` |
| Concurrency, lock renewal | `extensions.serviceBus` in `src/host.json`; lock duration and max delivery count in `infra/app/servicebus.bicep` |
| Model or timeout | `src/agents.config.yaml`, and `azd env set FOUNDRY_MODEL ...` |
| Act on the recommendation | Add Python tools under `src/tools/` or remote MCP servers to `src/mcp.json` |

## Files

```text
starter-servicebus/
├── azure.yaml
├── infra/                     Bicep: function app, Service Bus, Foundry, session pool, optional connector
├── samples/                   sample orders
├── scripts/demo.py            send samples, run the e2e check
└── src/
    ├── order_review.agent.md  the hosted skill (trigger + instructions)
    ├── agents.config.yaml     model, timeout, code interpreter
    ├── mcp.json               optional Office 365 Outlook MCP server
    ├── function_app.py        create_function_app()
    └── host.json
```
