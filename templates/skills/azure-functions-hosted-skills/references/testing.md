# Testing Recipes

Use these smoke tests after creating or changing an agent. Prefer local tests first, except for
Connector Namespace callbacks, which normally require deployed Azure resources.

When the user has approved testing, run these commands for them instead of only listing them. If a
test requires a portal-only action, open the relevant URL and pause for the user to complete it.

## Prepare Local Runtime

Provision first when the app uses Foundry, dynamic sessions, or Connector Namespace MCP tools:

```bash
azd provision
azd env get-values
```

Copy values into `src/local.settings.json`, then start Azurite in another terminal when using
`UseDevelopmentStorage=true`:

```bash
azurite --skipApiVersionCheck
```

Run the app:

```bash
cd src
source .venv/bin/activate
func start
```

## Built-In Chat API

Local chat API:

```bash
curl -i -X POST "http://localhost:7071/agents/main/chat" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hello and tell me what tools you have."}'
```

Save the `x-ms-session-id` response header and reuse it for follow-up calls.

Deployed chat UI/API uses the default function key. The chat UI prompts for this key:

```bash
function_key=$(az functionapp keys list \
  -g <resource-group> \
  -n <function-app-name> \
  --query "functionKeys.default" -o tsv)

curl -i -X POST "https://<function-app-name>.azurewebsites.net/agents/main/chat" \
  -H "Content-Type: application/json" \
  -H "x-functions-key: $function_key" \
  -d '{"prompt":"Say hello and tell me what tools you have."}'
```

Streaming:

```bash
curl -N -X POST "http://localhost:7071/agents/main/chatstream" \
  -H "Content-Type: application/json" \
  -H "x-ms-session-id: <session-id>" \
  -d '{"prompt":"Continue with progress events."}'
```

## HTTP Agents

```bash
curl -i -X POST "http://localhost:7071/<route>" \
  -H "Content-Type: application/json" \
  -d '{"example":"payload"}'
```

When testing deployed HTTP agents with `auth_level: function`, pass a function key using
`x-functions-key` or the `code` query string parameter.

## Timer and Other Non-HTTP Agents

Local admin invoke:

```bash
curl -X POST "http://localhost:7071/admin/functions/<agent-file-stem>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Deployed admin invoke:

```bash
master_key=$(az functionapp keys list \
  -g <resource-group> \
  -n <function-app-name> \
  --query "masterKey" -o tsv)

curl -X POST "https://<function-app-name>.azurewebsites.net/admin/functions/<agent-file-stem>" \
  -H "x-functions-key: $master_key" \
  -H "Content-Type: application/json" \
  -d '{}'
```

This works for timer, queue, blob, Service Bus, Event Hub, Cosmos, SQL, and connector-triggered
agent functions when you want to test the agent code path without waiting for the real event.

Set expectations before waiting on a deployed background run. The admin endpoint can return
`202 Accepted` while the agent continues running. Web browsing, reasoning, dynamic sessions, and
connector calls can make a run take several minutes, and Application Insights telemetry can arrive
late. Tell the user this is normal, then give brief updates while checking telemetry, such as
"the trigger was accepted; I am waiting for request/traces to appear" or "the function is still
running; I will keep watching for completion or errors." If there is no telemetry after about
10 minutes, or the run exceeds the configured timeout, stop waiting quietly and begin
troubleshooting startup, keys, App Insights, model quota, and connector configuration.

After triggering a deployed non-HTTP agent, query Application Insights instead of only telling the
user where logs live:

```bash
resource_group="<resource-group>"
function_name="<function-app-name>"
app_insights_name=$(az resource list \
  -g "$resource_group" \
  --resource-type Microsoft.Insights/components \
  --query "[0].name" -o tsv)

az monitor app-insights query \
  -g "$resource_group" \
  -a "$app_insights_name" \
  --analytics-query "requests | where timestamp > ago(20m) | where cloud_RoleName == '$function_name' | order by timestamp desc | project timestamp, name, resultCode, success, duration" \
  --output table

az monitor app-insights query \
  -g "$resource_group" \
  -a "$app_insights_name" \
  --analytics-query "traces | where timestamp > ago(20m) | where cloud_RoleName == '$function_name' | order by timestamp desc | project timestamp, severityLevel, message" \
  --output table

