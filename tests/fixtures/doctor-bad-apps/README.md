# Doctor bad app fixtures

These intentionally broken Azure Functions projects are test fixtures for the `doctor` command. They cover both **Tier 1** (built-in deterministic checks) and **Tier 2** (deep/LLM semantic analysis).

## Running fixtures

### Tier 1 (deterministic) — no LLM required

```powershell
$env:AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE = "1"
node bin/azure-functions-skills.js doctor --dir tests\fixtures\doctor-bad-apps\<fixture-name> --no-deep --format json
```

### Tier 2 (deep) — requires agent CLI (Copilot CLI, Claude Code, etc.)

```powershell
$env:AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE = "1"
node bin/azure-functions-skills.js doctor `
  --dir tests\fixtures\doctor-bad-apps\<fixture-name> `
  --deep --accept-deep-risk `
  --agent github-copilot `
  --format json --output <fixture-name>-result.json
```

> **CI cost note:** Each Tier 2 fixture spawns an LLM agent for semantic analysis. Consider using `SKIP_DEEP_TESTS=1` for CI runs that should only validate Tier 1 checks.

Use `expected-results.md` for expected findings. Tier 1 findings are strict; Tier 2 findings are advisory (LLM output is non-deterministic).

## Fixture list

### Tier 1 fixtures (Node.js, numbered — deterministic checks only)

| Fixture | Purpose |
|---------|---------|
| `01-missing-host-json` | Missing Functions project root |
| `02-host-json-missing-version` | `host.json` exists but lacks schema version |
| `03-extension-bundle-missing-version` | Extension bundle exists but has no version range |
| `04-extension-bundle-outdated` | Extension bundle range is too old |
| `05-unsupported-node-version` | Node.js version is outside supported fallback metadata |
| `06-missing-worker-runtime` | `FUNCTIONS_WORKER_RUNTIME` is missing |
| `07-non-http-missing-storage` | Non-HTTP trigger without `AzureWebJobsStorage` |
| `08-deprecated-settings` | Deprecated app settings |
| `09-unknown-trigger-type` | Function metadata has no recognized trigger |
| `10-entrypoint-tsconfig-errors` | Missing Node entry point and invalid `tsconfig.json` |

### Clean / negative fixtures (one per language — should produce 0 findings)

| Fixture | Language | Purpose |
|---------|----------|---------|
| `node-clean` | Node.js/TypeScript | Healthy v4 model project |
| `python-clean` | Python | Healthy v2 model project |
| `csharp-clean` | C# .NET | Healthy isolated model project |
| `java-clean` | Java | Healthy Maven project |
| `powershell-clean` | PowerShell | Healthy managed-deps project |

### Deep / semantic fixtures (multi-language — require LLM analysis)

| Fixture | Language | Tier 1 issues | Tier 2 (deep) issues |
|---------|----------|---------------|----------------------|
| `node-deep-client-reuse` | Node.js | Old extension bundle [3.*,4.*) | CQ-001, CQ-004, CQ-007, JS-006 — CosmosClient per invocation, floating promise, no error handling |
| `node-deep-anonymous-admin` | Node.js | — | SC-002, SC-009, CQ-003 — Anonymous admin endpoint, SQL injection, CPU-heavy sync work |
| `node-deep-secrets-obfuscated` | Node.js | — | SC-001, JS-005 — Secret split across variables, ESM/CJS mismatch |
| `node-deep-durable-nondeterministic` | Node.js | — | Durable orchestrator uses Date.now(), Math.random(), fetch(), setTimeout |
| `node-deep-eventhub-no-idempotency` | Node.js | — | EH-004, EH-005, CQ-005 — Payment without idempotency, checkpoint-blocking throws |
| `node-deep-servicebus-autocomplete` | Node.js | `function-bindings:warn` (v4 trigger detection) | autoComplete conflict, DP-004 connection name mismatch, EH-003 no dead-letter strategy |
| `node-deep-output-binding-errors` | Node.js | — | CQ-008, CQ-007 — Output binding without error handling |
| `python-deep-blocking-sync` | Python | Missing FUNCTIONS_WORKER_RUNTIME | PY-002, PY-004, CQ-006 — requests lib, time.sleep, client per invocation |
| `python-deep-v1-incomplete-deps` | Python | Deprecated AzureWebJobsDashboard | PY-001, PY-003 — v1 model, missing azure-cosmos in requirements.txt |
| `python-deep-v2-async-antipatterns` | Python | — | PY-002, PY-004, CQ-002 — Sync SDK in async handler, mutable global state, expensive module init |
| `python-deep-secrets-sql-injection` | Python | — | SC-001, SC-009, CQ-007 — SAS token + DB credentials in code, SQL injection via f-string |
| `csharp-deep-blocking-async` | C# | .NET 6 TFM (EOL) | CS-001, CS-003, CS-004 — .Result/.Wait(), no CancellationToken, new HttpClient, async void |
| `csharp-deep-inprocess-antipatterns` | C# | — (extension bundle check skips for .NET) | CS-002, CS-004, CQ-007 — In-process model, static client with finalizer disposal, DI anti-pattern |
| `java-deep-client-reuse` | Java | Missing extension bundle | JV-001, JV-002, JV-003, CQ-005, CQ-007 — Old plugin/Java 11, client per invocation, no idempotency, empty catch |
| `powershell-deep-install-module` | PowerShell | — | PS-002, PS-003, CQ-002 — Heavy profile, Install-Module in handler, $env/$global persistence |
| `powershell-deep-managed-deps` | PowerShell | Deprecated AzureWebJobsDashboard | PS-001, CQ-002, CQ-007 — managedDependency without requirements.psd1, $global cache anti-pattern |

