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

`--run-root` must be an existing, clean directory. Do not put it below your user profile, a Git repository, or a directory that has agent configuration. The tool deletes the staged cells when it completes. If the tool cannot delete them (for example, a Windows file lock), it keeps the results and shows a warning. See [Read the results](#read-the-results).

## How to run a benchmark

The examples use PowerShell and the `azure-functions-update` example. From the repository root, you can also use `npm --prefix tools/skill-bench <script>`.

### Prerequisites

- Node.js 22.18 or later. Node.js must run `.ts` files directly (type stripping), because Vally loads the plugin files with `import()`.
- The tools that the scenario needs. The `azure-functions-update` example needs the .NET SDK, Azure Functions Core Tools (`func`), PowerShell 7 (`pwsh`), and Azurite.
- For a paid run only: a GitHub account that has access to GitHub Copilot, and the GitHub CLI (`gh`).

### Install

1. `cd tools/skill-bench`
2. `npm ci --ignore-scripts`

The `.npmrc` file in this directory sets the public npm registry (`https://registry.npmjs.org/`) for the install. If your network cannot get to it, see [Microsoft internal networks](#microsoft-internal-networks).

### Free check (no model call)

1. `npm test && npm run typecheck`
2. Show the cells: `node bin/skill-bench.js plan --config examples/azure-functions-update/skill-bench.config.json --skill azure-functions-update --model gpt-6-sol`
3. Make an empty run root outside your user profile and outside a repository, for example `New-Item -ItemType Directory Q:\sb-run`.
4. Stage and validate the cells: `node bin/skill-bench.js dry-run --config examples/azure-functions-update/skill-bench.config.json --all --trusted --run-root Q:\sb-run`

### Paid run

Before a paid run, get approval for the models, the number of cells, the budget, and the cleanup of the resources that the run makes. Each cell is one paid trial.

1. Set the token. Do not show it on the screen:

   ```powershell
   $env:COPILOT_GITHUB_TOKEN = gh auth token --hostname github.com
   if (-not $env:COPILOT_GITHUB_TOKEN) { throw 'No token. Run gh auth login --hostname github.com.' }
   ```

2. Run the cells. `--output` and `--site` must be new directories:

   ```powershell
   node bin/skill-bench.js run --config examples/azure-functions-update/skill-bench.config.json `
     --skill azure-functions-update --model gpt-6-sol --trusted `
     --run-root Q:\sb-run --output Q:\sb-out\run1 --site Q:\sb-out\site1
   ```

3. Remove the token when you complete the run: `Remove-Item Env:COPILOT_GITHUB_TOKEN`

### Read the results

- The CLI prints a summary after the run. It shows the cells that did not pass and the reason.
- `<output>/matrix-manifest.json` lists each cell, its exit code, and the path of its `results.jsonl` and workspace snapshot.
- Open `<site>/index.html` to see the dashboard. The **Why it failed** panel of each comparison shows the failed checks and hints. See [Failure diagnostics](#failure-diagnostics).
- To make the dashboard again from an existing run output: `node bin/skill-bench.js report --input Q:\sb-out\run1 --output <new or empty dir>`
- On Windows, a process that a trial started can keep a file open for some seconds. The tool tries to delete the staged cells again, with a longer wait each time. If the delete still fails, the tool keeps the results, writes the `--site` dashboard, and shows a warning with the directory path. The exit code comes from the trials only. The manifest gets a `cleanup` record. Delete the directory manually when the processes stop, for example `Remove-Item -Recurse -Force Q:\sb-run\skill-bench-*`.

### Microsoft internal networks

On some Microsoft devices and networks, you cannot get to the public npm registry or to nuget.org directly. In that case, use an internal mirror that your team approved (for example, an Azure Artifacts feed with upstream sources). Get the URL from the internal documentation of your team. Do not write internal feed URLs in this repository.

- Install the tool: `npm ci --ignore-scripts --registry <approved-npm-feed-url>`
- npm in the cells: use `--registry <approved-npm-feed-url>` or set `$env:SKILL_BENCH_NPM_REGISTRY = '<approved-npm-feed-url>'`.
- NuGet in the cells (`azure-functions-update` example): set `$env:SKILL_BENCH_NUGET_SOURCE = '<approved-nuget-feed-url>'`. It must be a NuGet v3 service index URL.
- Set these values in environment variables only. Do not commit them to a file.

Limits. Know these before you select a feed:

- The tool accepts only an HTTPS URL without a user name, password, query, or fragment.
- Each cell gets its own HOME and app data directories, and an npm user configuration path in that HOME with no credentials. The NuGet preflight plugin of the `azure-functions-update` example writes a `NuGet.Config` for each cell with one feed and no credentials. The tool does not copy your `~/.npmrc`, your NuGet configuration, or credential provider plugins into a cell. The config `env` refuses names that look like secrets or that start with `NPM_CONFIG_`.
- Thus a feed that needs authentication (for example, a private Azure Artifacts feed) does not work in the cells. Use a mirror that permits anonymous read access, or run on a network that can get to the public registries.
- The cells do not get proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`). If your network needs an explicit proxy, the cells cannot use it. Issue #278 tracks generic feed and proxy options.

Other problems:

- If `npm ci` fails with `E401`, your user `~/.npmrc` can have an expired Azure Artifacts token. Use an empty user configuration (`npm ci --ignore-scripts --userconfig <empty file>`), or get a new token.
- If you have a GitHub EMU account and a public GitHub account, use the token of the account that has access to Copilot: `gh auth token --hostname github.com --user <account>`. To see your accounts, use `gh auth status`.
- Run only trusted, reviewed code. Do not run skill-bench in CI that a pull request starts. See [Security](#security).
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
| `skills.<name>.evals` | Yes | The Vally `eval.yaml` files. |
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
  run?(context: PreflightRunContext): void | Promise<void>; // run only, one time for each skill
  teardownCell?(context: PreflightTeardownContext): void | Promise<void>; // run only, after each cell and after run
}
```

Use `teardownCell` to stop processes that a trial started, for example build servers. The context has the cell root, the workspace (`null` after `run`), and the cell environment. An error in `teardownCell` gives a warning. It does not stop the run.

Scenario plugins go in the example directory, not in `src/`.

## Failure diagnostics

After `run` and `report`, the CLI prints a short list of the cells that did not pass. The dashboard shows the same data in the **Why it failed** panel of each comparison. A card row shows a warning when a trial needs attention.

Each trial gets a `diagnosis` in `benchmark.json`:

| Stage | Meaning |
| --- | --- |
| `execution` | The trial did not complete. For example, the model is not available, the token is not valid, or a timeout occurred. The message includes a hint. |
| `grading` | The trial completed, but one or more graders failed. The message names the failed graders and their failed sub-checks. |
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
- The tool redacts saved workspace snapshots.
- One trial, one worker, no retry for each cell.


## Examples

- `examples/azure-functions-update/`: the .NET in-process to isolated worker migration. It has a NuGet preflight plugin and a code review grader plugin. The preflight plugin also stops the .NET build servers after each cell (`dotnet build-server shutdown`), and the config sets `MSBuildNodeReuse=false`, `DOTNET_CLI_USE_MSBUILD_SERVER=0`, and `UseSharedCompilation=false`. The paid run needs .NET, Azure Functions Core Tools, and Azurite.
- `examples/azure-functions-create/`: the TypeScript HTTP function. It uses the root `evals/` directory.

The examples point at skills in the root `templates/skills/` directory. If you move this tool to its own repository, change the `skillDir` and `evals` paths.
