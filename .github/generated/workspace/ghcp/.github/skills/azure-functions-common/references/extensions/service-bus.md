# Azure Functions Diagnostics Reference — Service Bus

Use this file when investigating Service Bus trigger/output binding, sessions, settlement, lock renewal, connection, or scale behavior.

## Bindings

- `serviceBusTrigger`
- `serviceBus`

## Public repositories

| Repository | URL | Use |
| ----------- | ----- | ----- |
| azure-webjobs-sdk | <https://github.com/Azure/azure-webjobs-sdk> | Core binding pipeline, trigger indexing, and name resolution |
| azure-sdk-for-net | <https://github.com/Azure/azure-sdk-for-net> | Service Bus extension and SDK code paths |
| azure-functions-host | <https://github.com/Azure/azure-functions-host> | Host/runtime and scale behavior |

## Sparse checkout guidance

For `azure-sdk-for-net`, use `sdk/servicebus` and shared paths `sdk/core`, `sdk/identity`, and `sdk/extensions`.

## Public documentation

| Topic | URL |
| ------ | ----- |
| Service Bus bindings | <https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus> |
| Best practices | <https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices> |
| Manage connections | <https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections> |

## Investigation guidance

- Include Service Bus in message-trigger investigations when the symptom involves delivery, sessions, lock renewal, settlement, retries, or trigger latency.
- Include `azure-webjobs-sdk` when the symptom involves binding indexing, `%SETTING%` name resolution, binding metadata, or core trigger pipeline behavior.
- For scale symptoms, inspect `azure-sdk-for-net` under `sdk/servicebus` and host scale behavior.
