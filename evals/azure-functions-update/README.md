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
| Migration | The model-only migration builds at `net8.0`, states `FUNCTIONS_WORKER_RUNTIME=dotnet-isolated`, and reports a status for each definition-of-done ID. One grader checks each ID from `DI-01` to `DI-16` and from `DI-POST-01` to `DI-POST-03`. |

`fixtures/app` is a small C# in-process app with HTTP, queue, and blob functions and
`FunctionsStartup` DI. `fixtures/AGENTS.md` sets the workspace limits for the agent.

The scoring threshold is `1.0`. A stimulus passes only when each of its graders passes.

## Run

Prerequisites: `gh auth login`, and for the Migration stimulus, the .NET 8 SDK and a
reachable NuGet feed. The suite does not use Azure, Azurite, or Docker.

Run the commands from the repository root. Put the output and the workspaces outside
the repository.

```powershell
npx @microsoft/vally-cli@0.16.0 lint --eval-spec evals/azure-functions-update/eval.yaml
npx @microsoft/vally-cli@0.16.0 eval --eval-spec evals/azure-functions-update/eval.yaml `
  --output-dir <out-dir> --workspace <workspace-dir>
```

`lint` is free. `eval` calls a model and has a cost. Get approval for the model,
the budget, and the number of runs before you run `eval`.

- `--output-dir` keeps the results. The default is `./vally-results` in the current folder.
- `--workspace` keeps the agent workspace of each stimulus, so that you can examine the changed files.
- To run only some stimuli, add `--tag area=<area>`. The areas are `routing`, `resume`,
  `scope` (Stages), and `migration`.

### Grade the saved results again

After you change a grader, you can grade the saved results again. This step does not
call a model and is free.

```powershell
$run = '<out-dir>\<run-timestamp>'
Get-Content "$run\results.jsonl" | Where-Object { $_ -match '"type":"trial-result"' } |
  npx @microsoft/vally-cli@0.16.0 grade --eval-spec evals/azure-functions-update/eval.yaml --run-dir $run
```

To grade one stimulus, select its line with the `stimulus` field, for example
`Where-Object { ($_ | ConvertFrom-Json).stimulus -like 'Stages*' }`.
