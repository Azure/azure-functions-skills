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

Do not fail all Python v2 projects just because `AzureWebJobsFeatureFlags=EnableWorkerIndexing` is absent. Newer host versions enable worker indexing by default.

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

Go support is in preview. Report findings with that framing, and do not treat preview-only behavior as a defect.

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `GO-001` | Goroutine panic safety | - | Goroutine started in a handler without propagating panics as errors |
| `GO-002` | Worker module pinning | - | Worker module tracks `main` or an untagged pseudo-version |
| `GO-003` | Client reuse | - | Azure SDK or `http.Client` constructed per invocation instead of at package scope |
| `GO-004` | Worker runtime value | `FUNCTIONS_WORKER_RUNTIME` set to a value the native worker does not accept | Setting absent where it can be inferred |
| `GO-005` | Indexing model conflict | `function.json` present in a worker-indexed Go project | Registration name does not match the intended route or schedule |
| `GO-006` | Extension activation | Extension trigger registered without its blank import | Blank import present but unused trigger registered |
| `GO-007` | Context propagation | - | `context.Context` ignored, or long work not cancellable |
| `GO-008` | Startup cost | - | Blocking work in `init()` or before `worker.Start` |
| `GO-009` | Toolchain version | `go` directive below the worker minimum | No `go` directive in `go.mod` |

Notes:

- `GO-001` is the highest-value Go check. An unrecovered panic in **any** goroutine terminates the whole process, and the worker hosts multiple concurrent invocations, so one panicking goroutine fails every in-flight request on that worker rather than just its own. Recommend `sdk.RecoverTo` with `errgroup`, or a `WaitGroup` where `wg.Done` is deferred **before** `RecoverTo` so the error is set first. Panics inside the handler itself are already recovered by the worker and reported with a stack trace — do not flag those.
- `GO-004`: Go apps use `FUNCTIONS_WORKER_RUNTIME=native`. `golang` is a legacy pre-release value that some builds still accept. `go` is never correct.
- `GO-005`: the Go worker indexes from code. Any `function.json` is a leftover from another language or a hand-written mistake.
- `GO-006`: extension triggers such as Blob live in `triggers/` and must be activated with a blank import, for example `_ "github.com/azure/azure-functions-golang-worker/triggers/blob"`. Missing it is the usual cause of a trigger that never registers.
- Entry-point checks that assume an interpreted script file do not apply. Go deploys a compiled binary, so there is no `scriptFile` or `entryPoint` to resolve.
- Durable Functions is unavailable for Go. Treat Durable bindings in a Go project as an unsupported configuration, not a runtime bug.
