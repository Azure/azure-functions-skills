# Select a supported .NET route

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

Apply [stage decisions](route-decisions.md) to the observed dependencies and contracts.
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

Then load [conversion checks](dotnet-changes.md) for affected contracts only.
Use release/tag source when guidance and graph conflict or behavior depends on code.
Link each adopted obligation to [implementation and proof](requirements.md).

## Primary sources

- [Isolated migration](https://learn.microsoft.com/azure/azure-functions/migrate-dotnet-to-isolated-model):
  dated 2026-09-14, updated 2026-09-16.
- [Isolated guide](https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide):
  dated 2026-09-14, updated 2026-09-16.
- [Support table](https://learn.microsoft.com/azure/azure-functions/supported-languages):
  dated 2026-08-27, updated 2026-09-17.
