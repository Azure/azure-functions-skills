# Azure Functions Diagnostics Reference — Python

Use this file when investigating Azure Functions issues involving Python apps, the Python worker, Python package dependencies, SDK type bindings, or Python runtime support.

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-python-worker | https://github.com/Azure/azure-functions-python-worker | Python worker runtime |
| azure-functions-python-library | https://github.com/Azure/azure-functions-python-library | `azure-functions` PyPI package |
| azure-functions-python-extensions | https://github.com/Azure/azure-functions-python-extensions | SDK type binding extensions |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior that affects Python apps |

## Public documentation and registries

| Topic | URL |
|------|-----|
| Python developer guide | https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python |
| Python troubleshooting guide | https://learn.microsoft.com/en-us/azure/azure-functions/recover-python-functions |
| Python scale and performance | https://learn.microsoft.com/en-us/azure/azure-functions/python-scale-performance-reference |
| Python build options | https://learn.microsoft.com/en-us/azure/azure-functions/python-build-options |
| PyPI package registry | https://pypi.org/project/azure-functions/ |
| Supported languages | https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation guidance

- The public troubleshooting guide is the first stop for `ModuleNotFoundError`, worker indexing failures, native dependency problems, and worker process exits.
- Check PyPI metadata when package version changes are part of the hypothesis.
- Include `azure-functions-host` if symptoms involve indexing, trigger discovery, host startup, or scale behavior.
- Check MCR image tags and supported language docs for runtime support and EOL issues.