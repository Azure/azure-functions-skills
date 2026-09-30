# TypeScript HTTP creation evaluation

This case asks the agent to create a TypeScript Azure Functions v4 HTTP app in an
empty workspace. The agent must build the app, start the local Functions host, call
`/api/hello` with and without `name`, and stop the processes that it started.

The eval is local only. It does not use Azure, Azurite, or deployment.

## Files in this folder

| Path | Who sees it | Purpose |
| --- | --- | --- |
| `eval.yaml` | Vally | The prompt, the constraints, and the graders. |

skill-bench adds the skills for each arm. Do not put a `skills:` key in `eval.yaml`.

## Requirements

- Node.js and Azure Functions Core Tools v4 (`func`).
- A network that can get to the npm registry. For an approved mirror, set
  `SKILL_BENCH_NPM_REGISTRY`.

## Run

Run these commands in `tools/skill-bench`. `dry-run` does not call a model.

```powershell
node bin/skill-bench.js dry-run --config examples/azure-functions-create/skill-bench.config.json `
  --all --trusted --run-root Q:\sb-run
```

For a paid run, use `run` and add `--output <new directory>`. See the tool README.
