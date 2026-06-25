# Doctor CI Usage

The recommended CI mode is built-in checks plus deep analysis.

## Deep mode

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: '22'
- run: az version
# Install/authenticate the selected agent CLI before this step.
- run: npx @azure/functions-skills doctor --deep --agent github-copilot --format json --output doctor-report.json --severity high
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: doctor-report
    path: doctor-report.json
```

## Lightweight mode

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: '22'
- run: az version
- run: npx @azure/functions-skills doctor --no-deep --format json --output doctor-report.json --severity high
```

## Tool requirements

| Tool | Required for |
|------|--------------|
| Node.js | Running `@azure/functions-skills` |
| Azure CLI | Runtime metadata via ARM functionAppStacks |
| `copilot`, `claude`, or `codex` CLI | `--deep --agent <name>` |
| Azure login / federated credentials | Azure resource tier checks |

`az functionapp list-runtimes` / ARM stack metadata does not normally require reading subscription resources, but Azure CLI must be installed. Azure resource checks require login.

For deterministic offline tests or intentionally network-free runs, set `AZURE_FUNCTIONS_DOCTOR_STACKS_OFFLINE=1` to skip live stack metadata resolution and use cache/fallback data.

## Exit codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | No `fail` / `warn` results at or above threshold |
| 1 | At least one `fail` / `warn` result at or above threshold |
| 2 | Doctor command execution error |
