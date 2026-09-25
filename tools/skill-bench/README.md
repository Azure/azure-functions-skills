# skill-bench

skill-bench measures the effect of one agent skill. It runs each eval with the skill OFF and with the skill ON, for each model that you select. It uses [Vally](https://www.npmjs.com/package/@microsoft/vally) 0.16.0 as the engine. It writes a `benchmark.json` file and a static dashboard.

This tool is independent of the root CLI. It does not import root `src/` and it does not read the root `package.json`. You can move this directory to its own repository.

## Install

Use Node.js 22.18 or later. Node.js must run `.ts` files directly (type stripping), because Vally loads the plugin files with `import()`.

```bash
cd tools/skill-bench
npm ci --ignore-scripts
```

From the repository root, you can use `npm --prefix tools/skill-bench <script>`.

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

`--run-root` must be an existing, clean directory. Do not put it below your user profile, a Git repository, or a directory that has agent configuration. The tool deletes the staged cells when it completes.

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
| `env` | No | Extra environment variables for each cell. Do not put secrets here. |
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
}
```

Scenario plugins go in the example directory, not in `src/`.

## Security

- `dry-run` and `run` need `--trusted` (or `SKILL_BENCH_TRUSTED=1`). Use it only for reviewed eval and plugin code. Eval content can contain prompt injection, and the agent can write files and run commands.
- The tool refuses a paid run for `pull_request` events. In CI, start the workflow only with `workflow_dispatch`, and use a GitHub Environment with a required reviewer.
- Each cell gets an isolated workspace, HOME, and agent configuration. The OFF arm gets no measured skill. The ON arm gets only the target skill. Both arms get the shared skills. The tool verifies this before it runs a cell.
- Each cell gets a minimal environment allowlist. Only a paid run gets the model token (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`). The tool does not copy normal credential stores.
- The tool refuses symbolic links and applies size limits when it copies files.
- The tool redacts saved workspace snapshots.
- One trial, one worker, no retry for each cell.

## Free check

```bash
cd tools/skill-bench
npm ci --ignore-scripts
npm test && npm run typecheck
node bin/skill-bench.js dry-run --config examples/azure-functions-update/skill-bench.config.json --all --trusted --run-root <clean dir>
```

## Examples

- `examples/azure-functions-update/`: the .NET in-process to isolated worker migration. It has a NuGet preflight plugin and a code review grader plugin. The paid run needs .NET, Azure Functions Core Tools, and Azurite.
- `examples/azure-functions-create/`: the TypeScript HTTP function. It uses the root `evals/` directory.

The examples point at skills in the root `templates/skills/` directory. If you move this tool to its own repository, change the `skillDir` and `evals` paths.
