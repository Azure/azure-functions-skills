# Azure Functions Diagnostics Reference — Azure Tables

Use this file when investigating Table input/output bindings, connection, SDK type binding behavior, or table data access issues.

## Bindings

- `table`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Tables extension and SDK code paths |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime and indexing behavior |

## Sparse checkout guidance

For `azure-sdk-for-net`, use `sdk/tables` and shared paths `sdk/core`, `sdk/identity`, and `sdk/extensions`.

## Public documentation

| Topic | URL |
|------|-----|
| Table bindings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-table |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Manage connections | https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections |
