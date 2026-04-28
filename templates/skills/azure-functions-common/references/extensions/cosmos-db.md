# Azure Functions Diagnostics Reference — Cosmos DB

Use this file when investigating Cosmos DB trigger/input-output binding, leases, change feed, connection, throughput, or scale behavior.

## Bindings

- `cosmosDBTrigger`
- `cosmosDB`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-webjobs-sdk-extensions | https://github.com/Azure/azure-webjobs-sdk-extensions | Cosmos DB extension implementation |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime and scale behavior |
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Newer SDK integration paths when relevant |

## Sparse checkout guidance

For `azure-sdk-for-net`, use `sdk/cosmosdb` when the issue involves SDK integration.

## Public documentation

| Topic | URL |
|------|-----|
| Cosmos DB bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-cosmosdb-v2 |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Manage connections | https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections |

## Investigation guidance

- Include Cosmos DB in message-trigger investigations when the symptom involves change feed processing, leases, throughput, or trigger latency.
- For scale symptoms, inspect `azure-webjobs-sdk-extensions` under `src/WebJobs.Extensions.CosmosDB` and host scale behavior.