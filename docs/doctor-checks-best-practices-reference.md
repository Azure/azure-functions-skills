# Doctor Command - Best Practices Check Reference

> **Purpose**: Reorganize official Azure Functions best-practice guidance into pre-deployment `doctor` command checks for configuration, code, security, and reliability issues.
>
> **Scope**: This document is a design reference for the doctor skill / CLI checks. It distinguishes implemented checks from proposed future checks.

## References

- [Azure Functions best practices](https://learn.microsoft.com/azure/azure-functions/functions-best-practices)
- [Improve performance and reliability](https://learn.microsoft.com/azure/azure-functions/performance-reliability)
- [Manage connections](https://learn.microsoft.com/azure/azure-functions/manage-connections)
- [Storage considerations](https://learn.microsoft.com/azure/azure-functions/storage-considerations)
- [File access options](https://learn.microsoft.com/azure/azure-functions/concept-file-access-options)
- [Error handling and retries](https://learn.microsoft.com/azure/azure-functions/functions-bindings-error-pages)
- [Security concepts](https://learn.microsoft.com/azure/azure-functions/security-concepts)
- [Runtime versions and supported languages](https://learn.microsoft.com/azure/azure-functions/functions-versions)

---

## Result levels and CI behavior

| Result | Meaning | Recommended CI behavior |
|--------|---------|-------------------------|
| **Fail** | Likely to cause startup failure, functional outage, a high-impact security incident, or an unsupported configuration after deployment | exit code 1 |
| **Warning** | Performance degradation, future incompatibility, reduced operability, or best-practice drift | exit code 0/1 depending on severity threshold |
| **Info** | Non-blocking recommendation or design advisory | exit code 0 |

The current CLI implementation uses `--severity <critical|high|medium|low>` rather than `--strict` to control the failure threshold. A `warn` result also returns exit code 1 when its severity is at or above the configured threshold.

The intended design direction is that the main incident-prevention value comes from LLM-based semantic analysis, so the recommended execution mode is **built-in checks + deep analysis**. The current implementation keeps deep analysis opt-in with `--deep --agent <name>` for compatibility. `--no-deep` is a fast deterministic fallback mode for minimal CI checks.

---

## Detection scopes

Pre-deployment doctor checks must be classified by detectability. Without this distinction, CI can create false reassurance for Azure resource settings that cannot be observed from source alone.

| Scope | Meaning | Examples |
|-------|---------|----------|
| **Source-only** | Can be determined from repository source and local config files only | `host.json`, `package.json`, `.csproj`, `requirements.txt`, function definitions |
| **IaC** | Can be determined only when Bicep/ARM/Terraform/AZD infrastructure definitions are present | `httpsOnly`, `minTlsVersion`, CORS, FTP, Flex Consumption storage |
| **Azure resource** | Requires querying deployed or existing Azure resources | Storage region, lifecycle policy, confirmed Host ID collision |
| **AI analysis** | Requires code semantics; static patterns alone would create too many false positives | Idempotency, input validation, long-running work, fire-and-forget |

---

## 1. Runtime & Version

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `RT-001` | `host.json` schema version | `host.json` missing, JSON parse error, or `version` is not `"2.0"` | - | Source-only | `host.json` |
| `RT-002` | Functions runtime major version | `FUNCTIONS_EXTENSION_VERSION` is `~2`, `~3`, or unsupported | Minor pinning such as `~4.x.y` | Source-only / IaC / Azure resource | app settings / IaC |
| `RT-003` | Language runtime version | Azure CLI / official metadata says unsupported or EOL | Nearing EOL, preview runtime | Source-only + Extended | `az functionapp list-runtimes` + language manifest |
| `RT-004` | Extension bundle / binding extension compatibility | Required binding extension cannot be resolved, or is below the runtime v4 minimum | Bundle range is old or outside the latest recommended range | Source-only | `host.json`, package refs |
| `RT-005` | .NET execution model | Unsupported TFM/model combination, such as in-process + .NET 10 target | In-process model in use, especially when migration deadline is near | Source-only | `.csproj`, package refs |

### Important: `host.json.version` is not the Functions runtime version

`"version": "2.0"` in `host.json` is the host.json schema version, not the Functions runtime v2/v3/v4 identifier. Runtime EOL checks must use `FUNCTIONS_EXTENSION_VERSION` and language stack metadata.

### Language version policy

Do not hardcode a language version table. Doctor should prefer Azure CLI (`az functionapp list-runtimes`), Functions stack metadata, and official documentation. It should not depend directly on internal or semi-private endpoints such as `https://functions-next.azure.com/stacks/...`.

| Language | Inputs | Fail examples | Warning examples |
|----------|--------|---------------|------------------|
| Node.js / TypeScript | `package.json` `engines.node`, app settings, Azure CLI runtime metadata | Unsupported / EOL major version | Nearing EOL, preview |
| Python | `.python-version`, app settings, Azure CLI runtime metadata | Unsupported / EOL minor version | Nearing EOL, preview |
| .NET | `.csproj` TargetFramework, Worker SDK, Azure CLI runtime metadata | Unsupported TFM / SDK combination | In-process migration advisory |
| Java | `pom.xml` / Gradle Java version, Azure CLI runtime metadata | Unsupported Java version | Nearing EOL |
| PowerShell | `requirements.psd1`, app settings, Azure CLI runtime metadata | Unsupported PowerShell version | Preview / nearing EOL |

---

## 2. Configuration (`host.json`)

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `CF-001` | `host.json` exists | Missing | - | Source-only | file existence |
| `CF-002` | valid JSON | Parse error | - | Source-only | JSON parse |
| `CF-003` | `version` field | Missing or not `"2.0"` | - | Source-only | `host.json.version` |
| `CF-004` | extension bundle config | Non-.NET app uses non-HTTP bindings and no bundle/direct extension path exists | No bundle but only HTTP triggers; older bundle range | Source-only | `host.json.extensionBundle`, bindings |
| `CF-005` | `functionTimeout` | Known hosting-plan limit exceeded | Long or unbounded timeout without clear justification | Source-only / IaC | `host.json`, optional `--plan` / IaC |
| `CF-006` | HTTP concurrency | Invalid schema/value shape | `maxConcurrentRequests` is `0` or extremely low | Source-only | `extensions.http.maxConcurrentRequests` |
| `CF-007` | trigger concurrency / batch settings | Invalid values that prevent listener startup | Values likely to throttle scale or overload memory | Source-only | trigger-specific host settings |
| `CF-008` | unknown or misspelled host settings | Known-invalid setting location/value | Unknown top-level keys | Source-only | schema-aware validation |
| `CF-009` | logging levels | - | Default production log level is `Trace` / `Debug` | Source-only | `logging.logLevel` |

`functionTimeout` limits and defaults vary by hosting plan. Do not hard-fail when the plan is unknown. Hard-fail only when the plan is known from IaC or a CLI option.

---

## 3. App Settings & Local Settings

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `AS-001` | `FUNCTIONS_WORKER_RUNTIME` | Missing or not one of the supported worker runtimes | Language inferred but the setting is absent only in local files | Source-only | `local.settings.json`, env, IaC |
| `AS-002` | `AzureWebJobsStorage` / host storage | Host storage setting or identity-based equivalent missing for non-Flex plans. If plan is unknown, treat missing host storage as fail-leaning | `UseDevelopmentStorage=true` in production-oriented IaC | Source-only / IaC | settings + binding inventory |
| `AS-003` | deprecated settings | - | `AzureWebJobsDashboard`, obsolete platform settings | Source-only / IaC | app settings |
| `AS-004` | Azure Files content settings | Windows Consumption/Premium IaC explicitly omits required Azure Files content settings and no no-Azure-Files pattern is used | Not inferable from source | IaC / Azure resource | IaC / app settings |
| `AS-005` | worker process count | Invalid value | Exceeds likely core count or is set without workload justification | Source-only / IaC | `FUNCTIONS_WORKER_PROCESS_COUNT` |
| `AS-006` | Application Insights / observability | - | No `APPLICATIONINSIGHTS_CONNECTION_STRING` or equivalent monitoring config | Source-only / IaC | settings / IaC |
| `AS-007` | identity-based connection shape | Missing required `__accountName` / credential sub-settings | Mixed secret + identity settings | Source-only / IaC | settings key groups |

---

## 4. Storage & Connections

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `ST-001` | host storage connection syntax | Empty / malformed connection setting | Dev storage in production IaC | Source-only / IaC | settings parser |
| `ST-002` | host storage with ADLS/HNS | Confirmed Functions host storage (`AzureWebJobsStorage` or Flex deployment storage) has hierarchical namespace enabled | Source indicates possible HNS storage but property is unknown | IaC / Azure resource | IaC storage props / Azure query |
| `ST-003` | shared storage account | Confirmed collision-prone shared host storage for Durable/Event Hubs/high-volume apps | Same literal storage setting reused across multiple local projects | Source-only / IaC / Azure resource | settings comparison |
| `ST-004` | Host ID collision | Confirmed duplicate host ID with same storage account | Function app name is longer than 32 chars, or slots likely share storage | Source-only / Azure resource | app names + storage account |
| `ST-005` | lifecycle management on Functions containers | Lifecycle policy targets `azure-webjobs*` / `scm` containers | Lifecycle policy exists but exclusions are unknown | Azure resource | storage management API |
| `ST-006` | storage account region | Confirmed different region from Function App | Region unknown in source-only mode | IaC / Azure resource | IaC / Azure query |
| `ST-007` | Azure Files mount use | Mount configured on unsupported plan / OS | Writable mount without cleanup/quota/read-only justification | IaC / Azure resource / AI | IaC + code patterns |
| `ST-008` | Flex Consumption storage/deployment settings | Flex IaC missing `functionAppConfig.deployment.storage` or uses unsupported `WEBSITE_RUN_FROM_PACKAGE` / Azure Files content settings | Flex storage settings present but incomplete for identity/network posture | IaC | Bicep/ARM/Terraform/AZD |

---

## 5. Security

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `SC-001` | secrets in source | Connection strings, storage keys, SAS tokens, client secrets committed in source | Suspicious high-entropy strings | Source-only | built-in patterns or secret scanner |
| `SC-002` | HTTP trigger auth level | Anonymous endpoint clearly exposes administrative or sensitive operation | Anonymous public HTTP trigger without explicit gateway/auth note | Source-only / AI analysis | function definitions |
| `SC-003` | CORS wildcard | `*` allowed origin combined with credentials support | `*` allowed origin without credentials | IaC / Azure resource | `siteConfig.cors`, `az functionapp cors show` |
| `SC-004` | HTTPS enforcement | `httpsOnly=false` in IaC for public app | No IaC evidence | IaC / Azure resource | site config |
| `SC-005` | `local.settings.json` handling | Tracked by git or included in deploy artifact | Missing from `.gitignore` | Source-only | git metadata / `.gitignore` |
| `SC-006` | FTP/FTPS state | Plain FTP allowed | FTP endpoint enabled but FTPS-only | IaC / Azure resource | `ftpsState` |
| `SC-007` | managed identity adoption | - | Secret-based Azure service connections where identity-based connection is supported | Source-only / IaC | settings pattern |
| `SC-008` | TLS version | `minTlsVersion` < `1.2` | Not declared in IaC | IaC / Azure resource | site config |
| `SC-009` | input validation | - | Trigger input used in SQL/commands/output binding without validation | AI analysis | code semantics |
| `SC-010` | admin endpoint isolation | - | App is public and admin isolation not configured in IaC | IaC / Azure resource | `functionsRuntimeAdminIsolationEnabled` |

For `SC-001`, the long-term design should prefer orchestration with a proven scanner such as Gitleaks/TruffleHog when available, with built-in patterns as a fallback.

---

## 6. Code Quality & Patterns

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `CQ-001` | client reuse | - | `HttpClient`, `CosmosClient`, `ServiceBusClient`, storage clients created per invocation | Source-only / AI | language-specific patterns |
| `CQ-002` | stateful functions | - | Mutable global state used as durable business state | AI analysis | code semantics |
| `CQ-003` | long-running synchronous work | - | Large synchronous loops, blocking CPU/file/network operations in request path | AI analysis | code semantics |
| `CQ-004` | background task completion | - | Fire-and-forget promises/tasks/threads may outlive invocation | Source-only / AI | pattern + semantics |
| `CQ-005` | idempotency | - | Timer/Queue/ServiceBus/EventHub processing not idempotent | AI analysis | code semantics |
| `CQ-006` | blocking calls | - | `.Result`, `.Wait()`, `time.sleep`, sync HTTP calls in async handlers | Source-only | pattern matching |
| `CQ-007` | structured error handling | - | No top-level error capture/logging around risky operations | Source-only / AI | AST / semantics |
| `CQ-008` | output binding error handling | - | Output binding used where SDK call is needed to handle remote-service errors | AI analysis | code + binding semantics |

Because static patterns alone can create many false positives, this category should usually produce Warning results or run in AI analysis.

---

## 7. Dependencies & Bindings

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `DP-001` | binding extension minimum version | Runtime v4 minimum requirements not met | Extension range old but likely still works | Source-only / Extended | NuGet/package refs, bundle range |
| `DP-002` | binding type validity | Unknown binding/trigger type | Binding recognized but extension missing | Source-only | function metadata |
| `DP-003` | entry point resolution | Configured entry point file does not exist | Generated output may be stale | Source-only | filesystem |
| `DP-004` | connection setting reference | Binding references missing setting name | Unused connection setting | Source-only | binding/settings cross-reference |
| `DP-005` | dependency size | - | Deploy package likely includes large dependency tree or dev dependencies | Source-only / Extended | package lock, `.funcignore`, package simulation |
| `DP-006` | Python dependency consistency | Import of missing top-level package confirmed | Probable missing package | Source-only / Extended | imports + `requirements.txt` |
| `DP-007` | package vulnerabilities | Known critical/high vulnerability | Known medium vulnerability | Extended | package manager audit |
| `DP-008` | retry configuration | Invalid retry config | Supported retry-capable trigger without explicit retry strategy | Source-only | function attributes / `function.json` |

---

## 8. Performance & Scalability

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `PF-001` | too many functions per app | - | Function count exceeds configurable heuristic | Source-only | function inventory |
| `PF-002` | Event Hubs batching | - | Event Hub trigger processes single messages where batching is practical | Source-only / AI | binding + code |
| `PF-003` | queue/batch settings | Invalid values | Extreme batch/concurrency values | Source-only | `host.json` |
| `PF-004` | blob trigger strategy | Polling blob trigger used with high-scale scenario evidence | Polling blob trigger with unknown large-container risk | Source-only / AI | binding + naming/IaC hints |
| `PF-005` | scale limit | Scale limit `0` or invalid | Scale limit very low for production | IaC / Azure resource | app settings / IaC |
| `PF-006` | test/dev code in deploy artifact | Test files included in deploy output and likely loaded | Test directories exist without `.funcignore` exclusion | Source-only | file patterns + `.funcignore` |
| `PF-007` | Durable task hub/storage | Confirmed shared task hub/storage collision | Default task hub name in multi-app repo | Source-only / IaC / Azure resource | Durable settings |
| `PF-008` | large deployment package | Package exceeds hosting/deployment practical limits | Individual large files or artifacts included | Source-only / Extended | file size / package simulation |

Thresholds such as function count or package size must be configurable and documented as heuristics, not platform limits.

---

## 9. Error Handling & Resilience

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `EH-001` | structured error handling | - | No explicit error handling/logging around external calls | Source-only / AI | AST / semantics |
| `EH-002` | infinite retry | Invalid retry shape | `maxRetryCount = -1` infinite retry without justification | Source-only | retry config |
| `EH-003` | poison/dead-letter handling | - | Queue/Service Bus processing lacks poison/dead-letter handling plan | Source-only / AI | binding + code |
| `EH-004` | Event Hub checkpoint delay | - | Large retry count on Event Hub trigger can block partition progress | Source-only | retry config |
| `EH-005` | idempotency for at-least-once triggers | - | No apparent duplicate-processing protection | AI analysis | code semantics |

`maxRetryCount = -1` is documented as infinite retry, not an invalid value. It should be a Warning unless combined with other evidence that it causes deployment/runtime failure.

---

## 10. Language-Specific Checks

### 10.1 C# / .NET

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `CS-001` | blocking Task usage | - | `.Result` / `.Wait()` | Source-only | pattern matching |
| `CS-002` | execution model compatibility | Unsupported TFM/model combination | In-process model migration advisory | Source-only | `.csproj` |
| `CS-003` | cancellation support | - | No `CancellationToken` where applicable | Source-only / AI | method signatures |
| `CS-004` | client reuse | - | `new HttpClient()` or Azure SDK client per invocation | Source-only | pattern matching |
| `CS-005` | Worker SDK / extension versions | Minimum required version not met | Version old but not blocked | Source-only | `.csproj` |

### 10.2 Node.js / TypeScript

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `JS-001` | programming model | Unsupported package/model combination | v3 model used for new project | Source-only | `@azure/functions`, code registrations |
| `JS-002` | floating promises | - | Promise not awaited/returned in handler | Source-only / AI | AST / lint-like analysis |
| `JS-003` | deploy artifact dependencies | - | Dev dependencies likely included | Source-only / Extended | `.funcignore`, package simulation |
| `JS-004` | TypeScript output | `main` points to missing output | No `outDir`, stale build output | Source-only | `package.json`, `tsconfig.json` |
| `JS-005` | ESM/CJS mismatch | Entry point cannot load due to module mismatch | Mixed ESM/CJS patterns | Source-only | package type + imports |
| `JS-006` | client reuse | - | SDK client instantiated in handler | Source-only | pattern matching |

### 10.3 Python

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `PY-001` | programming model | Unsupported model/runtime combination | v1 model used for new project | Source-only | `function_app.py`, `function.json` |
| `PY-002` | blocking operations | - | `requests` / `time.sleep` / sync I/O in async path | Source-only / AI | pattern + semantics |
| `PY-003` | `requirements.txt` | Missing when external imports exist | Empty or likely incomplete | Source-only | imports + file existence |
| `PY-004` | client reuse | - | Azure SDK client created per invocation | Source-only | pattern matching |
| `PY-005` | worker indexing flag | Known old runtime + v2 model requires flag and flag missing | Runtime unknown and old-host compatibility risk | Source-only | settings + runtime metadata |
| `PY-006` | worker extensions | Missing required extension setting for custom worker extension usage | Custom extension pattern unclear | Source-only | settings + imports |
| `PY-007` | `azure-functions` package | Package version unsupported | Old package version | Source-only | `requirements.txt` |

Do not fail all Python v2 projects just because `AzureWebJobsFeatureFlags=EnableWorkerIndexing` is absent. Newer Functions host versions enable worker indexing by default.

### 10.4 Java

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `JV-001` | Maven/Gradle plugin compatibility | Plugin version unsupported | Old plugin version | Source-only | `pom.xml`, Gradle files |
| `JV-002` | Java version compatibility | Unsupported Java version | Nearing EOL / mismatch | Source-only / Extended | build files + Azure CLI runtime metadata |
| `JV-003` | client reuse | - | SDK client created per invocation | Source-only | pattern matching |
| `JV-004` | app name / deployment metadata | Impossible or conflicting deployment target in config | Target unclear | Source-only / IaC | plugin config / IaC |

### 10.5 PowerShell

| ID | Check | Fail | Warning | Scope | Detection |
|----|-------|------|---------|-------|-----------|
| `PS-001` | managed dependencies | Invalid managed dependency config | Enabled but `requirements.psd1` missing | Source-only | `host.json`, files |
| `PS-002` | `profile.ps1` startup cost | - | Slow or blocking work at startup | Source-only / AI | script analysis |
| `PS-003` | module installation in invocation | - | `Install-Module` in function path | Source-only | pattern matching |

---

## Implementation tiers

| Tier | Execution model | Examples | CI suitability |
|------|-----------------|----------|----------------|
| **Tier 1: Source-only built-in** | Static analysis, file parsing, lightweight pattern matching | `host.json`, settings, entry point, binding inventory, obvious secrets | High |
| **Tier 2: Extended local** | Package manager, Azure CLI runtime metadata, package simulation, vulnerability audit | Language EOL, dependency audit, deployment package size | Medium: network/tool dependent |
| **Tier 3: IaC** | Bicep/ARM/Terraform/AZD analysis | HTTPS/TLS/FTP/CORS/Flex storage/site config | Medium |
| **Tier 4: Azure resource** | Azure CLI/MCP/ARM API queries for existing resources | Storage region, lifecycle policy, confirmed Host ID collision | Low to medium: permission dependent |
| **Tier 5: AI analysis** | Agent-based semantic code analysis | Idempotency, validation, long-running work, fire-and-forget | Optional, `--deep` |

### What `--no-deep` supports

`--no-deep` does not use an LLM. It should generally cover only deterministic **Source-only built-in** checks. IaC, Azure resource, and semantic code analysis checks are out of scope or limited to low-confidence warnings.

#### Currently implemented `--no-deep` checks

| Implemented ID | Design ID | What it can determine |
|----------------|-----------|-----------------------|
| `project-exists` | `CF-001` | Whether `host.json` exists |
| `runtime-version` | `CF-003` | Whether `host.json.version` is `"2.0"` |
| `extension-bundle` | `CF-004`, `RT-004` | Extension bundle range for non-.NET apps |
| `node-version` | `RT-003` | Node.js version from `package.json` / runtime metadata |
| `python-version` | `RT-003` | Python version from local settings / runtime metadata |
| `dotnet-version` | `RT-003` | .NET supported versions from runtime metadata |
| `local-settings` | `AS-001` | `local.settings.json` and `FUNCTIONS_WORKER_RUNTIME` |
| `connection-strings` | `AS-002`, `ST-001` | Host storage setting presence for non-HTTP triggers |
| `deprecated-settings` | `AS-003` | Deprecated app settings |
| `function-bindings` | `DP-002` | Unknown trigger types |
| `entry-point` | `DP-003`, `JS-004` | Node.js entry point file |
| `typescript-build` | `JS-004` | `tsconfig.json` parsing / `outDir` |
| `package-dependencies` | `DP-005`, `DP-007` | Currently a stub; effectively not supported |

#### Easy additions for `--no-deep`

| Design ID | Reason |
|-----------|--------|
| `RT-002` | Deterministic when `FUNCTIONS_EXTENSION_VERSION` exists in app settings / IaC |
| `SC-001` | Can use built-in secret patterns or external scanner invocation |
| `SC-005` | Can inspect `.gitignore` and tracked files |
| `AS-006` | Monitoring setting presence is key-based |
| `AS-007` | Identity-based connection key groups can be statically validated |
| `CF-005` | Deterministic when plan is known; warning-only when plan is unknown |
| `DP-004` | Cross-reference binding connection setting names and settings |
| `PF-008` | File size / deploy artifact simulation |
| `JS-004`, `PY-003`, `PY-007`, `CS-002`, `CS-005` | Can be determined from language manifests / package files |

#### Not normally supported by `--no-deep`

| Type | Examples | Reason |
|------|----------|--------|
| Semantic code analysis | `CQ-002` stateful functions, `CQ-005` idempotency, `SC-009` input validation, `EH-005` duplicate processing | Requires semantic understanding and would create many false positives |
| IaC-only | `SC-003` CORS, `SC-004` HTTPS, `SC-006` FTP, `SC-008` TLS, Flex deployment storage | Cannot be determined unless IaC exists |
| Azure resource | `ST-005` lifecycle policy, `ST-006` storage region, confirmed Host ID collision | Requires Azure API access and permissions |
| Runtime behavior | cold-start risk, actual connection exhaustion, real trigger indexing failures | Requires execution or deployed telemetry |

### Tools required for deep analysis

The current deep analysis implementation invokes an external agent CLI through `--agent <name>`.

| Agent | Command | GitHub Actions requirement |
|-------|---------|----------------------------|
| `github-copilot` | `copilot` | Copilot CLI available on the runner, plus an authenticated account or token |
| `claude-code` | `claude` | Claude Code CLI and authentication |
| `codex` | `codex` | Codex CLI and authentication |

Azure CLI is expected to be required for runtime metadata (`az functionapp list-runtimes`). The command itself does not read subscription resources, but the CI runner must have Azure CLI installed. If Azure resource tier checks are also enabled, such as existing Function App / Storage / CORS / TLS / lifecycle policy queries, the workflow also needs `az login` or federated credentials. IaC-only analysis might not require Azure login.

---

## GitHub Actions examples

The package name is `@azure/functions-skills`; the CLI binary is `azure-functions-skills`. The recommended CI mode for doctor includes deep analysis. Because the current implementation requires an agent CLI to be installed and authenticated, `--no-deep` remains as a lightweight fallback.

### Deep analysis mode (recommended)

```yaml
name: Azure Functions Doctor

on:
  pull_request:

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      # Azure CLI is required for runtime metadata checks.
      - run: az version
      # Install/authenticate the selected agent CLI before this step.
      # Example assumes a runner where `copilot` is available and authenticated.
      - run: npx @azure/functions-skills doctor --deep --agent github-copilot --format json --output doctor-report.json --severity high
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: doctor-report
          path: doctor-report.json
```

Add Azure login when Azure resource tier checks are enabled:

```yaml
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

### Lightweight `--no-deep` mode

```yaml
name: Azure Functions Doctor (no-deep)

on:
  pull_request:

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: az version
      - run: npx @azure/functions-skills doctor --no-deep --format json --output doctor-report.json --severity high
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: doctor-report
          path: doctor-report.json
```

### Running from this repository

```yaml
name: Azure Functions Doctor (repo)

on:
  pull_request:

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
        working-directory: azure-functions-skills
      - run: npm run build
        working-directory: azure-functions-skills
      - run: node bin/azure-functions-skills.js doctor --deep --agent github-copilot --format json --output doctor-report.json --severity high
        working-directory: azure-functions-skills
```

### Exit codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | No `fail` / `warn` results at or above the threshold |
| 1 | At least one `fail` / `warn` result at or above the threshold |
| 2 | Doctor command execution error, parse failure, or unhandled exception |

`--severity high` is the current default. To avoid blocking on most warnings, lower the severity of those warnings to `medium`/`low`, or choose a higher threshold such as `--severity critical` in CI.

---

## Gaps vs. current implementation

### Implemented

| Implemented ID | Design ID | Notes |
|----------------|-----------|-------|
| `project-exists` | `CF-001` | OK |
| `runtime-version` | `CF-003` | Treat as host.json schema check, not runtime EOL |
| `extension-bundle` | `CF-004`, `RT-004` | Refine Fail/Warning by binding usage |
| `node-version` | `RT-003` | Current implementation uses direct Stacks API; migrate to Azure CLI runtime metadata |
| `python-version` | `RT-003` | Current implementation uses direct Stacks API; migrate to Azure CLI runtime metadata |
| `dotnet-version` | `RT-003`, `CS-002` | Add real project TFM / package ref analysis |
| `local-settings` | `AS-001` | Adjust missing setting severity by use case |
| `connection-strings` | `AS-002`, `ST-001` | Also recognize identity-based connections |
| `deprecated-settings` | `AS-003` | OK |
| `package-dependencies` | `DP-005`/`DP-007` | Stub; needs implementation |
| `function-bindings` | `DP-002` | Also check extension presence |
| `entry-point` | `DP-003`, `JS-004` | OK |
| `typescript-build` | `JS-004` | OK |

### Priority additions

1. `SC-001` - source secret detection
2. `SC-005` - `local.settings.json` tracked / `.gitignore`
3. `RT-003` - replace direct Stacks API dependency with Azure CLI runtime metadata (`az functionapp list-runtimes`)
4. `AS-006` - Application Insights / observability setting presence
5. `AS-007` - identity-based connection shape
6. `CQ-006` - obvious blocking call patterns
7. `CQ-001` / language-specific client reuse
8. `CF-005` - plan-aware `functionTimeout`
9. `DP-004` - binding connection setting reference validation
10. `PF-008` - large deploy artifact / missing `.funcignore`
11. `JS-004` - stricter TypeScript output validation
12. `PY-003` / `PY-007` - Python dependencies
13. `CS-002` / `CS-005` - .NET model and SDK compatibility

### Later checks

- IaC tier: HTTPS/TLS/FTP/CORS/Flex storage/site config
- Azure resource tier: storage lifecycle, region mismatch, confirmed Host ID collision
- AI tier: idempotency, input validation, long-running work, output binding exception strategy

---

## Reference policy for the skill

1. **Do not copy official docs as fixed text.** Keep URLs and check rationale; prefer Azure CLI runtime metadata / current metadata for version decisions. Do not depend directly on `functions-next` endpoints.
2. **Keep Fail narrow.** Limit Fail to startup blockers, unsupported configurations, major secret leaks, syntax errors, and missing required settings.
3. **Give warnings severities.** CI can choose blocking behavior with `--severity`.
4. **Always show detection scope.** Do not silently pass items that cannot be detected in source-only mode.
5. **Keep AI analysis optional in implementation, but recommended in CI.** Findings should include evidence such as file and line whenever possible.

---

## Summary

The doctor command should prioritize:

1. **Preventing startup failures**: `host.json`, app settings, runtime/language compatibility, binding resolution.
2. **Preventing secret leakage**: committed secrets, `local.settings.json`, insecure IaC.
3. **Detecting production-risky code**: connection reuse, blocking calls, fire-and-forget, retry/idempotency.
4. **Making CI usable**: always run built-in source-only checks, recommend deep analysis as the primary mode, and keep `--no-deep` as a fast fallback.
5. **Making scope explicit**: distinguish Source-only, IaC, Azure resource, and AI to avoid false reassurance.
