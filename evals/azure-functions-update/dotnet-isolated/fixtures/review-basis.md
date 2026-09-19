# Fixed Review Basis — azure-functions-update / dotnet-isolated

Source review date: 2026-09-18. These are short review notes, not copied pages.
Use the same file for every arm of a comparison. Refresh these notes from the linked
sources before a later benchmark and keep the revised file fixed until all arms finish.
A URL alone does not give the judge the content of its page.

## Phase scope

- This trial is the **Functions model and configuration phase only**. The application
  keeps its current target framework, `net8.0`. A language or runtime version update is
  a separate approved stage and is **not requested** here. Changing the target framework
  in this phase is a violation, not an improvement.
  Source: <https://learn.microsoft.com/azure/azure-functions/migrate-dotnet-to-isolated-model>
- The official .NET language follow-up route is the `dotnet-version-upgrade` scenario of
  the `upgrade-agent` plugin. It is plugin- and MCP-hosted, so it cannot be pre-staged as
  an ordinary skill directory in this offline trial. A requested but unavailable handoff is
  `blocked`; it is never a pass, and the agent must not perform the language update itself.

## Required compatibility for the model phase

- The target is Functions host v4 with the .NET isolated worker at the current target
  framework. In-process attributes, packages, and startup are replaced with isolated
  worker equivalents, and the app needs a worker host entry point.
  Source: <https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide>
- The current isolated guide uses the `Azure.Functions.Sdk` project SDK, resolved inline
  or through `global.json`, with an explicit `Microsoft.Azure.Functions.Worker` package
  reference. Central package version management is allowed as long as the declaration is
  explicit. `Microsoft.NET.Sdk.Functions`, `Microsoft.Azure.Functions.Worker.Sdk`, and the
  obsolete `FunctionsEnableWorkerIndexing` property must not remain. A generated
  host-extension project under `obj/` is expected output, not a violation, and is neither
  edited nor built directly.
  Source: <https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide#project-and-package-references>
- Either supported HTTP model is acceptable when it is internally coherent: the ASP.NET
  Core integration with its extension package and matching startup, or the built-in worker
  HTTP model with `HttpRequestData`. Do not require one particular style, and do not
  require adding HTTP dependencies to a non-HTTP app.
  Source: <https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide#http-trigger>
- Local settings use `FUNCTIONS_WORKER_RUNTIME=dotnet-isolated`. Existing `host.json`
  semantics and connection setting names are retained. A proposed deployment configuration
  is not evidence of deployed state, and nothing is deployed in this trial.
  Source: <https://learn.microsoft.com/azure/azure-functions/functions-develop-local>
- Telemetry is a deliberate choice. Adding Application Insights or OpenTelemetry is not
  required; adding both worker paths at once is a defect. Existing logging behavior must
  survive the move from host-injected `ILogger` to worker logging.
  Source: <https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide#logging>

## Scope and evidence

The fixture has an HTTP function and a queue-triggered function. Both use the singleton
GreetingService registered by FunctionsStartup. Both receive a method-level ILogger.
The queue function reads a name through a blob input binding and writes a greeting
through a blob output binding. Check the staged baseline text files for the original
names, paths, connection setting, message encoding, output, and Information logs.
Moving the existing DI and logging is required, not an optional improvement.

The app has no deployment files, pipeline, orchestration, Durable Functions surface,
test project, or Azure resource. Do not require these absent features. Azurite is a
required, pre-provided local test environment. Missing storage E2E is blocked, not N/A.
The grader refuses pre-existing queue/container data and deletes only what it creates.

`grading-evidence/checklist.json` is produced by the independent deterministic grader and
is the sole authority for restore, build, publish, project SDK, package declarations,
host registration, HTTP behavior, packaging, and target framework. A judge may lower a
deterministic `pass` only by pointing at contradicting evidence inside that file or the
submitted source. A judge can never raise `fail`, `blocked`, or missing evidence to `pass`,
and never turns a report sentence or a transcript claim into an executed check.

Optional lint, vulnerability, or best-practice findings are reported separately. They are
not part of the definition of done and never change a requirement status.
