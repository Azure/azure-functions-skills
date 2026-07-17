# Source-only Doctor Checks

These checks can run without LLM semantics and without Azure resource access. They are suitable for `--no-deep` or as context for deep analysis.

## Runtime and configuration

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `CF-001` | `host.json` exists | Missing | - |
| `CF-002` | `host.json` JSON parse | Parse error | - |
| `CF-003` | `host.json.version` | Missing or not `"2.0"` | - |
| `RT-002` | `FUNCTIONS_EXTENSION_VERSION` | `~2`, `~3`, unsupported | Minor pinning such as `~4.x.y` |
| `RT-003` | Language runtime version | Unsupported/EOL according to Azure CLI runtime metadata | Nearing EOL or preview |
| `RT-004` | Extension bundle/extension compatibility | Required extension cannot be resolved | Older bundle range |
| `AS-001` | `FUNCTIONS_WORKER_RUNTIME` | Missing or invalid | Missing only in local settings when language can be inferred |
| `AS-002` | Host storage | Missing host storage setting or identity-based equivalent for non-Flex/unknown plan | `UseDevelopmentStorage=true` in production-oriented config |
| `AS-003` | Deprecated settings | - | `AzureWebJobsDashboard`, obsolete platform settings |
| `AS-006` | Observability setting | - | No Application Insights connection setting or equivalent |
| `AS-007` | Identity-based connection shape | Missing required grouped keys | Mixed secret and identity settings |

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
| `PF-006` | Test/dev code in deploy artifact | Test files included in deploy output and likely loaded | Test directories exist without `.funcignore` exclusion |
| `PF-008` | Large deployment package | Exceeds practical deployment limit | Large files or generated artifacts included |

## Notes

- `host.json.version` is the schema version, not the Functions runtime version.
- Use Azure CLI runtime metadata for language version checks; do not call internal stack endpoints directly.
- Prefer Fail only for startup blockers, unsupported configurations, parse errors, and confirmed secrets.
- Treat native Python dependency detection as compatibility information, not
  evidence of a vulnerable or malicious package.
