# Doctor Command — Best Practices Check Reference

> **目的**: Azure Functions のデプロイ前に、構成・コード・セキュリティ・信頼性の問題を `doctor` コマンドで検出するためのチェック項目を、公式 Best Practices 系ドキュメントから再整理する。
>
> **前提**: このファイルは doctor skill / CLI チェック設計の参照資料であり、実装済みチェックと将来追加チェックを区別する。

## 参照元

- [Azure Functions best practices](https://learn.microsoft.com/azure/azure-functions/functions-best-practices)
- [Improve performance and reliability](https://learn.microsoft.com/azure/azure-functions/performance-reliability)
- [Manage connections](https://learn.microsoft.com/azure/azure-functions/manage-connections)
- [Storage considerations](https://learn.microsoft.com/azure/azure-functions/storage-considerations)
- [File access options](https://learn.microsoft.com/azure/azure-functions/concept-file-access-options)
- [Error handling and retries](https://learn.microsoft.com/azure/azure-functions/functions-bindings-error-pages)
- [Security concepts](https://learn.microsoft.com/azure/azure-functions/security-concepts)
- [Runtime versions and supported languages](https://learn.microsoft.com/azure/azure-functions/functions-versions)

---

## 判定と CI の扱い

| 判定 | 意味 | 推奨 CI 扱い |
|------|------|-------------|
| **Fail** | デプロイ後に起動失敗・機能停止・重大なセキュリティ事故につながる可能性が高い、または未サポート構成 | exit code 1 |
| **Warning** | 性能劣化、将来の非互換、運用性低下、ベストプラクティス非準拠 | severity threshold に応じて exit code 0/1 |
| **Info** | すぐにブロックしない推奨事項、設計上の助言 | exit code 0 |

現行 CLI 実装は `--strict` ではなく `--severity <critical|high|medium|low>` で fail threshold を制御する。`warn` でも threshold 以上の severity なら exit code 1 になる。

設計方針としては、incident prevention の主価値は LLM による semantic analysis にあるため、将来的な推奨実行形は **built-in checks + deep analysis** とする。現行実装では互換性のため deep analysis は `--deep --agent <name>` の opt-in で、`--no-deep` は CI で高速・決定的な最小チェックだけを行うモードとして扱う。

---

## 検出スコープ

pre-deployment doctor では、チェックを検出可能性で分ける必要がある。これを分けないと、CI で検出できない Azure リソース設定を「検出済み」と誤解させる。

| スコープ | 意味 | 例 |
|----------|------|----|
| **Source-only** | リポジトリ内のソース・設定ファイルだけで判定可能 | `host.json`, `package.json`, `.csproj`, `requirements.txt`, function 定義 |
| **IaC** | Bicep/ARM/Terraform/AZD などインフラ定義がある場合のみ判定可能 | `httpsOnly`, `minTlsVersion`, CORS, FTP, Flex Consumption storage |
| **Azure resource** | デプロイ済みまたは既存 Azure リソースへの照会が必要 | Storage region, lifecycle policy, Host ID collision confirmed |
| **AI analysis** | 静的パターンだけでは false positive が多く、コード意味解析が必要 | 冪等性、入力検証、長時間処理、fire-and-forget |

---

## 1. Runtime & Version

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `RT-001` | `host.json` schema version | `host.json` が欠落、JSON parse error、`version` が `"2.0"` 以外 | — | Source-only | `host.json` |
| `RT-002` | Functions runtime major version | `FUNCTIONS_EXTENSION_VERSION` が `~2` / `~3` / unsupported | `~4.x.y` など minor pinning | Source-only / IaC / Azure resource | app settings / IaC |
| `RT-003` | 言語 runtime version | Azure CLI / official metadata で unsupported / EOL | EOL 予定が近い、preview runtime | Source-only + Extended | `az functionapp list-runtimes` + language manifest |
| `RT-004` | Extension bundle / binding extension compatibility | 必要な binding extension が解決不能、runtime v4 の最小要件未満 | bundle range が古い、最新推奨範囲でない | Source-only | `host.json`, package refs |
| `RT-005` | .NET execution model | in-process + .NET 10 target など未サポート組み合わせ | in-process model 使用中、移行期限が近い場合 | Source-only | `.csproj`, package refs |

### 注意: `host.json.version` は runtime version ではない

`host.json` の `"version": "2.0"` は host.json schema version であり、Functions runtime v2/v3/v4 の識別子ではない。Runtime の EOL 判定は `FUNCTIONS_EXTENSION_VERSION` と言語 stack で行う。

### 言語バージョン判定方針

言語バージョン表はハードコードしない。doctor は可能な限り Azure CLI (`az functionapp list-runtimes`) / Functions stack metadata / 公式 docs 由来のデータを使用する。直接 `https://functions-next.azure.com/stacks/...` のような内部・非公開に近い endpoint へ依存しない。

| 言語 | 判定入力 | Fail の例 | Warning の例 |
|------|----------|-----------|--------------|
| Node.js / TypeScript | `package.json` `engines.node`, app settings, Azure CLI runtime metadata | unsupported / EOL major | EOL 予定が近い、preview |
| Python | `.python-version`, app settings, Azure CLI runtime metadata | unsupported / EOL minor | EOL 予定が近い、preview |
| .NET | `.csproj` TargetFramework, Worker SDK, Azure CLI runtime metadata | unsupported TFM / SDK combination | in-process migration advisory |
| Java | `pom.xml` / Gradle Java version, Azure CLI runtime metadata | unsupported Java version | nearing EOL |
| PowerShell | `requirements.psd1`, app settings, Azure CLI runtime metadata | unsupported PowerShell version | preview / nearing EOL |

---

## 2. Configuration (`host.json`)

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `CF-001` | `host.json` exists | missing | — | Source-only | file existence |
| `CF-002` | valid JSON | parse error | — | Source-only | JSON parse |
| `CF-003` | `version` field | missing or not `"2.0"` | — | Source-only | `host.json.version` |
| `CF-004` | extension bundle config | non-.NET app uses non-HTTP bindings and no bundle/direct extension path exists | no bundle but only HTTP triggers; older bundle range | Source-only | `host.json.extensionBundle`, bindings |
| `CF-005` | `functionTimeout` | known hosting plan limit exceeded | long or unbounded timeout without clear justification | Source-only / IaC | `host.json`, optional `--plan` / IaC |
| `CF-006` | HTTP concurrency | invalid schema/value shape | `maxConcurrentRequests` is `0` or extremely low | Source-only | `extensions.http.maxConcurrentRequests` |
| `CF-007` | trigger concurrency / batch settings | invalid values that prevent listener startup | values likely to throttle scale or overload memory | Source-only | trigger-specific host settings |
| `CF-008` | unknown or misspelled host settings | known-invalid setting location/value | unknown top-level keys | Source-only | schema-aware validation |
| `CF-009` | logging levels | — | default production log level is `Trace` / `Debug` | Source-only | `logging.logLevel` |

`functionTimeout` は plan により上限・既定値が異なるため、plan 不明時に Fail と断定しない。plan が IaC や CLI option から分かる場合のみ hard fail にする。

---

## 3. App Settings & Local Settings

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `AS-001` | `FUNCTIONS_WORKER_RUNTIME` | missing or not one of supported worker runtimes | language inferred but setting absent in local file only | Source-only | `local.settings.json`, env, IaC |
| `AS-002` | `AzureWebJobsStorage` / host storage | Flex 以外の plan で host storage setting / identity-based equivalent が無い。plan 不明時も欠落は Fail 寄り | local uses `UseDevelopmentStorage=true` in production-oriented IaC | Source-only / IaC | settings + binding inventory |
| `AS-003` | deprecated settings | — | `AzureWebJobsDashboard`, obsolete platform settings | Source-only / IaC | app settings |
| `AS-004` | Azure Files content settings | Windows Consumption/Premium IaC explicitly omits required Azure Files content settings and no no-Azure-Files pattern is used | not inferable from source | IaC / Azure resource | IaC / app settings |
| `AS-005` | worker process count | invalid value | exceeds likely core count or set without workload justification | Source-only / IaC | `FUNCTIONS_WORKER_PROCESS_COUNT` |
| `AS-006` | Application Insights / observability | — | no `APPLICATIONINSIGHTS_CONNECTION_STRING` or equivalent monitoring config | Source-only / IaC | settings / IaC |
| `AS-007` | identity-based connection shape | missing required `__accountName` / credential sub-settings | mixed secret + identity settings | Source-only / IaC | settings key groups |

---

## 4. Storage & Connections

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `ST-001` | host storage connection syntax | empty / malformed connection setting | dev storage in production IaC | Source-only / IaC | settings parser |
| `ST-002` | host storage with ADLS/HNS | confirmed Functions host storage (`AzureWebJobsStorage` or Flex deployment storage) has hierarchical namespace enabled | source indicates possible HNS storage but property unknown | IaC / Azure resource | IaC storage props / Azure query |
| `ST-003` | shared storage account | confirmed collision-prone shared host storage for Durable/Event Hubs/high-volume apps | same literal storage setting reused across multiple local projects | Source-only / IaC / Azure resource | settings comparison |
| `ST-004` | Host ID collision | confirmed duplicate host ID with same storage account | function app name >32 chars or slots likely share storage | Source-only / Azure resource | app names + storage account |
| `ST-005` | lifecycle management on Functions containers | lifecycle policy targets `azure-webjobs*` / `scm` containers | lifecycle policy exists but exclusions unknown | Azure resource | storage management API |
| `ST-006` | storage account region | confirmed different region from Function App | region unknown in source-only mode | IaC / Azure resource | IaC / Azure query |
| `ST-007` | Azure Files mount use | mount configured on unsupported plan / OS | writable mount without cleanup/quota/read-only justification | IaC / Azure resource / AI | IaC + code patterns |
| `ST-008` | Flex Consumption storage/deployment settings | Flex IaC missing `functionAppConfig.deployment.storage` or uses unsupported `WEBSITE_RUN_FROM_PACKAGE` / Azure Files content settings | Flex storage settings present but incomplete for identity/network posture | IaC | Bicep/ARM/Terraform/AZD |

---

## 5. Security

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `SC-001` | secrets in source | connection strings, storage keys, SAS tokens, client secrets committed in source | suspicious high-entropy strings | Source-only | built-in patterns or secret scanner |
| `SC-002` | HTTP trigger auth level | anonymous endpoint clearly exposes administrative or sensitive operation | anonymous public HTTP trigger without explicit gateway/auth note | Source-only / AI | function definitions |
| `SC-003` | CORS wildcard | `*` allowed origin combined with credentials support | `*` allowed origin without credentials | IaC / Azure resource | `siteConfig.cors`, `az functionapp cors show` |
| `SC-004` | HTTPS enforcement | `httpsOnly=false` in IaC for public app | no IaC evidence | IaC / Azure resource | site config |
| `SC-005` | `local.settings.json` handling | tracked by git or included in deploy artifact | missing from `.gitignore` | Source-only | git metadata / `.gitignore` |
| `SC-006` | FTP/FTPS state | plain FTP allowed | FTP endpoint enabled but FTPS-only | IaC / Azure resource | `ftpsState` |
| `SC-007` | managed identity adoption | — | secret-based Azure service connections where identity-based connection is supported | Source-only / IaC | settings pattern |
| `SC-008` | TLS version | `minTlsVersion` < `1.2` | not declared in IaC | IaC / Azure resource | site config |
| `SC-009` | input validation | — | trigger input used in SQL/commands/output binding without validation | AI analysis | code semantics |
| `SC-010` | admin endpoint isolation | — | app is public and admin isolation not configured in IaC | IaC / Azure resource | `functionsRuntimeAdminIsolationEnabled` |

For `SC-001`, long term design should prefer orchestration with a proven scanner such as Gitleaks/TruffleHog when available, with built-in patterns as a fallback.

---

## 6. Code Quality & Patterns

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `CQ-001` | client reuse | — | `HttpClient`, `CosmosClient`, `ServiceBusClient`, storage clients created per invocation | Source-only / AI | language-specific patterns |
| `CQ-002` | stateful functions | — | mutable global state used as durable business state | AI analysis | code semantics |
| `CQ-003` | long-running synchronous work | — | large synchronous loops, blocking CPU/file/network operations in request path | AI analysis | code semantics |
| `CQ-004` | background tasks completion | — | fire-and-forget promises/tasks/threads may outlive invocation | Source-only / AI | pattern + semantics |
| `CQ-005` | idempotency | — | Timer/Queue/ServiceBus/EventHub processing not idempotent | AI analysis | code semantics |
| `CQ-006` | blocking calls | — | `.Result`, `.Wait()`, `time.sleep`, sync HTTP calls in async handlers | Source-only | pattern matching |
| `CQ-007` | structured error handling | — | no top-level error capture/logging around risky operations | Source-only / AI | AST / semantics |
| `CQ-008` | output binding error handling | — | output binding used where SDK call is needed to handle remote-service errors | AI analysis | code + binding semantics |

静的パターンだけで Fail にすると false positive が多いため、このカテゴリは原則 Warning または AI analysis とする。

---

## 7. Dependencies & Bindings

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `DP-001` | binding extension minimum version | runtime v4 minimum requirements not met | extension range old but likely still works | Source-only / Extended | NuGet/package refs, bundle range |
| `DP-002` | binding type validity | unknown binding/trigger type | binding recognized but extension missing | Source-only | function metadata |
| `DP-003` | entry point resolution | configured entry point file does not exist | generated output may be stale | Source-only | filesystem |
| `DP-004` | connection setting reference | binding references missing setting name | unused connection setting | Source-only | binding/settings cross-reference |
| `DP-005` | dependency size | — | deploy package likely includes large dependency tree or dev dependencies | Source-only / Extended | package lock, `.funcignore`, package simulation |
| `DP-006` | Python dependency consistency | import of missing top-level package confirmed | probable missing package | Source-only / Extended | imports + `requirements.txt` |
| `DP-007` | package vulnerabilities | known critical/high vulnerability | known medium vulnerability | Extended | package manager audit |
| `DP-008` | retry configuration | invalid retry config | supported retry-capable trigger without explicit retry strategy | Source-only | function attributes / `function.json` |

---

## 8. Performance & Scalability

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `PF-001` | too many functions per app | — | function count exceeds configurable heuristic | Source-only | function inventory |
| `PF-002` | Event Hubs batching | — | Event Hub trigger processes single messages where batching is practical | Source-only / AI | binding + code |
| `PF-003` | queue/batch settings | invalid values | extreme batch/concurrency values | Source-only | `host.json` |
| `PF-004` | blob trigger strategy | polling blob trigger used for high-scale scenario evidence | polling blob trigger with large-container risk unknown | Source-only / AI | binding + naming/IaC hints |
| `PF-005` | scale limit | scale limit `0` or invalid | scale limit very low for production | IaC / Azure resource | app settings / IaC |
| `PF-006` | test/dev code in deploy artifact | test files included in deploy output and likely loaded | test directories exist without `.funcignore` exclusion | Source-only | file patterns + `.funcignore` |
| `PF-007` | Durable task hub/storage | confirmed shared task hub/storage collision | default task hub name in multi-app repo | Source-only / IaC / Azure resource | Durable settings |
| `PF-008` | large deployment package | package exceeds hosting/deployment practical limits | individual large files or artifacts included | Source-only / Extended | file size / package simulation |

Thresholds such as function count or package size must be configurable and documented as heuristics, not platform limits.

---

## 9. Error Handling & Resilience

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `EH-001` | structured error handling | — | no explicit error handling/logging around external calls | Source-only / AI | AST / semantics |
| `EH-002` | infinite retry | invalid retry shape | `maxRetryCount = -1` infinite retry without justification | Source-only | retry config |
| `EH-003` | poison/dead-letter handling | — | Queue/Service Bus processing lacks poison/dead-letter handling plan | Source-only / AI | binding + code |
| `EH-004` | Event Hub checkpoint delay | — | large retry count on Event Hub trigger can block partition progress | Source-only | retry config |
| `EH-005` | idempotency for at-least-once triggers | — | no apparent duplicate-processing protection | AI analysis | code semantics |

`maxRetryCount = -1` is documented as infinite retry, not an invalid value. It should be a Warning unless combined with other evidence that it causes deployment/runtime failure.

---

## 10. Language-Specific Checks

### 10.1 C# / .NET

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `CS-001` | blocking Task usage | — | `.Result` / `.Wait()` | Source-only | pattern matching |
| `CS-002` | execution model compatibility | unsupported TFM/model combination | in-process model migration advisory | Source-only | `.csproj` |
| `CS-003` | cancellation support | — | no `CancellationToken` where applicable | Source-only / AI | method signatures |
| `CS-004` | client reuse | — | `new HttpClient()` or Azure SDK client per invocation | Source-only | pattern matching |
| `CS-005` | Worker SDK / extension versions | minimum required version not met | version old but not blocked | Source-only | `.csproj` |

### 10.2 Node.js / TypeScript

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `JS-001` | programming model | unsupported package/model combination | v3 model used for new project | Source-only | `@azure/functions`, code registrations |
| `JS-002` | floating promises | — | promise not awaited/returned in handler | Source-only / AI | AST / lint-like analysis |
| `JS-003` | deploy artifact dependencies | — | dev dependencies likely included | Source-only / Extended | `.funcignore`, package simulation |
| `JS-004` | TypeScript output | `main` points to missing output | no `outDir`, stale build output | Source-only | `package.json`, `tsconfig.json` |
| `JS-005` | ESM/CJS mismatch | entry point cannot load due to module mismatch | mixed ESM/CJS patterns | Source-only | package type + imports |
| `JS-006` | client reuse | — | SDK client instantiated in handler | Source-only | pattern matching |

### 10.3 Python

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `PY-001` | programming model | unsupported model/runtime combination | v1 model used for new project | Source-only | `function_app.py`, `function.json` |
| `PY-002` | blocking operations | — | `requests` / `time.sleep` / sync I/O in async path | Source-only / AI | pattern + semantics |
| `PY-003` | `requirements.txt` | missing when external imports exist | empty or likely incomplete | Source-only | imports + file existence |
| `PY-004` | client reuse | — | Azure SDK client created per invocation | Source-only | pattern matching |
| `PY-005` | worker indexing flag | known old runtime + v2 model requires flag and flag missing | runtime unknown and old-host compatibility risk | Source-only | settings + runtime metadata |
| `PY-006` | worker extensions | missing required extension setting for custom worker extension usage | custom extension pattern unclear | Source-only | settings + imports |
| `PY-007` | `azure-functions` package | package version unsupported | old package version | Source-only | `requirements.txt` |

Do not fail all Python v2 projects just because `AzureWebJobsFeatureFlags=EnableWorkerIndexing` is absent. Newer Functions host versions enable worker indexing by default.

### 10.4 Java

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `JV-001` | Maven/Gradle plugin compatibility | plugin version unsupported | old plugin version | Source-only | `pom.xml`, Gradle files |
| `JV-002` | Java version compatibility | unsupported Java version | nearing EOL / mismatch | Source-only / Extended | build files + Azure CLI runtime metadata |
| `JV-003` | client reuse | — | SDK client created per invocation | Source-only | pattern matching |
| `JV-004` | app name / deployment metadata | impossible or conflicting deployment target in config | target unclear | Source-only / IaC | plugin config / IaC |

### 10.5 PowerShell

| ID | チェック | Fail | Warning | スコープ | 検出方法 |
|----|---------|------|---------|----------|----------|
| `PS-001` | managed dependencies | invalid managed dependency config | enabled but `requirements.psd1` missing | Source-only | `host.json`, files |
| `PS-002` | `profile.ps1` startup cost | — | slow or blocking work at startup | Source-only / AI | script analysis |
| `PS-003` | module installation in invocation | — | `Install-Module` in function path | Source-only | pattern matching |

---

## 実装ティア

| ティア | 実行方式 | 対象例 | CI 適合性 |
|--------|----------|--------|-----------|
| **Tier 1: Source-only built-in** | 静的解析、ファイル解析、軽量パターンマッチ | `host.json`, settings, entry point, binding inventory, obvious secrets | 高 |
| **Tier 2: Extended local** | package manager, Azure CLI runtime metadata, package simulation, vulnerability audit | language EOL, dependency audit, deployment package size | 中（ネットワーク/ツール依存） |
| **Tier 3: IaC** | Bicep/ARM/Terraform/AZD 解析 | HTTPS/TLS/FTP/CORS/Flex storage/site config | 中 |
| **Tier 4: Azure resource** | Azure CLI/MCP/ARM API で既存リソース照会 | storage region, lifecycle policy, confirmed Host ID collision | 低〜中（権限依存） |
| **Tier 5: AI analysis** | agent によるコード意味解析 | idempotency, validation, long-running work, fire-and-forget | 任意、`--deep` |

### `--no-deep` でサポートされる範囲

`--no-deep` は LLM を使わないため、原則として **Source-only built-in** のうち決定的に判定できるものだけを対象にする。IaC / Azure resource / semantic code analysis は対象外または限定的な Warning になる。

#### 現行実装で `--no-deep` 対応済み

| 実装済み ID | 対応設計 ID | 判定できること |
|-------------|-------------|----------------|
| `project-exists` | `CF-001` | `host.json` が存在するか |
| `runtime-version` | `CF-003` | `host.json.version` が `"2.0"` か |
| `extension-bundle` | `CF-004`, `RT-004` | 非 .NET app の extension bundle range |
| `node-version` | `RT-003` | `package.json` / runtime metadata による Node.js version |
| `python-version` | `RT-003` | local settings / runtime metadata による Python version |
| `dotnet-version` | `RT-003` | runtime metadata 上の .NET supported versions |
| `local-settings` | `AS-001` | `local.settings.json` と `FUNCTIONS_WORKER_RUNTIME` |
| `connection-strings` | `AS-002`, `ST-001` | non-HTTP trigger の host storage setting presence |
| `deprecated-settings` | `AS-003` | deprecated app settings |
| `function-bindings` | `DP-002` | unknown trigger type |
| `entry-point` | `DP-003`, `JS-004` | Node.js entry point file |
| `typescript-build` | `JS-004` | `tsconfig.json` parse / `outDir` |
| `package-dependencies` | `DP-005`, `DP-007` | 現状 stub。実質未対応 |
| `tracked-secret-files` | `SC-005` | `.env` と `local.settings.json` の Git tracking / ignore 状態 |
| `python-programming-model` | `PY-001` | Python v1、v2、mixed model layout |
| `python-dependency-manifest` | `PY-003` | external import がある場合の requirements / pyproject 欠如 |
| `python-azure-functions` | `PY-007` | `azure-functions` package の欠如・非互換 |
| `python-worker-dependency` | `PY-009` | platform-managed worker の明示依存 |
| `python-blueprint-registration` | `PY-008` | 静的解決可能な未登録 Blueprint |
| `python-native-dependencies` | `PY-010` | native wheel compatibility risk（Info） |
| `python-deploy-artifacts` | `PF-006` | `.funcignore` で除外されない test / environment / cache |
| `python-durable-configuration` | `PF-007` | implicit host default に依存する Durable trigger |
| `application-insights` | `AS-006` | local observability setting の存在 |
| `python-unpinned-requirements` | Supply chain | floating Python dependency |
| `python-missing-lockfile` | Supply chain | lockfile / dependency hash の欠如 |

#### `--no-deep` で追加実装しやすいもの

| 設計 ID | 理由 |
|---------|------|
| `RT-002` | app settings / IaC に `FUNCTIONS_EXTENSION_VERSION` があれば決定的に判定可能 |
| `SC-001` | built-in secret patterns または外部 scanner 呼び出しで判定可能 |
| `AS-007` | identity-based connection key group の形は静的判定可能 |
| `CF-005` | plan が分かる場合のみ決定的。plan 不明時は Warning |
| `DP-004` | binding の connection setting name と settings の突合 |
| `PF-008` | file size / 完全な deploy artifact simulation |
| `JS-004`, `CS-002`, `CS-005` | language manifest / package file から静的判定可能 |

#### `--no-deep` では原則サポートしないもの

| 種別 | 例 | 理由 |
|------|----|------|
| Semantic code analysis | `CQ-002` stateful functions, `CQ-005` idempotency, `SC-009` input validation, `EH-005` duplicate processing | コードの意味理解が必要で false positive が多い |
| IaC-only | `SC-003` CORS, `SC-004` HTTPS, `SC-006` FTP, `SC-008` TLS, Flex deployment storage | リポジトリに IaC がないと判断不能 |
| Azure resource | `ST-005` lifecycle policy, `ST-006` storage region, confirmed host ID collision | Azure API/権限が必要 |
| Runtime behavior | cold start risk, actual connection exhaustion, real trigger indexing failures | 実行またはデプロイ済み telemetry が必要 |

### deep analysis の前提ツール

現行実装の deep analysis は `--agent <name>` で外部 agent CLI を呼び出す。

| Agent | 実行コマンド | GitHub Actions で必要なもの |
|-------|-------------|-----------------------------|
| `github-copilot` | `copilot` | Copilot CLI が利用可能な runner、認証済みアカウントまたは token |
| `claude-code` | `claude` | Claude Code CLI と認証 |
| `codex` | `codex` | Codex CLI と認証 |

Azure CLI は runtime metadata (`az functionapp list-runtimes`) の取得に必要になる想定。`az functionapp list-runtimes` 自体はサブスクリプションリソースを読む操作ではないが、CI runner には Azure CLI のインストールが必要。Azure resource tier（既存 Function App / Storage / CORS / TLS / lifecycle policy 等を照会するチェック）まで実行する場合は、加えて `az login` / federated credentials が必要になる。IaC 解析だけなら Azure login は不要な場合がある。

---

## GitHub Actions 例

パッケージ名は `@azure/functions-skills`、CLI bin は `azure-functions-skills`。doctor の推奨 CI は deep analysis あり。ただし現行実装では agent CLI のインストール・認証が必要なため、`--no-deep` は軽量フォールバックとして残す。

### deep analysis を使う場合（推奨形）

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

Azure resource tier まで実行する場合は、この workflow に Azure login を追加する。

```yaml
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

### `--no-deep` 軽量モード

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

### このリポジトリから実行する場合

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

### Exit code

| Exit Code | 意味 |
|-----------|------|
| 0 | threshold 以上の `fail` / `warn` なし |
| 1 | threshold 以上の `fail` / `warn` あり |
| 2 | doctor 自体の実行エラー、パース不能、未処理例外 |

`--severity high` が現行 default。Warning を原則ブロックしない運用にしたい場合は、各 Warning の severity を `medium`/`low` に落とすか、CI 側で `--severity critical` などを選ぶ。

---

## 現在の実装とのギャップ

### 実装済み

| 実装済み ID | 対応する新 ID | 補足 |
|-------------|---------------|------|
| `project-exists` | `CF-001` | OK |
| `runtime-version` | `CF-003` | runtime EOL ではなく host.json schema check として扱う |
| `extension-bundle` | `CF-004`, `RT-004` | binding 使用状況に応じた Fail/Warning へ精緻化 |
| `node-version` | `RT-003` | 現行実装は direct Stacks API。Azure CLI runtime metadata 取得へ移行する |
| `python-version` | `RT-003` | 現行実装は direct Stacks API。Azure CLI runtime metadata 取得へ移行する |
| `dotnet-version` | `RT-003`, `CS-002` | 実プロジェクト TFM / package refs 解析を追加したい |
| `local-settings` | `AS-001` | missing は用途に応じて Warn/Fail を調整 |
| `connection-strings` | `AS-002`, `ST-001` | identity-based connection も認識する |
| `deprecated-settings` | `AS-003` | OK |
| `package-dependencies` | `DP-005`/`DP-007` | stub。実装が必要 |
| `function-bindings` | `DP-002` | extension presence も見る |
| `entry-point` | `DP-003`, `JS-004` | OK |
| `typescript-build` | `JS-004` | OK |
| `tracked-secret-files` | `SC-005` | `.env` と `local.settings.json` を対象にする |
| `application-insights` | `AS-006` | local evidence のみ。deployed settings は推論しない |
| Python deterministic checks | `PY-001`, `PY-003`, `PY-007`–`PY-010`, `PF-006`, `PF-007` | model、dependency、Blueprint、native wheel、packaging、Durable |

### 優先追加チェック

1. `SC-001` — source secret detection
2. `RT-003` — direct Stacks API 依存をやめ、Azure CLI runtime metadata (`az functionapp list-runtimes`) へ移行
3. `AS-007` — identity-based connection shape
4. `CQ-006` — obvious blocking call patterns
5. `CQ-001` / language-specific client reuse
6. `CF-005` — plan-aware `functionTimeout`
7. `DP-004` — binding connection setting reference validation
8. `PF-008` — large deploy artifact simulation
9. `JS-004` — stricter TypeScript output validation
13. `CS-002` / `CS-005` — .NET model and SDK compatibility

### 後続で扱うチェック

- IaC tier: HTTPS/TLS/FTP/CORS/Flex storage/site config
- Azure resource tier: storage lifecycle, region mismatch, confirmed Host ID collision
- AI tier: idempotency, input validation, long-running work, output binding exception strategy

---

## skill に盛り込むべき参照方針

1. **公式 docs を固定文言としてコピーしない**。URL とチェック根拠を保持し、バージョンは Azure CLI runtime metadata / current metadata を優先する。直接 `functions-next` endpoint には依存しない。
2. **Fail は絞る**。起動不能、未サポート、重大な secret leak、構文エラー、必須設定欠落に限定する。
3. **Warning は severity を持たせる**。CI では `--severity` でブロック方針を選べるようにする。
4. **検出スコープを必ず表示する**。Source-only で検出できないものを silent pass にしない。
5. **AI analysis は任意**。結果は補助的な Warning とし、証拠ファイル/行番号を伴う場合のみ強い判定にする。

---

## まとめ

doctor command は、デプロイ前の incident prevention のために次を優先する。

1. **起動不能を防ぐ**: `host.json`, app settings, runtime/language compatibility, binding resolution
2. **秘密情報漏えいを防ぐ**: committed secrets, `local.settings.json`, insecure IaC
3. **本番で詰まりやすいコードを検出する**: connection reuse, blocking calls, fire-and-forget, retry/idempotency
4. **CI で運用可能にする**: built-in source-only checks を常に実行し、deep analysis を推奨既定形にする。`--no-deep` は高速フォールバックとして残す
5. **スコープを明示する**: Source-only / IaC / Azure resource / AI を分け、false reassurance を避ける
