param(
    [Parameter(Mandatory=$true)] [string] $AppName,
    [string] $SubscriptionId,
    [string] $ResourceGroup,
    [int] $Hours = 24
)

$ErrorActionPreference = 'Continue'

function Invoke-AzJson([string] $Command) {
    $out = Invoke-Expression "$Command 2>`$null"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($out)) { return $null }
    try { return $out | ConvertFrom-Json } catch { return $null }
}

function Invoke-LogAnalyticsRest([string] $WorkspaceCustomerId, [string] $Kql) {
    if (-not $WorkspaceCustomerId) { return $null }
    $tmp = Join-Path $env:TEMP ("la-query-{0}.json" -f ([guid]::NewGuid().ToString('N')))
    try {
        @{ query = $Kql } | ConvertTo-Json -Compress | Set-Content -Path $tmp -Encoding utf8
        $resultText = az rest --method post --url "https://api.loganalytics.io/v1/workspaces/$WorkspaceCustomerId/query" --body "@$tmp" --headers "Content-Type=application/json" -o json 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($resultText)) { return $null }
        $result = $resultText | ConvertFrom-Json
        if ($result.tables -and $result.tables.Count -gt 0) { return $result.tables[0].rows }
        return $null
    } catch {
        return $null
    } finally {
        Remove-Item -Path $tmp -ErrorAction SilentlyContinue
    }
}

if ($SubscriptionId) { az account set --subscription $SubscriptionId | Out-Null }

