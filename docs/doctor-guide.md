# Doctor Guide

`azure-functions-skills doctor` validates Azure Functions projects **before deployment**. It catches configuration mistakes, deprecated settings, runtime incompatibilities, and (with `--deep`) semantic code issues such as missing error handling, blocking I/O, hardcoded secrets, and durable-orchestrator non-determinism.

The goal is to prevent the most common incident classes from reaching production.

## Two tiers

| Tier | Engine | Speed | Trust model | What it catches |
| --- | --- | --- | --- | --- |
| **Tier 1** (built-in) | Deterministic Node.js checks | < 1s | No external execution | Missing `host.json`, deprecated app settings, unsupported runtime versions, missing `FUNCTIONS_WORKER_RUNTIME`, extension bundle drift, function entry point errors, TypeScript build mismatches |
| **Tier 2** (`--deep`) | Headless LLM agent (Copilot / Claude / Codex) | ~60–120s | Agent runs with elevated permissions (write, shell) | Async/await anti-patterns, missing exception handling, hardcoded secrets, output-binding error gaps, durable non-determinism, service bus autoComplete conflicts, idempotency gaps |

Tier 1 always runs. Tier 2 is opt-in.

## Quick start

### Local — visual HTML report

```bash
npx @azure/functions-skills doctor --dir . --format html --output doctor-report.html
```

Open `doctor-report.html` in a browser:

![Doctor HTML report](images/doctor-report.png)

The HTML report includes:

- Overall pass/fail badge
- Summary cards (critical / high / medium / low / passed / total)
- Per-check cards color-coded by severity, with file:line references and remediation hints
- Tier 2 findings (when `--deep`) with the agent name, duration, and full message

### Local — pre-deploy gate

```bash
npx @azure/functions-skills doctor --dir .
```

Returns exit code `1` if any finding is at or above the `--severity` threshold (default `high`). Use this as a make/npm script gate before `azd up` / `func azure functionapp publish`.

### Local — deep semantic analysis

```bash
npx @azure/functions-skills doctor --dir . \
  --deep --accept-deep-risk \
  --agent github-copilot \
  --format html --output doctor-deep.html
```

⚠️ `--deep` runs the agent with elevated permissions on workspace files. Use only on trusted workspaces. The `--accept-deep-risk` flag is required to acknowledge this — running with `--deep` alone refuses to start the agent.

## Output formats

| Format | Best for | Notes |
| --- | --- | --- |
| `text` (default) | Local terminal, CI logs | Always also written to stdout regardless of `--format`. |
| `json` | CI artifacts, custom tooling | Full structured report; what other formats wrap. |
| `markdown` | PR comments, GitHub Actions job summary | Drop into `$GITHUB_STEP_SUMMARY`. |
| `html` | Local viewing, hosted artifacts | Self-contained — no external CSS or JS. Safe to host on GitHub Pages. |

Files are written to `--output` (default `.azure-functions-skills/doctor-report.json`); stdout always shows the human-readable text form.

## GitHub Actions integration

A minimal pre-deployment validation workflow:

```yaml
name: Pre-deploy validation
on: [pull_request]

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Run Azure Functions doctor
        run: |
          npx @azure/functions-skills doctor \
            --no-deep \
            --format markdown \
            --output doctor.md \
            --severity high
        # Exit 1 if any high/critical issue found

      - name: Publish doctor summary
        if: always()
        run: cat doctor.md >> $GITHUB_STEP_SUMMARY

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: doctor-report
          path: doctor.md
```

For Tier 2 in CI (requires the chosen agent CLI to be installed and authenticated):

```yaml
      - name: Install GitHub Copilot CLI
        run: npm install -g @github/copilot

      - name: Run deep doctor
        env:
          GITHUB_TOKEN: ${{ secrets.COPILOT_TOKEN }}
        run: |
          npx @azure/functions-skills doctor \
            --deep --accept-deep-risk \
            --agent github-copilot \
            --format html --output doctor.html \
            --timeout 300

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: doctor-deep-report
          path: doctor.html
```

## Skill references

When `--deep` runs, the agent has access to focused checklists tagged by language and category:

- `references/source-only-checks.md` — code patterns (try/catch, async/await, resource disposal)
- `references/language-checks.md` — Python sync I/O, .NET in-process, Java old plugin versions, etc.
- `references/iac-azure-resource-checks.md` — managed identity, network, scaling configs
- `references/ai-semantic-checks.md` — Durable orchestrator determinism, output-binding gaps, idempotency

The agent loads only the checklists relevant to the detected language/triggers.

## Auto-install behaviour for `--deep`

If the workspace state file doesn't show the chosen agent as installed, doctor auto-installs the skill files first:

- **Default (`--install-mode local`)**: Copies skill files into the workspace via `applySetup`. Safe for CI and ephemeral environments — no global state changes.
- **`--install-mode plugin`**: Runs the host plugin install + workspace activation. For dev machines where you want skills available globally.

State is recorded with `source: 'doctor-auto'` so future `doctor`/`chat` runs skip the install step.

## Testing with bad-app fixtures

A library of intentionally broken Azure Functions projects exercises the full doctor surface. See [bad-app-fixtures.md](bad-app-fixtures.md) for setup and validation workflows. Quick start:

```powershell
# Windows
.\scripts\doctor-e2e-setup.ps1 -Target Q:\temp\doctor-deep-test -DeepOnly
cd Q:\temp\doctor-deep-test
.\run-all.ps1 -Deep -Agent github-copilot
```

## Troubleshooting

**"AI analysis skipped: ... `--accept-deep-risk`"**
You ran `--deep` without acknowledging the elevated-permission requirement. Add `--accept-deep-risk` only on trusted workspaces.

**"AI analysis skipped: no agent specified and none installed"**
Pass `--agent <name>`, or run `install` first so workspace state knows which agent to use.

**Tier 1 reports `dotnet-version: skip`**
The Azure Stack API call failed (typical in offline CI). Set `AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE=1` to use the built-in fallback definitions.

**`doctor-ai-agent.log` in `.azure-functions-skills/`**
This is the captured stdout/stderr from the Tier 2 agent run. Useful for diagnosing why `--deep` produced no findings or failed. Not committed by default.

## Related

- [CLI reference for doctor](cli-reference.md#doctor)
- [bad-app fixtures](bad-app-fixtures.md)
- [PRD F16 — implementation status](prd-docs/f16-azure-functions-doctor.md)
