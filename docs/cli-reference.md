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

```bash
echo '<event-json>' | npx @azure/functions-skills telemetry
```

The plugin telemetry hooks call this command. It reads one sanitized event from stdin and sends it to Application Insights. You do not usually run it yourself.

## Contributor build

```bash
npm run build
npm run build:plugin-payload
```

`npm run build` writes the agent-specific layouts (`ghcp`, `claude`, `codex`) and the plugin payload to `dist/`. `npm run build:plugin-payload` regenerates the committed plugin payload and marketplace manifests. The plugin payload always contains skills, MCP configuration, and telemetry hooks.