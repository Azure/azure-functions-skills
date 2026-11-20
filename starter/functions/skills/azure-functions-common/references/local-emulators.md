# Local emulators and development services

Use this reference when `azure-functions-create`, diagnostics, or best-practices work needs local E2E verification for non-HTTP triggers or bindings.

## Ground rules

- Ask the user before installing, downloading, starting, or configuring any emulator, container, service, or background process.
- Prefer tools that are already installed and visible in the workspace or PATH.
- If the user declines emulator setup, skip emulator-backed E2E verification and clearly state what was skipped.
- Do not change long-lived system services, Docker state, Azure resources, secrets, or connection strings without explicit approval.
- Keep local settings in `local.settings.json` or environment variables. Never commit secrets or real connection strings.

## Trigger and binding mapping

Official links below were checked for HTTP 200 access on 2026-05-12.

| Trigger / binding | Local E2E option | Official reference | Notes |
| --- | --- | --- | --- |
| `httpTrigger` | No emulator needed | [HTTP trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger), [run locally](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) | Start `func host` and send an HTTP request to `http://localhost:7071/api/<FunctionName>`. |
| `timerTrigger` | No service emulator needed | [Timer trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer), [manually run non-HTTP functions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-manually-run-non-http) | Verify listener startup. For a full local run, ask before changing the schedule to a short development-only value and restore it afterward. |
| Blob, Queue, Table Storage | Azurite | [Use Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite), [local storage emulator note](https://learn.microsoft.com/en-us/azure/azure-functions/functions-develop-local#local-storage-emulator) | Use Azurite for `AzureWebJobsStorage` and Storage triggers/bindings when the extension supports local development. |
| Cosmos DB | Azure Cosmos DB Emulator or a temporary Azure dev account | [Cosmos DB Emulator](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator), [develop locally with emulator](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator) | The emulator is platform/runtime dependent. If unavailable, use a disposable Azure dev resource after user approval. |
| Service Bus | Service Bus Emulator or temporary Azure Service Bus dev namespace | [Service Bus trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger), [emulator overview](https://learn.microsoft.com/en-us/azure/service-bus-messaging/overview-emulator), [test locally](https://learn.microsoft.com/en-us/azure/service-bus-messaging/test-locally-with-service-bus-emulator) | Do not assume the emulator is installed. Ask before creating Azure resources or installing containers/tools. |
| Event Hubs | Event Hubs Emulator or temporary Azure Event Hubs dev namespace | [Event Hubs trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-hubs-trigger), [test locally with emulator](https://learn.microsoft.com/en-us/azure/event-hubs/test-locally-with-event-hub-emulator) | Validate by sending an event and checking checkpoint/listener behavior. |
| Event Grid | Local HTTP endpoint plus Event Grid validation tooling, or temporary Azure Event Grid resource | [Event Grid trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-grid-trigger), [Event Grid how-tos](https://learn.microsoft.com/en-us/azure/azure-functions/event-grid-how-tos) | There is no universal local replacement for Azure delivery semantics. Prefer deployment/dev-resource tests for full verification. |
| SQL | Local SQL Server, SQL container, Azure SQL Edge, or temporary Azure SQL dev database | [Azure SQL trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-azure-sql-trigger), [Azure SQL bindings overview](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-azure-sql) | Use a least-privilege local/dev connection string and keep it out of source control. |
| Redis | Local Redis container/server or temporary Azure Cache for Redis dev instance | [Redis list trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-cache-trigger-redislist) | Confirm extension requirements and connection settings. |
| Kafka | Local Kafka container/cluster or approved development cluster | [Kafka trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-kafka-trigger) | Validate topic existence and consumer group behavior. |
| Durable Functions | Azurite for the default Azure Storage provider, or an approved storage provider | [Durable Functions storage provider configuration](https://learn.microsoft.com/en-us/azure/azure-functions/durable-functions/durable-functions-configure-managed-identity), [Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) | Durable Functions commonly depends on `AzureWebJobsStorage` locally. Confirm provider-specific requirements before E2E tests. |
| MySQL | Local MySQL container/server or temporary Azure Database for MySQL dev instance | No Azure Functions-specific emulator page found in the checked official set | Verify schema/table prerequisites before starting the host. |
| RabbitMQ | Local RabbitMQ container/server or approved development broker | No Azure Functions-specific emulator page found in the checked official set | Validate queue/exchange setup. |
| Dapr | Local Dapr sidecar and component configuration | No Azure Functions-specific emulator page found in the checked official set | Ask before running sidecars. Confirm component YAML does not include secrets. |

## Suggested verification pattern

1. Build the project first (`npm run build`, `dotnet build`, `mvn package`, or language equivalent).
2. Identify the trigger/binding and required local dependency from the table above.
3. Ask whether to install/start the emulator or use an existing dev resource.
4. Start the emulator/service only after approval.
5. Start the Functions host.
6. Send one realistic input event/message/document/request.
7. Verify the expected log line, output binding side effect, response, checkpoint, or persisted data.
8. Stop any local processes started for the test and report what was validated or skipped.

## Skip wording

When the user declines emulator setup, report it explicitly:

> Emulator-backed E2E verification was skipped by request. Verified build and Functions host/listener startup only. To complete E2E later, run the same test with `<emulator or dev resource>` and send `<event/message/document>` to `<trigger source>`.