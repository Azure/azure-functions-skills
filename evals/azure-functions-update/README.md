# azure-functions-update evaluation

This optional Vally suite checks the behaviors that matter most for a skill that
changes customer code. It is manual. CI does not run it.

| Stimulus | What it checks |
| --- | --- |
| Selection — question | A question about migration does not start the skill or change the project. |
| Selection — generic request | An update request without the skill name does not start the skill. |
| Selection — named skill | The named skill starts, saves a plan, and keeps `net8.0`. |
| Resume | The skill continues from the saved plan in `fixtures/azure-functions-update-plan.md`. |
| Stages | .NET 10 and hosting plan requests stay separate stages. The project keeps `net8.0`. |
| Migration | The model-only migration builds at `net8.0`, states `FUNCTIONS_WORKER_RUNTIME=dotnet-isolated`, and reports a status for each definition-of-done ID. |

`fixtures/app` is a small C# in-process app with HTTP, queue, and blob functions and
`FunctionsStartup` DI. `fixtures/AGENTS.md` sets the workspace limits for the agent.

## Run

Prerequisites: `gh auth login`, and for the Migration stimulus, the .NET 8 SDK and a
reachable NuGet feed. The suite does not use Azure, Azurite, or Docker.

```powershell
npx @microsoft/vally-cli@0.16.0 lint --eval-spec evals/azure-functions-update/eval.yaml
npx @microsoft/vally-cli@0.16.0 eval --eval-spec evals/azure-functions-update/eval.yaml
```

`lint` is free. `eval` calls a model and has a cost. Get approval for the model,
the budget, and the number of runs before you run `eval`.
