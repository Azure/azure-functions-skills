# Azure Functions Common Reference Routing

Use this file to choose which small reference files to load. Do not load every reference.

Reference files are bundled with `azure-functions-common`:

- Language references: `references/languages/`
- Extension references: `references/extensions/`
- Local E2E references: `references/local-emulators.md`

## Language routing

| Inventory signal | Load |
| ------------------ | ------ |
| `FUNCTIONS_WORKER_RUNTIME=dotnet` or `dotnet-isolated` | `languages/csharp.md` |
| `FUNCTIONS_WORKER_RUNTIME=python` | `languages/python.md` |
| `FUNCTIONS_WORKER_RUNTIME=node` | `languages/node-typescript.md` |
| `FUNCTIONS_WORKER_RUNTIME=java` | `languages/java.md` |
| `FUNCTIONS_WORKER_RUNTIME=powershell` | `languages/powershell.md` |
| Durable bindings, Durable package, or orchestration/entity/activity symptom | `languages/durable-functions.md` |

## Extension routing

For any trigger or binding investigation, include `azure-webjobs-sdk` when the symptom involves core binding pipeline behavior, trigger indexing, binding metadata, `%SETTING%` name resolution, or listener startup. Use the matching extension reference below for the extension-specific implementation repository.

| Trigger / binding / symptom | Load |
| ----------------------------- | ------ |
| `httpTrigger`, HTTP routing, auth level, request/response | `extensions/http.md` |
| `timerTrigger`, schedule, missed execution | `extensions/timer.md` |
| `blobTrigger`, `blob` | `extensions/storage-blob.md` |
| `queueTrigger`, `queue`, poison messages | `extensions/storage-queue.md` |
| `serviceBusTrigger`, `serviceBus`, lock renewal, settlement, sessions | `extensions/service-bus.md` |
| `eventHubTrigger`, `eventHub`, checkpoints, partition ownership | `extensions/event-hubs.md` |
| `eventGridTrigger`, `eventGrid`, validation, delivery | `extensions/event-grid.md` |
| `cosmosDBTrigger`, `cosmosDB`, leases, change feed | `extensions/cosmos-db.md` |
| `table` | `extensions/azure-tables.md` |
| Durable bindings | `extensions/durable-functions.md` |
| `Sql`, `SqlTrigger` | `extensions/sql.md` |
| `MySql`, `MySqlTrigger` | `extensions/mysql.md` |
| `signalR*` | `extensions/signalr.md` |
| `webPubSub*` | `extensions/web-pubsub.md` |
| `kafkaTrigger`, `kafka` | `extensions/kafka.md` |
| `rabbitMQTrigger`, `rabbitMQ` | `extensions/rabbitmq.md` |
| `redis*` | `extensions/redis.md` |
| `sendGrid` | `extensions/sendgrid.md` |
| `twilioSms` | `extensions/twilio.md` |
| `dapr*` | `extensions/dapr.md` |
| Fabric bindings | `extensions/fabric.md` |
| MCP bindings | `extensions/mcp.md` |
| Non-.NET extension version, bundle loading, missing binding, binding resolution | `extensions/extension-bundles.md` |

## Symptom routing

| Symptom | First skills/references |
| --------- | ------------------------- |
| Need app specifications | `azure-functions-inventory` |
| Current health, errors, metrics, logs, Activity Log | `azure-functions-health-status` |
| Deployment failure | Inventory, health/status, `extensions/extension-bundles.md` if binding resolution appears in logs |
| Function indexing failure | Inventory, health/status traces, matching language and extension references |
| Trigger not firing | Inventory trigger list, health/status traces, matching extension reference |
| Runtime startup failure | Inventory runtime settings, health/status traces, matching language reference |
| Network/connectivity failure | Inventory network shape, health dependencies/traces, matching extension reference |
| Local E2E verification for non-HTTP triggers or bindings | `local-emulators.md`, matching extension reference |

## Skill feedback routing

Use `azure-functions-feedback` when the user asks to provide feedback, create an issue or PR for this skill suite, report confusing/incorrect skill guidance, or when a completed workflow reveals reusable improvements for any `azure-functions-*` skill.
