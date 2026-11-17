# Azure Functions Inventory Commands

Use these commands only for static Function App specifications. For health, metrics, exceptions, traces, dependencies, or Activity Log, use the health skill.

## Locate the app

```powershell
$AppName = '<function-app-name>'
$SubscriptionId = '<subscription-id>' # optional
$ResourceGroup = '<resource-group>'   # optional

az config set extension.use_dynamic_install=yes_without_prompt | Out-Null
az extension add --name resource-graph --upgrade --only-show-errors
az graph query -q "Resources | where type =~ 'microsoft.web/sites' and name =~ '$AppName' | project name, id, resourceGroup, subscriptionId, location, kind, properties" -o json
```

## App, plan, runtime, and config

```powershell
az account set --subscription $SubscriptionId
$ResourceId = az functionapp show -g $ResourceGroup -n $AppName --query id -o tsv

az rest --method get --url "https://management.azure.com${ResourceId}?api-version=2023-12-01" `
  --query "{id:id,name:name,location:location,kind:kind,enabled:properties.enabled,state:properties.state,defaultHostName:properties.defaultHostName,serverFarmId:properties.serverFarmId,virtualNetworkSubnetId:properties.virtualNetworkSubnetId,httpsOnly:properties.httpsOnly,publicNetworkAccess:properties.publicNetworkAccess,lastModifiedTimeUtc:properties.lastModifiedTimeUtc,identity:identity,functionAppConfig:properties.functionAppConfig}" -o json

$PlanId = az functionapp show -g $ResourceGroup -n $AppName --query "properties.serverFarmId || serverFarmId" -o tsv
az rest --method get --url "https://management.azure.com${PlanId}?api-version=2023-12-01" `
  --query "{id:id,name:name,location:location,sku:sku,status:properties.status,reserved:properties.reserved,zoneRedundant:properties.zoneRedundant}" -o json

az rest --method get --url "https://management.azure.com${ResourceId}/config/web?api-version=2023-12-01" `
  --query "{minTlsVersion:properties.minTlsVersion,ftpsState:properties.ftpsState,alwaysOn:properties.alwaysOn,http20Enabled:properties.http20Enabled,healthCheckPath:properties.healthCheckPath,use32BitWorkerProcess:properties.use32BitWorkerProcess}" -o json
```

## Selected app setting presence

```powershell
$settings = az functionapp config appsettings list -g $ResourceGroup -n $AppName -o json | ConvertFrom-Json
$names = @('FUNCTIONS_EXTENSION_VERSION','FUNCTIONS_WORKER_RUNTIME','APPLICATIONINSIGHTS_CONNECTION_STRING','APPINSIGHTS_INSTRUMENTATIONKEY','AzureWebJobsStorage','AzureWebJobsStorage__accountName','AzureWebJobsStorage__credential','WEBSITE_RUN_FROM_PACKAGE','WEBSITE_CONTENTSHARE','WEBSITE_CONTENTAZUREFILECONNECTIONSTRING')
$settings | Where-Object { $names -contains $_.name } | ForEach-Object {
  $v = if ($_.name -match 'CONNECTION|Storage|KEY|SECRET|INSIGHTS|TOKEN|PASSWORD|SAS|ACCOUNT') { '***redacted***' } else { $_.value }
  [pscustomobject]@{ name=$_.name; hasValue=($null -ne $_.value -and $_.value -ne ''); value=$v }
} | ConvertTo-Json -Depth 5
```

## Functions and trigger inventory

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