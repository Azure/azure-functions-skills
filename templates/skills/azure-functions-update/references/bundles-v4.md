# Extension Bundles v4

Use this reference to update bundle v1, v2, or v3 to v4. Sources below were
checked on **2026-09-15**. Start with the official
[upgrade guidance](https://learn.microsoft.com/en-us/azure/azure-functions/extension-bundles#upgrade-extension-bundles).
Compiled .NET apps use explicit extension packages, not bundles.

## Identify the actual extension changes

1. Read `host.json` and identify used bindings in source registration files.
2. Record the actual old bundle version from existing host logs or the
   deployed bundle manifest when available. A range alone does not establish
   which release ran. Do not connect to Azure only to complete local work.
3. Compare that version with the proposed resolved v4 release. Use both
   the tagged `extensions.json` and release notes: some manifests specify
   `majorVersion`, not a resolved package version.
4. Apply only the relevant changes in [Binding extensions](extensions.md)
   and, if used, [Durable Functions](durable-v2.md). Preserve the programming
   model, resource names, app-setting names, lease identity and effective
   processing settings unless their change is approved.
5. Set the normal supported range to `[4.0.0, 5.0.0)`. Keep host schema
   `"version": "2.0"` separate from bundle and Functions runtime versions.
   Record the resolved target after validation; the range can select a
   newer minor release later.

Do not replace a bundle range and declare the migration complete. JSON can
parse successfully while its binding properties are no longer supported.
Check source contracts offline, then distinguish them from host registration
and service integration checks. Do not claim deployment or message-processing
success without that evidence.

## Representative tagged contents

All extension columns refer to `Microsoft.Azure.WebJobs.Extensions.*`.
Storage is the aggregate extension, not an Azure Storage SDK version.
These are **discrete observations, not complete per-major version ranges**.
The publication dates are GitHub release dates, not verified CDN availability.

| Bundle / published UTC | CosmosDB | EventHubs | EventGrid | RabbitMQ | Storage | DurableTask |
| --- | --- | --- | --- | --- | --- | --- |
| [1.0.0](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/1.0.0) / 2019-04-11 | 3.0.3 | 3.0.3 | 2.0.0 | absent | 3.0.4 | 1.8.0 |
| [1.8.1](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/1.8.1) / 2021-08-23 | 3.0.9 | 3.0.6 | 2.1.0 | 1.0.0 | 3.0.11 | 1.8.7 |
| [2.0.0](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/2.0.0) / 2020-06-18 | 3.0.7 | 4.1.1 | 2.1.0 | absent | 4.0.2 | 2.2.2 |
| [2.36.0](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/2.36.0) / 2025-10-28 | 3.0.10 | 4.3.1 | 2.1.0 | 1.1.0 | 4.0.5 | 2.12.0 |
| [3.0.0](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/3.0.0) / 2021-05-04 | 3.0.7 | 4.1.1 | 2.1.0 | absent | 5.0.0-alpha.20201102.1 | 2.3.1 |
| [3.41.0](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/3.41.0) / 2025-10-28 | 3.0.10 | 5.5.0 | 3.5.0 | 1.1.0 | 5.3.3 | 2.13.7 |
| [4.0.2](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/4.0.2) / 2022-12-08 | 4.0.0-rc | 5.1.2 | 3.2.1 | 2.0.3 | 5.0.1 | 2.8.1 |
| [4.17.0](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/4.17.0) / 2024-05-16 | 4.6.1 | 5.5.0 | 3.4.1 | 2.0.3 | 5.3.0 | 2.13.2 |
| [4.22.0](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/4.22.0) / 2025-05-15 | 4.9.0 | 5.5.0 | 3.4.3 | 2.0.3 | 5.3.3 | 3.0.3 |
| [4.39.1](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/4.39.1) / 2026-09-04 | 4.16.1 | 6.5.3 | 3.5.0 | 2.1.0 | 5.3.7 | 3.15.0 |

Tagged source manifests:
[1.0.0](https://github.com/Azure/azure-functions-extension-bundles/blob/1.0.0/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json),
[1.8.1](https://github.com/Azure/azure-functions-extension-bundles/blob/1.8.1/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json),
[2.0.0](https://github.com/Azure/azure-functions-extension-bundles/blob/2.0.0/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json),
[2.36.0](https://github.com/Azure/azure-functions-extension-bundles/blob/2.36.0/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json),
[3.0.0](https://github.com/Azure/azure-functions-extension-bundles/blob/3.0.0/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json),
[3.41.0](https://github.com/Azure/azure-functions-extension-bundles/blob/3.41.0/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json),
[4.0.2](https://github.com/Azure/azure-functions-extension-bundles/blob/4.0.2/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json),
[4.17.0](https://github.com/Azure/azure-functions-extension-bundles/blob/4.17.0/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json),
[4.22.0](https://github.com/Azure/azure-functions-extension-bundles/blob/4.22.0/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json),
[4.39.1](https://github.com/Azure/azure-functions-extension-bundles/blob/4.39.1/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json).

The 3.0.0 release has an empty body; its row is tagged-source evidence,
including the alpha Storage version, not binary verification. The v4 rows
use release bodies for resolved versions where manifests use major selectors.
No binaries were executed to create this table. 4.39.1 was the latest stable
release found at the check date, not a permanent target recommendation.

Important consequences:

- Bundle 3 does not always contain Event Hubs 5. Early and late bundle-3
  apps can need different host settings.
- Bundle 4 itself crosses Event Hubs 5 to 6 and DurableTask 2 to 3.
  Review minor bundle updates as well as the initial major update.
- Bundle 4 is not RabbitMQ extension 4. The observed RabbitMQ transition
  is extension 1 to 2.
- If the old resolved version is unknown, list the possible changes and
  the missing evidence. Do not assign one extension version to its entire
  bundle major or invent a complete compatibility range.