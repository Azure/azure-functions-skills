# skill-bench

skill-bench measures the effect of one agent skill. It runs each eval with the skill OFF and with the skill ON, for each model that you select. It uses [Vally](https://www.npmjs.com/package/@microsoft/vally) 0.16.0 as the engine. It writes a `benchmark.json` file and a static dashboard.

This tool is independent of the root CLI. It does not import root `src/` and it does not read the root `package.json`. You can move this directory to its own repository.


## Commands

```text
skill-bench plan    --config <file> (--all | --skill <name>...) [--tier <name> | --model <id>...] [--json]
skill-bench dry-run --config <file> ... --trusted --run-root <dir>
skill-bench run     --config <file> ... --trusted --run-root <dir> --output <new dir> [--site <new dir>] [--registry <https url>]
skill-bench report  --input <run output> --output <new or empty dir>
```

- `plan` shows the cells. A cell is one model, one skill, one eval, and one arm (`off` or `on`). It does not run code.
- `dry-run` stages all cells, verifies the isolation, loads the plugins, and validates the eval specs. It does not call a model. It does not need a token.
- `run` does the paid run. It runs one Vally trial for each cell, with 1 worker, the configured timeout, and no retry. A missing result gives exit code 2.
- `report` reads a run output and writes `benchmark.json` and `index.html`. A missing result stays missing. The report does not make up values.

`--run-root` must be an existing, clean directory. Do not put it below your user profile, a Git repository, or a directory that has agent configuration. The tool deletes the staged cells when it completes. If the tool cannot delete them (for example, a Windows file lock), it keeps the results and shows a warning. See [How to run a benchmark](#how-to-run-a-benchmark).

## How to run a benchmark

You need Node.js 22.18 or later and the tools that the scenario uses. The `azure-functions-update` example uses the .NET SDK, Azure Functions Core Tools (`func`), PowerShell 7 (`pwsh`), and Azurite. For a paid run, you also need the GitHub CLI (`gh`) and a GitHub account that can use Copilot.

1. Install and do a free check. This does not call a model:

   ```powershell
   cd tools/skill-bench
   npm ci --ignore-scripts
   New-Item -ItemType Directory -Force Q:\sb-run   # outside your user profile and outside a repository
   node bin/skill-bench.js dry-run --config examples/azure-functions-update/skill-bench.config.json `
     --skill azure-functions-update --model gpt-6-sol --trusted --run-root Q:\sb-run
   ```

2. Get approval for the paid run: the models, the number of cells, and the budget. Each cell is one paid trial (2 cells for each model: skill OFF and skill ON).

3. Do the paid run. `--output` and `--site` must be new directories:

   ```powershell
   $env:COPILOT_GITHUB_TOKEN = gh auth token --hostname github.com
   if (-not $env:COPILOT_GITHUB_TOKEN) { throw 'No token' }

   node bin/skill-bench.js run --config examples/azure-functions-update/skill-bench.config.json `
     --skill azure-functions-update --model gpt-6-sol --trusted `
     --run-root Q:\sb-run --output Q:\sb-out\run1 --site Q:\sb-out\site1

   start Q:\sb-out\site1\index.html
   Remove-Item Env:COPILOT_GITHUB_TOKEN
   ```

4. Read the results. The CLI prints the cells that did not pass and the reason. In the dashboard, the **Why it failed** panel shows the failed checks and hints. To make the dashboard again, use `node bin/skill-bench.js report --input Q:\sb-out\run1 --output <new dir>`.

Tips:

- A model ID must be in `models` in the config, and your account must be able to use it. Else the cell fails with "Model ... is not available".
- The update example stops before the first model call if your `dotnet` or `func` version differs from the pin, or if Azurite is not running. Install the pinned version. To continue with a different version, set `$env:SKILL_BENCH_ALLOW_TOOL_DRIFT = '1'`; the run records the difference as a warning.
- If a Windows file lock stops the cleanup, the tool keeps the results and shows a warning. Delete the directory later: `Remove-Item -Recurse -Force Q:\sb-run\skill-bench-*`.
- If you have more than one GitHub account (for example, EMU and public), use the account that can use Copilot: `gh auth token --hostname github.com --user <account>`.

### Microsoft internal networks

If your network cannot get to the public npm registry or nuget.org, set these variables before step 1 and step 3. Get the URLs of the approved mirrors from your team. Do not commit them.

```powershell
$env:npm_config_registry      = '<approved-npm-feed-url>'    # npm ci for the tool
$env:SKILL_BENCH_NPM_REGISTRY = '<approved-npm-feed-url>'    # npm in the cells
$env:SKILL_BENCH_NUGET_SOURCE = '<approved-nuget-feed-url>'  # NuGet v3 index for the .NET example
```

- The feed must permit anonymous read access. The cells do not get credentials or proxy variables, so a feed that needs a sign-in or an explicit proxy does not work (see issue #278).
- If `npm ci` fails with `E401`, your `~/.npmrc` can have an expired token. Use `npm ci --ignore-scripts --userconfig <empty file>`.
## Configuration

`skill-bench.config.json` has these keys. All paths are relative to the config file.

| Key | Required | Description |
| --- | --- | --- |
| `title` | No | The dashboard title. |
| `models` | Yes | The model IDs. |
| `tiers` | No | Named groups of models, for `--tier`. |
| `timeout` | No | The timeout for one cell, for example `15m`. |
| `skills` | Yes | The measured skills. The key is the skill name. |
| `skills.<name>.skillDir` | Yes | The skill directory. It must contain `SKILL.md`. |
| `skills.<name>.files` | No | The files to copy from `skillDir`. If you do not set it, the tool copies all files. |
| `skills.<name>.evals` | Yes | The Vally `eval.yaml` files. An entry is a path, or `{ "path": "...", "copies": [...] }`. |
| `skills.<name>.evals[].copies` | No | Files to copy inside the staged eval: `{ "from": "fixtures/a.cs", "to": "grader-baseline/a.cs.txt" }`. Both paths are relative to the eval directory. The copy is only in the staged eval, not in your repository. Use it when a grader needs an unchanged copy of an input file. Vally refuses a grader file whose `src` is also an agent file. |
| `skills.<name>.plugins.graders` | No | Vally grader plugin modules. |
| `skills.<name>.plugins.executors` | No | Vally executor plugin modules. |
| `skills.<name>.plugins.preflight` | No | Preflight plugins: `{ "module": "...", "options": {...} }`. |
| `sharedSkills` | No | Skills that both arms get: `{ "<name>": { "skillDir": "...", "files": [...] } }`. |
| `disabledSkills` | No | Skill names that the agent must not load. |
| `env` | No | Extra environment variables for each cell, for example to stop build servers that stay after a trial. The tool refuses reserved names and names that look like secrets. Do not put secrets here. |
| `redaction.keepValues` | No | Values that the snapshot redaction keeps. |
| `display` | No | Labels for `models`, `skills`, and `scenarios` in the dashboard. |

Do not put a `skills:` key in `eval.yaml`. The tool stages the skills for each arm.

## Plugins

A plugin is an ESM module. The tool loads it by the module path in the config.

- A grader plugin exports `registerGraders(registry)`. Vally gets it with `--grader-plugin`.
- An executor plugin exports `registerExecutors(registry)`. Vally gets it with `--executor-plugin`.
- A preflight plugin exports `preflight` with this shape:

```ts
interface PreflightPlugin {
  name: string;
  validate?(options: unknown): void;                 // dry-run and run
  prepareCell?(context: PreflightCellContext): void; // dry-run and run, for each cell
  run?(context: PreflightRunContext): void | PreflightRunReport | Promise<void | PreflightRunReport>; // run only, one time for each skill
  teardownCell?(context: PreflightTeardownContext): void | Promise<void>; // run only, after each cell and after run
}

interface PreflightRunReport {
  tools?: Record<string, string>; // for example { "func": "4.15.1" }
  warnings?: string[];
}
```

Use `teardownCell` to stop processes that a trial started, for example build servers. The context has the cell root, the workspace (`null` after `run`), and the cell environment. An error in `teardownCell` gives a warning. It does not stop the run.

`run` can return the versions of the tools that the scenario uses. The tool records them, the Node.js version, and the platform in `environment` in `matrix-manifest.json`. The dashboard shows them in **Comparison conditions**. Use this to find a tool change between two runs. An unsafe name or version stops the run before the first model call.

Scenario plugins go in the example directory, not in `src/`.

## Failure diagnostics

After `run` and `report`, the CLI prints a short list of the cells that did not pass. It puts them in two groups:

- **Execution, infrastructure or grading problems**: the stages `execution`, `grader-error`, `ungraded` and `skipped`, and planned trials with no result. These are not evidence about the skill.
- **Skill results that did not pass**: the stage `grading`.

The dashboard shows the same data in the **Why it failed** panel of each comparison. A card row shows a warning when a trial needs attention.

The success rate is `passed / graded`. A graded trial completed and has a grader verdict. If an arm has a problem from the first group, the ON/OFF pair is **Not comparable**. The dashboard and the CLI then show the reason and no difference. `n` is the smallest number of graded trials in the two arms. When `n` is less than 5, the difference shows a direction only. It is not statistically significant.

Each trial gets a `diagnosis` in `benchmark.json`:

| Stage | Meaning |
| --- | --- |
| `execution` | The trial did not complete. For example, the model is not available, the token is not valid, or a timeout occurred. The message includes a hint. |
| `grading` | The trial completed, but one or more graders failed. The message names the failed graders and their failed sub-checks. |
| `grader-error` | The trial completed, but a grader did not complete (status `error`). This is not a verdict about the skill. |
| `ungraded` | The trial completed, but no grader verdict was recorded. |
| `skipped` | Vally skipped the trial. |
| `passed` | All graders passed. |

A grader plugin can give more detail in its result `metadata`:

- `summary`: one short sentence that tells why the grader failed.
- `checks`: a list of `{ "id", "status", "title"?, "reason"?, "hint"? }`. `status` is `pass`, `fail`, `blocked`, `not-applicable`, or `skipped`. `hint` tells the user what to change. If `checks` is absent, the report uses `requirements` with the same shape.

The report never copies grader `evidence`, transcripts, or logs. It removes control characters from the text fields, replaces absolute paths with `<path>` and token-like values with `<redacted>`, and limits the length. It rejects an unknown check status or an unsafe check ID. Do not put secrets or log output in these fields. Use `results.jsonl` for the full record.

## Security

- `dry-run` and `run` need `--trusted` (or `SKILL_BENCH_TRUSTED=1`). Use it only for reviewed eval and plugin code. Eval content can contain prompt injection, and the agent can write files and run commands.
- The tool refuses a paid run for `pull_request` events. In CI, start the workflow only with `workflow_dispatch`, and use a GitHub Environment with a required reviewer.
- Each cell gets an isolated workspace, HOME, and agent configuration. The OFF arm gets no measured skill. The ON arm gets only the target skill. Both arms get the shared skills. The tool verifies this before it runs a cell.
- Each cell gets a minimal environment allowlist. Only a paid run gets the model token (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`). The tool does not copy normal credential stores.
- The tool refuses symbolic links and applies size limits when it copies files.
- The tool redacts saved workspace snapshots. It does not save a file that contains the model token or a token-shaped value (`gh*_`, `github_pat_`, a JWT, or a private key).
- A paid run checks `--output` and `--site` before the first model call. Each must be a new or empty directory, and must not overlap the config, the skills, or the run root.
- The cell `configHash` uses the content of the staged skills, the eval, the plugin modules and `env`, not the temporary paths. Equal inputs give equal hashes in different runs.
- One trial, one worker, no retry for each cell.


## Examples

- `examples/azure-functions-update/`: the .NET in-process to isolated worker migration. It has three scenario plugins:
  - `host-preflight`: before the first model call, it checks that the installed `dotnet` and `func` versions are equal to the pins in the config, that each pinned .NET SDK (the `installed` option, from `dotnet --list-sdks`) is installed, and that Azurite accepts connections on ports 10000 and 10001 (60 s limit). It records the versions in the manifest.
  - `nuget-preflight`: it isolates the NuGet settings of each cell and checks the package restore. It also stops the .NET build servers after each cell (`dotnet build-server shutdown`). The config sets `MSBuildNodeReuse=false`, `DOTNET_CLI_USE_MSBUILD_SERVER=0`, and `UseSharedCompilation=false`.
  - `functions-code-review`: the code review grader.

  The paid run needs the .NET SDK, Azure Functions Core Tools, PowerShell 7, and Azurite. See the [scenario README](examples/azure-functions-update/evals/dotnet-isolated/README.md) for the pinned versions and the fixture files.
- `examples/azure-functions-create/`: the TypeScript HTTP function. It uses the root `evals/` directory.

The examples point at skills in the root `templates/skills/` directory. If you move this tool to its own repository, change the `skillDir` and `evals` paths.
