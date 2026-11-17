# Azure Functions Diagnostics Reference — Redis

Use this file when investigating Redis triggers, Redis output binding, pub/sub, streams, list trigger behavior, connection, or scale behavior.

## Bindings

- `redisPubSubTrigger`
- `redisStreamTrigger`
- `redisListTrigger`
- `redis`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-redis-extension | https://github.com/Azure/azure-functions-redis-extension | Redis extension implementation |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime and scale behavior |

## Public documentation

| Topic | URL |
|------|-----|
| Redis bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-cache |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Manage connections | https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections |

## Investigation guidance

- Include `azure-functions-redis-extension` when investigating Redis scale symptoms, trigger latency, pub/sub, stream, or list trigger behavior.