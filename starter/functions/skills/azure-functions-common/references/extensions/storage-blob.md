# Azure Functions Diagnostics Reference — Storage Blob

Use this file when investigating Blob trigger, Blob input/output binding, polling, receipts, connection, or scale behavior.

## Bindings

- `blobTrigger`
- `blob`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-webjobs-sdk | https://github.com/Azure/azure-webjobs-sdk | Storage extension and binding framework |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime and indexing behavior |
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Storage SDK and newer extension code paths |

## Sparse checkout guidance

For `azure-sdk-for-net`, use `sdk/storage` when the issue involves Storage SDK or extension internals.

## Public documentation

| Topic | URL |
|------|-----|
| Blob bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-blob |
| Recover a storage account | https://learn.microsoft.com/en-us/azure/azure-functions/functions-recover-storage-account |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |

## Investigation guidance

- Include Blob in message-trigger investigations when the symptom involves event delivery, retries, or trigger latency.
- For scale symptoms, inspect Storage extension code paths and host scale behavior.