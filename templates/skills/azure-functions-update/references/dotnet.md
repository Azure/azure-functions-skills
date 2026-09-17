# .NET migration decisions and conversion checks

Use this reference in steps 3 through 5 of [the workflow](../SKILL.md).

Build a support tuple: host, execution model, TFM, OS, SKU, architecture, build SDK,
worker, and extensions. SDK selection, build TFM, and executing runtime are different.
Using a new SDK with an old TFM is not a runtime migration.

## Dated support evidence

The official pages below were accessed on 2026-09-17. These are research facts, not
permanent defaults:

- Functions 4.x in-process supports .NET 8 only. In-process support ends 2026-11-10.
- Isolated lists .NET 10, 9, 8, and .NET Framework 4.8.1.
- .NET 8 and 9 support ends 2026-11-10.
- The migration guide recommends .NET 10 for modern .NET.
- Linux Consumption cannot run .NET 10; .NET 9 is its last added .NET version.
- The guide uses `net48` for Framework dependencies. The support table lists the
  execution runtime as Framework 4.8.1. Confirm TFM, Windows, and hosting support separately.

Refresh applicable sources when planning/revising, before first dependent execution,
on resume, target change, or contradiction. Record URL, document/update date, access
date, target tuple, supporting extract, and uncertainty. No fixed cache TTL suffices.
If a source is unavailable, keep the route provisional. Stop dependent execution unless
the user accepts a specific evidence exception; do not invent support.

| Observed state | Candidate route |
| --- | --- |
| 4.x in-process .NET 8, modern dependencies | Combined isolated/new-TFM checkpoint, or isolated at the same supported TFM followed by TFM update |
| Framework-only dependency | Investigate an isolated Framework target and Windows constraints; do not force modern .NET |
| Host 1.x/2.x/3.x | Use the applicable host-version guide; preserve separate host/model/TFM/package evidence |
| Linux Consumption with .NET 10 requested | Select a supported temporary code target or request a separate Azure Skills hosting-plan decision |
| Broken baseline | Apply the conditional baseline gate in the workflow; never mark it passed |

Never retarget an in-process app to a TFM that in-process does not support.
A near-EOS intermediate requires an in-support work period, expiry, owner, rollback
point, risk, and the next supported target in the same plan. It is not final completion
and is not deployed by default.

Apply the stage decisions below to the observed dependencies and contracts.
Show the user the proposed tuple and reasons after research, before candidate restore.

## Resolve before final plan approval

Record candidate versions first. Approve project changes and restore before producing
the actual graph. Compare:

1. Selected .NET SDK and applicable `global.json`.
2. Functions project SDK, including `global.json` `msbuild-sdks`, resolved version/source.
3. Worker application dependency graph.
4. Generated host-extension dependency graph where applicable.

The reviewed isolated guide uses `Azure.Functions.Sdk/1.0.0` with an explicit
`Microsoft.Azure.Functions.Worker`. Its worker minima are 2.50.0 for .NET 10, 2.0.0 for
.NET 9, and 1.16.0 for .NET 8/Framework. Refresh them; do not treat minima as pins.

For this SDK, restore the Functions project directly. Solution/traversal restore does
not automatically run the post-restore hook for `obj\azure_functions.g.csproj` (AZFW0108).
Do not edit, reference, or directly build that generated helper. Do not require a legacy
metadata filename as universal proof; use the selected SDK's indexing mechanism.

Then use the conversion checks below for affected contracts only.
Use release/tag source when guidance and graph conflict or behavior depends on code.
Link each adopted obligation to [implementation and proof](plan.md).

## Choose stage order from observed risks

These are proposed decision rules, not measured trial results. Record the observation,
rejected alternative, expected benefit, and required proof for the selected route.

