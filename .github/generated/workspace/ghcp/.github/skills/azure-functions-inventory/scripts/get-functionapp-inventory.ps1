param(
    [Parameter(Mandatory=$true)] [string] $AppName,
    [string] $SubscriptionId,
    [string] $ResourceGroup
)

$ErrorActionPreference = 'Continue'

function Invoke-AzJson([string] $Command) {
    $out = Invoke-Expression "$Command 2>`$null"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($out)) { return $null }
    try { return $out | ConvertFrom-Json } catch { return $null }
}

function Redact-Setting([string] $name, $value) {
    if ($name -match 'CONNECTION|Storage|KEY|SECRET|INSIGHTS|TOKEN|PASSWORD|SAS|ACCOUNT') { return '***redacted***' }
    return $value
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

$webConfigUrl = 'https://management.azure.com' + $ResourceId + '/config/web?api-version=2023-12-01'
$webConfig = Invoke-AzJson "az rest --method get --url `"$webConfigUrl`" -o json"

$settingsRaw = Invoke-AzJson "az functionapp config appsettings list -g $ResourceGroup -n $AppName -o json"
$settingsWanted = @(
    'FUNCTIONS_EXTENSION_VERSION',
    'FUNCTIONS_WORKER_RUNTIME',
    'APPLICATIONINSIGHTS_CONNECTION_STRING',
    'APPINSIGHTS_INSTRUMENTATIONKEY',
    'AzureWebJobsStorage',
    'AzureWebJobsStorage__accountName',
    'AzureWebJobsStorage__credential',
    'WEBSITE_RUN_FROM_PACKAGE',
    'WEBSITE_CONTENTSHARE',
    'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
)
$settings = @($settingsRaw | Where-Object { $settingsWanted -contains $_.name } | ForEach-Object {
    [pscustomobject]@{ name=$_.name; hasValue=($null -ne $_.value -and $_.value -ne ''); value=(Redact-Setting $_.name $_.value) }
})

$funcs = Invoke-AzJson "az functionapp function list -g $ResourceGroup -n $AppName -o json"
$functionSummary = @($funcs | ForEach-Object {
    $binding = $_.config.bindings | Where-Object { $_.direction -eq 'In' } | Select-Object -First 1
    [pscustomobject]@{ function=($_.name -replace '^.*/',''); trigger=$binding.type; disabled=$_.isDisabled }
})
$triggerCounts = @($functionSummary | Group-Object trigger, disabled | ForEach-Object {
    [pscustomobject]@{ trigger=$_.Group[0].trigger; disabled=$_.Group[0].disabled; count=$_.Count }
} | Sort-Object trigger, disabled)

$vnetIntegration = Invoke-AzJson "az webapp vnet-integration list -g $ResourceGroup -n $AppName -o json"
$privateEndpoints = Invoke-AzJson "az network private-endpoint-connection list -g $ResourceGroup -n $AppName --type Microsoft.Web/sites -o json"
$relatedResources = Invoke-AzJson "az resource list -g $ResourceGroup --query `"[].{name:name,type:type,location:location,sku:sku.name}`" -o json"

[pscustomobject]@{
    resource = [pscustomobject]@{
        id = $ResourceId
        name = $AppName
        resourceGroup = $ResourceGroup
        subscriptionId = $SubscriptionId
        location = $site.location
        kind = $site.kind
        defaultHostName = $site.properties.defaultHostName
        hostNames = $site.properties.hostNames
    }
    app = [pscustomobject]@{
        enabled = $site.properties.enabled
        state = $site.properties.state
        sku = $site.properties.sku
        functionAppConfig = $site.properties.functionAppConfig
        lastModifiedTimeUtc = $site.properties.lastModifiedTimeUtc
    }
    plan = if ($plan) { [pscustomobject]@{ id=$plan.id; name=$plan.name; sku=$plan.sku; status=$plan.properties.status; location=$plan.location; reserved=$plan.properties.reserved; zoneRedundant=$plan.properties.zoneRedundant } } else { $null }
    network = [pscustomobject]@{
        virtualNetworkSubnetId = $site.properties.virtualNetworkSubnetId
        publicNetworkAccess = $site.properties.publicNetworkAccess
        httpsOnly = $site.properties.httpsOnly
        minTlsVersion = $webConfig.properties.minTlsVersion
        ftpsState = $webConfig.properties.ftpsState
        vnetRouteAllEnabled = $site.properties.vnetRouteAllEnabled
        vnetContentShareEnabled = $site.properties.vnetContentShareEnabled
        vnetImagePullEnabled = $site.properties.vnetImagePullEnabled
        vnetIntegration = $vnetIntegration
        privateEndpointConnectionCount = @($privateEndpoints).Count
    }
    identity = $site.identity
    selectedSettings = $settings
    triggers = [pscustomobject]@{ counts=$triggerCounts; functions=$functionSummary }
    relatedResources = $relatedResources
} | ConvertTo-Json -Depth 30