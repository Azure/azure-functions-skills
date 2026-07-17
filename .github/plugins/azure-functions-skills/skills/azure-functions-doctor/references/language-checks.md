# Language-specific Doctor Checks

Load only the section for the detected project language.

## C# / .NET

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `CS-001` | Blocking Task usage | - | `.Result` / `.Wait()` |
| `CS-002` | Execution model compatibility | Unsupported TFM/model combination | In-process model migration advisory |
| `CS-003` | Cancellation support | - | No `CancellationToken` where applicable |
| `CS-004` | Client reuse | - | `new HttpClient()` or Azure SDK client per invocation |
| `CS-005` | Worker SDK / extension versions | Minimum required version not met | Old but not blocked |

## Node.js / TypeScript

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `JS-001` | Programming model | Unsupported package/model combination | v3 model used for new project |
| `JS-002` | Floating promises | - | Promise not awaited/returned in handler |
| `JS-003` | Deploy artifact dependencies | - | Dev dependencies likely included |
| `JS-004` | TypeScript output | `main` points to missing output | No `outDir`, stale build output |
| `JS-005` | ESM/CJS mismatch | Entry point cannot load | Mixed ESM/CJS patterns |
| `JS-006` | Client reuse | - | SDK client instantiated in handler |

## Python

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `PY-001` | Programming model | Unsupported model/runtime combination | v1 model used for new project |
| `PY-002` | Blocking operations | - | `requests`, `time.sleep`, sync I/O in async path |
| `PY-003` | `requirements.txt` | Missing when external imports exist | Empty or likely incomplete |
| `PY-004` | Client reuse | - | Azure SDK client created per invocation |
| `PY-005` | Worker indexing flag | Known old runtime + v2 model requires flag and flag missing | Runtime unknown and old-host compatibility risk |
| `PY-006` | Worker extensions | Missing required extension setting for custom worker extension usage | Custom extension pattern unclear |
| `PY-007` | `azure-functions` package | Package version unsupported | Old package version |
| `PY-008` | Blueprint registration | Decorated Blueprint is deterministically unregistered | Registration is dynamic and cannot be resolved statically |
| `PY-009` | Platform-managed worker dependency | - | `azure-functions-worker` is declared by the application |
| `PY-010` | Native dependency compatibility | - | Compiled packages may lack wheels for the deployment OS/architecture |

Do not fail all Python v2 projects just because `AzureWebJobsFeatureFlags=EnableWorkerIndexing` is absent. Newer host versions enable worker indexing by default.

Tier 1 normally handles `PY-001`, `PY-003`, and `PY-007` through `PY-010`.
Do not repeat those findings during deep analysis. For `PY-008`, inspect dynamic
registration only when Tier 1 could not resolve an imported Blueprint. Native
packages such as `numpy`, `cryptography`, and `orjson` are common legitimate
dependencies; never describe them as malicious solely because they contain
compiled code. The relevant risk is wheel and build compatibility with the
Function App operating system and architecture.

## Java

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `JV-001` | Maven/Gradle plugin compatibility | Plugin version unsupported | Old plugin version |
| `JV-002` | Java version compatibility | Unsupported Java version | Nearing EOL / mismatch |
| `JV-003` | Client reuse | - | SDK client created per invocation |
| `JV-004` | App name / deployment metadata | Impossible or conflicting deployment target | Target unclear |

## PowerShell

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `PS-001` | Managed dependencies | Invalid managed dependency config | Enabled but `requirements.psd1` missing |
| `PS-002` | `profile.ps1` startup cost | - | Slow or blocking work at startup |
| `PS-003` | Module installation in invocation | - | `Install-Module` in function path |
