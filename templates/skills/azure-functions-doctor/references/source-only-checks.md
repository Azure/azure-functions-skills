# Source-only Doctor Checks

Do these checks first in every analysis. They need only the project files. `RT-003` also uses Azure CLI runtime metadata when Azure CLI is available.

## Runtime and configuration

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `CF-001` | `host.json` exists | Missing | - |
| `CF-002` | `host.json` JSON parse | Parse error | - |
| `CF-003` | `host.json.version` | Missing or not `"2.0"` | - |
| `RT-002` | `FUNCTIONS_EXTENSION_VERSION` | `~2`, `~3`, unsupported | Minor pinning such as `~4.x.y` |
| `RT-003` | Language runtime version | Unsupported/EOL according to Azure CLI runtime metadata | Nearing EOL or preview. Node.js: no `engines.node` in `package.json`, or a value that you cannot parse |
| `RT-004` | Extension bundle/extension compatibility | Required extension cannot be resolved | Non-.NET project has no `extensionBundle` in `host.json`, `extensionBundle` has no `version`, or the range starts below major version 4 |
| `AS-001` | `FUNCTIONS_WORKER_RUNTIME` | Missing or invalid | Missing only in local settings when language can be inferred |
| `AS-002` | Host storage | Missing host storage setting or identity-based equivalent for non-Flex/unknown plan | `UseDevelopmentStorage=true` in production-oriented config |
| `AS-003` | Deprecated settings | - | A setting from the deprecated settings list below, or another obsolete platform setting |
| `AS-006` | Observability setting | - | No Application Insights connection setting or equivalent |
| `AS-007` | Identity-based connection shape | Missing required grouped keys | Mixed secret and identity settings |
| `AS-008` | Durable Functions host configuration | - | The project has an orchestration, activity, or entity trigger, but `host.json` has no `extensions.durableTask` object. The app then uses all host defaults, including the default task hub name. Tell the user to set a task hub name when more than one app can use the same storage account. |

## Bindings and dependencies

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `DP-002` | Binding type validity | Unknown trigger/binding type | Extension presence unclear |
| `DP-003` | Entry point resolution | Configured entry point file missing | Generated output may be stale |
| `DP-004` | Binding connection setting references | Referenced setting missing | Unused connection setting |
| `DP-005` | Dependency size | - | Large dependency tree or dev dependencies likely included |
| `DP-006` | Python dependency consistency | Confirmed missing package | Probable missing package |
| `DP-008` | Retry configuration | Invalid retry config | Retry-capable trigger without explicit retry strategy |
| `PY-008` | Python Blueprint registration | Decorated Blueprint is not registered | Registration is dynamic or unresolved |
| `PY-009` | Python worker dependency | - | Application declares the platform-managed `azure-functions-worker` |
| `PY-010` | Python native dependencies | - | Verify deployment-compatible wheels or remote build |

## Security and packaging

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `SC-001` | Secrets in source | Connection strings, storage keys, SAS tokens, client secrets committed | Suspicious high-entropy string |
| `SC-005` | `local.settings.json` handling | Tracked by git or included in deploy artifact | Missing from `.gitignore` |
| `PF-006` | Test/dev code in deploy artifact | Test files included in deploy output and likely loaded | A development directory exists and `.funcignore` does not exclude it. For Python, examine `tests/`, `.venv/`, `venv/`, `__pycache__/`, and `*.pyc` |
| `PF-008` | Large deployment package | Exceeds practical deployment limit | Large files or generated artifacts included |

## Notes

- `host.json.version` is the schema version, not the Functions runtime version.
- Use Azure CLI runtime metadata for language version checks; do not call internal stack endpoints directly.
- Prefer Fail only for startup blockers, unsupported configurations, parse errors, and confirmed secrets.
- Treat native Python dependency detection as compatibility information, not
  evidence of a vulnerable or malicious package.
- `AS-001` valid `FUNCTIONS_WORKER_RUNTIME` values include `native`, which is what Go apps use. Do not report `native` as invalid. `go` and `golang` are misconfigurations in a Go project, and the fix is `native`.
- `DP-003` does not apply to Go. Go deploys a compiled binary and indexes functions from code, so there is no configured entry point file to resolve and no `function.json` to read. A `function.json` in a Go project is itself the finding.
- `DP-002` binding inventory in a Go project only ever contains triggers. The Go worker has no input or output bindings.
- The extension bundle range is commonly written with a wildcard, `[4.*, 5.0.0)`. That is the documented form and must not be reported as outdated.
- For `RT-004`, recommend the bundle `Microsoft.Azure.Functions.ExtensionBundle` with the range `[4.*, 5.0.0)`. A range that starts at major version 4 or higher is current.

## Reference values

Use these values when you cannot get current data. Last synced: 2026-05-26.

### Fallback runtime versions for `RT-003`

Use this table only when Azure CLI runtime metadata is not available. In the finding, tell the user that the result comes from a fallback list and can be out of date.

| Runtime | Supported versions |
|---------|--------------------|
| Functions host (`FUNCTIONS_EXTENSION_VERSION`) | `~4` |
| Node.js | 22, 24 |
| Python | 3.10, 3.11, 3.12, 3.13 |
| .NET | 8.0, 9.0, 10.0 |
| Go | 1.24 or later (preview) |

### Deprecated settings for `AS-003`

| Setting | Recommendation |
|---------|----------------|
| `WEBSITE_NODE_DEFAULT_VERSION` | Use `FUNCTIONS_WORKER_RUNTIME` and the platform Node.js version setting |
| `AzureWebJobsDashboard` | Deprecated since Functions v2. Remove this setting |
