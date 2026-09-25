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
through a blob output binding. These contracts come from the original source, not
from a migration answer supplied to the agent:

- `Hello` keeps anonymous GET `/api/hello`, HTTP 200, and plain-text responses
  `Hello, world!` without a name and `Hello, <name>!` with a name query parameter.
- `QueueGreeting` consumes a base64-encoded request ID from `greeting-requests`.
  Its input binding reads `greeting-input/<request ID>.txt`; its output binding writes
  `greeting-output/<request ID>.txt`. Input `Storage` produces `Hello, Storage!`.
  Both bindings keep the `AzureWebJobsStorage` connection setting.
- Both functions keep singleton `GreetingService` injection. Information calls keep
  `HTTP greeting: {Greeting}` and `Queue greeting {RequestId}: {Greeting}`.
- Keep extension trigger, input, and output bindings; do not replace them with
  application SDK calls. Keep the effective `host.json` settings.

Moving the existing DI and logging is required, not an optional improvement.

The app has no deployment files, pipeline, orchestration, Durable Functions surface,
test project, or Azure resource. Do not require these absent features. Azurite is a
required, pre-provided local test environment. Missing storage E2E is blocked, not N/A.
The three fixture resource names are evaluation-owned. The trusted local runner
authorizes the grader to reset them before its independent E2E and remove them after it.

The code-only-v1 bundle contains typed statuses from the independent deterministic
grader. It is the authority for restore, build, publish, project SDK, package declarations,
host API inventory, HTTP and storage behavior, local settings, packaging, and target
framework. DI-03 is N/A only when the grader finds no test project. DI-POST-01 through
DI-POST-03 are N/A because no language stage was requested.

DI-04 does not inspect host logs. DI-10 is a source-only judge gate: the deterministic
status only permits review, not acceptance of logging behavior. Check worker-compatible
logging, Information level, and both original message templates in code. Emitted logs
and telemetry delivery are not assessed. The bundle excludes all raw logs, transcripts,
agent reports, generated files, and local settings. Report quality and transcript actions
are not assessed. Do not require these excluded inputs.

A judge may lower a machine `pass` by citing a contradiction in the submitted code.
It can never raise `fail`, `blocked`, or missing evidence to `pass`.

Optional lint, vulnerability, or best-practice findings are reported separately. They are
not part of the definition of done and never change a requirement status.
