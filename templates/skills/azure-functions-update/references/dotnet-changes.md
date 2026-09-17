# .NET conversion contract checks

Use [requirement IDs](requirements.md) and [contract probes](contract-probes.md).
For each relevant row, record observed code, target change, expected result, and proof.
Resolve target APIs during planning. Do not replace customer code with a sample.

| Surface | Preserve and investigate |
| --- | --- |
| Project/build | Output type, TFM, project SDK, worker and extension references, analyzers, shared project users, CI SDK selection |
| Startup | Move required registration from in-process startup to isolated startup; retain DI lifetimes, options, configuration sources, initialization behavior |
| Function declarations | Map `[FunctionName]` to isolated `[Function]` and target namespaces; preserve function names, routes, authorization levels, schedules, disabled state |
| HTTP | Select built-in worker HTTP or ASP.NET Core integration from actual APIs; preserve request/body behavior, status, headers, routes, and response serialization |
| Bindings | Map WebJobs extension packages to applicable worker extensions; preserve settings names, entity paths, input/output behavior, cardinality, and supported SDK types |
| Serialization | Compare JSON naming, null handling, enums, dates, encoding, and converter behavior across the chosen HTTP and worker pipelines |
| Logging/telemetry | Check host and worker logging separately; preserve required filters, telemetry, correlation, and exception behavior |
| Runtime settings | Plan required worker/runtime settings and startup command changes; cloud application remains a separate deployment action |
| Tests | Adapt host-specific test adapters, not expected results merely to match changed code |

Check the selected SDK's discovery limits for derived `WebJobsStartupAttribute` and
project-reference `ExtensionInformationAttribute` when custom extensions are present.
Do not assume a successful project build proves host extension discovery.

## Service-specific contracts

Use available `azure-functions-common` language/extension references for source pointers,
or official docs if unavailable. Do not load the whole common library.

- For message triggers, retain batch/single shape, retry, settlement, lock/session,
  duplicate handling, cancellation, checkpoint, and error behavior that the app uses.
- For Durable Functions, inspect orchestrator/activity/entity APIs, replay-safe code,
  serialization, task-hub identity, and compatibility of persisted orchestration history.
  Keep live instances and customer task hubs untouched. A new synthetic instance does
  not prove that existing history can resume after migration. Require the applicable
  version-specific migration strategy and acceptance before making that claim.
- For custom bindings, inspect the complete target host, WebJobs SDK, extension, and
  isolated-worker release path. Do not infer compatibility from package names alone.

Keep existing business expectations. If a documented target change requires a contract
change, stop and obtain a decision rather than hiding it in a test update.
Use requirement dispositions to separate required changes from recommendations.

## Primary sources

Accessed 2026-09-17. Refresh for the target versions:

- [Migration guide](https://learn.microsoft.com/azure/azure-functions/migrate-dotnet-to-isolated-model).
- [Worker guide](https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide).
- [Binding extensions](https://learn.microsoft.com/azure/azure-functions/functions-bindings-register).
- [Durable isolated migration](https://learn.microsoft.com/azure/durable-task/durable-functions/durable-functions-migrate),
  updated 2026-08-03.

The Durable guide has older project/SDK examples than the general migration guide.
Use its applicable API mapping, not its package versions as current build-SDK authority.
Resolve conflicts by target version; record release, commit, branch, and conclusion.