$resource = $null
try {
    az config set extension.use_dynamic_install=yes_without_prompt | Out-Null
    az extension add --name resource-graph --upgrade --only-show-errors | Out-Null
    $where = "type =~ 'microsoft.web/sites' and name =~ '$AppName'"
    if ($ResourceGroup) { $where += " and resourceGroup =~ '$ResourceGroup'" }
    $query = "Resources | where $where | project name, id, resourceGroup, subscriptionId, location, kind, properties"
    $graph = Invoke-AzJson "az graph query -q `"$query`" -o json"
    if ($graph -and $graph.data -and $graph.data.Count -gt 0) { $resource = $graph.data[0] }
} catch { }

if (-not $resource -and $SubscriptionId) {
    $list = Invoke-AzJson "az resource list --name $AppName --resource-type Microsoft.Web/sites -o json"
    if ($list -and $list.Count -gt 0) { $resource = $list[0] }
}

if (-not $resource) {
    [pscustomobject]@{ error = 'Function App not found'; appName = $AppName } | ConvertTo-Json -Depth 5
    exit 1
}

$SubscriptionId = $resource.subscriptionId
$ResourceGroup = $resource.resourceGroup
$ResourceId = $resource.id
az account set --subscription $SubscriptionId | Out-Null

$siteUrl = 'https://management.azure.com' + $ResourceId + '?api-version=2023-12-01'
$site = Invoke-AzJson "az rest --method get --url `"$siteUrl`" -o json"
if (-not $site) { $site = Invoke-AzJson "az functionapp show -g $ResourceGroup -n $AppName -o json" }

$planId = $site.properties.serverFarmId
if (-not $planId) { $planId = $site.serverFarmId }
$plan = if ($planId) {
    $planUrl = 'https://management.azure.com' + $planId + '?api-version=2023-12-01'
    Invoke-AzJson "az rest --method get --url `"$planUrl`" -o json"
} else { $null }

$healthUrl = 'https://management.azure.com' + $ResourceId + '/providers/Microsoft.ResourceHealth/availabilityStatuses/current?api-version=2022-10-01'
$health = Invoke-AzJson "az rest --method get --url `"$healthUrl`" -o json"

$funcs = Invoke-AzJson "az functionapp function list -g $ResourceGroup -n $AppName -o json"
$functionSummary = @($funcs | ForEach-Object {
    $binding = $_.config.bindings | Where-Object { $_.direction -eq 'In' } | Select-Object -First 1
    [pscustomobject]@{ function=($_.name -replace '^.*/',''); trigger=$binding.type; disabled=$_.isDisabled }
})
$triggerCounts = @($functionSummary | Group-Object trigger, disabled | ForEach-Object {
    [pscustomobject]@{ trigger=$_.Group[0].trigger; disabled=$_.Group[0].disabled; count=$_.Count }
} | Sort-Object trigger, disabled)

$metricNames = 'InstanceCount,CpuPercentage,AverageMemoryWorkingSet,OnDemandFunctionExecutionCount,OnDemandFunctionExecutionUnits,AlwaysReadyFunctionExecutionCount,AlwaysReadyFunctionExecutionUnits,AlwaysReadyUnits'
$metricsRaw = Invoke-AzJson "az monitor metrics list --resource `"$ResourceId`" --metric `"$metricNames`" --interval PT1H --aggregation Average Total -o json"
$metrics = @()
if ($metricsRaw -and $metricsRaw.value) {
    $metrics = @($metricsRaw.value | ForEach-Object {
        $totals = @()
        $averages = @()
        foreach ($series in $_.timeseries) {
            foreach ($point in $series.data) {
                if ($null -ne $point.total) { $totals += [double]$point.total }
                if ($null -ne $point.average) { $averages += [double]$point.average }
            }
        }
        [pscustomobject]@{
            name = $_.name.value
            unit = $_.unit
            totalSum = if ($totals.Count) { ($totals | Measure-Object -Sum).Sum } else { $null }
            averageMax = if ($averages.Count) { ($averages | Measure-Object -Maximum).Maximum } else { $null }
            nonZeroTotalBucketCount = @($totals | Where-Object { $_ -ne 0 }).Count
            nonZeroAverageBucketCount = @($averages | Where-Object { $_ -ne 0 }).Count
        }
    })
}

$activityRaw = Invoke-AzJson "az monitor activity-log list --resource-id `"$ResourceId`" --offset $($Hours)h --max-events 20 -o json"
$activity = @($activityRaw | ForEach-Object {
    [pscustomobject]@{
        time = $_.eventTimestamp
        operation = $_.operationName.value
        status = $_.status.value
        caller = $_.caller
        level = $_.level
        correlationId = $_.correlationId
    }
})

$aiResourceId = $null
if ($site.tags) { $aiResourceId = $site.tags.'hidden-link: /app-insights-resource-id' }
$workspaceResourceId = $null
$workspaceCustomerId = $null
if ($aiResourceId) {
    $ai = Invoke-AzJson "az resource show --ids `"$aiResourceId`" -o json"
    $workspaceResourceId = $ai.properties.WorkspaceResourceId
    if (-not $workspaceResourceId) { $workspaceResourceId = $ai.properties.workspaceResourceId }
    if ($workspaceResourceId) {
        $workspace = Invoke-AzJson "az monitor log-analytics workspace show --ids `"$workspaceResourceId`" -o json"
        $workspaceCustomerId = $workspace.customerId
    }
}

$telemetry = $null
if ($workspaceCustomerId) {
    $telemetry = [pscustomobject]@{
        workspaceResourceId = $workspaceResourceId
        tableCounts7d = Invoke-LogAnalyticsRest $workspaceCustomerId "union withsource=TableName AppRequests, AppExceptions, AppTraces, AppDependencies | where TimeGenerated > ago(7d) | summarize Count=count(), Latest=max(TimeGenerated) by TableName | order by TableName"
        requests = Invoke-LogAnalyticsRest $workspaceCustomerId "AppRequests | where TimeGenerated > ago($($Hours)h) | summarize Count=count(), Failed=countif(Success == false), AvgDurationMs=avg(DurationMs), P95DurationMs=percentile(DurationMs,95), Latest=max(TimeGenerated) by OperationName | order by Count desc | take 30"
        exceptions = Invoke-LogAnalyticsRest $workspaceCustomerId "AppExceptions | where TimeGenerated > ago($($Hours)h) | summarize Count=count(), Latest=max(TimeGenerated) by OperationName, ProblemId, Type, OuterMessage | order by Count desc | take 20"
        errorTraces = Invoke-LogAnalyticsRest $workspaceCustomerId "AppTraces | where TimeGenerated > ago($($Hours)h) | where SeverityLevel >= 2 | summarize Count=count(), Latest=max(TimeGenerated) by SeverityLevel, Message | order by Count desc | take 20"
        dependencies = Invoke-LogAnalyticsRest $workspaceCustomerId "AppDependencies | where TimeGenerated > ago($($Hours)h) | summarize Count=count(), Failed=countif(Success == false), AvgDurationMs=avg(DurationMs), P95DurationMs=percentile(DurationMs,95), Latest=max(TimeGenerated) by Type, Target, Name | order by Failed desc, Count desc | take 20"
    }
}

[pscustomobject]@{
    resource = [pscustomobject]@{
        id = $ResourceId
        name = $AppName
        resourceGroup = $ResourceGroup
        subscriptionId = $SubscriptionId
        location = $site.location
        kind = $site.kind
    }
    currentStatus = [pscustomobject]@{
        enabled = $site.properties.enabled
        state = $site.properties.state
        availabilityState = $site.properties.availabilityState
        runtimeAvailabilityState = $site.properties.runtimeAvailabilityState
        planStatus = $plan.properties.status
    }
    resourceHealth = if ($health) { [pscustomobject]@{ availabilityState=$health.properties.availabilityState; summary=$health.properties.summary; reasonType=$health.properties.reasonType; reportedTime=$health.properties.reportedTime; title=$health.properties.title } } else { $null }
    triggers = [pscustomobject]@{ counts=$triggerCounts; functions=$functionSummary }
    metrics = $metrics
    applicationInsights = $telemetry
    activityLog = $activity
    gaps = [pscustomobject]@{
        applicationInsightsResourceFound = [bool]$aiResourceId
        workspaceFound = [bool]$workspaceCustomerId
        resourceHealthReturned = [bool]$health
    }
} | ConvertTo-Json -Depth 30
