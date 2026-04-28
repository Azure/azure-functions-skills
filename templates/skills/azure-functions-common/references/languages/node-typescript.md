# Azure Functions Diagnostics Reference — Node.js / TypeScript

Use this file when investigating Azure Functions issues involving Node.js, TypeScript, the v4 programming model, `@azure/functions`, package versions, or Node runtime support.

## Public repositories

| Repository | URL | Use |
|-----------|-----|-----|
| azure-functions-nodejs-worker | https://github.com/Azure/azure-functions-nodejs-worker | Node.js worker runtime |
| azure-functions-nodejs-library | https://github.com/Azure/azure-functions-nodejs-library | `@azure/functions` package and v4 programming model APIs |
| azure-functions-nodejs-extensions | https://github.com/Azure/azure-functions-nodejs-extensions | SDK type binding extensions |
| azure-functions-host | https://github.com/Azure/azure-functions-host | Host/runtime behavior that affects Node.js apps |

## Public documentation and registries

| Topic | URL |
|------|-----|
| Node.js developer guide | https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node |
| Node.js troubleshooting guide | https://learn.microsoft.com/en-us/azure/azure-functions/functions-node-troubleshoot |
| v3 to v4 migration guide | https://learn.microsoft.com/en-us/azure/azure-functions/functions-node-upgrade-v4 |
| `@azure/functions` npm package | https://www.npmjs.com/package/@azure/functions |
| Supported languages | https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages |
| Best practices | https://learn.microsoft.com/en-us/azure/azure-functions/functions-best-practices |
| Diagnostics overview | https://learn.microsoft.com/en-us/azure/azure-functions/functions-diagnostics |

## Investigation guidance

- Prioritize `azure-functions-nodejs-library` for v4 programming model behavior.
- Use `azure-functions-nodejs-worker` for worker startup, gRPC, invocation, and process failures.
- Check npm package metadata and public GitHub issues before concluding root cause when package changes are part of the hypothesis.
- Include `azure-functions-host` when trigger indexing, host startup, scale, or cross-worker behavior is involved.