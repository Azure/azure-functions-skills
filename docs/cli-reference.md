# CLI Reference

`@azure/functions-skills` keeps a deliberately small CLI surface. Coding-agent plugin installation and updates belong to each host's plugin manager.

## Templates

```bash
npx @azure/functions-skills template list --language python --resource http
npx @azure/functions-skills template apply --dir ./app --template <template-id>
```

Use `template list --json` for structured discovery. `template apply` supports `--language`, `--runtime-version`, `--mode auto|new|add`, `--dry-run`, `--force`, `--json`, and `--manifest-url`.

### Library API

```ts
import { listFunctionTemplates, applyFunctionTemplate } from '@azure/functions-skills/templates';
```

## Telemetry

Automatic hooks and deployment skills use the installed
`hooks/runtime/telemetry.mjs` payload with Node.js 18 or later. The payload
includes the Application Insights SDK and its required dependencies. It does not
run npm or npx, read project modules, or download a missing payload.
The commands below remain available for explicit CLI use.

```bash
echo '<event-json>' | npx @azure/functions-skills telemetry
```

This command reads one sanitized event from stdin and sends it to Application Insights.

```bash
echo '<observation-json>' | npx @azure/functions-skills telemetry deployment-observed --dir <workspace-root>
```

This command supports observations after a successful `azd up` or standalone `azd provision`. It is not a deployment command. It reads a bounded JSON object from stdin, uses your Azure CLI sign-in to make sure that the Azure Resource Manager deployment is successful, and sends the categorical `azure_deployment_observed` event. It prints one status word and always exits with `0`. Thus, it cannot change the result of a deployment.

`--dir` sets the workspace root. The default is the current directory. If a `telemetry.config.json` file from an earlier local install in that workspace has `"enabled": false`, the command sends nothing.

Both commands obey the opt-out environment variables in the [README](../README.md#telemetry).

### Local automatic runtime

The plugin uses `hooks/runtime/telemetry.mjs`. Built workspace assets use
`.github/hooks/runtime/telemetry.mjs`, `.claude/hooks/runtime/telemetry.mjs`, or
`.codex/hooks/runtime/telemetry.mjs`. Hooks call `node "<runtime>" hook`.
The two deployment skills call
`node "<runtime>" deployment-observed --dir "<workspace-root>"` once after a
supported successful command. Both modes read at most 16 KiB from stdin.

The local runtime checks its installed hook configuration and all three workspace
hook configuration paths. A false or unreadable setting stops collection.
Environment opt-out also stops collection before ARM queries or sending.
Usage sends wait at most five seconds; a process deadline of 5.5 seconds also
bounds input reads. Deployment observations have a 26-second process deadline,
which includes the existing 20-second ARM and five-second send budgets.
Hooks always return `{"continue":true}` and exit with `0`. The observation mode
prints one status word and exits with `0`. Missing Node or payload files do not
trigger an install or download. Normal deployment and deployed-app monitoring
are unchanged.

## Contributor build

```bash
npm run build
npm run build:plugin-payload
```

`npm run build` writes the agent-specific layouts (`ghcp`, `claude`, `codex`) and the plugin payload to `dist/`. `npm run build:plugin-payload` regenerates the committed plugin payload and marketplace manifests. The plugin payload always contains skills, MCP configuration, and telemetry hooks.
