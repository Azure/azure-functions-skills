# Expected doctor results for bad app fixtures

Run with `AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE=1` to keep version checks deterministic.

## Tier 1 (deterministic) — strict assertions

These findings are produced by built-in checks (`--no-deep`) and can be validated automatically.

### Numbered fixtures (Node.js, Tier 1 only)

| Fixture | Expected status | Minimum expected findings |
|---------|-----------------|---------------------------|
| `01-missing-host-json` | fail | `project-exists:fail` |
| `02-host-json-missing-version` | fail | `runtime-version:fail`, `extension-bundle:warn`, `local-settings:warn` |
| `03-extension-bundle-missing-version` | fail | `extension-bundle:fail` |
| `04-extension-bundle-outdated` | fail | `extension-bundle:fail` |
| `05-unsupported-node-version` | fail | `node-version:fail` |
| `06-missing-worker-runtime` | pass (medium) | `local-settings:warn` |
| `07-non-http-missing-storage` | fail | `connection-strings:fail` |
| `08-deprecated-settings` | pass (medium) | `deprecated-settings:warn` |
| `09-unknown-trigger-type` | fail | `function-bindings:warn` |
| `10-entrypoint-tsconfig-errors` | fail | `entry-point:fail`, `typescript-build:fail` |

### Clean / negative fixtures (should produce 0 findings at any tier)

| Fixture | Language | Expected status | Expected findings |
|---------|----------|-----------------|-------------------|
| `node-clean` | Node.js | pass | None (all checks pass) |
| `python-clean` | Python | pass | None (all checks pass) |
| `csharp-clean` | C# | pass | None (all checks pass) |
| `java-clean` | Java | pass | None (all checks pass) |
| `powershell-clean` | PowerShell | pass | None (all checks pass) |

### Python deterministic fixtures

| Fixture | Expected status | Minimum expected findings |
|---------|-----------------|---------------------------|
| `python-mixed-model` | fail | `python-programming-model:warn` |
| `python-missing-dependency-manifest` | fail | `python-dependency-manifest:fail` |
| `python-missing-azure-functions` | fail | `python-azure-functions:fail` |
| `python-outdated-azure-functions` | fail | `python-azure-functions:fail` |
| `python-worker-dependency` | pass (medium) | `python-worker-dependency:warn` |
| `python-blueprint-unregistered` | fail | `python-blueprint-registration:warn` |
| `python-native-dependencies` | pass (info) | `python-native-dependencies:warn` |
| `python-deploy-artifacts` | pass (low) | `python-deploy-artifacts:warn` |
| `python-durable-defaults` | pass (low) | `python-durable-configuration:warn` |
| `python-missing-application-insights` | pass (info) | `application-insights:warn` |
| `python-v2-missing-storage` | fail | `connection-strings:fail` |

### Deep fixtures — Tier 1 component

These fixtures also have deterministic issues detectable by `--no-deep`:

| Fixture | Expected Tier 1 findings |
|---------|--------------------------|
| `node-deep-client-reuse` | `extension-bundle:fail` (range [3.*,4.*) is outdated) |
| `node-deep-anonymous-admin` | None expected |
| `node-deep-secrets-obfuscated` | None expected (secret is split/obfuscated — not regex-detectable) |
| `node-deep-durable-nondeterministic` | None expected |
| `node-deep-eventhub-no-idempotency` | None expected |
| `node-deep-servicebus-autocomplete` | `function-bindings:warn` (serviceBusQueue not in v4 discovery regex — triggers unknown trigger type warning) |
| `node-deep-output-binding-errors` | None expected |
| `python-deep-blocking-sync` | `local-settings:warn` (missing FUNCTIONS_WORKER_RUNTIME) |
| `python-deep-v1-incomplete-deps` | `deprecated-settings:warn` (AzureWebJobsDashboard) |
| `python-deep-v2-async-antipatterns` | None expected |
| `python-deep-secrets-sql-injection` | None expected |
| `csharp-deep-blocking-async` | `dotnet-version:skip` (stacks API needed for .NET version validation; net6.0 EOL detected only with live stacks) |
| `csharp-deep-inprocess-antipatterns` | None expected (extension bundle check skips for .NET projects) |
| `java-deep-client-reuse` | `extension-bundle:warn` (missing extension bundle) |
| `powershell-deep-install-module` | None expected |
| `powershell-deep-managed-deps` | `deprecated-settings:warn` (AzureWebJobsDashboard) |

## Tier 2 (deep/LLM) — advisory assertions

These findings require `--deep` and are produced by LLM semantic analysis. Because LLM output is non-deterministic, these are **advisory** — the expected findings describe what SHOULD be detected, but exact IDs, wording, and count may vary.

### Node.js deep fixtures

**`node-deep-client-reuse`** — Expected deep findings:
- ⚠️ CQ-001/JS-006: `CosmosClient` created inside handler (`new CosmosClient(...)` in processOrder.ts) — should be module-level
- ⚠️ CQ-004: Fire-and-forget promise — `container.items.create(...)` not awaited
- ⚠️ CQ-007: No try/catch around `fetch()` call to external shipping API