az monitor app-insights query \
  -g "$resource_group" \
  -a "$app_insights_name" \
  --analytics-query "exceptions | where timestamp > ago(20m) | where cloud_RoleName == '$function_name' | order by timestamp desc | project timestamp, type, outerMessage" \
  --output table
```

Use a time window that starts before the manual trigger. If the connector action should create a
visible side effect, such as Teams posting or email drafting, check both Application Insights and
the downstream system. If the side effect is missing after one run, stop rerunning the full agent
and use [connector-smoke-tests.md](./connector-smoke-tests.md) to validate the connector path with
the recorded tool arguments.

## Dynamic Workflows

Load [dynamic-workflows.md](./dynamic-workflows.md) and check the approved backend before tests.
Use deterministic handler/configuration checks before any model-backed run. Confirm paid test
target, budget, repetition count and owned-resource cleanup separately; do not run LLM-backed
evaluations in PR-triggered CI or on unreviewed contributor code.

Check startup indexes the owner trigger/endpoints and Durable orchestration/Activity functions,
the selected runtime supports `workflow_tool`, and host/app settings resolve to the intended Hub.
Verify local Emulator versus Azure credentials without printing secrets. Do not accept a printed
URL as runtime readiness.

For Azure DTS, verify the Function App and any approved dashboard/local client have both scoped
RBAC and the approved network path. An empty `ipAllowlist` denies all traffic even with correct
roles; `['0.0.0.0/0']` permits any IPv4 source only for the reviewed public configuration. Check
restricted ranges/private access against the actual clients; do not open an existing scheduler
just to pass a test.

After approval, run one bounded scenario through the real owner trigger or existing chat surface.
Capture Workflow ID, owner, source event/session, environment and revision. A `202 Accepted`,
queue enqueue, Workflow ID, or successful starter Function is not a completed workflow.
The runtime agent must end its initial turn rather than poll for completion; the test/operator
may inspect status through the existing chat status surface or Durable/DTS tooling.

For chat, reuse the real session and verify per-task progress and terminal result delivery.
For non-HTTP triggers, inspect the Durable/DTS terminal state and verify the final publisher's
actual Blob/queue/database/notification result. Do not add a debug chat agent just for this check.
Correlate Workflow ID/node with Function logs and Application Insights; retain failures and partial
external results. DTS timeline/history is complementary to, not a replacement for, App Insights.

Cover fixed fan-out/fan-in and `for_each` input ordering, skipped and empty collections, explicit
upstream output transfer, authorized/unauthorized specialists, and errors for missing references,
non-array iteration and node-cap overflow. Keep collection sizes within the 50-node budget.
Test timeout, retry/idempotency, cancellation and restart recovery only against separately approved
isolated targets; never repeat live emails/posts to prove retry or kill shared processes.
If the publisher outcome is unknown, reconcile the stable destination/event key before retrying.
Report business completion only after terminal state and the required destination are verified.

## Queue and Blob Smoke Tests

For local Storage Queue triggers, add a queue message with Azure Storage tooling or SDKs after
Azurite is running. For Blob triggers, upload a file to the configured container/path.

For deployed identity-based storage triggers, use Azure CLI or the portal with the deployed storage
account. Make sure the function app identity has the relevant Storage data roles.

## Connector Trigger Smoke Tests

Connector trigger callbacks usually cannot be fully tested locally. Test in Azure:

1. Deploy the function app and confirm it starts.
2. Confirm the `connector_extension` system key exists.
3. Deploy the Connector Namespace trigger config with a callback URL for the function name.
4. Confirm the connection is authorized.
5. Create the external event, such as sending an email or posting a Teams message.
6. Use Application Insights traces and requests to confirm the function fired.

Never print callback URLs in logs; they contain a system key.

## MCP Endpoint

Get the deployed MCP extension key:

```bash
az functionapp keys list \
  -g <resource-group> \
  -n <function-app-name> \
  --query "systemKeys.mcp_extension" -o tsv
```

Then connect an MCP client to:

```text
https://<function-app-name>.azurewebsites.net/runtime/webhooks/mcp
```

For docs lookup while creating unfamiliar backing Azure resources, ask the user to connect the
Microsoft Learn MCP server:

```text
https://learn.microsoft.com/api/mcp
```

The Learn MCP server uses Streamable HTTP, requires no authentication, and provides public Learn
documentation and samples.