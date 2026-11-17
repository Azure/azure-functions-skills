# Azure Functions Diagnostics Reference — Durable Functions Extension

Use this file when investigating Durable Functions triggers/bindings, orchestrations, activities, entities, durable clients, task hubs, or storage providers.

## Bindings

- `activityTrigger`
- `orchestrationTrigger`
- `entityTrigger`
- `durableClient`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-durable-extension | https://github.com/Azure/azure-functions-durable-extension | Durable Functions extension |
| durabletask | https://github.com/Azure/durabletask | Durable Task Framework and Azure Storage provider |
| durabletask-mssql | https://github.com/microsoft/durabletask-mssql | SQL Server storage provider |
| durabletask-netherite | https://github.com/microsoft/durabletask-netherite | Netherite/Event Hubs storage provider |

## Public documentation

| Topic | URL |
|------|-----|
| Durable Functions overview | https://learn.microsoft.com/en-us/azure/azure-functions/durable-functions/durable-functions-overview |
| Durable Task overview | https://learn.microsoft.com/en-us/azure/durable-task/common/what-is-durable-task |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |

## Investigation guidance

- Search public GitHub issues in `Azure/azure-functions-durable-extension`, `Azure/durabletask`, and `Azure/azure-functions-host` first.
- Add language-specific Durable repos when the app language is known.
- Add provider repos when SQL Server or Netherite is configured.