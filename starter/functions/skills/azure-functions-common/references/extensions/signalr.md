# Azure Functions Diagnostics Reference — SignalR Service

Use this file when investigating SignalR output binding, trigger, connection info, negotiation, endpoints, or messaging behavior.

## Bindings

- `signalR`
- `signalRTrigger`
- `signalRConnectionInfo`
- `signalREndpoints`
- `signalRNegotiation`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | SignalR extension and SDK code paths |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior |

## Sparse checkout guidance

For `azure-sdk-for-net`, use `sdk/signalr` and shared paths `sdk/core`, `sdk/identity`, and `sdk/extensions`.

## Public documentation

| Topic | URL |
|------|-----|
| SignalR Service bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-signalr-service |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Manage connections | https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections |