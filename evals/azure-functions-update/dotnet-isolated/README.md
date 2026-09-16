# .NET Isolated Migration Evaluation

Migrate one small .NET 8 in-process HTTP app to .NET 10 isolated. The input is
an evaluation fixture authored in this repository, not a historical official
sample. There is no intermediate-stage requirement and no Azure deployment.

The existing runner compares the same prompt and input with the skill OFF and
ON. ON includes only azure-functions-update. OFF has no supplied skill. Both
arms use the same native Vally prompt judge: gpt-6-astra, high reasoning effort.
No custom agent runner or judge service is used.

## Requirements

- Node.js 24 or later, PowerShell 7, Git, .NET SDKs 8 and 10, and Functions Core
  Tools v4 must be on PATH. Install them before the evaluation.
- Restore this repository's dependencies from its configured npm registry.
  Do not switch to the public registry if it is not available in your network.
- The runner creates a credential-free `NuGet.Config` in its isolated profile.
  Public NuGet is the default. Use `--nuget-source` or
  `VALLY_NUGET_SOURCE` only when the local network needs another reviewed
  HTTPS v3 source. The URL cannot contain credentials, a query, or a fragment.
- Before a paid run, the runner restores a trusted probe for
  `Azure.Functions.Sdk` 1.0.0 and Worker 2.50.0. A failed preflight stops the
  run before Vally starts. Dry-run does not access NuGet.
- Use reviewed, trusted code only. Do not run in PR-triggered CI. The runner
  isolates configuration, not executable code; it is not a security sandbox.
- Approve model selection, inference budget, trial count, and owned-process
  cleanup before a paid run. Timeouts are not token or money limits.

## Run

Run these commands from the repository in PowerShell. Select clean external
directories. The run root must have no repository or agent configuration in its
ancestors. The output parent must be private. The example uses the Windows
temporary drive root for staging and the user's local app data for results.
Use different paths if that drive has agent configuration at its root.

```powershell
$env:VALLY_RUN_ROOT = [IO.Path]::GetPathRoot($env:TEMP)
$env:VALLY_OUTPUT_ROOT = Join-Path $env:LOCALAPPDATA 'vally-results'
New-Item -ItemType Directory -Force $env:VALLY_OUTPUT_ROOT | Out-Null
$env:VALLY_NPM_REGISTRY = npm config get registry
if ($LASTEXITCODE -ne 0) { throw 'Could not read the configured npm registry.' }
$env:VALLY_TRUSTED = '1'

# No model calls: verify one model with OFF and ON, two planned trials.
npm run eval -- --skill azure-functions-update --scenario dotnet-isolated --models claude-sonnet-5 --dry-run
```

If public NuGet is not available, set an approved credential-free NuGet proxy.
Do not use an internal proxy in public GitHub Actions. Ask @tsushi if you need
the Microsoft internal proxy address.

```powershell
$env:VALLY_NUGET_SOURCE = 'https://nuget-proxy.example/v3/index.json'
# Or add this option to one command:
# --nuget-source https://nuget-proxy.example/v3/index.json
```

Supply a GitHub token for an account with access to both the agent and judge
models. Keep it in the process environment; do not print it or put it in files.
For multiple accounts, add --user with the intended account to gh auth token.

```powershell
$env:COPILOT_GITHUB_TOKEN = gh auth token --hostname github.com
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:COPILOT_GITHUB_TOKEN)) {
    $env:COPILOT_GITHUB_TOKEN = $null
    throw 'Sign in to GitHub CLI with a Copilot-enabled account, then retry.'
}

# Paid: two migration trials plus their LLM grading calls.
npm run eval -- --skill azure-functions-update --scenario dotnet-isolated --models claude-sonnet-5

# Remove the token from this shell when no more runs are needed.
Remove-Item Env:COPILOT_GITHUB_TOKEN
Remove-Item Env:VALLY_NUGET_SOURCE -ErrorAction SilentlyContinue
```

To compare all six registered agent models, omit --models. That runs 12 migration
trials, each with LLM grading. The judge remains gpt-6-astra for every arm. Model
availability is not checked by dry-run. There is no silent model fallback.
Avoid --all unless you also want the other registered skill scenarios.

The command prints the native results path and the static site path. Open
site/index.html from that output bundle to view the existing dashboard. A failed
grader produces a nonzero command exit and can still produce a report.

Only the reviewed site directory is a publication candidate. Keep raw and native
results private. They can contain code, prompts, local paths, and tool output.
The runner removes only its owned staging directory. Never stop shared hosts
or delete another session's files. See the [runner guide](../../../experiments/README.md)
for isolation, cleanup, account selection, and report-only commands.

## Read the Results

- completed: the agent run finished.
- migration-configuration-and-publish: the project uses Azure.Functions.Sdk
  1.0.0 or later and Worker 2.50.0 or later without the old Worker.Sdk package;
  an independent dotnet publish passed; published output targets net10.0 and
  uses dotnet-isolated; Core Tools registers Hello and both required HTTP
  responses pass.
- migration-quality: the LLM checks the final code and diff against the rubric
  and the fixed [official-source notes](fixtures/guidance.md). It also reads the
  independent execution result written before this judge runs.

All three graders must pass. A high LLM score cannot offset a failed build.
The judge still runs after a failed build and can incur inference cost. The
execution JSON exists in the temporary grading view; it is not a retained
output artifact. Inspect native grader verdicts for the recorded result.
The judge receives repository files, the diff, and the trajectory, not just the agent's final
message. Model and skill labels are not supplied as scoring criteria, but this
is not a fully blinded experiment: skill files may be present in repo evidence.

The independent check starts the published output with Core Tools and sends the
two required HTTP requests. It does not test other query inputs or Azure
deployment. There are no IaC, pipeline, Durable, or non-HTTP bindings in this
case.

The native grader metadata records judge token usage and latency separately.
Use those fields for judge cost analysis; do not treat dashboard agent token
totals as the full bill. Billing can include retries and cached tokens. One run
per arm is a smoke comparison, not evidence of a stable performance difference.

## Evidence and Calibration

The official-source notes were reviewed on 2026-09-14. Before a later benchmark,
review the linked official pages and update the notes if requirements changed.
Freeze that revision for all arms. The judge does not browse the URLs. Keep the
input, notes, rubric, and judge unchanged within a comparison.

The initial implementation has static and deterministic validation only. No
paid model run or judge calibration was performed. Treat the first comparison
as a smoke test. Before relying on judge scores, use native Vally grade with a
reviewed successful migration and an intentionally incomplete migration, such
as one that still targets net8.0 or keeps in-process APIs. Both must receive the
same grading environment and rubric. Retain the verdicts privately; a judge
that accepts the incomplete migration is not calibrated for this task.