**`node-deep-anonymous-admin`** — Expected deep findings:
- 🚫 SC-002: Anonymous auth (`authLevel: "anonymous"`) on admin endpoint that deletes users
- 🚫 SC-009: User input `userId` used directly in SQL string without validation/parameterization
- ⚠️ CQ-003: CPU-intensive `computeHash()` with 100K iterations blocking request path

**`node-deep-secrets-obfuscated`** — Expected deep findings:
- 🚫 SC-001: Storage account key split across `accountKeyPart1`, `accountKeyPart2`, `accountKeySuffix` variables and concatenated into connection string
- ⚠️ JS-005: `tsconfig.json` has `"module": "CommonJS"` but code uses ESM import patterns

**`node-deep-durable-nondeterministic`** — Expected deep findings:
- 🚫 Durable: `Date.now()` in orchestrator (line 14) — should use `context.df.currentUtcDateTime`
- 🚫 Durable: `Math.random()` in orchestrator (line 17) — non-deterministic
- 🚫 Durable: Direct `fetch()` in orchestrator (line 20) — should use `context.df.callHttp` or activity
- 🚫 Durable: `setTimeout` via `new Promise(resolve => setTimeout(...))` (line 23) — should use `context.df.createTimer`

**`node-deep-eventhub-no-idempotency`** — Expected deep findings:
- ⚠️ CQ-005/EH-005: Payment API called without idempotency key — replays will double-charge
- ⚠️ EH-004: Throwing on payment failure blocks entire event batch checkpoint
- ⚠️ CQ-005: Irreversible side effect (email send) before any state tracking

**`node-deep-servicebus-autocomplete`** — Expected deep findings:
- ⚠️ autoComplete conflict: `host.json` has `autoCompleteMessages: true` but code throws to trigger retry
- ⚠️ DP-004: Connection name mismatch — binding uses `"ServiceBusConnection"` but local.settings has `"ServiceBusConn"`
- ⚠️ EH-003: No dead-letter strategy — errors logged and rethrown without DLQ forwarding or alerting

**`node-deep-output-binding-errors`** — Expected deep findings:
- ⚠️ CQ-008: Cosmos DB output binding used for critical write — no way to handle conflicts/throttling
- ⚠️ CQ-007: Returns success immediately without verifying the output binding succeeded

### Python deep fixtures

**`python-deep-blocking-sync`** — Expected deep findings:
- ⚠️ PY-002: `requests.get()` and `requests.post()` — synchronous HTTP in function handler
- ⚠️ CQ-006: `time.sleep(5)` and `time.sleep(2)` — blocking the worker thread
- ⚠️ PY-004/CQ-001: `BlobServiceClient.from_connection_string()` created per invocation

**`python-deep-v1-incomplete-deps`** — Expected deep findings:
- ⚠️ PY-001: Uses v1 programming model (`function.json` + `__init__.py`) instead of v2 decorators
- 🚫 PY-003: `from azure.cosmos import CosmosClient` but `azure-cosmos` not in `requirements.txt`

**`python-deep-v2-async-antipatterns`** — Expected deep findings:
- ⚠️ PY-002: `requests.get()` sync HTTP call inside `async def` handler — blocks event loop
- ⚠️ PY-004: New `CosmosClient(...)` created per invocation inside handler
- ⚠️ CQ-002: Mutable global `request_counter`, `processed_items`, `error_log` used for business state
- ⚠️ Module-level `requests.get()` call blocks during import/cold start

**`python-deep-secrets-sql-injection`** — Expected deep findings:
- 🚫 SC-001: SAS token with `sig=` parameter hardcoded in `BLOB_SAS_URL`
- 🚫 SC-001: Database connection string with `Pwd=SuperSecret123!` in `DB_CONNECTION`
- 🚫 SC-009: SQL injection via f-string: `f"SELECT * FROM users WHERE id = '{user_id}'"`
- 🚫 SC-009: Another SQL injection: `f"SELECT {columns} FROM {table_name}"`
- ⚠️ CQ-007: No try/except around `pyodbc.connect()` and `cursor.execute()`

### C# deep fixtures

**`csharp-deep-blocking-async`** — Expected deep findings:
- ⚠️ CS-001: `.Result` on `GetAsync()` and `ReadAsStringAsync()` — deadlock risk
- ⚠️ CS-001: `.Wait()` on `PostAsync()` — blocking async call
- ⚠️ CS-003: No `CancellationToken` parameter on `Run()` method
- 🚫 CS-004: `new HttpClient()` created multiple times per invocation — should use `IHttpClientFactory`
- 🚫 `async void RunAsync()` — exceptions crash process, not caught by runtime

**`csharp-deep-inprocess-antipatterns`** — Expected deep findings:
- ⚠️ CS-002: In-process model (`Microsoft.NET.Sdk.Functions`, `[FunctionName]`) — should migrate to isolated
- ⚠️ CS-004: Static `HttpClient` with finalizer disposal (`~ProcessItem()`) — incorrect pattern
- ⚠️ DI anti-pattern: Startup registers `new HttpClient()` as singleton instead of `IHttpClientFactory`
- ⚠️ CS-003: No `CancellationToken` on `Run()` method

