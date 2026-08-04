# CLI Reference

`@azure/functions-skills` keeps a deliberately small CLI surface. Coding-agent plugin installation and updates belong to each host's plugin manager.

## Local skills

Use `--local` when a workspace needs package-bundled skills, MCP configuration, and telemetry hooks, including VS Code integrations that call the library API.

```bash
npx @azure/functions-skills install --local --agent ghcp --dir ./my-app
npx @azure/functions-skills update --local --agent ghcp --dir ./my-app
```

| Flag | Description |
| --- | --- |
| `--local` | Required. Use package-bundled workspace assets instead of a host plugin. |
| `--agent <name>` | Repeatable: `ghcp`, `claude`, or `codex`. Auto-detected when omitted. |
| `--all` | Apply all three target layouts. |
| `--dir <path>` | Target directory; defaults to the current directory. |
| `--dry-run` | List generated files without writing them. |

Updates remove existing `azure-functions-*` skill directories and owned telemetry-hook files before copying the current package assets. No `.azure-functions-skills` state directory is created.

### Library API

```ts
import { installLocalSkills } from '@azure/functions-skills/setup';

const result = await installLocalSkills({
  targetDir: workspaceFolder.uri.fsPath,
  agents: ['ghcp'],
});
```

The result contains `agents`, `filesWritten`, `plannedFiles`, `dryRun`, and npm `packageUpdate` guidance.

## Doctor

```bash
npx @azure/functions-skills doctor --dir ./my-app
npx @azure/functions-skills doctor --dir ./my-app --deep --accept-deep-risk --agent github-copilot
```

`doctor` writes to `.azure-functions-doctor/doctor-report.json` by default. Deep analysis installs workspace-local skill assets only when the selected agent cannot already see `azure-functions-doctor`.

## Templates

```bash
npx @azure/functions-skills template list --language python --resource http
npx @azure/functions-skills template apply --dir ./app --template <template-id>
```

Use `template list --json` for structured discovery. `template apply` supports `--language`, `--runtime-version`, `--mode auto|new|add`, `--dry-run`, `--force`, `--json`, and `--manifest-url`.

## Contributor build

```bash
npm run build
npm run build:plugin-payload
```

The plugin payload always contains skills, MCP configuration, and telemetry hooks. There are no payload profiles.
