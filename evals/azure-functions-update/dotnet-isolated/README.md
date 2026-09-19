# .NET isolated migration evaluation

This case migrates a small in-process app to the isolated worker. The Functions
model/configuration phase keeps `net8.0`. It does not update the language or hosting plan.

## Input app

The starting point is the app from
[Azure/azure-functions-skills#267](https://github.com/Azure/azure-functions-skills/pull/267),
commit `605f4eca7ee8839787fb630fc8134ec0436a1cc9`.
This revision adds three small migration surfaces. It does not change #267.

| Surface | Input | Required result after migration |
| --- | --- | --- |
| DI | FunctionsStartup registers a singleton GreetingService; both functions use constructor injection | Program.cs registers the service; both functions still use it |
| Logging | Method-injected ILogger writes Information messages | Worker logging preserves the messages and level |
| Trigger/input/output | QueueGreeting reads a request ID from a queue, a name from a blob input binding, and writes a greeting through a blob output binding | Compatible isolated extension bindings preserve the same contract |
| HTTP | Hello returns plain text for the anonymous GET route `/api/hello` | Same function name, route, status, media type, and responses |

For the storage path, send a base64-encoded request ID to `greeting-requests`.
Put `Storage` in `greeting-input/<request ID>.txt`. The expected output is
`Hello, Storage!` in `greeting-output/<request ID>.txt`. Both bindings use
`AzureWebJobsStorage`. Do not replace bindings with application SDK calls.

The design reference is
[fabiocav/azure-functions-dotnet-migration](https://github.com/fabiocav/azure-functions-dotnet-migration/tree/767350e51ca1d5972eb79544608b11c18f92354b).
This fixture uses its DI pattern as a reference; it does not copy its implementation.
`upstream-provenance.json` records original hashes and deliberate changes.
The `baseline/*.txt` copies are the current input for grading. Their text extensions
prevent the build from compiling a second copy of the app.

## Definition-of-done grading

`fixtures/definition-of-done.json` uses the same 19 IDs as the scenario reference.
Each ID has evidence and one status: `pass`, `fail`, `blocked`, or `not-applicable`.
N/A requires a reason. Missing infrastructure or execution evidence is never a pass.

The deterministic grader restores, builds, publishes, runs existing test projects if
present, starts the host, and exercises the HTTP and queue/blob paths. It checks expected
function registration through the local `/admin/functions` API, not log text.
It records `grading-evidence/checklist.json`
and command logs, stops its host, and removes only the emulator resources it created.
It never calls Azure or starts an emulator. A failed cleanup fails the result.

The **code-only-v1** judge receives final source and build configuration, fixed review
notes, and typed machine statuses. A Vally grader plugin creates this separate input;
it does not edit the original workspace or results. The input excludes raw logs,
transcripts, patches, agent reports, skill files, generated build output, and local
settings. The source selection includes C# files, project files, props/targets,
`host.json`, `global.json`, and `.gitignore`. Local settings are checked by the machine
grader. The bundle has a 24 KB limit and is supplied inline. Excess size or missing
required evidence is an error, not a truncated review or a pass.

The judge checks DI, signatures, logging calls, and binding contracts. DI-10 is source
review only. Its machine status permits review; it does not prove emitted logs or
telemetry delivery. DI-04 checks host inventory and trigger execution, not log warnings
or errors. Thus these IDs cover less than the full skill completion definition.
Agent report quality and actions in transcripts are not assessed. Raw diagnostic logs
can remain in the saved run for the operator, but are not LLM grading inputs.

The judge cannot turn a machine fail, blocked check, or missing evidence into success.
Optional improvements do not change required acceptance. Do not compare this policy
directly with earlier full-log judge scores without identifying the policy change.
Previous results are not changed or regraded.

## Short task and private user answers

The initial request asks only to use `azure-functions-update` and update the project
to the latest programming model. Both arms receive the same source and a short
`AGENTS.md` with workspace and operation limits. Neither arm receives the private
grading checklist, review notes, or a migration recipe.

The `user-policy-copilot` executor supplies customer answers only when the agent
uses the SDK user-input callback. Its private policy contains scope, environment,
permission, and dependency facts, not package choices or code changes. It is not
staged into the agent workspace. Both arms use the same policy. An arm that asks no
questions receives no extra answers. An unknown, ambiguous, or unsupported question
blocks the trial; the runner does not assume approval. This policy does not replace
an operating-system sandbox or support every third-party confirmation UI.
Patterns match the full question, without case sensitivity. A closed-choice question
requires an exact configured answer. A question that matches two rules is blocked,
not answered by guessing. Review the private question record before a later rerun.

Vally 0.16 does not load experiment `grader_plugins` during `experiment run`.
The local runner instead calls standalone `vally eval` with both plugin flags for
each cell. It saves original results and a separate `matrix-manifest.json` for
reporting. It does not create a false native experiment manifest.

Provide .NET SDK 8, Core Tools v4, PowerShell 7.2+, and a reachable NuGet source.
Also provide a **dedicated Azurite instance** on loopback ports 10000 and 10001,
using its public development account. Do not share it with another app or concurrent
trial. The `greeting-requests` queue and `greeting-input`/`greeting-output` containers
must be absent at each start. Neither agent nor grader may delete pre-existing data.
Use `AzureWebJobsStorage=UseDevelopmentStorage=true`; do not use cloud credentials.
The baseline also needs `FUNCTIONS_WORKER_RUNTIME=dotnet` and
`FUNCTIONS_INPROC_NET8_ENABLED=1`. Keep real local settings untracked.

The run helper stages only declared files into a clean external directory. It isolates
NuGet settings and caches and checks the selected SDK/Worker restore path before a
paid call. This is not a complete host or emulator readiness check. The operator must
check the other prerequisites first. No installation or emulator start is automatic.

After code review, use existing clean external parent directories. This example selects
GPT-6 Astra and Claude Opus 5, with one ON and one OFF trial for each model:

```powershell
npm run eval:run -- --skill azure-functions-update `
  --models gpt-6-astra --models claude-opus-5 `
  --run-root C:\eval-clean --output C:\eval-results\update-review --trusted --dry-run
```

This command loads both plugins and validates all four cells without model calls.
It does not prove model access, host readiness, or a successful migration.
The judge stays fixed at GPT-6 Astra with high reasoning
effort in all four trials. To run the paid
ON/OFF comparison, first approve the target, budget, one run per arm, and cleanup policy,
then remove `--dry-run`. Use a new output path. Supply the runner token through
`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`, never in a file or command argument.
Use `--nuget-source` for an approved credential-free HTTPS feed if required.
Never run paid evaluation from PR-triggered CI.

For a direct Vally command outside the runner, first run `npm run compile` and pass
`--grader-plugin` with the absolute path to `lib\evaluation\code-only-grader.js`
and `--executor-plugin` with the absolute path to
`lib\evaluation\interactive-executor.js`. The policy path is relative to the
controller working directory, so use the repository root for a direct command.
Direct commands do not provide the local runner's isolation.
`npm run eval:lint` loads both plugins without model calls.

## Downloadable source

The stimulus uses native Vally `artifacts.include` and `artifacts.exclude` rules.
After a completed agent execution, Vally saves the final C# and project/build files,
`host.json`, `global.json`, and `.gitignore` in that trial's `artifacts` directory,
beside its session data. Local ON/OFF results separate these directories by model
and skill arm. Grading failure does not remove these files when agent execution
completed. An aborted execution can have no exported source; it must not be treated
as an empty successful migration.

The source export excludes local settings, `.env` files, logs, hidden working
directories, and generated output. It is separate from the code-only judge input.
The manual CI workflow uploads it as `migrated-app-source-<run ID>` in addition to
the existing private results. No CI run is started by this configuration change.

## Dependencies and limits

Shared directory-based dependency skills can be declared as `sharedSkills` in the local
benchmark registry. They stay in both arms; only ON receives `azure-functions-update`.
This model-only case needs no external upgrade agent. `DI-POST-01..03` are N/A because
no language stage was requested.

The official `dotnet-version-upgrade` scenario belongs to the Upgrade agent/MCP. It is
not an ordinary standalone skill directory. A future language-stage case must fix its
plugin version, availability, permission UI, and approved inputs in both arms before
running. If the client cannot provide the handoff, record blocked; do not claim that
preanswered values guarantee unattended operation.

This case does not prove Azure authentication, production storage behavior, Durable
history compatibility, performance, or migration effectiveness on large applications.
No paid migration trial is part of the fixture's repository checks.
