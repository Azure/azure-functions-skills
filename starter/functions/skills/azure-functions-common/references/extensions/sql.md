# Azure Functions Diagnostics Reference — SQL

Use this file when investigating Azure SQL input/output binding, SQL trigger, change tracking, connection, or scale behavior.

## Bindings

- `Sql`
- `SqlTrigger`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-sql-extension | https://github.com/Azure/azure-functions-sql-extension | SQL extension implementation |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime and scale behavior |

## Public documentation

| Topic | URL |
|------|-----|
| SQL bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-azure-sql |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Manage connections | https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections |

## Investigation guidance

- Include `azure-functions-sql-extension` when investigating SQL scale symptoms, trigger latency, or change tracking behavior.