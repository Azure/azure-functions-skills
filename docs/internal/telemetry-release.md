# Telemetry and internal release pipeline

This repository keeps the telemetry destination out of source control. The
committed package contains only `__APPLICATIONINSIGHTS_CONNECTION_STRING__` in
`src/telemetry/config.ts`; the internal 1ES mirror pipeline replaces the
compiled placeholder immediately before `npm pack`.

## Release flow

1. The internal AzDO official or prerelease pipeline builds from the mirrored
   repository with the 1ES template in `azure-pipelines/templates/build.yml`.
2. The build copies the npm package inputs to `dropInput`.
3. The official and prerelease pipelines require the secret variable
   `ApplicationInsightsConnectionString` and inject it into
   `dropInput/lib/telemetry/config.js`. Public PR/CI builds do not receive the
   secret and compile out the injection step. Hook and plugin files never
   contain the destination.
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

The npm package ships Copilot, Claude, and Codex telemetry-hook manifests plus
PowerShell and Bash scripts in two places:

- `templates/hooks/`, used by the build system;
- `dist/plugin/azure-functions-skills/hooks/`, used in the built plugin payload.

`npm run build` also writes the telemetry assets into each host's native hook
directory in the agent-specific layouts under `dist/workspace/`.

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
`AZURE_MCP_COLLECT_TELEMETRY=false`. The hook scripts also honor a
`telemetry.config.json` next to the hooks with `"enabled": false`.

## Deployment-observation collector

The two canonical deployment skills invoke a second hidden subcommand exactly
once after a supported command reports success:

```text
npx -y @azure/functions-skills@latest telemetry deployment-observed
```

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

### Rollout ordering

The skill snippets may ship before a published `@azure/functions-skills` CLI
that supports `telemetry deployment-observed`. During that window the command is a
verified silent no-op that emits nothing. A published bin without the
subcommand matches `command === 'telemetry'`, ignores the `deployment-observed`
argument, and pipes stdin into the old `parseTelemetryEvent`, whose strict
property allowlist rejects our payload's first key (`skill`) with
`Unsupported telemetry property: skill` and exit `1`; a version predating the
`telemetry` command prints `Unknown command` and exits `1`. Either way no
usage event is sent, `environmentName` is not included in any telemetry event, and the snippets'
`>/dev/null 2>&1 || true` swallows the stderr and non-zero exit. This is
intended behavior — do not "fix" the snippets or the old parser to make the
subcommand appear to run on older releases.

### Data governance

This event introduces **no new destination, credential, or service**. It is
written to the same Application Insights resource, through the same
release-injected connection string, as the existing usage event, so its
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
