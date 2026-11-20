# Azure Functions Diagnostics Reference — MCP

Use this file when investigating Model Context Protocol-related Azure Functions bindings.

## Bindings

- `mcpToolTrigger`
- `mcpToolProperty`
- `mcpResourceTrigger`

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-sdk-for-net | https://github.com/Azure/azure-sdk-for-net | Extension and SDK integration paths |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior |

## Public documentation

| Topic | URL |
|------|-----|
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation notes

- No public Functions-specific MCP binding page was found in reviewed source material or Microsoft Learn sources.
- Exclude internal MCP service references from external diagnostics documentation.