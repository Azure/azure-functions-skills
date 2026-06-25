# Azure Functions Diagnostics Reference — Kafka

Use this file when investigating Kafka trigger/output binding, broker connectivity, consumer group behavior, offset behavior, or extension-specific failures.

## Bindings

- `kafkaTrigger`
- `kafka`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-kafka-extension | https://github.com/Azure/azure-functions-kafka-extension | Kafka extension implementation |
| confluent-kafka-dotnet | https://github.com/confluentinc/confluent-kafka-dotnet | Kafka .NET client dependency |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime and scale behavior |

## Public documentation

| Topic | URL |
|------|-----|
| Kafka bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-kafka |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Manage connections | https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections |

## Investigation guidance

- Treat Kafka extension investigations as a dedicated path because symptoms often involve broker configuration, consumer group behavior, and the Confluent client dependency.
- Include Kafka extension code when investigating scale behavior.