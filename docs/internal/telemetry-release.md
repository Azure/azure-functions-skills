# Telemetry and internal release pipeline

This repository keeps telemetry secrets out of source control. The committed
package contains only `__APPLICATIONINSIGHTS_INSTRUMENTATION_KEY__` in
`templates/hooks/telemetry.config.json`; the internal 1ES mirror pipeline
replaces that placeholder immediately before `npm pack`.

## Release flow

1. The internal AzDO mirror builds from the mirrored repository with the 1ES
   template in `azure-pipelines/templates/build.yml`.
2. The build copies the npm package inputs to `dropInput`.
3. If the secret variable `ApplicationInsightsInstrumentationKey` is present,
   the build injects it into both `dropInput/templates/hooks/telemetry.config.json`
   and `dropInput/dist/plugin/azure-functions-skills/hooks/telemetry.config.json`.
4. The build runs `npm pack --ignore-scripts` and publishes the `.tgz` as the
   official `drop` pipeline artifact through the 1ES template.
5. The official drop is mirrored to the Azure SDK partner drops storage account
   by the official build infrastructure. Existing drops use this path shape:

   ```text
   drops/azure-functions/azure-functions-skills/<version>/azure-functions-skills-<version>.tgz
   ```

6. `azure-pipelines/release.yml` consumes the official build's `drop` artifact
   for npm publishing. It does not manually upload to partner blob storage.

If the official build mirroring is delayed or a controlled re-upload is needed,
run `azure-pipelines/partner-drop-upload.yml`. It consumes the selected
`functions-skills.official` build's `drop` artifact and uploads the `.tgz` to
the same versioned virtual directory. Azure Blob Storage does not require a
separate directory creation call; the `/` segments in the blob name create the
portal folder view automatically.

Required AzDO variable group: `azure-functions-skills-release`.

| Variable | Purpose |
| --- | --- |
| `ApplicationInsightsInstrumentationKey` | Secret injected into the npm package telemetry config. |
| `PartnerBlobAzureServiceConnection` | Azure service connection used by the helper upload pipeline. |
| `PartnerBlobStorageAccount` | Partner storage account name, expected to be `azuresdkpartnerdrops`. |
| `PartnerBlobContainer` | Partner blob container name, expected to be `drops`. |

## Runtime telemetry hook

The npm package ships Copilot, Claude, and Cursor hook manifests plus PowerShell
and Bash scripts in two places:

- `templates/hooks/`, used by the build system;
- `dist/plugin/azure-functions-skills/hooks/`, used by local plugin installs
  from the packaged CLI.

Repository marketplace payloads intentionally keep the placeholder because the
public source tree cannot contain the instrumentation key.

The scripts follow the Azure Skills telemetry pattern and invoke:

```text
npx -y @azure/mcp@latest server plugin-telemetry
```

The scripts set `APPLICATIONINSIGHTS_INSTRUMENTATION_KEY` and
`APPINSIGHTS_INSTRUMENTATIONKEY` from `telemetry.config.json` only when the
pipeline has replaced the placeholder. Users can opt out by setting either
`AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY=false` or
`AZURE_MCP_COLLECT_TELEMETRY=false`.

## Events and expected dimensions

| Event type | Trigger | Dimensions |
| --- | --- | --- |
| `skill_invocation` | `skill`/`Skill` tool invokes an `azure-functions-*` skill, or a Functions `SKILL.md` file is read from a recognized plugin path. | `timestamp`, `client-name`, `session-id`, `skill-name` |
| `tool_invocation` | Azure Functions MCP tool names such as `functions_template_get`, `functions_project_get`, or host-prefixed equivalents are called. | `timestamp`, `client-name`, `session-id`, `tool-name` |
| `reference_file_read` | A non-`SKILL.md` file is read under an `azure-functions-*` skill directory. | `timestamp`, `client-name`, `session-id`, `file-reference` |

These dimensions should support analysis such as:

- skill adoption by client (`skill-name` by `client-name`);
- active sessions using Azure Functions skills (`dcount(session-id)`);
- create/deploy/diagnostics funnel analysis by session;
- most-read references and scripts (`file-reference`);
- MCP template/scaffold usage (`tool-name` for `functions_*` tools);
- versioned package rollout correlation by comparing blob package version with
  release timing.