| Observation | Decision and reason | Evidence before acceptance |
| --- | --- | --- |
| Only the SDK changes; TFM/model stay fixed | A toolchain check, not a runtime migration; add a stage only if it isolates a real failure | Effective SDK, unchanged TFM, original build/tests and executing runtime |
| Model and TFM changes affect different contracts; a same-TFM isolated state supports required packages | Consider a same-TFM checkpoint to separate causes of regression | Supported intermediate and support window, model/serialization/binding checks, then TFM checks |
| No supported intermediate exists, or required packages cannot resolve there | Consider one coherent conversion; do not invent an unsupported stage | Supported final tuple, resolved graphs, original contract probes, rollback point |
| Baseline behavior is unknown or tests fail | Investigate or accept a conditional baseline; do not hide failures through stage selection | Classified cause, substitute contract, explicit risk acceptance |
| Shared libraries have other consumers | Identify model/TFM/API effects; isolate Functions-specific changes where feasible | Consumer paths and selected checks; inaccessible consumers remain an acceptance gap |
| Already isolated; bounded extension update without host/TFM/platform change | Prefer one compact checkpoint and affected contract checks | Version-specific change evidence, relevant tests, final agreed E2E |
| New TFM requires a different SKU | Separate code compatibility from platform migration | User-approved Azure Skills handoff; no silent SKU change |

Do not choose same-TFM isolation merely because it is familiar. Check package support
and the time-bounded support window. Do not combine stages merely to save steps:
check that available probes can diagnose failures and that recovery is practical.
Investigate or ask if neither route is supported by the facts.

For example, accepted HTTP fixtures and a supported current TFM can make same-TFM
isolation useful: compare serialization through the host before a later TFM change.
That separates model effects from framework effects. It is a decision pattern, not a
claim about the customer's code. Original expert rationale remains to be collected.
Stage count and agent count are not measures of quality.

## Conversion contracts

For each relevant row, record observed code, target change, original expected result,
and proof. Resolve APIs in planning; do not replace customer code with a sample.

| Surface | Preserve and investigate |
| --- | --- |
| Project/build | Output type, TFM, project SDK, worker/extensions, analyzers, shared consumers, CI SDK selection |
| Startup | Required registration, DI lifetimes, options, configuration sources, initialization |
| Function declarations | Map `[FunctionName]` to isolated `[Function]` and target namespaces; preserve names, routes, authorization, schedules, disabled state |
| HTTP | Choose built-in worker HTTP or ASP.NET Core integration from actual APIs; preserve body, status, headers, routes, serialization |
| Bindings | Map WebJobs packages to applicable worker extensions; preserve setting names, entities, input/output, cardinality, supported SDK types |
| Serialization | JSON naming, nulls, enums, dates, encoding, converters across the selected HTTP/worker pipelines |
| Logging/telemetry | Host and worker filters, correlation, telemetry, exception behavior |
| Runtime settings | Required worker/runtime settings and startup commands; cloud application is separate deployment work |
| Tests | Adapt host-specific adapters, not expected results merely to match new code |

For custom extensions, check the chosen SDK's discovery limits for derived
`WebJobsStartupAttribute` and project-reference `ExtensionInformationAttribute`.
A successful project build does not prove host extension discovery.

For message triggers, retain used batch/single shape, retry, settlement, lock/session,
duplicate handling, cancellation, checkpoint, and error behavior.
For Durable Functions, inspect orchestrator/activity/entity APIs, replay-safe code,
serialization, task-hub identity, and compatibility of persisted history.
Keep live instances and customer task hubs untouched. A new synthetic instance does
not prove that old history can resume. Require a version-specific migration strategy
and acceptance before making that claim.
For custom bindings, inspect the complete host, WebJobs SDK, extension, and worker
release path; package names alone do not establish compatibility.

Use focused `azure-functions-common` references for source pointers if available,
or official docs; do not load the whole common library.
If a target change requires a business-contract change, stop for a user decision.
Do not hide it in a test update. Keep mandatory changes separate from recommendations.

## Primary sources

- [Isolated migration](https://learn.microsoft.com/azure/azure-functions/migrate-dotnet-to-isolated-model):
  dated 2026-09-14, updated 2026-09-16.
- [Isolated guide](https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide):
  dated 2026-09-14, updated 2026-09-16.
- [Support table](https://learn.microsoft.com/azure/azure-functions/supported-languages):
  dated 2026-08-27, updated 2026-09-17.
- [Binding extensions](https://learn.microsoft.com/azure/azure-functions/functions-bindings-register):
  accessed 2026-09-17.
- [Durable isolated migration](https://learn.microsoft.com/azure/durable-task/durable-functions/durable-functions-migrate):
  updated 2026-08-03, accessed 2026-09-17.

The Durable guide has older project/SDK examples than the general migration guide.
Use its applicable API mapping, not those example versions as current build-SDK
authority. Resolve conflicts by target version and record release, commit, branch,
and conclusion. Use observed risks to select [behavior probes](validation.md).
