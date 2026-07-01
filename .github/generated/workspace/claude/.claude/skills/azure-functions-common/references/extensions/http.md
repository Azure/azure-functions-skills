# Azure Functions Diagnostics Reference — HTTP

Use this file when investigating HTTP trigger/input-output behavior, routing, authorization level behavior, request/response handling, or host-level HTTP symptoms.

## Bindings

- `httpTrigger`
- `http`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host HTTP pipeline, routing, indexing, authorization integration |
| azure-webjobs-sdk | https://github.com/Azure/azure-webjobs-sdk | Core binding framework |

## Public documentation

| Topic | URL |
|------|-----|
| HTTP trigger and bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation notes

- HTTP issues often cross host, language worker, and language SDK boundaries.
- Include the relevant language file when the issue involves request body parsing, response serialization, streaming, or middleware.