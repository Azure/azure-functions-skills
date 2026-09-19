# C# in-process to isolated worker

Use with the eleven steps in [SKILL.md](../SKILL.md). This scenario owns Functions
model/configuration work. It does not own the separate C#/.NET language or TFM update.
Do not copy a guide's new TFM into the model-only phase.

## Official sources and applicability

Research reviewed on 2026-09-18. Record current source dates and actual target applicability
in each migration plan; these snapshots are not permanent version pins.

| Source | Use |
| --- | --- |
| [Migration guide](https://learn.microsoft.com/azure/azure-functions/migrate-dotnet-to-isolated-model?tabs=net10) | Project, packages, startup, signatures, configuration, and deployment transition; page date 2026-09-14, source commit `f6a684c01948c31fa1bb769feced429f575c0090` |
| [Isolated worker guide](https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide) | Supported targets, SDK resolution, HTTP, logging, serialization, publish; page date 2026-09-14, source commit `c6ee03c9ef1c10cef4a9bc01a4b8d31192448490` |
| [Supported languages](https://learn.microsoft.com/azure/azure-functions/supported-languages) and [.NET support](https://dotnet.microsoft.com/platform/support/policy/dotnet-core) | Host/model/runtime/OS/plan support and expiry |
| [C# language versions](https://learn.microsoft.com/dotnet/csharp/language-reference/configure-language-version) and [SDK selection](https://learn.microsoft.com/dotnet/core/versions/selection) | Distinguish language syntax, SDK, runtime, and target framework |
| [Supported bindings](https://learn.microsoft.com/azure/azure-functions/functions-triggers-bindings#supported-bindings) | Find the official page for every trigger/input/output binding actually used |
| [Binding extensions](https://learn.microsoft.com/azure/azure-functions/functions-bindings-register) | Extension registration and package model |
| [Durable migration](https://learn.microsoft.com/azure/durable-task/durable-functions/durable-functions-migrate) | Durable API/history changes only when used; older SDK examples do not override current general SDK guidance |
| [Local development](https://learn.microsoft.com/azure/azure-functions/functions-develop-local) and [slots](https://learn.microsoft.com/azure/azure-functions/functions-deployment-slots) | Actual local checks and separately approved slot operations |

The migration guide assumes host 4.x. For host 1.x/2.x/3.x, consult the linked
[host upgrade guides](https://learn.microsoft.com/azure/azure-functions/migrate-version-3-version-4)
and the [1.x guide](https://learn.microsoft.com/azure/azure-functions/migrate-version-1-version-4).
Do not silently add host, language, or platform changes to this scenario.
Record unmet prerequisites and obtain a separate plan decision.
C# scripts need an explicitly scoped conversion to a project before this scenario.

At the research date, in-process host 4.x supports .NET 8 and reaches end of support
on 2026-11-10. Isolated supports .NET 8, 9, 10 and a .NET Framework path.
Confirm Framework TFM, executing runtime, Windows, and dependency support separately.
Linux Consumption cannot run .NET 10. Do not change it to Flex without a separate
Azure Skills decision. A near-EOS intermediate needs an owner, expiry, support window,
next target, and rollback point; it is not final completion of a requested later update.

## Additional prerequisites and baseline

Record the effective .NET SDK, executing runtimes/shared frameworks, `global.json`,
targeting packs, current TFM, test framework, and relevant build/CI settings.
A newer SDK building an old TFM is not a language/runtime migration.
Do not change runtime roll-forward to hide a missing runtime.
For Framework, check Windows reference assemblies/build tools and runtime separately.

Resolve effective `NuGet.Config`, machine/user/directory settings, package source mapping,
corporate feeds, authentication, proxy, TLS, cache, and permitted temporary paths.
Use approved existing configuration. No TLS bypass, permanent feed replacement, or
unrelated tool installation. See [NuGet configuration](https://learn.microsoft.com/nuget/consume-packages/configuring-nuget-behavior).

After inspecting hooks, record concrete commands and cwd in the plan, for example:

```text
dotnet --info
dotnet restore <Functions-project.csproj>
dotnet build <Functions-project.csproj> --no-restore
dotnet test <existing-test-project.csproj>
func start
```

These are templates, not approval to run. Identify the actual projects and test commands;
tests can invoke restore, scripts, or services. Start `func` from the approved project/output
directory with the correct SDK/Core Tools integration. Do not launch a second host
implicitly through another build command.
Record baseline outputs and business fixtures before changing expected behavior.
If no existing tests exist, record that fact; it does not remove trigger E2E requirements.

## Model/config conversion, with the current TFM unchanged

1. Confirm a supported same-TFM isolated target, compatible worker/extensions, host, OS,
   and SKU. Do not retarget in-process to a TFM it does not support. If no supported
   same-TFM path exists, show the actual support/package constraint, not just a build
   error. Mark model work blocked and use common steps 7 and 8 for an approved prerequisite
   language handoff. Record the model work that step 9 must finish afterward.
2. Change the project SDK to `Azure.Functions.Sdk` with an effective version, either inline
   or through `global.json` `msbuild-sdks`. The current guide requires this SDK for
   supported .NET 8/9/10 and Framework targets, not only after a TFM update.
   Keep `Microsoft.Azure.Functions.Worker` explicit. Remove `Microsoft.NET.Sdk.Functions`,
   `Microsoft.Azure.Functions.Worker.Sdk`, and `FunctionsEnableWorkerIndexing`.
   Remove redundant `OutputType` and `AzureFunctionsVersion` properties when following
   the new SDK's defaults; inspect custom build logic before changing it.
3. Resolve four distinct inputs: selected .NET SDK, Functions project SDK, application
   dependency graph, and generated host-extension graph. Restore the Functions project
   directly; solution/traversal restore alone can omit the extension post-restore hook.
   Do not edit, reference, or directly build `obj\azure_functions.g.csproj`.
   Check custom extension discovery: derived `WebJobsStartupAttribute` and project-reference
   `ExtensionInformationAttribute` metadata have documented limits.
4. Replace app-level WebJobs extension references/code with the applicable isolated
   `Microsoft.Azure.Functions.Worker.Extensions.*` APIs. Remove
   `Microsoft.Azure.Functions.Extensions`. Only add extensions the app uses.
   Legitimate WebJobs dependencies in the SDK-generated host project or transitive graph
   are not an app migration defect. Do not delete them or ban the name across all artifacts.
5. Move `FunctionsStartup` registrations to `Program.cs`; preserve service lifetimes,
   configuration, options, initialization, and middleware behavior. Remove the old class
   and assembly attribute after transfer. The process must build and run its host.
   DI migration is required independently of any HTTP integration choice.
6. Map `[FunctionName]` to `[Function]` while retaining exact function names.
   Update trigger/input/output attributes, arguments, and supported types from each
   binding's isolated documentation. Replace output parameters with supported return/
   multi-output shapes. Replace `IAsyncCollector<T>` or `IBinder` only with a supported
   output or client approach that retains the contract. Use `FunctionContext` where
   invocation context is needed; the threading `ExecutionContext` alias is not its substitute.
7. Convert method-parameter `ILogger` injection to constructor `ILogger<T>` or a supported
   `FunctionContext` logger. Separate host filters in `host.json` from worker filters.
   Preserve required levels, categories, correlation, exceptions, and telemetry.
   Follow the selected Application Insights or OpenTelemetry setup and target versions;
   do not enable both pipelines blindly or assume guide examples override app contracts.
8. For HTTP apps, select a supported HTTP model and keep startup, references, request/
   response types, serialization, and async stream I/O consistent. ASP.NET Core integration
   uses `ConfigureFunctionsWebApplication`, its HTTP extension, and applicable framework
   reference. The built-in worker HTTP path uses its supported types/startup instead.
   Do not force `Http.AspNetCore` into a non-HTTP app. The guide's recommendation to keep
   an ASP.NET shared-framework reference for performance is not a non-HTTP completion rule.
9. Preserve JSON property names, null/enum/date behavior, encoding, and output contracts.
   The default changes from Newtonsoft.Json to System.Text.Json can silently ignore old
   serialization attributes. Update attributes or configure the appropriate serializer.
   ASP.NET HTTP serialization and general worker serialization are distinct pipelines.
   Compare original fixtures; never rewrite expectations to match the migration.
10. Set local `FUNCTIONS_WORKER_RUNTIME` to `dotnet-isolated`. Preserve connection setting
    names and effective `host.json` values; translate version-specific extension settings
    if their schema changed. Worker-only configuration does not supply host binding settings.
    Propose matching deployment/IaC settings without deploying. Keep `host.json` in output
    and exclude secret-bearing local settings from commits and publish output.
11. Build, run existing tests, and apply the completion table below. A coherent conversion
    can have temporary errors, but its accepted checkpoint must meet its required gates.

Use the latest stable versions that are compatible with the approved tuple, and record
the resolved versions. As dated evidence, the guide lists Worker minima of 2.50.0 for
.NET 10, 2.0.0 for .NET 9, and 1.16.0 for .NET 8/Framework, with Functions SDK 1.0.0+.
The migration example uses Worker 2.52.0 and HTTP AspNetCore 2.1.0 for .NET 10.
Minima and examples are not permanent pins or permission to update the TFM.

## Binding and environment checks

For each used binding, save its isolated/version-specific source and chosen API mapping
in the plan. The [binding index](https://learn.microsoft.com/azure/azure-functions/functions-triggers-bindings#supported-bindings)
links Timer, Storage, Cosmos DB, Service Bus, Event Hubs, Event Grid, Durable, Kafka,
RabbitMQ, SQL, and other supported bindings. Follow only the relevant paths.
Preserve entity/connection names, cardinality, retries, settlement, sessions, cancellation,
checkpointing, duplicates, schedules, and shared-library consumers as applicable.

For Durable, check orchestrator/activity/entity APIs, replay safety, serializer, task-hub
identity, and persisted-history compatibility. Keep customer hubs and live instances untouched.
A new synthetic orchestration does not prove existing history can resume.

Choose checks from observed risks: JSON fixtures, HTTP valid/error responses, controlled
message success/failure, partition/checkpoint behavior, timer semantics, Durable replay,
and custom binding discovery. Use only approved environments. Do not inject failure or
restart tests into a live service. No universal log line proves every listener is ready.

Event Grid [local replay](https://learn.microsoft.com/azure/azure-functions/event-grid-how-tos)
can test host dispatch for the selected schema. It does not prove subscription validation,
delivery/retry, filtering, dead-lettering, or real identity. The reviewed guidance identifies
no official Event Grid or Key Vault emulator; do not claim universal nonexistence.
Azurite covers selected Storage APIs, not all services or production scale.
Service Bus/Event Hubs emulator restart loses data/entities and cannot prove production
retention. Check exact images, dependencies, transports, identity limits, and persistence.
For [Cosmos Linux vNext](https://learn.microsoft.com/azure/cosmos-db/emulator-linux),
some APIs return success without implementation; .NET needs HTTPS. Check telemetry and
approved certificate trust. An emulator health probe is not a Functions listener check.

## Separate .NET language handoff

Only enter common step 8 for a requested/approved update or an approved prerequisite.
Use the official [GitHub Copilot upgrade installation guide](https://learn.microsoft.com/dotnet/core/porting/github-copilot-upgrade/install?pivots=github-copilot-app).
Its page date is 2026-07-07, source commit `ca3e7fc9decaf56fe2e2494b52d223d0083ba51d`.
It uses the `microsoft/upgrade-agent-plugins` marketplace and `upgrade-agent` plugin.
Follow the instructions for the actual client; do not silently install it.

The public plugin at commit `681dbf0b0dc470f63776f44728e76bbc6acc5c45`, version 1.1.539,
has the scenario
[`dotnet-version-upgrade`](https://github.com/microsoft/upgrade-agent-plugins/blob/681dbf0b0dc470f63776f44728e76bbc6acc5c45/plugins/upgrade-agent/upgrade/dotnet/skills/scenarios/dotnet-version-upgrade/SKILL.md).
This is the verified name for the user's intended `dotnet-version-update` handoff.
It declares `requires-extension: upgrade-dotnet` and `metadata.discovery: scenario`.
It is not necessarily an independently exposed skill callable by that name.

The [Upgrade agent entry](https://github.com/microsoft/upgrade-agent-plugins/blob/681dbf0b0dc470f63776f44728e76bbc6acc5c45/plugins/upgrade-agent/agents/upgrade.agent.md)
uses its MCP's state/scenario/instruction discovery. The documented App agent is
`upgrade-agent:upgrade`; the CLI installation guide uses `upgrade-agent`.
Discover actual exposed capabilities and select the verified scenario through that agent.
If direct delegation is unavailable, give the user the agent-switch instructions and
the saved handoff packet. Do not invent a direct `dotnet-version-update` tool.
If a later version uses another name, verify its actual definition before use.

Plugin installation and MCP startup can download software; the published MCP uses
`dnx Microsoft.GitHubCopilot.Upgrade.Mcp`. Do not start it merely to probe availability.
Review its feed/download behavior and obtain permission. The third-party agent can
require its own confirmation UI; supplied answers do not guarantee unattended operation.
If the client cannot use the prepared answers, record a blocked handoff, not permission
to bypass the UI.

Include target TFM/projects, permitted toolchain changes, baseline/checkpoint, incomplete
model work, completed Functions settings, original behavior, Git-operation permissions,
and all pending completion IDs. The external agent must not redo accepted model work,
change SKU, create branches/commits, or expand scope without authorization.
Its `azure-functions-upgrade` scenario is not a reason to restart this model migration.
On return, review the diff and finish common step 9 before final acceptance.

## Functions follow-up after the language stage

Check the selected TFM, effective SDK resolution, CI/build/publish paths, and compatible
Worker/extensions again. Use `net10.0` only when .NET 10 is the approved destination.
If the model phase completed, retain `Azure.Functions.Sdk` and the explicit Worker
reference. Requirements applicable to that completed model-only phase must not have
been deferred until the language update.
If the model phase was blocked on a language prerequisite, apply the recorded full
model/config conversion now in a distinct phase, including project SDK, Worker, DI,
bindings, serialization, and settings. Evaluate DI-01 through DI-16 on this artifact;
do not report the blocked earlier phase as passed.

For the approved modern .NET update, ensure the effective project includes:

```xml
<Using Include="System.Threading.ExecutionContext" Alias="ExecutionContext" />
```

It can be in the project or an actually imported configuration file. A file that is
not imported, or a commented example, is not evidence. Apply it earlier if the selected
model-stage guide requires it. Reconcile invocation-context usages separately.

Rerun direct project restore/build, existing tests, host registration/log checks, and
required E2E against the returned artifact. Recheck every applicable ID and invalidate
prior proof affected by SDK, dependencies, configuration, or source changes.
Do not infer failure from a missing legacy `functions.metadata` file: verify the selected
SDK's actual indexing and packaging behavior.

## Definition of done

These stable IDs are shared by planning, phase review, final review, and evaluation.
For each app and phase, record `pass`, `fail`, `blocked`, or `not-applicable`, with artifact,
proof, and applicability reason. A future check can be pending in the live plan; at delivery,
missing required proof is blocked. N/A needs a condition below, not a tool or permission gap.
Optional improvements do not change this required checklist.

| ID | Required condition | Evidence and applicability |
| --- | --- | --- |
| DI-01 | Supported host/model/TFM/OS/SKU/toolchain tuple; model stage keeps its current TFM | Dated support, effective project values, phase diffs; unavailable support or required prerequisite remains blocked |
| DI-02 | Restore and build succeed | Direct Functions project commands, exit results, effective SDK and application/host-extension graphs for the current artifact |
| DI-03 | Existing unit/local tests succeed | Actual commands and original expectations; N/A only if inventory proves no such tests exist, not when they cannot run |
| DI-04 | `func` starts with expected functions, required listeners, and expected logs without unresolved errors | Expected versus actual function inventory, host/worker/listener evidence and redacted logs; function list alone is insufficient |
| DI-05 | Agreed trigger E2E succeeds with original business outputs | Input, environment, actual result, expected result, and artifact for each scenario; unavailable/denied required service checks are blocked, not N/A |
| DI-06 | Explicit `Microsoft.Azure.Functions.Worker` reference resolves compatibly | Actual app package declaration and resolved graph; central version management is allowed |
| DI-07 | App direct WebJobs/legacy Functions packages and code are migrated | App references/imports/types replaced with applicable Worker/extension APIs; generated host-extension and legitimate transitive WebJobs dependencies are excluded from the prohibition |
| DI-08 | Function attributes, trigger/input/output types and arguments are isolated-compatible | Per-function mapping retains names, routes, authorization, cardinality and outputs; no unsupported collector/binder/signature remains |
| DI-09 | `Program.cs` owns required DI/startup and starts the worker host | Registrations/lifetimes/configuration preserved; old `FunctionsStartup` class/attribute removed; no old startup is required when none existed |
| DI-10 | Isolated logging and telemetry preserve required behavior | Supported logger acquisition, separate host/worker filters, selected telemetry path, expected logs and correlation; no blanket new telemetry requirement |
| DI-11 | HTTP integration, startup, types, async I/O, and HTTP serialization agree | Applicable official HTTP mode and runtime requests; N/A for no HTTP triggers, not an obligation to add HTTP dependencies |
| DI-12 | JSON and output contracts remain unchanged | Original fixtures for names/nulls/enums/dates/encoding and current outputs; account for Newtonsoft attributes and separate serializer pipelines |
| DI-13 | Worker/runtime configuration and binding settings are correct | Local `dotnet-isolated`, retained connection names, effective `host.json`, proposed deployment config; proposals do not prove deployed state |
| DI-14 | Current Functions project SDK and compatible build setup are effective | `Azure.Functions.Sdk` inline or effective `global.json`, no obsolete Worker.Sdk/indexing property, correct generated-helper handling and SDK-compatible output; apply target-required alias/config now even without a language update |
| DI-15 | Packaging includes required host configuration and excludes local secrets/settings | Effective output/publish settings and applicable artifact inspection; no secret-bearing file in the diff; do not deploy to prove packaging |
| DI-16 | Used binding, Durable, and shared-consumer contracts are preserved | Selected behavior/replay/consumer evidence; N/A only for absent surfaces with inventory proof; new Durable instances do not prove old history |
| DI-POST-01 | After language handoff, the effective TFM and affected toolchain/CI paths match the approved destination | Returned diff and resolved values; `net10.0` only for approved .NET 10; N/A if no language stage is requested/needed |
| DI-POST-02 | Modern .NET follow-up has the effective threading `ExecutionContext` alias | Project or actually imported configuration; N/A for no language stage or a Framework path whose applicable guide does not require it; earlier applicable rules remain under DI-14 |
| DI-POST-03 | Functions follow-up and all affected checks pass on the returned artifact | New restore/build/tests/host/E2E evidence and ID reconciliation; N/A only if no language stage; requested but unavailable handoff stays blocked |

For a mixed app, evaluate DI-11 and DI-16 per applicable surface instead of marking the
whole row N/A because one function lacks that feature.
No language stage makes conditional POST rows N/A with a reason. A requested but missing
handoff makes them blocked. A genuine unchanged baseline test failure stays a reported
failure/exception, not passing DI-03.
Final requested-scope completion needs all applicable mandatory checks and cleanup.
Retain useful partial model results when E2E, language handoff, or platform checks block.
