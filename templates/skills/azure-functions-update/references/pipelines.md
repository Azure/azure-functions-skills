# Pipeline Configuration

Use this reference only if an existing pipeline must change for the selected migration. Read the source for the provider in use.

- GitHub Actions: [official Functions action](https://github.com/Azure/functions-action#parameter-reference).
- Azure Pipelines: [Functions deployment guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-azure-devops).
- For a .NET artifact layout change: [isolated worker deployment payload](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide#deployment-payload).

Check SDK selection, build output, and runtime settings together. Keep the existing authentication and deployment target unless the user requests a change. A local review does not prove that the pipeline runs successfully.