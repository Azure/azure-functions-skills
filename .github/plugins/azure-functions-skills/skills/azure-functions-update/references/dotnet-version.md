# .NET Version Update

Use this reference to change the .NET version of an isolated worker app.

- Start with [C# language version updates](https://learn.microsoft.com/en-us/azure/azure-functions/update-language-versions?pivots=programming-language-csharp).
- Check [supported versions and hosting limits](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide#supported-versions) and [worker and build SDK requirements](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide#project-and-package-references).
- For .NET 8 to .NET 10, check applicable changes in both [.NET 9](https://learn.microsoft.com/en-us/dotnet/core/compatibility/9.0) and [.NET 10](https://learn.microsoft.com/en-us/dotnet/core/compatibility/10). Read only the technology areas used by the app.
- If SDK selection is fixed in the repository, use the [global.json reference](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json).

A requested .NET 8 in-process to .NET 8 isolated to .NET 10 migration has two stages. Verify and preserve the .NET 8 isolated result before the .NET 10 change. Do not require this sequence for other requests.

Local compatibility does not prove that the existing Azure hosting plan supports the target. Report a plan limitation without changing the plan unless authorized.