# Azure Functions Diagnostics Reference — Extension Bundles

Use this file when investigating extension version resolution for non-.NET Azure Functions apps or when a binding issue may be caused by the extension bundle version.

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-extension-bundles | https://github.com/Azure/azure-functions-extension-bundles | Extension bundle packaging and package list |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host extension loading behavior |

## Public references

| Topic | URL |
|------|-----|
| Extension bundle repository | https://github.com/Azure/azure-functions-extension-bundles |
| Extension bundle v4 package list | https://github.com/Azure/azure-functions-extension-bundles/blob/main/src/Microsoft.Azure.Functions.ExtensionBundle/extensions.json |
| App settings | https://learn.microsoft.com/en-us/azure/azure-functions/functions-app-settings |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |

## Investigation guidance

- Use this reference for non-.NET apps where extensions are loaded from bundles instead of explicit package references.
- Include extension bundle metadata when investigating deployment, extension loading, binding resolution, or non-.NET package-version symptoms.