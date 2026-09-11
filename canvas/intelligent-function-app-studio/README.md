# Functions Hosted Skills Studio

Build an [Intelligent Functions App](https://learn.microsoft.com/en-us/azure/azure-functions/functions-serverless-agents-runtime) locally or select an existing Azure Function App.

The launcher opens this Studio first for event-driven application, Azure Functions, Function App, function-trigger, and Intelligent Functions requests. After the canvas opens, Copilot can load additional Azure Functions or implementation skills to continue the work.

## Install and run the demo

```bash
copilot plugin marketplace add coreai-microsoft/canvases-cloud-foundation
copilot plugin install intelligent-function-app-studio@canvases-cloud-foundation
```

Reload extensions, start a fresh chat or child session, and ask:

```text
Build a daily digest app that scans a GitHub repo for work items, issues, pull requests, workflow failures, and other changes, then creates an intelligent summary.
```

For stronger routing, say `Open Functions Hosted Skills Studio`. See the root README's **For developers** section for worktree development instructions.

## What it does

- Initializes automatically from the daily-digest template [`paulyuk/serverless-repo-digest-agent`](https://github.com/paulyuk/serverless-repo-digest-agent).
- Generates HTTP, Queue, and Microsoft 365 Inbox siblings from the same editable Hosted Skill instructions.
- Detects Azure Functions Core Tools v4, Python 3.13+, and Azurite, creates a `.venv`, installs `requirements.txt`, and runs the Functions host with `func start`.
- Discovers existing Microsoft Foundry project deployments directly. Governed AI Gateway discovery is additive and uses authenticated ARM REST.
- Lists available subscriptions and Function Apps for read-only Azure discovery.
- Edits Timer schedules as Daily (default), Weekly, or Hourly and writes the matching Azure Functions NCRONTAB expression back to the generated agent source. Daily and Weekly times stay local in the UI.
- Discovers deployed functions and trigger bindings through public ARM REST, then supports selected HTTP, Timer, and safely resolvable Azure Storage Queue tests.
- Supports local Timer and HTTP invocation, a local Azurite Queue test path, a safe Microsoft 365 Inbox dry run, HTTP load testing with `oha`, and Application Insights deep links plus explicit 30-minute request totals, traces, and exceptions. Application Insights resolves and starts polling by default when an Azure Function App is selected.
- Automatically generates in a dedicated subfolder of the active worktree, with path customization and safe removal.
- Deploys from a persistent isolated copy, so `azd up` never stops, starts, or rewrites the local Functions host workspace. **Deployment output** opens on click, uses the same collapsible-card interaction as **Commands**, and retains provision, package, and deploy milestones plus bounded redacted stdout/stderr while other Studio controls stay usable.

## Try it

See [`DEMO.md`](DEMO.md) for the full walkthrough.

1. Install and activate the plugin.
2. Wait for the local Functions host to start.
3. Confirm the collapsed **MODEL ENDPOINT** summary, or expand it to select another existing Foundry or AI Gateway model.
4. Keep the Timer cadence on **Daily** or choose **Weekly** or **Hourly**, then click **Invoke Trigger**. Switch to **HTTP** for a direct call, choose **Queue** to enqueue a representative JSON message in local Azurite, or choose **Connector** for a Microsoft 365 Inbox dry run.
5. Switch **Source** to **Azure Function App** when you want to browse an existing cloud app.
6. Select one of the discovered deployed functions. Unsupported trigger types remain visible with explicit guidance.
7. Click **Load test** to run `oha` bursts for a selected HTTP function and, if desired, enable live Application Insights telemetry.

## Requirements for a full local run

- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) (`func`)
- **Python 3.13+**: the serverless agents runtime (`azurefunctions-agents-runtime`) requires it; a system `python3` older than 3.13 (for example macOS's bundled 3.9) is never used automatically. [uv](https://docs.astral.sh/uv/) is the preferred way to get a Python 3.13 for this project. Install it and the canvas will use it to provision and install into the environment. A verified Python 3.13+ interpreter of your own choosing also works without uv.
- [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) (`npm install -g azurite`), needed for the Timer schedule store and local Queue invocation
- [`oha`](https://github.com/hatoo/oha) for the load test (`brew install oha` or `cargo install oha`) - see the [environment and tooling guide](../../docs/intelligent-function-app-studio-environment.md#load-test) for what it does and why it is safe
- `az` CLI for Azure-target discovery, invoke, and telemetry. Sign in once with `az login` in your own terminal; the canvas reads that existing sign-in and never opens a login flow itself
- AI Gateway management needs no Azure CLI extension. Azure CLI supplies only the cached ARM token from the existing sign-in; missing preview registration, API-version availability, or RBAC affects explicit gateway discovery but not Foundry-only startup or an already configured gateway runtime binding.
- [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/) (`azd`), only needed for **Deploy to Azure**, not for Create Models or a local trigger run
- At least one accessible Microsoft Foundry model deployment or governed AI Gateway model, or use **Create Models** to provision `gpt-5.4-mini` and `gpt-5.6-sol` with one explicit click

Use the **Doctor** pill near the top of the canvas to open the readiness panel on demand, or ask Copilot to doctor the environment. It opens automatically when Invoke finds a blocker. See the canonical [environment and tooling guide](../../docs/intelligent-function-app-studio-environment.md) for machine prerequisites, exact local commands, check order and latency, Python and `uv` selection, child-process environment handling, Azure CLI sign-in reuse, Create Models, Invoke doctoring, load testing, bootstrap recovery, and legacy plugin cleanup.

The documented Azure discovery, trigger-classification, invocation, RBAC, and
secret-handling contracts are in
[`docs/intelligent-function-app-studio-azure-invocation.md`](../../docs/intelligent-function-app-studio-azure-invocation.md).

## Queue and Connector boundaries

- **Queue** uses the Hosted Skills `queue_trigger` contract with connection `AzureWebJobsStorage`. Each generated workspace gets a stable `agent-input-<12hex>` queue name so separate local apps do not consume each other's messages. Selecting Queue shows an editable JSON object seeded with the repository-digest request; change its `repository` field to test another GitHub repo. Local Invoke creates the queue in Azurite and writes that base64-encoded JSON for the Functions Queue extension's default decoder. The Studio forces the local Functions child process to `UseDevelopmentStorage=true`. For a selected existing Azure Function App, Invoke explicitly writes one real test message only after the documented target resolves safely and honors an explicit `AzureFunctionsJobHost__extensions__queues__messageEncoding=none` app setting. Deploy is blocked while Queue is selected because the template infrastructure does not create its source queue; Timer/HTTP deployment snapshots omit an inactive generated Queue sibling.
- **Connector** currently means **Microsoft 365 Inbox only**. The generated agent uses the preview runtime's `connector_trigger` and built-in chat API. `src/m365-inbox.mcp.json` records the deployment-time Outlook MCP shape with Entra scope `https://apihub.azure.com/.default` and only the read-only `office365_GetEmailsV3` operation; local `mcp.json` deliberately omits that server.
- Local Connector Invoke accepts only a JSON array of representative email objects, wraps it as `RUN MODE: DRY RUN` trigger data, and posts it to `/agents/<agent>/chat`. It cannot remove the dry-run marker, does not guess the undocumented raw Connector Namespace webhook envelope, and cannot call Microsoft 365 because no Outlook tool is registered locally.
- A live Azure Connector deployment separately requires Connector Namespace infrastructure, an `OnNewEmailV3` trigger for `folderPath=Inbox`, the runtime connector webhook callback, `OUTLOOK_MCP_ENDPOINT`, merging the generated MCP fragment, and one-time delegated OAuth consent. **Deploy to Azure** fails closed while Connector is selected because Studio does not silently install preview CLI components, provision that infrastructure, or grant consent. Timer/HTTP deployment snapshots omit an inactive generated Connector sibling and restore the standard extension bundle. Other connectors remain unsupported.

## Notes

- One loopback HTTP server and state bag are created per open canvas instance and torn down in `onClose`.
- When the host exposes a working directory, opening the canvas automatically creates or reuses the Studio-owned app at `functions/daily-repo-digest` in that worktree.
- **Local function path** sits directly under **New local function**. **Change** moves the complete generated tree to another unoccupied subfolder in the same worktree.
- If no working directory is available, source falls back to `~/.intelligent-function-app-studio/<instanceId>/template`.
- **Remove generated skill** deletes only an unchanged Studio-owned subtree. External ownership metadata and baseline hashes block removal after user files are added, removed, or edited, and a removal marker prevents automatic recreation until the user explicitly chooses **Create here**.
- The canvas only creates a GitHub session or deploys when the user explicitly chooses that action.
- **Deploy to Azure** requires `azd`, but not a running local Functions host. Studio runs the persistent `deployment` environment non-interactively with the canvas-selected subscription and the template-supported `eastus2` default, so `azd` never waits for subscription/location prompts. Before provisioning, the isolated snapshot explicitly disables Storage shared-key access and Foundry local authentication while preserving the template's managed-identity settings and RBAC. Timer/HTTP snapshots use the current Functions Blob-only host-storage shape; stale direct Queue, Table, and File service settings are removed because those services are not used by this deployment and can make the host's composite storage health check fail. An unrecognized template shape fails closed. The local Start/Stop control remains available during and after deployment failures; use **Deployment output** to follow live progress or stop the local `azd` process. Azure operations already submitted by `azd` may continue and are not reported as rolled back.
- Local Foundry runs use the Studio-managed `FOUNDRY_TOKEN_FILE`. Deployed apps omit that local-only setting and use `DefaultAzureCredential` with the Function App's configured user-assigned identity.

## REDACTED mode for demos

Add `use REDACTED mode` to either:

- **Sessions → Instructions** in the GitHub Copilot App, or
- the project's `.github/copilot-instructions.md`.

When **Open in VS Code** is used, the Studio opens a temporary demo copy. API keys, tokens, secrets, passwords, credentials, and connection strings in `.env` files and `local.settings.json` are replaced with `REDACTED`. Names, model values, resource IDs, normal settings, and endpoint URLs stay visible. The real project is not changed.
