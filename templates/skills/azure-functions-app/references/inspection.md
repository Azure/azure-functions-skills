# Inspection Mode (R0, read only)

Read [core/ARM-CORE.md](core/ARM-CORE.md) and [core/COMMON-CLI.md](core/COMMON-CLI.md) first.
Read [core/HOST-CORE.md](core/HOST-CORE.md) only for host status.

**Inspection never writes.** If the user asks for a change during inspection, finish the read,
then switch to Authoring or Operations and follow that reference's approval rules.

All paths below are relative to `https://management.azure.com` unless they start with `https://`.

## 1. Find and summarize the app

1. Resolve the app (ARM-CORE "Resolve the target app").
2. Read the app, plan, and site config:

| Item | Request | Fields to show |
| --- | --- | --- |
| App | `GET {site}?{av}` | `kind`, `location`, `properties.state`, `enabled`, `defaultHostName`, `httpsOnly`, `publicNetworkAccess`, `virtualNetworkSubnetId`, `identity.type`, `functionAppConfig.runtime`, `functionAppConfig.scaleAndConcurrency`, `lastModifiedTimeUtc` |
| Plan | `GET <properties.serverFarmId>?{av}` | `sku`, `properties.status`, `reserved`, `zoneRedundant`, `maximumElasticWorkerCount` |
| Site config | `GET {site}/config/web?{av}` | `linuxFxVersion`, `netFrameworkVersion`, `powerShellVersion`, `alwaysOn`, `minTlsVersion`, `ftpsState`, `http20Enabled`, `cors`, `healthCheckPath`, `ipSecurityRestrictions` (count) |
| Slots | `GET {site}/slots?{av}` | `name`, `properties.state` |

3. Classify the plan (ARM-CORE "Plan detection") and state it in the summary.
4. For network details or connectivity problems, continue with [networking.md](networking.md) §1–§2.

## 2. App settings and connection strings (redacted)

- `POST {site}/config/appsettings/list?{av}` → `properties` (name → value).
- `POST {site}/config/connectionstrings/list?{av}` → `properties` (name → `{value, type}`).
- `GET {site}/config/slotConfigNames?{av}` → which names are slot-sticky.

Always redact with the COMMON-CLI helpers. Show names, presence, and non-secret values only.
Point out notable settings: `FUNCTIONS_EXTENSION_VERSION`, `FUNCTIONS_WORKER_RUNTIME`,
`AzureWebJobsStorage` vs `AzureWebJobsStorage__accountName` (identity-based),
`APPLICATIONINSIGHTS_CONNECTION_STRING`, `WEBSITE_RUN_FROM_PACKAGE`, `AzureWebJobs.<fn>.Disabled`.

## 3. Functions, triggers, and keys

| Item | Request |
| --- | --- |
| Function list | `GET {site}/functions?{av}` → per item: `name` (after `/`), `properties.config.bindings`, `properties.isDisabled`, `properties.invoke_url_template` |
| One function | `GET {site}/functions/{functionName}?{av}` |
| Function keys | `POST {site}/functions/{functionName}/listkeys?{av}` |
| Host keys | `POST {site}/host/default/listkeys?{av}` → `masterKey`, `functionKeys`, `systemKeys` |

- Trigger type = the binding whose `direction` is `in` and whose `type` ends with `Trigger`.
- Show key **names only** (value `***`) unless the user explicitly asks for one specific key.
- An empty function list on a running app usually means trigger sync failed or the deployment
  did not index. Suggest Operations "Sync triggers" and the deployment checks below.

## 4. Deployments

- SCM history: `GET https://<scm-host>/api/deployments` and `.../api/deployments/latest`
  (see [core/SCM-CORE.md](core/SCM-CORE.md)). Show `id`, `status`, `status_text`, `deployer`,
  `start_time`, `end_time`, `complete`.
- Failed deployment log: `GET https://<scm-host>/api/deployments/{id}/log`.
- Flex Consumption: also show `functionAppConfig.deployment.storage` (container URL and auth type)
  from the app GET. Do not read blobs in that container.

## 5. Health