### Supply-chain fixtures (Tier 1 + Tier 2)

| Fixture | Language | Tier 1 issues | Tier 2 (deep) issues |
|---------|----------|---------------|----------------------|
| `node-supply-chain-postinstall` | Node.js | `lifecycle-scripts:fail`, `missing-lockfile:warn` | SC-101 module-load spawn, SC-103 silent except |
| `node-supply-chain-unpinned-deps` | Node.js | `unpinned-prod-deps:warn`, `missing-lockfile:warn` | — |
| `node-supply-chain-tracked-env` | Node.js | `tracked-secret-files:fail`, `missing-lockfile:warn` | SC-109 hardcoded secrets in source |
| `node-supply-chain-dropper-pattern` | Node.js | `missing-lockfile:warn` | SC-101+102+103+104+108 (durabletask Node.js port) |
| `node-supply-chain-credential-collector` | Node.js | `missing-lockfile:warn` | SC-105 credential harvest, SC-106 .bashrc persistence |
| `python-supply-chain-c2-import` | Python | — | SC-101+102+103+104+108 (durabletask Python port) |

## Check ID reference

- **CF/RT/AS/DP/SC/PF** — Source-only checks (see `references/source-only-checks.md`)
- **CQ/EH** — AI semantic checks (see `references/ai-semantic-checks.md`)
- **CS/JS/PY/JV/PS** — Language-specific checks (see `references/language-checks.md`)
- **SC-101 .. SC-110** — Supply-chain semantic checks (see `references/supply-chain-checks.md`)

## Generate an HTML validation report

After running `run-all.ps1 -Deep`, you can produce an HTML report that scores how many expected Tier 2 findings the AI agent caught.

### Option 1 — bundled Node.js script (recommended)

```powershell
node <repo-root>/scripts/doctor-validation-report.mjs --fixtures-dir .
Start-Process .\ai-validation-report.html
```

The script uses a curated keyword map for each fixture and reports overall recall (%), per-fixture matched / missed / extra findings, and AI durations. Self-contained HTML, no external dependencies.

### Option 2 — let a coding agent produce the report

If you would rather hand the validation to a coding agent (Copilot CLI, Claude Code, Codex), paste the prompt below into the agent **from this directory** (the one containing `<fixture>/doctor-result.json`, `expected-results.md`, and this README). The agent reads each report, compares findings to the advisory `expected-results.md` assertions, and writes `ai-validation-report.html`.

````text
You are validating a doctor command test run for @azure/functions-skills.

The current working directory contains:
- One subdirectory per fixture (each is a doctor bad-app fixture).
- A `doctor-result.json` in each subdirectory, produced by
  `azure-functions-skills doctor --deep`.
- `expected-results.md` documents the Tier 2 findings each fixture is
  expected to produce, as advisory keyword-tagged assertions (LLM output is
  non-deterministic so wording varies — match by concept, not exact ID).

Task:

1. List the fixture subdirectories.
2. For each fixture:
   a. Load `doctor-result.json` and read `tiers.ai.checks` (the AI findings).
   b. Look up the expected Tier 2 findings for that fixture in
      `expected-results.md`. Each expected entry has an ID such as SC-101
      or CQ-007 and a short description.
   c. Use semantic matching: an AI finding satisfies an expected one if its
      `title`, `message`, `file`, or `recommendation` collectively cover the
      expected concept. Do not require the expected ID string to appear
      verbatim — match the concept (e.g. "module-load side effect" matches
      titles like "Code executes at import time" or "Top-level network call").
   d. Each expected entry: MATCHED or MISSED.
   e. Each AI finding that satisfies no expected entry: EXTRA. Many extras
      are still valid supply-chain concerns, not hallucinations.
3. Compute overall metrics: total expected, matched, missed, extras, recall (%).

Output: write a single self-contained file `ai-validation-report.html` in
the current directory with:

- Hero metrics at top: fixture count, expected total, matched, recall %, extras.
- A per-fixture summary table with columns: name, language (from each
  report's `language` field), Tier 1 issue count (status `fail`+`warn` in
  `tiers.builtin.checks`), Tier 2 finding count, recall (matched/total),
  AI duration in seconds (from `tiers.ai.durationMs`).
- A detailed section per fixture:
  - Each MATCHED expected entry, shown beside the AI title and severity
    that matched it.
  - Each MISSED expected entry, clearly flagged.
  - Each EXTRA AI finding, shown separately under an "Extras" heading.
- Inline `<style>` only — no external CSS or JS. The report must render
  offline. Color code: green for matched, red for missed, blue for extras.
- Escape every value that originates from the AI report (XSS safety).
  Validate `status` and `severity` against an allowlist before
  interpolating into CSS class names.

Do not modify any other files. Do not make network calls.
````

After the agent writes `ai-validation-report.html`, open it in a browser to review.
