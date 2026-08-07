# Trigger Reference

Agents use one trigger per `.agent.md` file. The current schema puts binding arguments under
`trigger.args`.

```yaml
trigger:
  type: timer_trigger
  args:
    schedule: "0 0 15 * * *"
```

The runtime registers the trigger through the Azure Functions Python programming model. Values
inside `args` generally map to the corresponding Azure Functions decorator parameters.

Environment variable substitution applies to strings in `trigger.args`, not to `trigger.type`.

Do not set `arg_name`; the runtime injects `arg_name: trigger_data` for non-HTTP triggers.

## Timer Trigger

```yaml
trigger:
  type: timer_trigger
  args:
    schedule: "0 0 9 * * *"
```

Arguments:

| Name | Required | Notes |
| --- | --- | --- |
| `schedule` | Yes | NCRONTAB expression. Prefer six fields with seconds. |
| `run_on_startup` | No | Use only for development or special one-shot scenarios. |
| `use_monitor` | No | Defaults to the Functions host behavior. |

Examples:

- `"0 0 9 * * *"` - daily at 09:00 UTC.
- `"0 */5 * * * *"` - every five minutes.
- `"0 30 14 * * 1-5"` - weekdays at 14:30 UTC.

Timer agents are background work. Set the agent runtime timeout to `1800` seconds by default and
set `host.json` `functionTimeout` to `00:30:00` unless the task is known to be short. Use longer
values only when the workflow clearly needs them and the hosting plan supports the duration.

## HTTP Trigger

```yaml
trigger:
  type: http_trigger
  args:
    route: summarize
    methods: ["POST"]
    auth_level: function
```

Arguments:

| Name | Required | Notes |
| --- | --- | --- |
| `route` | Yes | URL path. |
| `methods` | No | Defaults to `POST` in most examples. |
| `auth_level` | No | Use `function` for deployed APIs unless anonymous is intentional. |

For structured HTTP responses, add top-level `response_example` or `response_schema` to the
agent frontmatter, not inside `trigger.args`.

Do not use synchronous HTTP triggers for agent work expected to run longer than about 230 seconds;
Azure's HTTP front end can time out the response even when `host.json` allows a longer function
execution. For longer work, use a timer, queue, connector trigger, or another deferred pattern and
return status through storage, logs, email, Teams, or a follow-up API.

## Queue Trigger

```yaml
trigger:
  type: queue_trigger
  args:
    queue_name: work-items
    connection: AzureWebJobsStorage
```

Use the app setting name for `connection`, not the raw connection string. Identity-based storage
settings can still be used by the Functions host.

## Blob Trigger

```yaml
trigger:
  type: blob_trigger
  args:
    path: input/{name}
    connection: AzureWebJobsStorage
```

Arguments:

| Name | Required | Notes |
| --- | --- | --- |
| `path` | Yes | Container and blob pattern. |
| `connection` | Yes | App setting prefix or connection setting name. |
| `source` | No | Use `EventGrid` for lower latency when infrastructure supports it. |

## Event Grid Trigger

```yaml
trigger:
  type: event_grid_trigger
  args: {}
```

Event Grid subscriptions are configured outside the agent file.

## Event Hub Trigger

```yaml
trigger:
  type: event_hub_message_trigger
  args:
    event_hub_name: events
    connection: EVENTHUB_CONNECTION
```

Common optional arguments include `consumer_group` and `cardinality`.

## Service Bus Queue Trigger

```yaml
trigger:
  type: service_bus_queue_trigger
  args:
    queue_name: jobs
    connection: SERVICEBUS_CONNECTION
```

Common optional arguments include `is_sessions_enabled`, `cardinality`, and
`auto_complete_messages`.

## Service Bus Topic Trigger

```yaml
trigger:
  type: service_bus_topic_trigger
  args:
    topic_name: jobs
    subscription_name: agent
    connection: SERVICEBUS_CONNECTION
```

## Cosmos DB Trigger

```yaml
trigger:
  type: cosmos_db_trigger
  args:
    database_name: appdb
    container_name: items
    connection: COSMOSDB_CONNECTION
```

Common optional arguments include `lease_connection`, `lease_container_name`,
`create_lease_container_if_not_exists`, and `max_items_per_invocation`.

## Other Function Event Triggers

Use the same `trigger.args` pattern for other Azure Functions trigger decorators exposed by the
Python programming model. Common supported examples include:

