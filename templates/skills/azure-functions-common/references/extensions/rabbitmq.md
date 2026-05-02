# Azure Functions Diagnostics Reference — RabbitMQ

Use this file when investigating RabbitMQ trigger/output binding, broker connectivity, queue behavior, authentication, or extension-specific failures.

## Bindings

- `rabbitMQTrigger`
- `rabbitMQ`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-rabbitmq-extension | https://github.com/Azure/azure-functions-rabbitmq-extension | RabbitMQ extension implementation |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior |

## Public documentation

| Topic | URL |
|------|-----|
| RabbitMQ bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-rabbitmq |
| RabbitMQ extension wiki | https://github.com/Azure/azure-functions-rabbitmq-extension/wiki |
| RabbitMQ getting started | https://www.rabbitmq.com/getstarted.html |
| .NET RabbitMQ client API guide | https://www.rabbitmq.com/dotnet-api-guide.html |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |

## Investigation guidance

- Use the public RabbitMQ docs and the extension wiki as primary references for broker behavior and language samples.
- Treat RabbitMQ extension investigations as a dedicated path because symptoms often involve broker connectivity, queue behavior, and authentication.