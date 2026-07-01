# Azure Functions Diagnostics Reference — Event Grid

Use this file when investigating Event Grid trigger/output binding, validation, delivery, retry, or event schema issues.

## Bindings

- `eventGridTrigger`
- `eventGrid`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Event Grid extension and SDK code paths |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime and indexing behavior |

## Sparse checkout guidance

For `azure-sdk-for-net`, use `sdk/eventgrid` and shared paths `sdk/core`, `sdk/identity`, and `sdk/extensions`.

## Public documentation

| Topic | URL |
|------|-----|
| Event Grid bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-grid |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation notes

- Include HTTP/host behavior when Event Grid validation or endpoint delivery is involved.