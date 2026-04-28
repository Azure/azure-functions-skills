# Azure Functions Health Status Commands and KQL

Use these commands only for current status and health investigation. For static specifications, use the inventory skill.

## Current app state and plan status

```powershell
$AppName = '<function-app-name>'
$SubscriptionId = '<subscription-id>' # optional
$ResourceGroup = '<resource-group>'   # optional
$Hours = 24

az account set --subscription $SubscriptionId
$ResourceId = az functionapp show -g $ResourceGroup -n $AppName --query id -o tsv

az rest --method get --url "https://management.azure.com${ResourceId}?api-version=2023-12-01" `
  --query "{state:properties.state,enabled:properties.enabled,availabilityState:properties.availabilityState,runtimeAvailabilityState:properties.runtimeAvailabilityState,serverFarmId:properties.serverFarmId}" -o json
```

## Resource Health

```powershell
az rest --method get --url "https://management.azure.com${ResourceId}/providers/Microsoft.ResourceHealth/availabilityStatuses/current?api-version=2022-10-01" `
  --query "{availabilityState:properties.availabilityState,summary:properties.summary,reasonType:properties.reasonType,reportedTime:properties.reportedTime,title:properties.title}" -o json
```

## Trigger enabled/disabled summary

```powershell
$funcs = az functionapp function list -g $ResourceGroup -n $AppName -o json | ConvertFrom-Json
$summary = $funcs | ForEach-Object {
  $binding = $_.config.bindings | Where-Object { $_.direction -eq 'In' } | Select-Object -First 1
  [pscustomobject]@{ Function=($_.name -replace '^.*/',''); Trigger=$binding.type; Disabled=$_.isDisabled }
}
$summary | Group-Object Trigger, Disabled | ForEach-Object {
  [pscustomobject]@{ Trigger=$_.Group[0].Trigger; Disabled=$_.Group[0].Disabled; Count=$_.Count }
} | Sort-Object Trigger,Disabled | ConvertTo-Json -Depth 4
```

## Azure Monitor Metrics

```powershell
az monitor metrics list --resource $ResourceId `
  --metric "InstanceCount,CpuPercentage,AverageMemoryWorkingSet,OnDemandFunctionExecutionCount,OnDemandFunctionExecutionUnits,AlwaysReadyFunctionExecutionCount,AlwaysReadyFunctionExecutionUnits,AlwaysReadyUnits" `
  --interval PT1H --aggregation Average Total -o json
```

## Application Insights / Log Analytics

Get workspace ID:

```powershell
$app = az functionapp show -g $ResourceGroup -n $AppName -o json | ConvertFrom-Json
$AiResourceId = $app.tags.'hidden-link: /app-insights-resource-id'
$WorkspaceResourceId = az resource show --ids $AiResourceId --query properties.WorkspaceResourceId -o tsv
$WorkspaceId = az monitor log-analytics workspace show --ids $WorkspaceResourceId --query customerId -o tsv
```

Use Log Analytics REST API if the CLI extension is unavailable:

```powershell
$tmp = Join-Path $env:TEMP 'la-query.json'
@{ query = 'AppRequests | where TimeGenerated > ago(24h) | count' } | ConvertTo-Json -Compress | Set-Content -Path $tmp -Encoding utf8
az rest --method post --url "https://api.loganalytics.io/v1/workspaces/$WorkspaceId/query" --body "@$tmp" --headers "Content-Type=application/json" -o json
```

Table coverage:

```kusto
union withsource=TableName AppRequests, AppExceptions, AppTraces, AppDependencies
| where TimeGenerated > ago(7d)
| summarize Count=count(), Latest=max(TimeGenerated) by TableName
```

Requests:

```kusto
AppRequests
| where TimeGenerated > ago(24h)
| summarize Count=count(), Failed=countif(Success == false), AvgDurationMs=avg(DurationMs), P95DurationMs=percentile(DurationMs,95), Latest=max(TimeGenerated) by OperationName
| order by Count desc
| take 30
```

Exceptions:

```kusto
AppExceptions
| where TimeGenerated > ago(24h)
| summarize Count=count(), Latest=max(TimeGenerated) by OperationName, ProblemId, Type, OuterMessage
| order by Count desc
| take 20
```

Warning/error traces:

```kusto
AppTraces
| where TimeGenerated > ago(24h)
| where SeverityLevel >= 2
| summarize Count=count(), Latest=max(TimeGenerated) by SeverityLevel, Message
| order by Count desc
| take 20
```

Dependencies:

```kusto
AppDependencies
| where TimeGenerated > ago(24h)
| summarize Count=count(), Failed=countif(Success == false), AvgDurationMs=avg(DurationMs), P95DurationMs=percentile(DurationMs,95), Latest=max(TimeGenerated) by Type, Target, Name
| order by Failed desc, Count desc
| take 20
```

## Activity Log

```powershell
az monitor activity-log list --resource-id $ResourceId --offset ${Hours}h --max-events 20 `
  --query "[].{time:eventTimestamp,operation:operationName.value,status:status.value,caller:caller,level:level,correlationId:correlationId}" -o json
```
