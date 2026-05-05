# Azure Functions Diagnostics Reference — C# / .NET

Use this file when investigating Azure Functions issues involving C# apps, .NET isolated worker, .NET in-process apps, binding behavior in C#, or .NET runtime/package support.

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-dotnet-worker | https://github.com/Azure/azure-functions-dotnet-worker | .NET isolated worker |
| azure-functions-vs-build-sdk | https://github.com/Azure/azure-functions-vs-build-sdk | Build SDK and Visual Studio integration |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior that affects .NET apps |
| azure-webjobs-sdk | https://github.com/Azure/azure-webjobs-sdk | In-process model and binding pipeline |
| azure-webjobs-sdk-extensions | https://github.com/Azure/azure-webjobs-sdk-extensions | Timer, Cosmos DB, SendGrid, Twilio, and extension behavior |
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Azure SDK-based Functions extensions |

## Sparse checkout guidance

Use this `azure-sdk-for-net` scope when the issue crosses .NET code and extension packages:

```text
sdk/core, sdk/identity, sdk/extensions, sdk/storage,
sdk/eventgrid, sdk/eventhub, sdk/servicebus,
sdk/signalr, sdk/tables, sdk/cosmosdb, sdk/webpubsub
```

## Public documentation

| Topic | URL |
|------|-----|
| .NET isolated process guide | https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide |
| .NET in-process class library guide | https://learn.microsoft.com/en-us/azure/azure-functions/functions-dotnet-class-library |
| Migrate from in-process to isolated | https://learn.microsoft.com/en-us/azure/azure-functions/migrate-dotnet-to-isolated-model |
| Performance optimizations | https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide#performance-optimizations |
| Supported languages | https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation guidance

- Start with `azure-functions-dotnet-worker` for isolated-worker startup, middleware, dependency injection, serialization, and invocation issues.
- Use `azure-webjobs-sdk` and `azure-webjobs-sdk-extensions` for binding pipeline and in-process behavior.
- Use `azure-functions-host` for runtime, scale, indexing, configuration, and cross-language host issues.
- Check container image tags and supported language docs when the issue involves runtime support, EOL, or base images.