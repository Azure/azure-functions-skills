# Fixed Review Basis

Source review date: 2026-09-14. These are short review notes, not copied pages.
Use the same file for every arm in a comparison. Review and update these notes
from the linked sources before a later benchmark. Keep that revised file fixed
until all arms finish. URLs alone do not give the judge their page content.

## Required Compatibility

- The target is Functions host v4 with .NET 10 isolated, not in-process.
  Replace in-process attributes and packages with isolated worker equivalents.
  The app needs worker startup and compatible binding packages.
  Source: https://learn.microsoft.com/en-us/azure/azure-functions/migrate-dotnet-to-isolated-model
- The current isolated guide uses the Azure.Functions.Sdk project SDK and an
  explicit Microsoft.Azure.Functions.Worker package. Check project and package
  references as a unit. An old sample alone does not establish compatibility.
  Worker startup must match the selected HTTP integration. ASP.NET Core
  integration and the built-in HTTP model are both valid when configured as
  documented. Preserve response behavior when changing types.
  Source: https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide#project-and-package-references
  Source: https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide#http-trigger
- Use net10.0 for the target framework and dotnet-isolated for the local worker
  runtime when local settings are present. Published output must contain worker
  configuration and generated function metadata. A library that merely compiles
  is not enough to establish a runnable Functions app.
  Source: https://learn.microsoft.com/en-us/azure/azure-functions/update-language-versions?pivots=programming-language-csharp
  Source: https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide#deployment-payload
- A .NET 8 to .NET 10 update crosses both .NET 9 and .NET 10 compatibility
  changes. Apply only changes that affect APIs or behavior in this app. A
  running .NET 9 intermediate stage is not required.
  Source: https://learn.microsoft.com/en-us/dotnet/core/compatibility/9.0
  Source: https://learn.microsoft.com/en-us/dotnet/core/compatibility/10

## Scope and Evidence

This fixture is an HTTP-only app. It has no deployment files, pipeline,
orchestration, or Azure resource to migrate. Do not require new infrastructure,
telemetry, dependency injection, or other optional features. Do not require a
specific valid HTTP integration style or a .NET 8 isolated intermediate stage.

The independent grader checks publish, target framework, worker configuration,
and the generated Hello trigger. It does not start the host or send HTTP
requests. Assess response preservation from the code. Report this local runtime
coverage gap; do not describe semantic review as an executed HTTP test.

.NET 10 support also depends on the Azure hosting plan. There is no deployed
plan in this fixture. Do not infer cloud support or require a hosting-plan change.
Source: https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide#supported-versions