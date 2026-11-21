# Azure Functions Diagnostics Reference — Web PubSub

Use this file when investigating Web PubSub bindings, triggers, connection, request, or messaging behavior.

## Bindings

- `webPubSub`
- `webPubSubTrigger`
- `webPubSubConnection`
- `webPubSubRequest`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Web PubSub extension and SDK code paths |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior |

## Sparse checkout guidance

For `azure-sdk-for-net`, use `sdk/webpubsub` and shared paths `sdk/core`, `sdk/identity`, and `sdk/extensions`.

## Public documentation

| Topic | URL |
|------|-----|
| Web PubSub bindings | https://learn.microsoft.com/en-us/azure/web-pubsub/reference-functions-bindings |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Manage connections | https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections |