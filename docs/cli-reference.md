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

Automatic plugin telemetry is temporarily disabled. The hooks and deployment
skills do not call these commands. They remain available for explicit use.

```bash
echo '<event-json>' | npx @azure/functions-skills telemetry
```

This command reads one sanitized event from stdin and sends it to Application Insights.

```bash
echo '<observation-json>' | npx @azure/functions-skills telemetry deployment-observed --dir <workspace-root>
```

This command supports observations after a successful `azd up` or standalone `azd provision`. It is not a deployment command. It reads a bounded JSON object from stdin, uses your Azure CLI sign-in to make sure that the Azure Resource Manager deployment is successful, and sends the categorical `azure_deployment_observed` event. It prints one status word and always exits with `0`. Thus, it cannot change the result of a deployment.

`--dir` sets the workspace root. The default is the current directory. If a `telemetry.config.json` file from an earlier local install in that workspace has `"enabled": false`, the command sends nothing.

Both commands obey the opt-out environment variables in the [README](../README.md#telemetry). An explicit invocation is not blocked by the suspension of automatic telemetry. Use the opt-out settings to disable explicit collection.

## Contributor build

```bash
npm run build
npm run build:plugin-payload
```

`npm run build` writes the agent-specific layouts (`ghcp`, `claude`, `codex`) and the plugin payload to `dist/`. `npm run build:plugin-payload` regenerates the committed plugin payload and marketplace manifests. The plugin payload always contains skills, MCP configuration, and telemetry hooks.
