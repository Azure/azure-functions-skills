# Python migration evaluations

These two native Vally scenarios compare the same migration with the
azure-functions-update skill OFF and ON. They do not run the .NET scenario
when selected with the commands below.

| Scenario ID | Migration | Independent checks |
| --- | --- | --- |
| `python-blob-sdk` | HTTP plus Blob input: InputStream to BlobClient | Real Python SDK registration; mock SDK downloads; complete, empty, multibyte and larger UTF-8 responses |
| `python-http-streaming` | Both HTTP functions to the streaming extension | Real Python SDK registration; bounded incremental ASGI output; Echo route, auth, method, body and error contracts; Python 3.12 settings |

Each scenario has native completed, run-command and LLM prompt graders.
All must pass. The judge is fixed at gpt-6-astra with high reasoning effort.
Its calls add cost, including when the independent grader fails. No performance
claim or paid judge calibration is supplied. One run per arm is not evidence
of a stable skill advantage.

## Prerequisites

Use reviewed code only. The isolated runner is not a code sandbox. Do not run
paid evaluations from PR-triggered CI. A future GitHub Actions paid run needs
a reviewer-gated GitHub Environment.

Install Node.js 24+, Git and a supported Python version with pip and venv.
These checks were designed for Python 3.12 or 3.13. The app fixtures target
Python 3.12 regardless of the grader interpreter. Neither .NET, NuGet,
Functions Core Tools, Azure access nor an emulator is needed for these two
scenarios. Python dependencies must be installed before Vally starts; grader
execution makes no package downloads or storage calls.

From this checkout, prepare a dedicated environment. Change the example
directories if needed. Do not use a shared developer environment for these
tests.

```powershell
npm ci
python -m venv C:\private\python-migration-grader
& C:\private\python-migration-grader\Scripts\python.exe -m pip install -r evals\azure-functions-update\python-grader-requirements.txt
$env:PATH = 'C:\private\python-migration-grader\Scripts;' + $env:PATH

# Free: test the independent graders with trusted valid and invalid examples.
python -I -B tests\fixtures\python-migrations\test_graders.py
```

The runner retains PATH, but does not copy user Python configuration. `python
-I` disables the user site and PYTHONPATH. Use the environment's executable on
PATH as shown, not packages installed only with `pip --user`.

Use an existing clean external run parent without agent configuration in its
ancestors, and a private output parent. No credentials are needed for dry-run.

```powershell
$env:VALLY_RUN_ROOT = 'Q:\'
$env:VALLY_OUTPUT_ROOT = 'C:\private\benchmarks'
New-Item -ItemType Directory -Force $env:VALLY_OUTPUT_ROOT | Out-Null
$env:VALLY_TRUSTED = '1'

# Free: each command plans only one scenario, one model, skill OFF and ON.
npm run eval -- --skill azure-functions-update --scenario python-blob-sdk --models claude-sonnet-5 --dry-run
npm run eval -- --skill azure-functions-update --scenario python-http-streaming --models claude-sonnet-5 --dry-run
```

If your network needs another approved npm source, use the runner's
`--registry` or `VALLY_NPM_REGISTRY`. Do not publish internal proxy addresses.
Ask @tsushi for organization-specific setup.

## Paid commands

First approve the models, inference budget, repetition count and cleanup policy
separately. Supply a supported GitHub token through your approved process
environment without displaying it. See the [runner guide](../../experiments/README.md)
for account selection and isolation. `--trusted` is not spending approval.

```powershell
# Paid: one scenario, one model, two trials plus LLM grading.
npm run eval -- --skill azure-functions-update --scenario python-blob-sdk --models claude-sonnet-5
npm run eval -- --skill azure-functions-update --scenario python-http-streaming --models claude-sonnet-5

# Paid: only these two scenarios, one model, four trials plus LLM grading.
npm run eval -- --skill azure-functions-update --scenario python-blob-sdk --scenario python-http-streaming --models claude-sonnet-5

# Free: plan both scenarios with all six registered models (24 trials).
npm run eval -- --skill azure-functions-update --scenario python-blob-sdk --scenario python-http-streaming --models claude-sonnet-5 --models gpt-6-astra --models gpt-5.6-sol --models claude-opus-5 --models gpt-5.6-luna --models mai-code-1.1-flash --dry-run

# Paid: the same six-model selection, 24 trials plus LLM grading.
npm run eval -- --skill azure-functions-update --scenario python-blob-sdk --scenario python-http-streaming --models claude-sonnet-5 --models gpt-6-astra --models gpt-5.6-sol --models claude-opus-5 --models gpt-5.6-luna --models mai-code-1.1-flash
```

For one scenario with all six models, remove the other `--scenario` option
from the last command: 12 trials plus LLM grading. Omission of `--models`
also selects all currently registered models. There is no silent fallback.
Dry-run resolves the native plan, not model access, Python imports or runtime
behavior.

Repeat `--scenario` to select scenarios; it requires `--skill` and does not
accept comma-separated IDs. Do not use `--all` or omit the scenario filter
unless you intend to run the other registered scenarios. Excluded scenarios
and their fixtures are not staged, and Python-only selections skip the .NET
NuGet preflight. Skill references remain available to the selected skill.

## Limits and evidence

Blob storage calls use autospecced real SDK interfaces, not a storage service.
The fixture is an HTTP trigger plus a Blob input; Blob triggers are supported
by the documented SDK feature but are not exercised here.

HTTP output is sent through real ASGI response objects. The controlled source
requires each event to reach ASGI send before the next source item is requested.
The grader also checks that the submitted source yields five ordered events
and stops. This is not a TCP, proxy, Functions host or Azure streaming test.
Authorization is checked in registration metadata, not enforced by a host.
Host indexing, binding conversion and live storage access remain untested.

The fixed official-source notes and grader scripts enter the grading
environment only after the agent task. They are not supplied in the task
prompt. Native Vally owns execution, evidence, scoring and measurements.
The run-command result records checks and failures for the subsequent judge.
Inspect native verdicts; the temporary grading execution JSON is not a retained
artifact. The trial gitignore excludes virtual environments, Python caches,
package output and build output from diff evidence. The native repository
snapshot separately excludes `.venv`, `__pycache__`, `.pytest_cache`, `.cache`,
`build` and `dist`. Keep temporary output in those excluded directories.

Keep raw and native output private. Only publish a reviewed static report.
The runner removes its owned trial root, not your test virtual environment.
No cloud resources or long-running processes are created by these graders.
