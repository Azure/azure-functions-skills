# Binding Extensions

Use this reference when a used binding changes version or execution model. Read only the rows for bindings used by the app.

| Binding | Official reference |
| --- | --- |
| Blob Storage | [Blob extension](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-blob) |
| Queue Storage | [Queue extension](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-queue) |
| Tables | [Table extension](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-table) |
| Cosmos DB | [Cosmos DB extension](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-cosmosdb-v2) |
| Service Bus | [Service Bus extension](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus) |
| Event Hubs | [Event Hubs extension](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-hubs) |
| Event Grid | [Event Grid extension](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-grid) |
| RabbitMQ | [RabbitMQ extension](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-rabbitmq) |
| HTTP | [HTTP binding](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook) |
| Timer | [Timer binding](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer) |

Select the language, model, and extension version on the page. For another binding, use [supported bindings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings#supported-bindings). For host compatibility, use [minimum extension versions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions#minimum-extension-versions).

## Bundle migration checks

Sources checked on **2026-09-15**. First use the
[tagged bundle comparison](bundles-v4.md) to identify the actual extension
transition. Read only the following sections for bindings used by the app.

### Cosmos DB extension 3 to 4

Use the [migration guide](https://learn.microsoft.com/en-us/azure/azure-functions/migrate-cosmos-db-version-3-version-4)
(updated 2026-09-02). For `function.json` metadata:

| Old property | New property |
| --- | --- |
| connectionStringSetting | connection |
| collectionName | containerName |
| leaseConnectionStringSetting | leaseConnection |
| leaseCollectionName | leaseContainerName |
| createLeaseCollectionIfNotExists | createLeaseContainerIfNotExists |
| leasesCollectionThroughput | leasesContainerThroughput |
| leaseCollectionPrefix | leaseContainerPrefix |

Remove unsupported `useMultipleWriteLocations`, `checkpointInterval`, and
`checkpointDocumentCount` options. Preserve database/container names,
connection setting references, lease prefix and lease location. Do not
reset checkpoints or create a new lease identity as an implicit migration.
Output bindings no longer generate item IDs automatically; ensure each
output document has an explicit `id`. Existing trigger/input business logic
does not generally need a rewrite.

Use the correct registration surface:

| Language/model | Edit |
| --- | --- |
| JavaScript model v3, Python model v1, PowerShell | Source `function.json` |
| JavaScript model v4 | Code-based registration options |
| Python model v2 | Decorators, such as `container_name`, `connection`, and `lease_container_name` |
| Java | Source annotations and a compatible azure-functions-java-library version, at least 3.0.0 |

For Java, do not replace every annotation name with a JSON name. The
[CosmosDBTrigger annotation](https://github.com/Azure/azure-functions-java-library/blob/dev/src/main/java/com/microsoft/azure/functions/annotation/CosmosDBTrigger.java)
still exposes `leaseConnectionStringSetting`; some old checkpoint members
also remain in the library even though the extension removed those options.
Check the installed library and the
[language-specific trigger reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-cosmosdb-v2-trigger).
Do not edit generated Java metadata as the source of truth.

With identity-based connections, automatic lease-container creation is
not allowed. Provision the container separately with approval. Do not
switch authentication or create resources as an implicit bundle update.

### Event Hubs extension 3/4 to 5/6

Use the [version-specific host settings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-hubs#hostjson-settings).
For an old nested configuration, move
`extensions.eventHubs.eventProcessorOptions.maxBatchSize` to
`extensions.eventHubs.maxEventBatchSize`, and move nested `prefetchCount`
to `extensions.eventHubs.prefetchCount`. Remove the obsolete nested
object after its applicable settings are migrated.

Keep `batchCheckpointFrequency` at the `eventHubs` level. Preserve explicit
values, binding cardinality, consumer group, and connection references.
If the source already uses extension 5, keep its valid flat settings.
The default maximum batch size changes from **10 to 100 in extension 6.0.0**.
If the old app omitted it, decide whether to preserve the old effective
value explicitly. Documentation values such as 256 and 512 are examples,
not defaults. Check latency, memory use, and restart/checkpoint behavior
in a separately approved integration test.

### Event Grid extension 2 to 3

Read [Considerations](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-grid#considerations)
(page updated 2026-06-03). Extension 3 adds CloudEvents support; older
versions do not support that schema. The .NET SDK binding types also change.
For JavaScript, Python, Java and PowerShell, inspect the actual event
schema and payload handling rather than applying .NET type replacements.
A bundle change does not require conversion from Event Grid schema to
CloudEvents. Event Grid trigger webhook settings use the HTTP trigger's
host configuration. Verify delivery and output envelopes with a real
subscription only when such integration work is approved.

### RabbitMQ extension 1 to 2

This transition occurs in bundle v4; it is not a RabbitMQ extension-v4
upgrade. The [v2.0.0-preview release](https://github.com/Azure/azure-functions-rabbitmq-extension/releases/tag/v2.0.0-preview)
(2022-03-03) removes separate hostname, port, username and password
properties. The [v2.0.0 GA release](https://github.com/Azure/azure-functions-rabbitmq-extension/releases/tag/v2.0.0)
(2022-07-05) links that breaking-change notice.

Replace legacy `hostName`, `port`, `userNameSetting` and `passwordSetting`
metadata with `connectionStringSetting`, which names an app setting
containing the complete RabbitMQ connection URI. Keep credentials out of
source and reports; arrange the setting through the user's approved secret
configuration. Preserve queue identity and TLS certificate validation.

Some Learn tables still show old properties under v2 tabs. For the removal
claim, use the dated release and
[tagged v2 trigger implementation](https://github.com/Azure/azure-functions-rabbitmq-extension/blob/v2.0.0/extension/WebJobs.Extensions.RabbitMQ/Trigger/RabbitMQTriggerAttribute.cs).
Check the matching output binding and language library as applicable.
Do not disable certificate validation to make a migration pass.

### Storage aggregate extension 3/4 to 5

The [Storage changelog](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/storage/Microsoft.Azure.WebJobs.Extensions.Storage/CHANGELOG.md)
dates Storage 5.0.0 GA to 2021-10-26. Storage 5 separates Blob and Queue
functionality into service-specific extensions. The aggregate no longer
provides the old Table binding; check that the bundle includes the separate
Tables extension. For explicit-package apps, review package references
instead of adding a bundle.

BCL/POCO binding scenarios are documented as drop-in cases. Advanced
SDK-type bindings and custom options can need changes. Do not prescribe
.NET SDK type replacements for every JavaScript, Python, Java or PowerShell
binding. Check its representation and wire behavior.

The [Blob changelog](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/storage/Microsoft.Azure.WebJobs.Extensions.Storage.Blobs/CHANGELOG.md)
records the Azure Storage SDK v12 transition and removal of
`BlobsOptions.CentralizedPoisonQueue`; the poison queue is in the target
blob account. Check access to that account.

Do not claim that Storage 5 universally removes base64 queue encoding.
The [Queue changelog](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/storage/Microsoft.Azure.WebJobs.Extensions.Storage.Queues/CHANGELOG.md)
records its removal in 5.0.0-beta.1 and restoration as the default in beta.2
for compatibility. Preserve the app's effective encoding and test existing
messages before changing it. Preview behavior is not the GA contract.

For DurableTask, including task-hub and provider risks, read
[Durable migration](durable-v2.md) separately.