# Extension Bundle migration evaluation

This native Vally scenario tests an offline source migration to Extension
Bundle v4. **One trial migrates three independent apps**, not three trials.
Each app uses JavaScript programming model v3 with `function.json` bindings.
The original bundle versions and extension versions are listed in
[fixed source guidance](fixtures/guidance.md).

The scenario covers Cosmos DB change-feed and output bindings, plus Event
Hubs input and output bindings. It checks lease identity, resource and
app-setting names, consumer group, batch size, prefetch, checkpoint frequency,
logging, and empty and nonempty JavaScript batch behavior. These bindings
were selected because a bundle range edit can leave a valid JSON file with
an invalid binding contract or changed processing settings.

All three apps must pass. The grader records separate per-app results.
The original inputs and a range-only edit fail. Unit tests also reject lost
lease settings, old properties, changed batch behavior, and invalid files.

## Scope and limits

This is not a Functions host or service integration test. No Azure service,
broker, emulator, package restore, or NuGet preflight is needed. The grader
executes the dependency-free legacy JavaScript functions with synthetic
inputs and checks their JSON contracts. The fixture uses CommonJS because
the existing model-v3 app must remain unchanged; the grader uses ESM.

The three inputs are representative tagged versions, not all releases in
each bundle major. This does not measure Python, Java, PowerShell, Node
programming model v4, or a host/runtime upgrade. Event Grid, RabbitMQ,
Storage, and Durable migration guidance is documented in the skill but is
not measured by this scenario.

Before deployment, use a separate approved integration test to check
function registration, Cosmos permissions and lease continuation, Event
Hubs serialization, checkpoint/restart behavior, and load. A passing
offline result does not prove those properties.

The grader receives its script only after the agent finishes.
The fixed guidance documents the source rationale for reviewers; it is not
an input to scoring. The grader reads only named source and configuration files. It does not
use generated files, the agent's final answer, or an LLM judge to assign
the result. Thus, no generated source enters judge evidence and this
scenario has no judge inference cost. Native Vally still records the
agent trajectory and diff privately. Do not publish raw results.

## Run only this scenario

Use reviewed local code and the pinned dependencies from the repository
lockfile. Node.js 24+ and npm must be on PATH. Set a clean external staging
parent and an existing private output parent. The staging parent must not
inherit repository, user, workspace, or plugin skill configuration.

```powershell
$env:VALLY_RUN_ROOT = 'Q:\'
$env:VALLY_OUTPUT_ROOT = 'C:\private\benchmarks'

# Free: two planned trials, one model with skills OFF and ON.
npm run eval -- --skill azure-functions-update --scenario extension-bundles --models gpt-6-astra --trusted --dry-run
```

The dry-run makes no model calls. Before a paid run, separately approve the
model, budget, repetition count, and cleanup policy. The default is one
trial per OFF/ON condition, each with a ten-minute limit and one worker.
A time limit is not a cost cap. Supply an approved Copilot token through
the environment as described in the [local runner guide](../../../experiments/README.md).
Do not put credentials in commands or files.

```powershell
# Paid: run only after approval. This does not include the .NET scenario.
npm run eval -- --skill azure-functions-update --scenario extension-bundles --models gpt-6-astra --trusted
```

Repeat `--models <id>` to select more registered models. Use the dry-run
to confirm the resulting OFF/ON trial count. Omitting `--scenario` selects
all scenarios for the skill, including .NET and its NuGet preflight.

The runner preserves isolated OFF/ON skill discovery and removes only its
owned temporary staging and trial directory. It retains private results.
No cloud resources or processes that belong to other users are changed.
Do not run paid evaluations in PR-triggered CI. If an approved package
proxy is required, use `--registry https://your-approved-registry/`.
Ask @tsushi for internal setup; internal addresses are not public configuration.

## Free grader checks

```powershell
npm test -- tests/bundle-migration-grader.test.ts tests/evaluation-run.test.ts
npm run eval:lint
```

These commands test the grader and runner, not model performance. No
benchmark result is claimed until the user runs and reviews the trials.
