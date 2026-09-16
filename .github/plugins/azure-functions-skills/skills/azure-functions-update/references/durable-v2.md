# Durable Functions Extension Migration

Use this reference for the Durable Functions extension version, not the language programming model or the isolated worker package version.

- Start with [migration from 1.x to 2.x](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-versions#migrate-from-1x-to-2x).
- To select a current target, use the [version summary](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-versions#version-summary). Do not assume v2 is the latest release.
- If orchestration instances are running, use [deployment with no downtime](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-zero-downtime-deployment).

Check the task hub name and stored state before a deployment. The default task hub name changes between v1 and v2. Do not replace storage, delete state, or change the storage provider as an implicit part of this update.

## Extension v1 to v2

Sources checked on **2026-09-15**. The
[versions guide](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-versions)
was updated on 2026-08-03. Bundle 1 includes DurableTask 1.x in the
[observed releases](bundles-v4.md); current bundle 4 can cross both the
DurableTask 1-to-2 and 2-to-3 boundaries.

Move applicable host settings into the documented `storageProvider`,
`tracing`, and `notifications` structure. The default task hub changes
from `DurableFunctionsHub` to an app-derived name. Preserve the old hub
explicitly or plan a safe state migration; a different hub can leave
existing orchestrations without workers.

Change source client bindings from `orchestrationClient` to `durableClient`
where applicable. Raising an event to a nonexistent instance changes from
a silent failure to an exception; inspect caller error handling. Python
Durable requires extension 2 or later, so do not describe Python
Durable-v1 as a supported starting point.

## Extension v2 to v3

The [v2-to-v3 migration section](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-versions#migration-from-webjobsextensionsdurabletask-v2x-to-v3x)
does not prescribe application-code changes for this extension upgrade.
For non-.NET apps, it identifies bundle **4.22.0** as the transition.
The Azure Storage backend changes SDKs and message text encoding.

Do not assume any earlier bundle is a safe rollback target. The guide
requires DurableTask **2.13.5 or later** for the documented in-process
downgrade compatibility. For example, bundle 4.17.0 contains 2.13.2,
so a simple rollback to that bundle does not meet the stated minimum.
Check the exact resolved package, persisted message format, worker model,
and release guidance before approving rollback.

## Netherite and storage providers

Do not apply Azure Storage backend details unchanged to Netherite.
Identify the existing provider and its extension version first.
The [provider comparison](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-storage-providers)
(updated 2026-06-02) states that Netherite does not support identity-based
connections or Flex Consumption. It gives a support end date of
**2028-03-31**, not an already completed retirement at the check date.

There is no supported automatic state migration between provider backends.
Do not change provider, task hub, hosting plan, or authentication as an
implicit bundle update. Plan separately approved state handling and
integration tests for running instances, replay, external events and
rollback. A host.json edit or an offline test cannot prove durable-state
compatibility.