| Item | Request |
| --- | --- |
| App state | `GET {site}?{av}` → `state`, `availabilityState`, `usageState` |
| Resource Health | `GET {site}/providers/Microsoft.ResourceHealth/availabilityStatuses/current?api-version=2022-10-01` → `availabilityState`, `summary`, `reasonType`, `occuredTime` |
| Diagnose and solve | `GET {site}/detectors?{av}` lists detectors; `GET {site}/detectors/{detectorName}?{av}&startTime=<ISO>&endTime=<ISO>` runs one |
| Host status | `GET https://<defaultHostName>/admin/host/status` with the master key (HOST-CORE) |

Pick detectors by `properties.metadata.name` / `description` matching the symptom. Summarize
`properties.dataset` insights with status `Critical` or `Warning` first. Do not dump raw tables.

## 6. Metrics

`GET {site}/providers/Microsoft.Insights/metrics?api-version=2023-10-01&metricnames=<list>&timespan=<ISO start>/<ISO end>&interval=PT1H&aggregation=Total,Average`

| Plan | Useful metric names |
| --- | --- |
| Flex Consumption | `OnDemandFunctionExecutionCount`, `OnDemandFunctionExecutionUnits`, `AlwaysReadyFunctionExecutionCount`, `Http5xx`; instance count per §6a |
| Consumption / Premium / Dedicated | `FunctionExecutionCount`, `FunctionExecutionUnits`, `Http5xx`, `Requests`, `AverageResponseTime`, `MemoryWorkingSet` |

If the service returns `BadRequest` for a metric name, drop that name and retry once with the rest.
List valid names with `GET {site}/providers/Microsoft.Insights/metricDefinitions?api-version=2023-10-01`.

## 6a. Observed scale (how many instances actually ran)

Configured limits (§1) are not actual scale. Use these sources and say which one each number
comes from. Pick a window that covers the load in question.

| Source | Plans | Request and reading |
| --- | --- | --- |
| Instance count metric | Flex Consumption | In `metricDefinitions` find the metric whose `name.localizedValue` is `Automatic Scaling Instance Count`; use its `name.value`. Query it per §6 with `interval=PT1M` and `aggregation=Count`. It aggregates every instance seen in each 30-second emission, so treat it as instances used, not a point-in-time count. |
| Per-instance metric split | Premium, Dedicated, Flex Consumption | Query `MemoryWorkingSet` per §6 with `interval=PT1M`, `aggregation=Average`, and `$filter=Instance eq '*'`. The number of distinct `timeseries[].metadatavalues` with name `Instance` per interval is the instance count. |
| Current instances | Premium, Dedicated | `GET {site}/instances?{av}` → `value[].name` (instance IDs now). Empty or `404` on other plans: use the metrics. |
| Instances that executed | All plans with Application Insights | KQL below. Counts only instances that ran or logged; idle always-ready or pre-warmed instances do not appear. |

```kusto
union AppRequests, AppTraces
| where _ResourceId =~ "<app-insights-id>"
| summarize Instances=dcount(AppRoleInstance), Executions=countif(Type == "AppRequests") by bin(TimeGenerated, 1m)
| order by TimeGenerated asc
```

Report the peak and the time it was reached, the configured maximum (Flex
`maximumInstanceCount`, Premium `maximumElasticWorkerCount` / `functionAppScaleLimit`, Dedicated
`sku.capacity`), and whether the peak hit that limit. If executions rise while instances stay
flat at the limit, say that scale is capped; if instances stay at one with no limit, look at the
trigger's scale signal (for example queue length) instead of guessing.

Scale controller decisions (why it scaled) need app setting `SCALE_CONTROLLER_LOGGING_ENABLED=AppInsights:Verbose`,
supported on Consumption and Premium. Enabling it is an Authoring app-settings change (R1, restarts
the app, adds log volume); remove it after the investigation. Then query
`AppTraces | where _ResourceId =~ "<app-insights-id>" and tostring(Properties.Category) == "ScaleControllerLogs"`.

## 7. Logs (Application Insights)

Prefer the tool: `logs query --app <name> [--preset errors|exceptions|failures|requests|traces|instances] [--since 1h]`
or `--kql "<query>"`. It resolves the component and filters by app. Use the steps below only when
the tool returns exit 3 or 4.

1. Find the Application Insights component: read `APPLICATIONINSIGHTS_CONNECTION_STRING`, take its
   `InstrumentationKey`, and query Resource Graph for
   `resources | where type =~ 'microsoft.insights/components' and properties.InstrumentationKey =~ '<key>' | project id`.
   Never print the key.
