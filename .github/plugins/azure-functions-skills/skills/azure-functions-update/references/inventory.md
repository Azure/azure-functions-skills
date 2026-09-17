# Inventory and preflight

After the processing gate, start with bounded metadata. For a large workspace, agree
[sampling limits](testing-data.md) before content collection. Identify all Functions
projects and shared-library users, not just the first `host.json`.

Record each fact's source and uncertainty:

- Language, host, programming model, TFM, OS, architecture, and SKU clues.
- SDK selection, project/build SDK, worker, analyzers, extensions, and bundles.
- Declared versions versus actual resolved versions; label a pre-existing assets file
  as historical until its inputs and successful restore are confirmed.
- Project references, startup/DI, middleware, serialization, logging, configuration.
- Every function, trigger, binding, endpoint setting name, and shared contract.
- Existing tests, fixtures, original expected behavior, deployment/IaC/CI, and related
  service dependencies. Record local-settings shape without secret values.

Ask whether a deployed app exists. If so, request identity and scoped read permission.
Otherwise continue locally with cloud facts unknown. Unknown OS/SKU blocks claims of
deployed compatibility, not all local analysis.

## Requirements depend on the operation

| Operation | Needed | Not inherently needed |
| --- | --- | --- |
| File assessment | Approved file reader/parser | SDK, Core Tools, Azure CLI, Docker |
| .NET restore/build | Compatible SDK, targeting packs, project SDK, feeds/cache, build targets | Core Tools or Azure login |
| Unit tests | Test runner and executing runtime; build tools if invoked | Host/emulator unless tests use them |
| Local isolated host | Compatible `func`, host, worker runtime/shared frameworks, startup dependencies | Azure CLI for fully local dependencies |
| .NET Framework | Correct reference assemblies/build tools, Windows and runtime | Assumption that modern .NET SDK supplies Framework execution |
| Emulator test | Version, client/extension compatibility, ports, dependencies, approval | Cloud identity for a local key-based test |
| Azure check | Approved identity, network, resources, selected tool | Azure CLI if an approved alternative suffices |

Record tool paths/versions, SDKs/runtimes, `global.json`, locks, effective NuGet
configuration, proxies, trust requirements, and permitted paths.
A newer SDK can build an older TFM but might not supply its executing runtime.
Do not silently change runtime roll-forward to hide a missing runtime.
Core Tools v4 and Functions CLI v5 preview can both use `func`; record which is selected.

NuGet combines machine, user, directory, and solution configuration. Diagnose DNS, TLS,
proxy, authentication, source mapping, missing packages, timeout, and runner denial
separately. No unrelated linter/tool installation belongs in a migration packet.

## Existing capability, not assumed automation

Discover available MCP schemas; do not invent names or parameters. Use permitted read
tools. On failure, use public docs for research; ask before a cloud CLI alternative.

Use available `azure-functions-inventory` and `azure-functions-diagnostics` for scoped
facts and research, not wholesale script execution. Inventory can change CLI settings,
install an extension, and retrieve secrets before redaction.

Doctor output is advisory. Doctor can access Azure, write caches, or use broad deep-mode
permissions; it is not an implicit offline, redacted inventory API.
No shared read-only API exists in this draft. Use permitted source or supplied facts;
do not add a duplicate inventory engine.

Sources: [SDK selection](https://learn.microsoft.com/dotnet/core/versions/selection),
[NuGet configuration](https://learn.microsoft.com/nuget/consume-packages/configuring-nuget-behavior),
[Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local).
Accessed 2026-09-17; refresh for selected tool versions.
