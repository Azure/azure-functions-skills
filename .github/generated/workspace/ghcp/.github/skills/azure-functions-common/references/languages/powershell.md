# Azure Functions Diagnostics Reference — PowerShell

Use this file when investigating Azure Functions issues involving PowerShell apps, the PowerShell worker, PowerShell runtime support, or PowerShell container images.

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-powershell-worker | https://github.com/Azure/azure-functions-powershell-worker | PowerShell worker runtime |
| azure-functions-powershell-library | https://github.com/Azure/azure-functions-powershell-library | PowerShell SDK/library |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior that affects PowerShell apps |

## Public documentation

| Topic | URL |
|------|-----|
| PowerShell developer guide | https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-powershell |
| Supported languages | https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation guidance

- Include public MCR image tags when investigating runtime support, image refresh, CVEs, or EOL-related symptoms.
- Include `azure-functions-host` when trigger indexing, host startup, scale, or cross-worker behavior is involved.