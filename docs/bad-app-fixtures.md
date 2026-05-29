# Bad-App Fixtures for Doctor Testing

A library of intentionally broken Azure Functions projects under `tests/fixtures/doctor-bad-apps/` exercises every check in the doctor command — both Tier 1 deterministic checks and Tier 2 LLM semantic analysis.

These fixtures back the unit test suite and a manual E2E validation workflow.

## What is in the fixture library

| Category | Fixtures | Purpose |
| --- | --- | --- |
| **Tier 1 only (numbered)** | `01-missing-host-json`, `02-host-json-missing-version`, … `10-entrypoint-tsconfig-errors` | Each isolates a single deterministic failure mode. |
| **Tier 2 (`*-deep-*`)** | 16 fixtures across Node.js, Python, C#, Java, PowerShell | Each contains realistic code smell patterns: blocking I/O, missing error handling, secrets in source, durable non-determinism, etc. |
| **Clean reference** | `node-clean`, `python-clean`, `csharp-clean`, `java-clean`, `powershell-clean` | Negative controls — should produce zero findings. |

Each fixture has `expected-results.md` describing what doctor *should* detect at each tier.

See the full list at [tests/fixtures/doctor-bad-apps/README.md](../tests/fixtures/doctor-bad-apps/README.md) and the assertions at [tests/fixtures/doctor-bad-apps/expected-results.md](../tests/fixtures/doctor-bad-apps/expected-results.md).

## Manual E2E workflow

### 1. Copy fixtures to a working directory

A helper script copies fixtures into a target directory (so doctor's side-effects do not pollute the source tree):

```powershell
# Windows (PowerShell)
cd <repo-root>
.\scripts\doctor-e2e-setup.ps1 -Target Q:\temp\doctor-deep-test -DeepOnly
```

Options:
- `-Target <path>` — destination (default: `$env:TEMP\doctor-e2e-<timestamp>`)
- `-Filter <glob>` — pattern, e.g. `"python-*"` or `"node-deep-*"`
- `-DeepOnly` — copy only `*-deep-*` fixtures (skips numbered and clean fixtures)

The script also writes a `run-all.ps1` helper inside the target directory.

### 2. Run doctor against every fixture

```powershell
cd Q:\temp\doctor-deep-test

# Tier 1 only — fast, no LLM cost
.\run-all.ps1

# Tier 2 — invokes the agent for each fixture (~60–120s each, 16 fixtures ≈ 25 min total)
.\run-all.ps1 -Deep -Agent github-copilot
```

Each fixture's report is saved to `<fixture>/doctor-result.json`. A summary table is printed at the end:

```text
===== Summary =====
Name                                 ExitCode Status  Critical High Medium AiChecks Duration
----                                 -------- ------  -------- ---- ------ -------- --------
csharp-deep-blocking-async                  1 fail           0    4      2        8     78.2
node-deep-client-reuse                      1 fail           1    3      2        9     65.4
…
```

### 3. Generate HTML validation report

After a deep run, compare AI findings against expected results and produce an HTML report.

**Option A — bundled Node.js script (deterministic, recommended):**

```bash
node <repo>/scripts/doctor-validation-report.mjs --fixtures-dir Q:\temp\doctor-deep-test
```

Writes `ai-validation-report.html` to the fixtures directory with:

- Overall recall metric (% of expected findings matched)
- Per-fixture: matched / missed / extra findings
- Drill-down: AI title, severity badge, file:line, full message

Typical recall on 16 fixtures with GitHub Copilot CLI: **~95%**.

> The deterministic Node.js script above is the only supported way to generate the validation report. A previous "ask a coding agent to write the report" option was withdrawn: pointing a general-purpose agent at adversarial fixture content is itself a prompt-injection surface.

### 4. Cleanup

```powershell
.\scripts\doctor-e2e-cleanup.ps1 -Target Q:\temp\doctor-deep-test
```

## Adding a new fixture

1. Pick a representative anti-pattern (e.g. "missing CancellationToken in async handler")
2. Create a minimal Azure Functions project under `tests/fixtures/doctor-bad-apps/<lang>-deep-<scenario>/`
3. Document expected findings in [tests/fixtures/doctor-bad-apps/expected-results.md](../tests/fixtures/doctor-bad-apps/expected-results.md):
   - Tier 1 findings (strict assertions — must be deterministic)
   - Tier 2 findings (advisory — keyword groups, since LLM wording varies)
4. Run doctor against the fixture to confirm it produces the expected output
5. If you add a new keyword group, update `generate-report.mjs` (if you keep a local copy outside the repo) so the validation report can match the new finding

## Notes for CI

The fixtures are intentionally broken — they fail compilation/lint/typecheck. They are excluded from the main CI flow via:

- `eslint.config.js` → `ignores: ['tests/fixtures/doctor-bad-apps/**']`
- `tsconfig.typecheck.json` → `exclude: ['tests/fixtures/doctor-bad-apps/**']`

If you add a new fixture and CI starts complaining, verify the exclusions are still applied.

## Related

- [Doctor guide](doctor-guide.md)
- [CLI reference for doctor](cli-reference.md#doctor)
- [tests/fixtures/doctor-bad-apps/README.md](../tests/fixtures/doctor-bad-apps/README.md)
- [tests/fixtures/doctor-bad-apps/expected-results.md](../tests/fixtures/doctor-bad-apps/expected-results.md)
