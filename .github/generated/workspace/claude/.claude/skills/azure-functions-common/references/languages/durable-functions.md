# Azure Functions Diagnostics Reference — Durable Functions

Use this file when investigating Durable Functions issues that cross language boundaries, orchestration behavior, Durable Task Framework behavior, or Durable storage providers.

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-durable-extension | https://github.com/Azure/azure-functions-durable-extension | Durable Functions extension |
| durabletask | https://github.com/Azure/durabletask | Durable Task Framework and Azure Storage provider |
| durabletask-dotnet | https://github.com/microsoft/durabletask-dotnet | Durable Task SDK for .NET |
| azure-functions-durable-js | https://github.com/Azure/azure-functions-durable-js | Durable Functions SDK for JavaScript/TypeScript |
| azure-functions-durable-python | https://github.com/Azure/azure-functions-durable-python | Durable Functions SDK for Python |
| durabletask-python | https://github.com/microsoft/durabletask-python | Durable Task SDK for Python |
| durabletask-java | https://github.com/microsoft/durabletask-java | Durable Task SDK for Java |
| azure-functions-durable-powershell | https://github.com/Azure/azure-functions-durable-powershell | Durable Functions SDK for PowerShell |
| durabletask-mssql | https://github.com/microsoft/durabletask-mssql | SQL Server storage provider |
| durabletask-netherite | https://github.com/microsoft/durabletask-netherite | Netherite/Event Hubs storage provider |

## Public documentation

| Topic | URL |
|------|-----|
| Durable Functions overview | https://learn.microsoft.com/en-us/azure/azure-functions/durable-functions/durable-functions-overview |
| Durable Task overview | https://learn.microsoft.com/en-us/azure/durable-task/common/what-is-durable-task |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation guidance

- Search public GitHub issues in `Azure/azure-functions-durable-extension`, `Azure/durabletask`, and `Azure/azure-functions-host` first.
- Add language-specific Durable repos when the app language is known.
- Add `microsoft/durabletask-mssql` or `microsoft/durabletask-netherite` when the storage backend is known.