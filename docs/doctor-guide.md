# Doctor Guide

`azure-functions-skills doctor` validates Azure Functions projects **before deployment**. It catches configuration mistakes, deprecated settings, runtime incompatibilities, and (with `--deep`) semantic code issues such as missing error handling, blocking I/O, hardcoded secrets, and durable-orchestrator non-determinism.

The goal is to prevent the most common incident classes from reaching production.

## Two tiers

| Tier | Engine | Speed | Trust model | What it catches |
| --- | --- | --- | --- | --- |
| **Tier 1** (built-in) | Deterministic Node.js checks | < 1s | No external execution | Missing `host.json`, deprecated app settings, unsupported runtime versions, missing `FUNCTIONS_WORKER_RUNTIME`, extension bundle drift, function entry point errors, TypeScript build mismatches, **supply-chain risks (lifecycle scripts, unpinned prod deps, missing lockfile, tracked `.env` files, install-script deps)** |
| **Tier 2** (`--deep`) | Headless LLM agent (Copilot / Claude / Codex) | ~60–120s | Agent runs with elevated permissions (write, shell) | Async/await anti-patterns, missing exception handling, hardcoded secrets, output-binding error gaps, durable non-determinism, service bus autoComplete conflicts, idempotency gaps, **semantic supply-chain attack patterns (import-time side effects, fetch-then-eval, anti-analysis, credential exfiltration)** |

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

Files are written to `--output` (default `.azure-functions-doctor/doctor-report.json`); stdout always shows the human-readable text form.

## GitHub Actions integration

### Pre-merge (PR) checks — Tier 1 only

For pull request validation, run **Tier 1 only** (`--no-deep`). Tier 2 must never run on PR code (see [Security model](#security-model) below).

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

      - name: Run Azure Functions doctor (Tier 1 only)
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

If you try to use `--deep` from this workflow, doctor refuses to start because it detects the `pull_request` event context.

### Post-merge — Tier 2 (full semantic analysis)

Tier 2 belongs in a separate workflow triggered by `push` to `main` (post-merge) — never `pull_request`. The agent only sees code that has already been reviewed and merged.

```yaml
name: Post-merge deep analysis
on:
  push:
    branches: [main]

jobs:
  deep-doctor:
    runs-on: ubuntu-latest
    environment: trusted-deep-analysis  # gate with GitHub Environment protections
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

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

Using a GitHub Environment (`environment: trusted-deep-analysis` above) lets you require manual approval before the deep run starts, scope the secret to that environment only, and limit branch eligibility.

## Security model

`doctor --deep` spawns an LLM agent with **file write** and **shell execution** permissions on the workspace. That means workspace content can prompt-inject the agent into doing anything the runner permits — exfiltrate secrets, modify files, install backdoors. Treat it like giving the workspace shell access.

### Rules

1. **Never run `--deep` on contributor pull requests.** Pull request code is untrusted by definition. Doctor refuses to run when it detects `GITHUB_EVENT_NAME=pull_request`/`pull_request_target`, Azure DevOps `BUILD_REASON=PullRequest`, or GitLab CI `CI_PIPELINE_SOURCE=merge_request_event`.
2. **Use environment isolation.** Run `--deep` only in a GitHub Environment (or equivalent) gated by manual approval and scoped secrets.
3. **Acknowledge the risk.** `--accept-deep-risk` is required to start Tier 2. There is no global default; every invocation must consent explicitly.
4. **Limit network egress.** Use [Harden-Runner](https://github.com/step-security/harden-runner) or equivalent egress filtering on runners that execute `--deep`.
5. **Do not store long-lived agent credentials in CI.** Prefer short-lived OIDC tokens.

### Escape hatch (trusted pipelines only)

The mirror/release pipeline may legitimately need to scan PR-derived branches. Set `AZURE_FUNCTIONS_DOCTOR_TRUST_PR=1` in that pipeline's environment to opt out of the PR-context refusal. **Never set this in a workflow that runs on PR events from contributors.**

### Why the refusal is at the runner, not just docs

Documentation is easy to overlook. The runtime refusal at the doctor level catches the bad pattern even when a workflow author copy-pastes the wrong example.

## Skill references

When `--deep` runs, the agent has access to focused checklists tagged by language and category:

- `references/source-only-checks.md` — code patterns (try/catch, async/await, resource disposal)
- `references/language-checks.md` — Python sync I/O, .NET in-process, Java old plugin versions, etc.
- `references/iac-azure-resource-checks.md` — managed identity, network, scaling configs
- `references/ai-semantic-checks.md` — Durable orchestrator determinism, output-binding gaps, idempotency
- `references/supply-chain-checks.md` — supply chain attack patterns (lifecycle scripts, fetch-then-eval, credential exfiltration)

The agent loads only the checklists relevant to the detected language/triggers.

## Auto-install behaviour for `--deep`

If the selected agent cannot see the local `azure-functions-doctor` skill, doctor copies the package-bundled local assets for that agent before deep analysis. Plugin installation remains the responsibility of the host coding agent.

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
Pass `--agent <name>` to select the coding-agent CLI used for deep analysis.

**Tier 1 reports `dotnet-version: skip`**
The Azure Stack API call failed (typical in offline CI). Set `AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE=1` to use the built-in fallback definitions.

**`doctor-ai-agent.log` in `.azure-functions-doctor/`**
This is the captured stdout/stderr from the Tier 2 agent run. Useful for diagnosing why `--deep` produced no findings or failed. Not committed by default.

## Related

- [CLI reference for doctor](cli-reference.md#doctor)
- [bad-app fixtures](bad-app-fixtures.md)
- [PRD F16 — implementation status](prd-docs/f16-azure-functions-doctor.md)