| Trigger type | Use for |
| --- | --- |
| `event_hub_message_trigger` | Event Hubs messages. |
| `service_bus_queue_trigger` | Service Bus queues. |
| `service_bus_topic_trigger` | Service Bus topic subscriptions. |
| `cosmos_db_trigger` | Cosmos DB change feed, extension bundle 4.x shape. |
| `cosmos_db_trigger_v3` | Cosmos DB extension bundle 2.x/3.x shape. |
| `sql_trigger` | Azure SQL changes. |
| `mysql_trigger` | Azure Database for MySQL changes. |
| `kafka_trigger` | Kafka/Event Hubs Kafka endpoint events. |
| `dapr_binding_trigger` | Dapr input bindings. |
| `dapr_service_invocation_trigger` | Dapr service invocation. |
| `dapr_topic_trigger` | Dapr pub/sub topics. |
| `generic_trigger` | Custom extension binding triggers. |

Confirm the exact decorator argument names from Azure Functions docs before writing less common
triggers. The runtime forwards all `trigger.args` to the underlying decorator.

## Connector Triggers

Connector triggers start agents from external Connector Namespace events, such as new email,
Teams messages, or SharePoint/OneDrive changes when supported by the connector operation.

Use the Azure Functions Connector Extension from the preview extension bundle. No Python
`connectors` package extra is needed for an agent that receives the raw trigger payload.

Use this `host.json` bundle for connector-triggered apps:

```json
{
  "version": "2.0",
  "functionTimeout": "00:30:00",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle.Preview",
    "version": "[4.42.0, 5.0.0)"
  }
}
```

Current sample frontmatter:

```yaml
trigger:
  type: generic_trigger
  args:
    type: connectorTrigger
```

The runtime also supports `trigger.type: connector_trigger` when the Azure Functions Python
package exposes a native connector decorator. Prefer the `generic_trigger` shape above for now
because it matches the current Outlook reply sample and preview extension bundle.

Rules:

- Do not use dotted trigger types such as `teams.new_channel_message_trigger`.
- Do not add connector Python package extras for raw trigger payloads.
- Use Connector Namespace trigger configs to tell the connector platform which function callback
  URL to invoke.
- Use MCP connection servers in `mcp.json` for connector actions the agent calls after it is
  triggered.

Connector trigger config creation is a second deployment step because the callback URL needs the
`connector_extension` system key. See [connector-triggers.md](./connector-triggers.md).

Example agent:

```markdown
---
name: Outlook Reply Agent
description: Drafts a reply when new Office 365 Outlook email arrives.

trigger:
  type: generic_trigger
  args:
    type: connectorTrigger

mcp: true
---

When new Outlook email arrives, inspect the trigger payload. If the message matches the watched
mailbox or sender criteria, use the Office 365 Outlook MCP tools to draft a reply. Never send an
email unless the instructions explicitly allow sending.
```

## Built-In Endpoints

Built-in endpoints are not triggers. They are additional routes and MCP tools the runtime can
register for any agent, including timer, queue, HTTP, and connector-triggered agents.

Only add built-in endpoints when the user wants an interactive/API/MCP surface. Do not add debug
chat UI or chat API to scheduled-only/background-only agents just for testing; use admin invoke
plus Application Insights instead.

```yaml
builtin_endpoints:
  debug_chat_ui: true
  chat_api: true
  mcp: true
```

`debug_chat_ui: true` automatically enables `chat_api: true`. `builtin_endpoints: true` enables
`debug_chat_ui`, `chat_api`, and `mcp`.

Routes use the sanitized `.agent.md` file stem:

| Surface | Route |
| --- | --- |
| Chat UI | `GET /agents/<slug>/` |
| Chat API | `POST /agents/<slug>/chat` |
| Streaming Chat API | `POST /agents/<slug>/chatstream` |
| MCP tool | Shared `/runtime/webhooks/mcp` endpoint with an MCP tool named from `<slug>`. |

An agent with at least one enabled built-in endpoint may omit `trigger`. An agent may also have
both a normal trigger and built-in endpoints when the user explicitly wants both background and
interactive access.

## Trigger Data

Triggered agents receive serialized trigger data in the prompt context. HTTP agents receive the
request body. Timer agents receive timer metadata such as whether the run is past due. Queue,
blob, event, and message triggers receive the serialized binding payload.