2. Query the component directly (no workspace lookup needed):
   `POST https://api.loganalytics.io/v1<app-insights-id>/query` with a token for resource
   `https://api.loganalytics.io` and body `{"query":"<KQL>","timespan":"P1D"}`.
   Use the classic table names (`requests`, `exceptions`, `traces`, `dependencies`).

A component can be shared by several apps, so filter by `cloud_RoleName =~ '<app-name>'`.

```kusto
requests
| where cloud_RoleName =~ '<app-name>'
| summarize count=count(), failures=countif(success == false), p95ms=percentile(duration, 95) by operation_Name
| order by failures desc, count desc
| take 30
```

```kusto
exceptions
| where cloud_RoleName =~ '<app-name>'
| summarize count=count(), latest=max(timestamp) by operation_Name, problemId, outerMessage
| order by count desc
| take 20
```

```kusto
traces
| where cloud_RoleName =~ '<app-name>' and severityLevel >= 2
| summarize count=count(), latest=max(timestamp) by severityLevel, message
| order by count desc
| take 20
```

Traces may contain secrets or personal data. Summarize; do not paste full messages unless asked.
For what is happening right now, use `logs tail` (§7b) instead of polling queries.

If a preset returns no rows but the app ran, read finding `NoRowsForRoleName`: it lists the
`cloud_RoleName` values that do have telemetry (slots and custom role names differ from the app
name). Rerun with `--kql` and that name. If a query is rejected (`KqlRejected`), quote column
names that are KQL keywords as `['count']`.

## 7a. What can and cannot be observed

Answer "can I see X?" questions with this table before running anything.

| Question | Observable with | Not observable |
| --- | --- | --- |
| Is the host up, which version, which errors | `host status` (`--full` for every field) | Per-instance host state |
| Which functions exist, triggers, disabled | `functions list` | Function code (use the workspace) |
| Executions, failures, durations | `logs query --preset requests\|failures` (Application Insights) | Anything when Application Insights is not connected |
| How many instances ran | §6a (`--preset instances` and metrics) | Instance count without telemetry or metrics |
| How many instances run now | `logs tail` (`data.instances`, from ARM `/instances`) | Per-instance load |
| Who changed what | `changes` (Activity Log, control plane only) | App setting values before the change; data-plane calls |
| Live log stream | `logs tail [--seconds 30] [--invoke <fn>]` (§7b) | Flex Consumption and Container Apps (use `logs query`) |
| Key values | Names via `keys list` | Values (the tool never prints them) |

## 7b. Live log stream

`logs tail --app <name> [--slot <s>] [--seconds 30] [--invoke <function>]` watches the Kudu log
stream for a bounded time and returns the new lines plus the current instance list. To show that a
call reaches the logs, pass `--invoke <function>`: the tool calls it about 2 seconds after the
stream opens (HTTP GET runs directly; other triggers need `--approve`). Do not start a separate
background stream or shell job.

- Windows: the tool first writes the Functions debug marker (as the portal log stream does), so
  function logs go to files for 15 minutes; `data.debugMode` says so. Mention it to the user.
- Linux Premium/Dedicated: the container log is streamed; no marker is written.
- Flex Consumption and Container Apps: exit 3; use `logs query --preset traces --since 15m`.
- `NoLogLines`: nothing new happened in the window; trigger the function or widen `--seconds`.
- The stream carries what the Functions host writes (Executing/Executed, host errors, and worker
  logs the host receives). .NET isolated apps that export with OpenTelemetry or the Application
  Insights worker SDK send their own `ILogger` messages straight to Application Insights; read
  those with `logs query --preset traces --since 15m`.
- Lines are redacted and de-duplicated; still summarize rather than paste many lines.

## 8. Activity Log (what changed)

`GET /subscriptions/{sub}/providers/Microsoft.Insights/eventtypes/management/values?api-version=2015-04-01&$filter=eventTimestamp ge '<ISO start>' and resourceUri eq '<site id>'&$select=eventTimestamp,operationName,status,caller,level,correlationId`

URL-encode the `$filter` value. Show the newest 20 events. Treat `caller` as personal data: show
it only when the user asks who made a change.

## Output

Lead with a short summary (plan, state, health, notable risks), then the details the user asked
for. Mark every redacted value. State which reads failed and why.
