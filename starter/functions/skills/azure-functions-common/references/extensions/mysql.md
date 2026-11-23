# Azure Functions Diagnostics Reference — MySQL

Use this file when investigating MySQL input/output binding or MySQL trigger behavior.

## Bindings

- `MySql`
- `MySqlTrigger`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Extension and SDK integration paths |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior |

## Public documentation

| Topic | URL |
|------|-----|
| MySQL bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-azure-mysql |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Manage connections | https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections |

## Investigation notes

- If the issue involves package resolution from a non-.NET app, also check the extension bundle reference.