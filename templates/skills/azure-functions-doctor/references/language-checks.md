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
| `PY-001` | Programming model | Unsupported model/runtime combination | v1 model used for new project. Both `function.json` functions and v2 `FunctionApp` or `Blueprint` registrations are in the project (mixed models). Python signals exist but no model is found |
| `PY-002` | Blocking operations | - | `requests`, `time.sleep`, sync I/O in async path |
| `PY-003` | `requirements.txt` | Missing when external imports exist | Empty or likely incomplete |
| `PY-004` | Client reuse | - | Azure SDK client created per invocation |
| `PY-005` | Worker indexing flag | Known old runtime + v2 model requires flag and flag missing | Runtime unknown and old-host compatibility risk |
| `PY-006` | Worker extensions | Missing required extension setting for custom worker extension usage | Custom extension pattern unclear |
| `PY-007` | `azure-functions` package | Package is not declared, or the constraint excludes 1.17.0 or later in a v2 project | Old package version |
| `PY-008` | Blueprint registration | Decorated Blueprint is deterministically unregistered | Registration is dynamic and cannot be resolved statically |
| `PY-009` | Platform-managed worker dependency | - | `azure-functions-worker` is declared by the application |
| `PY-010` | Native dependency compatibility | - | Compiled packages may lack wheels for the deployment OS/architecture |

Do not fail all Python v2 projects just because `AzureWebJobsFeatureFlags=EnableWorkerIndexing` is absent. Newer host versions enable worker indexing by default.

`PY-008` through `PY-010` are also listed in `source-only-checks.md`. Report each one
only one time. For `PY-008`, first resolve imported Blueprints statically, and
inspect dynamic registration only when static resolution fails. Native
packages such as `numpy`, `cryptography`, and `orjson` are common legitimate
dependencies; never describe them as malicious solely because they contain
compiled code. The relevant risk is wheel and build compatibility with the
Function App operating system and architecture.

For `PY-010`, examine the dependency manifest for these packages at minimum:
`cryptography`, `grpcio`, `lxml`, `numpy`, `opencv-python`, `orjson`,
`pandas`, `pillow`, `psycopg2`, `pyodbc`, `scipy`, and `ujson`. Report other
packages with compiled code too. For each one, tell the user to use remote
build or to make sure that wheels exist for the deployment OS and architecture.

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

## Go

Apply Go worker checks only after confirming use of the Go worker from source/modules
and configuration. `native` alone does not identify Go. A Go custom handler is not
a misconfigured Go worker app; do not flag its `custom` runtime or `function.json`
as migration defects. Flex core-worker support is GA; Premium/Dedicated and selected
extensions require separate preview checks.

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `GO-001` | Goroutine panic safety | - | Goroutine started in a handler without propagating panics as errors |
| `GO-002` | Worker module pinning | - | Worker module tracks `main` or an untagged pseudo-version |
| `GO-003` | Client reuse | - | Azure SDK or `http.Client` constructed per invocation instead of at package scope |
| `GO-004` | Go worker runtime value | Local `FUNCTIONS_WORKER_RUNTIME` is not `native` in an app confirmed to use the Go worker; exclude source custom handlers | Setting absent where the Go worker model is confirmed |
| `GO-005` | Go indexing model conflict | `function.json` present in a confirmed worker-indexed Go project; exclude source custom handlers | Registration name does not match the intended route or schedule |
| `GO-006` | Extension activation | Extension trigger registered without its blank import | Blank import present but unused trigger registered |
| `GO-007` | Context propagation | - | `context.Context` ignored, or long work not cancellable |
| `GO-008` | Startup cost | - | Blocking work in `init()` or before `worker.Start` |
| `GO-009` | Toolchain version | Go/toolchain below the selected worker or extension module's minimum (core: 1.24) | Required version cannot be established |
| `GO-010` | Unsupported feature | Unsupported additional input binding (exclude the Durable middleware's `durableClient` binding), non-HTTP output binding, or Durable entity used in a project using the Go worker | Trigger/extension support or required preview acceptance is unverified |

Notes:

- `GO-001` is the highest-value Go check. An unrecovered panic in **any** goroutine terminates the whole process, and the worker hosts multiple concurrent invocations, so one panicking goroutine fails every in-flight request on that worker rather than just its own. Recommend `sdk.RecoverTo` with `errgroup`, or a `WaitGroup` where `wg.Done` is deferred **before** `RecoverTo` so the error is set first. Panics inside the handler itself are already recovered by the worker and reported with a stack trace — do not flag those.
- `GO-004`: apps using the Go worker use `FUNCTIONS_WORKER_RUNTIME=native` locally; `go` and `golang` are wrong for that model. A source custom handler with runtime `custom` and a `host.json` `customHandler` block is not a finding. Cloud runtime configuration must match the target-plan schema; Flex uses `functionAppConfig.runtime`.
- `GO-005`: the Go worker indexes from code. Do not flag a source custom handler's required `function.json` or remove it without approved migration.
- `GO-006`: extension triggers such as Blob live in `triggers/` and must be activated with a blank import, for example `_ "github.com/azure/azure-functions-golang-worker/triggers/blob"`. Missing it is the usual cause of a trigger that never registers.
- `GO-010`: HTTP responses use `http.ResponseWriter`; do not flag them as unsupported output bindings. The preview Durable middleware's `durabletask.ClientInput()` registers a supported `durableClient` input binding; do not flag it as unsupported merely because it is an additional input. Other unsupported input/non-HTTP output bindings need Azure SDK for Go integration. Durable orchestrations/activities are preview through `middleware/durabletask` with Go 1.25+ and Durable Task extension 3.15.0+; entities are unsupported. Verify middleware/extension compatibility and preview acceptance separately. Check the selected release rather than flagging all Durable use.
- Entry-point checks that assume an interpreted script file do not apply. Go deploys a compiled binary, so there is no `scriptFile` or `entryPoint` to resolve.
- Deployment findings should account for Linux Flex Consumption (GA) or confirmed Linux Premium/Dedicated preview availability. Windows and Linux Consumption are not supported Go worker hosting targets.
