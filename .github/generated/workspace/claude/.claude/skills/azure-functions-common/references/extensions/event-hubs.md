# Azure Functions Diagnostics Reference — Event Hubs

Use this file when investigating Event Hubs trigger/output binding, checkpoints, partition ownership, connection, throughput, or scale behavior.

## Bindings

- `eventHubTrigger`
- `eventHub`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Event Hubs extension and SDK code paths |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime and scale behavior |

## Sparse checkout guidance

For `azure-sdk-for-net`, use `sdk/eventhub` and shared paths `sdk/core`, `sdk/identity`, and `sdk/extensions`.

## Public documentation

| Topic | URL |
|------|-----|
| Event Hubs bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-hubs |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Manage connections | https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections |

## Investigation guidance

- Include Event Hubs in message-trigger investigations when the symptom involves checkpoints, partition ownership, throughput, or trigger latency.
- For scale symptoms, inspect `azure-sdk-for-net` under `sdk/eventhub` and host scale behavior.