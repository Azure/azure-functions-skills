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
function registration and Information logs. It records `grading-evidence/checklist.json`
and command logs, stops its host, and removes only the emulator resources it created.
It never calls Azure or starts an emulator. A failed cleanup fails the result.

The LLM judge reviews source, diff, and execution evidence for the remaining semantic
checks, including DI, signatures, logging, and binding contracts. Keyword matches alone
do not prove completion. The judge cannot turn a deterministic fail, blocked check, or
missing evidence into success. Optional improvements do not change required acceptance.

## Preanswered run

The prompt supplies the app, target, preserved behavior, permissions, environment,
retention, and dependency availability. It tells the agent not to ask those questions
again. A new material decision remains blocked; unattended execution adds no permission.
Both arms receive the same acceptance checklist in `.migration/definition-of-done.json`.
OFF can work directly without the skill and does not have to guess unpublished IDs.

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

After code review, choose one model and existing clean external parent directories:

```powershell
npm run eval:run -- --skill azure-functions-update --models gpt-6-astra `
  --run-root C:\eval-clean --output C:\eval-results\update-review --trusted --dry-run
```

This command prepares and validates the experiment without model calls. To run the paid
ON/OFF comparison, first approve the target, budget, one run per arm, and cleanup policy,
then remove `--dry-run`. Use a new output path. Supply the runner token through
`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`, never in a file or command argument.
Use `--nuget-source` for an approved credential-free HTTPS feed if required.
Never run paid evaluation from PR-triggered CI.

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
