# C# In-process to Isolated Worker

Use this reference to change the C# execution model on Functions host v4.

- Start with the [official migration guide](https://learn.microsoft.com/en-us/azure/azure-functions/migrate-dotnet-to-isolated-model).
- For startup, binding, logging, or serialization details, use the applicable section of the [isolated worker guide](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide).
- If the app uses Durable Functions, also use the [Durable Functions model migration guide](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-migrate).

If the host is still v3, start with the host migration reference instead. A model change does not authorize a .NET version change. Keep the .NET version when the user requests a model-only stage.

## Current project SDK requirements

For a project that targets a supported .NET version, use `Azure.Functions.Sdk` as the project SDK. For .NET 10, use:

- `Azure.Functions.Sdk` 1.0.0 or later.
- An explicit `Microsoft.Azure.Functions.Worker` package at version 2.50.0 or later.
- HTTP and other binding extension packages that match the selected worker startup model.

Remove both `Microsoft.NET.Sdk.Functions` and the old `Microsoft.Azure.Functions.Worker.Sdk` package reference. Do not keep the old `Microsoft.NET.Sdk` plus `Worker.Sdk` arrangement only because it compiles or publishes. Current Functions tooling, metadata generation, and deployment preparation come from the `Azure.Functions.Sdk` project SDK.

Use an inline SDK version:

```xml
<Project Sdk="Azure.Functions.Sdk/1.0.0">
```

Alternatively, use `Azure.Functions.Sdk` without an inline version only when the repository supplies version 1.0.0 or later through `global.json` under `msbuild-sdks`.

Before editing, check the current minimum versions in the official isolated worker guide. Treat its project and package reference section as the primary source when an older migration example conflicts with it.

When using ASP.NET Core integration with `FunctionsApplication.CreateBuilder`, include the Builder namespace and matching HTTP extension:

```csharp
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.Hosting;

var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();
builder.Build().Run();
```

Use `Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore` 2.1.0 or later for this startup model. If the app uses `ConfigureFunctionsWorkerDefaults` instead, keep the built-in HTTP types and packages consistent with that model. Do not mix startup and HTTP integration styles.