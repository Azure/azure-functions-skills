# Telemetry and internal release pipeline

This repository keeps the telemetry destination out of source control. The
committed package contains only `__APPLICATIONINSIGHTS_CONNECTION_STRING__` in
`src/telemetry/config.ts`; the internal 1ES mirror pipeline replaces the
compiled placeholder immediately before `npm pack`.

## Release flow

1. The internal AzDO mirror builds from the mirrored repository with the 1ES
   template in `azure-pipelines/templates/build.yml`.
2. The build copies the npm package inputs to `dropInput`.
3. If the secret variable `ApplicationInsightsConnectionString` is present,
   the build injects it into `dropInput/lib/telemetry/config.js`. Hook and plugin
   files never contain the destination.
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
`functions-skills.official` build's `drop` artifact through the shared
engineering `release-npm-package.yml` template and uploads the `.tgz` to the
same versioned virtual directory. Azure Blob Storage does not require a separate
directory creation call; the `/` segments in the blob name create the portal
folder view automatically.

Required AzDO variable group: `azure-functions-skills-release`.

| Variable | Purpose |
| --- | --- |
| `ApplicationInsightsConnectionString` | Secret injected into the npm package telemetry runtime. |
| `PartnerBlobAzureServiceConnection` | Azure service connection used by the helper upload pipeline. |
| `PartnerBlobStorageAccount` | Partner storage account name, expected to be `azuresdkpartnerdrops`. |
| `PartnerBlobContainer` | Partner blob container name, expected to be `drops`. |

## Runtime telemetry hook

The npm package ships Copilot, Claude, and Codex telemetry-hook manifests plus
PowerShell and Bash scripts in two places:

- `templates/hooks/`, used by the build system;
- `dist/plugin/azure-functions-skills/hooks/`, used in the built plugin payload.

Workspace-local installs copy the corresponding telemetry assets into each
selected host's native hook directory.

The scripts filter and normalize hook input, then send one sanitized JSON object
over stdin to the package's hidden telemetry command:

```text
npx -y @azure/functions-skills@latest telemetry
```

The hidden command calls the exported `@azure/functions-skills/telemetry`
library API. That API creates an isolated Application Insights client, sends
only the custom event, flushes it, and stops waiting after five seconds. It
does not enable automatic request, dependency, exception, performance, or
console collection.

The connection string exists only inside the CI-built npm package. It is not
set in the coding agent's environment or persisted by a hook. If the compatible
package is not yet published, cannot be downloaded, lacks the hidden command,
or fails to send, the hook ignores that telemetry-only failure. This supports
releasing the plugin before the package without affecting agent tool use.

Users can opt out by setting either
`AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY=false` or
`AZURE_MCP_COLLECT_TELEMETRY=false`. Workspace-local installs also honor
`telemetry.config.json` with `"enabled": false`.

## Events and expected dimensions

| Event type | Trigger | Dimensions |
| --- | --- | --- |
| `skill_invocation` | `skill`/`Skill` invokes a bundled Azure Functions skill, or its `SKILL.md` is read from a recognized plugin path. | `timestamp`, `client-name`, `session-id`, `skill-name` |
| `tool_invocation` | Azure Functions MCP tool names such as `functions_template_get`, `functions_project_get`, or host-prefixed equivalents are called. | `timestamp`, `client-name`, `session-id`, `tool-name` |
| `reference_file_read` | A non-`SKILL.md` file is read under a bundled Azure Functions skill directory. | `timestamp`, `client-name`, `session-id`, `file-reference` |

These dimensions should support analysis such as:

- skill adoption by client (`skill-name` by `client-name`);
- active sessions using Azure Functions skills (`dcount(session-id)`);
- create/deploy/diagnostics funnel analysis by session;
- most-read references and scripts (`file-reference`);
- MCP template/scaffold usage (`tool-name` for `functions_*` tools);
- versioned package rollout correlation by comparing blob package version with
  release timing.
