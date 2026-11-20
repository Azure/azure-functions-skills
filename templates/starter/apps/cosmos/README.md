# Starter: Cosmos DB-triggered hosted skill

The smallest useful hosted skill that reacts to **Azure Cosmos DB changes**. Add or update a product in the `products` container and the skill reads the change feed, summarizes what changed, and flags products that need attention: low stock, out of stock, or a price change over 20 percent. There are no custom tools: the whole skill is one Markdown file.

Use this as a starting point, the same way [functions-daily-blog-hosted-skills-azd](https://github.com/Azure-Samples/functions-daily-blog-hosted-skills-azd) is the starting point for timer-triggered skills.

```text
 product upsert ──► Cosmos DB 'starter/products' ──change feed──► product_watch.agent.md ──► logs (Application Insights)
                    (checkpoints in 'leases')                     hosted skill (Flex Consumption)  └─► email via Office 365 (optional)
                                                                  └─ code interpreter (ACA dynamic sessions)
```

The change feed delivers the **latest version** of each changed document, not the earlier values. If the skill should compare before and after, have the writer record what changed. The demo script stores the earlier values in a `previous` field.

## What gets deployed

`azd up` creates a resource group with:

- A Flex Consumption function app (Python 3.13) with a user-assigned managed identity.
- An Azure Cosmos DB for NoSQL account (serverless, key auth disabled) with the `starter` database and the `products` and `leases` containers. The app can only read `products`, so it can't start a trigger loop by writing back to it.
- A storage account (no shared key access) for the function app.
- A Microsoft Foundry project with a `gpt-5.4` deployment.
- An Azure Container Apps dynamic session pool, so the skill can run Python (for example, to compute price changes).
- Optional: a Connector Namespace with an Office 365 Outlook connection, only when `TO_EMAIL` is set.
- Application Insights and Log Analytics.

All connections use the managed identity. Your signed-in account gets Cosmos DB Built-in Data Contributor on the account so you can add products and run the app locally.

## Prerequisites

- An Azure subscription with quota for `gpt-5.4` (GlobalStandard) in your region.
- [Azure Developer CLI](https://aka.ms/azd) (`azd`) and [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`).
- Python 3.13.
- For local runs: [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) 4.x and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite).

## Deploy to Azure

```bash
cd starter-cosmos
azd auth login
azd env new starter-cosmos
azd env set TO_EMAIL you@example.com   # optional: email products that need attention
azd up
```

If you set `TO_EMAIL`, authorize the Office 365 connection once: open the Connector Namespace (`cg-...`) in the Azure portal, select the `office365` connection, and sign in. Without `TO_EMAIL`, no email is sent.

By default, the hosted-skills runtime does not include the full model response in traces. To inspect sample JSON in Application Insights, add `ENABLE_SENSITIVE_DATA=true` to the Function App's application settings and restart the app. This exposes full model responses in logs; use it only with sample or otherwise non-sensitive data, since responses may contain personal data and are subject to your log access and retention settings.

## Try it

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install --pre -r requirements-dev.txt

python scripts/demo.py seed     # add three products: one run, all routine
python scripts/demo.py update   # stove stock drops below its reorder level, tent price is cut by 24%
```

After `update`, the skill should flag both products:

```json
[{"id": "STOVE-2B", "name": "Two-burner camp stove", "change": "stock: 18 → 6", "attention": ["low_stock"]},
 {"id": "TENT-4P", "name": "4-person tent", "change": "price: 289.0 → 219.0", "attention": ["price_change_over_20_percent"]}]
```

The change feed can batch both updates into one run or deliver them in two. Find invocation details in Application Insights (`traces` for the `product_watch` operation), or the result in your inbox when `TO_EMAIL` is set. You can also edit items with Data Explorer in the Azure portal.

`python scripts/demo.py e2e` adds uniquely named products and runs a best-effort smoke check for a successful invocation in Application Insights. It does not correlate invocations with the submitted products, so it is not proof that they were processed; unrelated runs or telemetry delays can affect the result.

## Run locally

The change feed trigger in this template uses the deployed Cosmos DB account, so a local run reads the same change feed. Stop the deployed app first if you don't want both to process the changes.

1. Run `azd up` (or `azd provision`) once.
2. Start Azurite (the Functions host uses it for its own state).
3. Create the settings file and fill in values from `azd env get-values`: `COSMOS__accountEndpoint` (`COSMOS_ENDPOINT`), `FOUNDRY_PROJECT_ENDPOINT`, `ACA_SESSION_POOL_ENDPOINT`, and optionally `TO_EMAIL` / `O365_MCP_SERVER_URL`:

   ```bash
   cp src/local.settings.json.sample src/local.settings.json
   ```

4. Start the app and change products from another terminal:

   ```bash
   cd src && func start
   python scripts/demo.py update
   ```

Locally the app uses your `az login` identity.

## Make it yours

| To change | Edit |
|---|---|
| What counts as "needs attention" | the Markdown body of `src/product_watch.agent.md` |
| Database, container, or batch size | `trigger.args` in `src/product_watch.agent.md`, plus the names in `infra/main.bicep` |
| Model or timeout | `src/agents.config.yaml`, and `azd env set FOUNDRY_MODEL ...` |
| Write results somewhere (another container, Teams, a ticket) | Add Python tools under `src/tools/` or remote MCP servers to `src/mcp.json`. Never write back to the monitored container. |

## Files

```text
starter-cosmos/
├── azure.yaml
├── infra/                      Bicep: function app, Cosmos DB, Foundry, session pool, optional connector
├── samples/                    products.json (seed) and updates.json (changes)
├── scripts/demo.py             seed, update, run the e2e check
└── src/
    ├── product_watch.agent.md  the hosted skill (trigger + instructions)
    ├── agents.config.yaml      model, timeout, code interpreter
    ├── mcp.json                optional Office 365 Outlook MCP server
    ├── function_app.py         create_function_app()
    └── host.json
```
