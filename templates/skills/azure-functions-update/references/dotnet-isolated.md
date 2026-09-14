# C# In-process to Isolated Worker

Use this reference to change the C# execution model on Functions host v4.

- Start with the [official migration guide](https://learn.microsoft.com/en-us/azure/azure-functions/migrate-dotnet-to-isolated-model).
- For startup, binding, logging, or serialization details, use the applicable section of the [isolated worker guide](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide).
- If the app uses Durable Functions, also use the [Durable Functions model migration guide](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-migrate).

If the host is still v3, start with the host migration reference instead. A model change does not authorize a .NET version change. Keep the .NET version when the user requests a model-only stage.