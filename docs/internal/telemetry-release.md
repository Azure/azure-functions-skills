# Telemetry and internal release pipeline

The public plugin uses a non-secret instrumentation key and ingestion endpoint
from `src/telemetry/public-config.ts`. These are separate fields, not a stored
connection string. The SDK receives the key in its constructor and the ingestion
endpoint through `config.endpointUrl`. Only these two fields are public.
The source was the published `@azure/functions-skills@0.0.6-preview` artifact
from the existing public Azure Functions npm feed:

```text
https://pkgs.dev.azure.com/azfunc/public/_packaging/upstream-public/npm/registry/@azure/functions-skills/-/functions-skills-0.0.6-preview.tgz
SHA-1: cf755495ceaddf78921f192e319cb218ddc6945d
```

The artifact was read as data and checked against the exact version's registry
digest. Its code was not run. Do not copy other release connection-string fields,
credentials, or secrets into public configuration.

The library still contains `__APPLICATIONINSIGHTS_CONNECTION_STRING__` in
`src/telemetry/config.ts`. The internal 1ES pipeline replaces the compiled
placeholder before `npm pack`. The plugin bundle instead selects the public
configuration at build time, so GitHub plugin installation does not depend on
internal release injection.

This follows the public configuration pattern in
[`microsoft/vscode-azurefunctions`](https://github.com/microsoft/vscode-azurefunctions/blob/271b6d24fa4d003b2c10bfeb0250df82372641b6/package.json),
which stores its telemetry key in `aiKey`. This plugin keeps its existing
Application Insights SDK and explicit privacy controls. Separate fields do not
guarantee that a secret scanner will accept the configuration.

## Release flow

1. The internal AzDO official or prerelease pipeline builds from the mirrored
   repository with the 1ES template in `azure-pipelines/templates/build.yml`.
2. The build copies the npm package inputs to `dropInput`.
3. The official and prerelease pipelines require the secret variable
   `ApplicationInsightsConnectionString` and inject it into
   `dropInput/lib/telemetry/config.js`. Public PR/CI builds do not receive the
   secret and compile out the injection step. This step does not change the
   public plugin bundle. Its destination contains only the approved public fields.
4. The build runs `npm pack --ignore-scripts` and publishes the `.tgz` as the
   official `drop` pipeline artifact through the 1ES template.
5. The official drop is mirrored to the Azure SDK partner drops storage account
   by the official build infrastructure. Existing drops use this path shape:

   ```text
   drops/azure-functions/azure-functions-skills/<version>/azure-functions-skills-<version>.tgz
   ```

6. `azure-pipelines/release.yml` consumes the official build's `drop` artifact
   and delegates npm publishing to the internal engineering
   `release-npm-package.yml` template with its ESRP option enabled. It does not
   expose the fixed ESRP infrastructure configuration or use an npm token.
7. After npm publishing succeeds, a maintainer creates and pushes a signed
   `v<version>` tag to the public GitHub repository. The tag triggers
   `.github/workflows/draft-release.yml`, which creates the draft GitHub
   Release using `GITHUB_TOKEN`. The code-mirror pipeline also mirrors `v*`
   tags to the internal repository.

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
| `EsrpOwners` | Comma- or newline-separated individual Microsoft aliases that own the ESRP release. Distribution lists and security groups are not supported. |
| `EsrpApprovers` | Comma- or newline-separated individual Microsoft aliases that approve the ESRP release; these must differ from the owners. |
| `EsrpManualApprovers` | Azure DevOps users or groups allowed to approve the manual validation before ESRP publishing. |

Authorize the release pipelines to use the variable group, internal engineering
repository, ESRP service connection, and official-build pipeline resource. Add
`microsoft1es` plus `microsoft-oss-releases` as read/write collaborators for
the npm package.

Both release pipelines default to a local npm dry run. Queue with
`NpmPublishDryRun: false` only after checking the package version and tag.
Real publishing requires Azure DevOps manual validation before the engineering
template invokes ESRP Release. `NpmPublishTag` is passed to the engineering
template as `esrpNpmTag`.

Azure DevOps does not hold GitHub credentials or create GitHub tags/releases.
After a successful release, create the signed tag from the exact public commit
used for the release:

```text
git tag -s v<version> -m "v<version>"
git push origin v<version>
```

## Runtime telemetry hook

The Bash and PowerShell hooks call only the adjacent
`hooks/runtime/telemetry.mjs` payload through Node.js 18 or later.
They always return `{"continue":true}` and exit successfully.
Missing Node or payload files cause no collection. No package-manager, download,
or install fallback is permitted.

Canonical hook scripts and manifests are in `templates/hooks/`.
The build emits Copilot, Claude, Cursor, and Codex-compatible hook assets in:

- `.github/plugins/azure-functions-skills/hooks/`, for GitHub plugin installation;
- `dist/plugin/azure-functions-skills/hooks/`, for the built plugin payload.

`npm run build` also writes the telemetry assets into each host's native hook
directory in the agent-specific layouts under `dist/workspace/`.

`src/build/telemetry-runtime.ts` uses the pinned build-only esbuild dependency
to combine the ESM runtime, existing sender, Application Insights SDK 1.8.10,
and required production dependencies into one ESM file. Authored code remains
ESM and strict TypeScript. SDK CommonJS modules are compiled into the payload;
the compatibility loader accepts Node built-in modules only. It cannot resolve
a package from the workspace or `NODE_PATH`. The unused optional native-metrics
module is not shipped and cannot be loaded.

The bundle disables diagnostic-channel patching at build time. It never calls
SDK `setup` or `start`. The sender creates an isolated client, cancels the SDK's
automatic correlation-profile lookup, disables disk retries, allows only the
custom event fields, and removes all envelope tags except the SDK version.
There is no automatic request, dependency, exception, performance, or console
collection. SDK package metadata is shipped beside the bundle for its version
lookup. A bundle-local SDK directory also keeps its application-version lookup
inside the runtime payload, not the workspace. License notices are shipped in
`THIRD-PARTY-NOTICES.txt`.

The published CLI `build` command copies the runtime from its shipped
`dist/plugin/` payload. It does not need source files or development dependencies.
Repository builds instead generate that payload from source. A missing packaged
payload is a build error, not a reason to download code.

The build embeds the canonical relative skill-file allowlist. Reference events
therefore work in every layout, including Codex's separate `.agents/skills`
directory, without reading project files to validate a reference.
Usage sends retain the five-second timeout. The usage process deadline is
5.5 seconds, including stdin. Observation processes have a 26-second deadline
for bounded input, the 20-second ARM budget, and the five-second send.
Hook mode accepts at most 1 MiB of input, including tool responses. It uses only
allowed event metadata; it never sends tool output. Observation mode retains
its 16 KiB input limit. Copilot tool arguments can be objects or JSON strings.
Malformed serialized arguments do not produce an event.

Before reading input, the runtime checks the installed configuration and all
three host configurations in the selected directory and each ancestor up to the
filesystem root. A disabled or unreadable ancestor configuration stops collection
even if a child configuration is enabled. Git metadata is not required.

No runtime npm configuration is read. Earlier hooks ran a downloaded package
from the workspace, where registry overrides could change the package source.
Do not restore that path, even with a fixed version.

Release the updated plugin and workspace assets, and tell users to update their
installed copies. A source change does not stop hooks in existing installations.

Users can opt out by setting either
`AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY=false` or
`AZURE_MCP_COLLECT_TELEMETRY=false`. Both local modes also honor the installed
hook `telemetry.config.json` and workspace files under `.github/hooks/`,
`.claude/hooks/`, and `.codex/hooks/`. A false or unreadable setting stops
collection before queries or sends.

Runtime tests build the actual plugin and all workspace layouts in isolated paths
with spaces. A trusted test-only preload routes SDK requests to a local server.
It supplies ARM responses without running Azure CLI. Hostile workspace `.npmrc`,
project modules, SDK configuration, and package-manager stubs must never run.
Tests check both shells on Windows and Bash elsewhere; static checks cover both
scripts on all platforms. Tests do not send real telemetry.

## Deployment-observation collector

Each canonical deployment skill invokes its installed local collector once after
its own supported `azd up` or standalone `azd provision` succeeds. Do not collect
twice for a delegated deployment, after a failure, or after an unsupported command.
Do not retry a telemetry failure or change the deployment result.
Application Insights monitoring in deployed applications is unchanged.

The local `deployment-observed` mode and the retained
`telemetry deployment-observed` CLI subcommand share the following contract.

It reads one bounded JSON object on stdin (16 KiB max) with `skill`,
`operation`, `agent`, `environmentName`, optional `skillsVersion`, and optional
`startedAt`; unknown properties are rejected. `environmentName` is required for
a usable observation, but it is enforced at collection time, not at parse time:
input without it parses, and the collector then returns `skipped` before any
Azure query (see selection below). `startedAt` is an optional ISO-8601 UTC lower
bound on which deployment can be selected. It is used only locally: it is not
sent to Azure, not included in the telemetry event, and not printed. A malformed
value is ignored rather than failing. It prints exactly one categorical word
(`sent`, `disabled`, `not-configured`, `skipped`, or `failed`) and always exits
`0`, so a telemetry-only failure never affects the deployment. `sent` means that
the ingestion service confirmed it accepted the event; an empty or partial
ingestion response is `failed`. The original `telemetry` stdin contract is
unchanged.

The collector looks up the subscription-scope ARM deployment **by name**, using
`environmentName` as the deployment name (`az deployment sub show --name
<environmentName>`), then confirms success and derives the resource-type
breakdown from that single deployment. Lookup by name is one request and does
not degrade as deployment history grows; it replaced an earlier recency-scan
approach because ARM does not return deployments newest-first and `$top` is a
per-page hint rather than a global cap, so a full scan was both slow and
unreliable. If `environmentName` is absent or fails ARM deployment-name
validation, the collector returns `skipped` (reason `no-environment-name`)
before any Azure query, so nothing is recorded. Only an ARM `DeploymentNotFound`
or `ResourceNotFound` error means that the deployment does not exist. Any other
Azure CLI failure, and any malformed ARM response or operations page, returns
`skipped` with a query-failure reason and never a partial breakdown. The ARM
work is bounded to 20 s and 50 requests. It honors the same opt-out preferences
before any ARM query or send. The environment name, subscription, resource
group, and deployment IDs are sent to Azure Resource Manager only to perform
these queries. They are not included in the telemetry event and are not printed.

### Data governance

This event introduces **no new destination, credential, or service**. It is
written to the same Application Insights resource, through the same
approved public key and endpoint in the plugin (or the release-injected library
configuration), as the existing usage event, so its
governance is the governance already applying to that resource (FRD-0003 D-019).
Recording concrete owner, retention, access, and privacy-review values is a
sign-off gate (AC-012).

| Governance item | Phase 1 position |
| --- | --- |
| Data owner | The maintainer team that already owns the existing Application Insights usage-telemetry resource. No new owner is introduced. Record the team name and contact before sign-off. |
| Categories collected | Categorical strings only — the seven properties in the event contract above. No customer, subscription, resource, or user identity. |
| Retention | As already configured on the existing resource; this event does not request a different period. Record the period before sign-off. |
| Access control | The existing Azure RBAC on that resource; no new reader is added. Record the access model before sign-off. |
| Privacy/security review | Obtain a determination before sign-off on whether a categorical event with no new identifier class needs a delta review. |
| Regional and network metadata | Follows the existing resource. The client IP is visible to the ingestion service as a property of HTTPS and is never an application property. This is not anonymous transport. |
| User disablement | Either opt-out environment variable, or the installed workspace `telemetry.config.json`, disables the ARM queries and the send before either runs (AC-007). |
| Operator rollback | Remove the collection step from the two skills and ship a release. Reverting the implementation PRs removes the event entirely. |
| No remote kill switch | Deliberate. A switch would add a configuration service, a fetch path, and a failure mode to every collection, out of proportion to one categorical event; the worst case is bounded by release cadence. |

## Events and expected dimensions

| Event type | Trigger | Dimensions |
| --- | --- | --- |
| `skill_invocation` | `skill`/`Skill` invokes a bundled Azure Functions skill, or its `SKILL.md` is read from a recognized plugin path. | `timestamp`, `client-name`, `session-id`, `skill-name` |
| `tool_invocation` | Azure Functions MCP tool names such as `functions_template_get`, `functions_project_get`, or host-prefixed equivalents are called. | `timestamp`, `client-name`, `session-id`, `tool-name` |
| `reference_file_read` | A non-`SKILL.md` file is read under a bundled Azure Functions skill directory. | `timestamp`, `client-name`, `session-id`, `file-reference` |
| `azure_deployment_observed` | The `azure-functions-deploy` or `azure-functions-hosted-skills` skill collects once after a supported `azd up` / standalone `azd provision` succeeds and a current ARM deployment confirms it. | `skill`, `operation`, `result`, `resourceTypes`, `deploymentKind`, `agent`, `skillsVersion` |

The `azure_deployment_observed` properties are all categorical strings:

| Property | Value |
| --- | --- |
| `skill` | `azure-functions-deploy` or `azure-functions-hosted-skills` |
| `operation` | `deploy` (from `azd up`) or `provision` (standalone `azd provision`) |
| `result` | Constant `success`, constructed only after ARM verification |
| `resourceTypes` | JSON-encoded, sorted, de-duplicated array of Microsoft resource-provider types |
| `deploymentKind` | `function-app` (deploy skill) or `hosted-agent` (hosted-skills skill) |
| `agent` | Normalized client (`copilot-cli`, `claude-code`, `codex`, `Visual Studio Code`, …) or `unknown` |
| `skillsVersion` | Installed Skills asset version, or `unknown` |

Example serialized event:

```json
{
  "name": "azure_deployment_observed",
  "properties": {
    "skill": "azure-functions-deploy",
    "operation": "deploy",
    "result": "success",
    "resourceTypes": "[\"microsoft.storage/storageaccounts\",\"microsoft.web/sites\"]",
    "deploymentKind": "function-app",
    "agent": "copilot-cli",
    "skillsVersion": "unknown"
  }
}
```

These dimensions should support analysis such as:

- skill adoption by client (`skill-name` by `client-name`);
- active sessions using Azure Functions skills (`dcount(session-id)`);
- create/deploy/diagnostics funnel analysis by session;
- most-read references and scripts (`file-reference`);
- MCP template/scaffold usage (`tool-name` for `functions_*` tools);
- versioned package rollout correlation by comparing blob package version with
  release timing.

### Reporting the deployment-observation metric

#### Required disclaimer

Any dashboard, report, slide, or query example that publishes this metric must
show this text next to the number, verbatim (AC-010):

> **Observed successful Azure deployment operations.** Counts azd/Bicep
> subscription-scope deployments observed after a successful
> `azure-functions-deploy` or `azure-functions-hosted-skills` command, verified
> against Azure Resource Manager. It is a best-effort adoption signal, not a
> deployment inventory, conversion rate, success rate, or proof that Azure
> Functions Skills created the workload. Resource-group-scope deployments,
> Terraform, direct Azure CLI, multiple azd provisioning layers, tenant and
> management-group roots, custom Azure clouds, opted-out users, and cached or
> update-only redeployments are not counted. Duplicate observations are possible.

Using this metric in a ratio requires a written coverage statement explaining
what the other side measures and why the two are comparable. Without it, publish
the count only.

#### Query examples

Each example carries the required disclaimer as a comment, so a copied query
keeps it. Show the same text next to any number that a query produces.

```kusto
// Observed successful Azure deployment operations. Counts azd/Bicep
// subscription-scope deployments observed after a successful
// `azure-functions-deploy` or `azure-functions-hosted-skills` command, verified
// against Azure Resource Manager. It is a best-effort adoption signal, not a
// deployment inventory, conversion rate, success rate, or proof that Azure
// Functions Skills created the workload. Resource-group-scope deployments,
// Terraform, direct Azure CLI, multiple azd provisioning layers, tenant and
// management-group roots, custom Azure clouds, opted-out users, and cached or
// update-only redeployments are not counted. Duplicate observations are possible.
//
// Observed successful deployments per day by skill and deploymentKind
customEvents
| where name == "azure_deployment_observed"
| summarize count() by bin(timestamp, 1d),
    tostring(customDimensions.skill), tostring(customDimensions.deploymentKind)
```

```kusto
// Observed successful Azure deployment operations. Counts azd/Bicep
// subscription-scope deployments observed after a successful
// `azure-functions-deploy` or `azure-functions-hosted-skills` command, verified
// against Azure Resource Manager. It is a best-effort adoption signal, not a
// deployment inventory, conversion rate, success rate, or proof that Azure
// Functions Skills created the workload. Resource-group-scope deployments,
// Terraform, direct Azure CLI, multiple azd provisioning layers, tenant and
// management-group roots, custom Azure clouds, opted-out users, and cached or
// update-only redeployments are not counted. Duplicate observations are possible.
//
// Resource-type breakdown. Expanding the array must not inflate the headline
// count: a type's count means "observations containing this type", not resource
// count. Do not compute an exact funnel or conversion rate from these
// success-only events.
customEvents
| where name == "azure_deployment_observed"
| extend types = todynamic(tostring(customDimensions.resourceTypes))
| mv-expand type = types to typeof(string)
| summarize observations = count() by type
```

These counts are an approximate deployment-observation trend, not exact accounting.
Deployment selection is by name (`environmentName`) against subscription-scope
ARM deployments, validated by a bounded 30-minute recency window: a named
deployment older than the window, a resource-group-scope deployment
(`az deployment group create`), or a missing or invalid name is skipped and
records nothing. Selecting by name makes cross-deployment misattribution
unlikely, but re-running the collector after a second deployment that reuses
the same environment name still refers to the newest deployment of that name.
Duplicate collector calls are possible, and there is no exactly-once delivery.
