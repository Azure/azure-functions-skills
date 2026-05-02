# Azure Functions Diagnostics Reference — Dapr

Use this file when investigating Dapr bindings, Dapr service invocation, Dapr pub/sub, Dapr state, Dapr secret, or topic trigger behavior in Azure Functions.

## Bindings

- `daprBinding`
- `daprBindingTrigger`
- `daprInvoke`
- `daprPublish`
- `daprSecret`
- `daprServiceInvocationTrigger`
- `daprState`
- `daprTopicTrigger`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Extension and SDK integration paths |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior |

## Public documentation

| Topic | URL |
|------|-----|
| Dapr extension bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-dapr |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |

## Investigation notes

- If package versions are resolved through extension bundles, also check the extension bundle reference.