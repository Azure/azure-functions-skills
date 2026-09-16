# Fixed source rationale

Sources checked on **2026-09-15**. This file explains the offline grader
contract for reviewers. It is not supplied to the task agent or used by an
LLM judge.

## Original source snapshots

| App | Bundle tag | Cosmos DB | Event Hubs | Original host schema |
| --- | --- | --- | --- | --- |
| bundle-v1 | [1.8.1 manifest](https://github.com/Azure/azure-functions-extension-bundles/blob/1.8.1/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json) | 3.0.9 | 3.0.6 | Nested eventProcessorOptions |
| bundle-v2 | [2.36.0 manifest](https://github.com/Azure/azure-functions-extension-bundles/blob/2.36.0/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json) | 3.0.10 | 4.3.1 | Nested eventProcessorOptions |
| bundle-v3 | [3.41.0 manifest](https://github.com/Azure/azure-functions-extension-bundles/blob/3.41.0/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json) | 3.0.10 | 5.5.0 | Flat settings already in use |

The exact-version constraints identify the source snapshots. No bundle
binary or host resolution was executed for these fixtures. The original
runtime and Node version are not measured. These are source-contract
tests, not claims that each old bundle runs on a current Functions host.

The target uses the supported `[4.0.0, 5.0.0)` range (or equivalent
`[4.*, 5.0.0)`). The [4.39.1 release](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/4.39.1),
published 2026-09-04, reports Cosmos DB 4.16.1 and Event Hubs 6.5.3.
The range can resolve to a later release. Before live testing, record the
actual resolved version and review its release notes.

## Contract basis

- [Cosmos DB extension 3 to 4](https://learn.microsoft.com/en-us/azure/azure-functions/migrate-cosmos-db-version-3-version-4): the JavaScript model-v3 JSON properties change from collection to container names and from connectionStringSetting to connection. Lease properties change in the same metadata. Keep their values and the existing lease identity. Cosmos output documents already contain explicit IDs in this fixture.
- [Event Hubs host settings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-hubs#hostjson-settings): extensions 3/4 use nested eventProcessorOptions; extensions 5/6 use maxEventBatchSize and prefetchCount at the eventHubs level. batchCheckpointFrequency remains at that level.
- The maximum batch size **32** and prefetch count **64** are explicit fixture choices, not platform defaults. Both must remain unchanged. The bundle-v3 app already uses the flat schema. Its Event Hubs settings need no rename.
- Extension 6 changes the default maximum batch size from 10 to 100. The explicit value in these fixtures avoids that default change; this evaluation does not separately test migration of an omitted setting.

All functions keep their names, script paths and registration model.
The tests accept reordered binding arrays, equivalent bundle range syntax,
and different JavaScript implementations with the same checked outputs.
The functions remain dependency-free CommonJS model-v3 functions; this
grader is not a general JavaScript module loader.

## Evidence limits

The grader checks only named JSON contracts and synthetic empty/nonempty
batch outputs. It cannot establish trigger registration, network access,
identity permissions, lease continuation, serialization on the wire,
checkpoint recovery, or throughput. It does not prove the absence of all
semantic regressions. Review the source diff and run separately approved
service integration tests before deployment.
