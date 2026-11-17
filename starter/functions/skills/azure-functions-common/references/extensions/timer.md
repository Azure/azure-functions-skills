# Azure Functions Diagnostics Reference — Timer

Use this file when investigating timer trigger schedule, missed execution, singleton, host ID, storage, or schedule monitor issues.

## Bindings

- `timerTrigger`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-webjobs-sdk-extensions | https://github.com/Azure/azure-webjobs-sdk-extensions | Timer extension implementation |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host scheduling, startup, and runtime behavior |

## Public documentation

| Topic | URL |
|------|-----|
| Timer trigger | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation notes

- Timer behavior can depend on host storage and host ID configuration.
- Check host logs before assuming language-worker behavior.