### Java deep fixtures

**`java-deep-client-reuse`** — Expected deep findings:
- ⚠️ JV-001: Maven plugin version 1.18.0 is outdated (current: 1.37.0+)
- ⚠️ JV-002: Java 11 — nearing or past EOL for Azure Functions
- 🚫 JV-003: `BlobServiceClient`, `CosmosClient` created inside handler methods (3 occurrences)
- ⚠️ CQ-005: ServiceBus order processing without idempotency check
- ⚠️ CQ-007: Empty catch block swallows all exceptions silently
- ⚠️ Resource leak: `CosmosClient` never closed

### PowerShell deep fixtures

**`powershell-deep-install-module`** — Expected deep findings:
- ⚠️ PS-002: `profile.ps1` installs modules, calls APIs, downloads large config — slow cold start
- 🚫 PS-003: `Install-Module` called in `TimerTrigger/run.ps1` handler (2 occurrences)
- ⚠️ CQ-002: `$env:RUN_COUNT` and `$global:ProcessedCount` used for state — not shared across instances

**`powershell-deep-managed-deps`** — Expected deep findings:
- 🚫 PS-001: `host.json` has `managedDependency.enabled: true` but `requirements.psd1` is missing
- ⚠️ CQ-002: `$global:UserCache` hash table used as cross-invocation cache — per-worker only
- ⚠️ CQ-007: No error handling around `Invoke-RestMethod` call

### Supply-chain deep fixtures (Tier 1 + Tier 2)

These fixtures exercise the supply-chain checks added with the doctor-as-defender feature.

**`node-supply-chain-postinstall`** — Tier 1: `lifecycle-scripts:fail` (high — package.json defines `preinstall` and `postinstall`). Tier 2 advisory:
- 🚫 SC-101: src/functions/hello.js spawns a detached child process at module load (import-time side effect)
- ⚠️ SC-103: bare try/catch swallows errors around the spawn

**`node-supply-chain-unpinned-deps`** — Tier 1:
- `unpinned-prod-deps:warn` (medium — 5 prod deps use `^`/`*`/`latest`)
- `missing-lockfile:warn` (medium — no package-lock.json)

No Tier 2 advisory expected (deterministic only).

**`node-supply-chain-tracked-env`** — Tier 1:
- `tracked-secret-files:fail` (high — `.env` is present and `.gitignore` does not cover it)

Tier 2 advisory:
- 🚫 SC-109: `src/functions/lookup.js` contains hardcoded production-looking secrets in variable declarations (`DB_PASSWORD`, `AWS_ACCESS_KEY_ID`, an AWS-key-shaped string)

**`node-supply-chain-dropper-pattern`** — Tier 2 only (no Tier 1 findings expected). Mirrors the durabletask Node.js port:
- 🚫 SC-101: code runs at module-load via IIFE
- 🚫 SC-102: fetch-then-execute (https.get + spawn child to run downloaded file)
- ⚠️ SC-103: empty catch swallows all errors
- 🚫 SC-104: hardcoded raw IP host in URL (`192.0.2.42`)
- 🚫 SC-108: anti-analysis gates (Linux only, CPU > 2, skip Russian LANG)

**`node-supply-chain-credential-collector`** — Tier 2 only:
- 🚫 SC-105: systematic credential harvesting from cloud / SSH / git / npm / docker / shell-history paths plus regex over env vars matching `TOKEN|SECRET|KEY|PASSWORD`
- 🚫 SC-106: persistence installation via append to `~/.bashrc`
- ⚠️ SC-103: silent empty catch around filesystem reads and persistence write

**`python-supply-chain-c2-import`** — Tier 2 only (Python). Mirrors the durabletask dropper:
- 🚫 SC-101: top-level code in `function_app.py` runs at import (before any handler is called)
- 🚫 SC-102: urlretrieve + subprocess.Popen with `start_new_session=True`
- ⚠️ SC-103: bare `except: pass` suppresses everything
- 🚫 SC-104: hardcoded C2-shaped host (`check.example-rcd-host.com`)
- 🚫 SC-108: Linux gate, low-CPU exit, Russian-locale exit

## Severity legend

- 🚫 = Expected `fail` (Tier 2 confidence: high)
- ⚠️ = Expected `warn` (Tier 2 confidence: medium or context-dependent)

## Notes

- Default `--severity high` makes high and critical warnings/failures return exit code 1.
- `06-missing-worker-runtime` is a medium warning → exit code 0 with default severity.
- `08-deprecated-settings` uses medium warnings only → exit code 0 with default severity.
- `09-unknown-trigger-type` is a high-severity warning → exits 1 with default severity.
- Clean fixtures should produce 0 findings at both Tier 1 and Tier 2 (false positives indicate LLM hallucination).
- Tier 2 expected findings are advisory — LLM may use different wording, produce additional valid findings, or miss some. Use category + keyword matching rather than exact ID comparison for automated Tier 2 validation.
- The supply-chain fixtures use non-routable example.com / 192.0.2.x placeholders. They do not contain actual malicious payloads — only the structural patterns doctor's checks should detect.
