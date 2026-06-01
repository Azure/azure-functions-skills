targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment used to generate a short unique hash for resource names.')
param environmentName string

@minLength(1)
@description('Primary location for all resources. Must support Azure Functions Flex Consumption, ACA session pools, and the default Microsoft Foundry gpt-4.1 Global Standard deployment.')
@allowed([
  'centralus'
  'eastus'
  'eastus2'
  'northcentralus'
  'southcentralus'
  'westus'
])
@metadata({
  azd: {
    type: 'location'
  }
})
param location string

@description('Optional email recipient for the daily Microsoft blog digest. Leave blank to skip Office 365 Outlook setup and log the digest instead.')
param toEmail string = ''

@description('Microsoft Foundry model deployment name.')
param foundryModel string = 'gpt-4.1'

@description('Microsoft Foundry model name.')
param foundryModelName string = 'gpt-4.1'

@description('Microsoft Foundry model version.')
param foundryModelVersion string = '2025-04-14'

@description('Microsoft Foundry deployment capacity.')
param foundryDeploymentCapacity int = 200

@description('Optional reasoning effort for supported Foundry reasoning models. Leave empty for older models such as gpt-4.1, which do not support reasoning settings.')
@allowed([
  ''
  'none'
  'low'
  'medium'
  'high'
  'xhigh'
])
param reasoningEffort string = ''

@description('Reasoning summary mode for supported Foundry reasoning models. Only used when reasoningEffort is set.')
@allowed([
  ''
  'auto'
  'concise'
  'detailed'
])
param reasoningSummary string = 'concise'

@description('Connector Gateway location. Defaults to westcentralus because connector gateway preview features are known to work there while rollout continues.')
@allowed([
  'centralus'
  'eastus'
  'eastus2'
  'northcentralus'
  'southcentralus'
  'westcentralus'
  'westus'
])
param connectorGatewayLocation string = 'westcentralus'

@description('Optional managed identity client ID to use when authenticating to the Office 365 Outlook MCP server. Leave empty to use the app-wide identity selection.')
param o365McpClientId string = ''

var abbrs = {
  cognitiveServicesAccounts: 'cog-'
  insightsComponents: 'appi-'
  managedIdentityUserAssignedIdentities: 'id-'
  operationalInsightsWorkspaces: 'log-'
  resourcesResourceGroups: 'rg-'
  storageStorageAccounts: 'st'
  webServerFarms: 'plan-'
  webSitesFunctions: 'func-'
}
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }
var emailEnabled = !empty(toEmail)
var functionAppName = '${abbrs.webSitesFunctions}agents-${resourceToken}'
var foundryAccountName = 'cog-${resourceToken}'
var foundryProjectName = '${foundryAccountName}-proj'
var deploymentStorageContainerName = 'app-package-${take(functionAppName, 32)}-${take(toLower(uniqueString(functionAppName, resourceToken)), 7)}'
var deployerPrincipalId = deployer().objectId
var connectorGatewayName = 'cg-${resourceToken}'
var office365ConnectionName = 'office365-outlook'
var office365McpServerConfigName = 'o365-outlook-send-email-only'
var sessionPoolName = 'sessionpool${resourceToken}'
var reasoningAppSettings = !empty(reasoningEffort) ? {
  AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT: reasoningEffort
  AZURE_FUNCTIONS_AGENTS_REASONING_SUMMARY: empty(reasoningSummary) ? 'concise' : reasoningSummary
} : {}

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: '${abbrs.resourcesResourceGroups}${environmentName}'
  location: location
  tags: tags
}

module apiUserAssignedIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.4.1' = {
  name: 'apiUserAssignedIdentity'
  scope: rg
  params: {
    location: location
    tags: tags
    name: '${abbrs.managedIdentityUserAssignedIdentities}agents-${resourceToken}'
  }
}

module foundry './app/foundry.bicep' = {
  name: 'foundry'
  scope: rg
  params: {
    accountName: foundryAccountName
    projectName: foundryProjectName
    location: location
    tags: tags
    modelDeploymentName: foundryModel
    modelName: foundryModelName
    modelVersion: foundryModelVersion
    deploymentCapacity: foundryDeploymentCapacity
    managedIdentityPrincipalId: apiUserAssignedIdentity.outputs.principalId
    deployerPrincipalId: deployerPrincipalId
  }
}

module office365Connector './app/connector-gateway.bicep' = if (emailEnabled) {
  name: 'office365Connector'
  scope: rg
  params: {
    connectorGatewayName: connectorGatewayName
    connectionName: office365ConnectionName
    mcpServerConfigName: office365McpServerConfigName
    location: connectorGatewayLocation
    tags: tags
    managedIdentityPrincipalId: apiUserAssignedIdentity.outputs.principalId
    deployerPrincipalId: deployerPrincipalId
    tenantId: tenant().tenantId
  }
}

module appServicePlan 'br/public:avm/res/web/serverfarm:0.1.1' = {
  name: 'appserviceplan'
  scope: rg
  params: {
    name: '${abbrs.webServerFarms}${resourceToken}'
    sku: {
      name: 'FC1'
      tier: 'FlexConsumption'
    }
    reserved: true
    location: location
    tags: tags
  }
}

module api './app/api.bicep' = {
  name: 'api'
  scope: rg
  params: {
    name: functionAppName
    location: location
    tags: tags
    applicationInsightsName: monitoring.outputs.name
    appServicePlanId: appServicePlan.outputs.resourceId
    runtimeName: 'python'
    runtimeVersion: '3.13'
    storageAccountName: storage.outputs.name
    deploymentStorageContainerName: deploymentStorageContainerName
    identityId: apiUserAssignedIdentity.outputs.resourceId
    identityClientId: apiUserAssignedIdentity.outputs.clientId
    appSettings: union({
      AZURE_FUNCTIONS_AGENTS_PROVIDER: 'foundry'
      FOUNDRY_PROJECT_ENDPOINT: foundry.outputs.projectEndpoint
      FOUNDRY_MODEL: foundry.outputs.modelDeploymentName
      AZURE_CLIENT_ID: apiUserAssignedIdentity.outputs.clientId
      ACA_SESSION_POOL_ENDPOINT: sessionPool.outputs.poolManagementEndpoint
      TO_EMAIL: toEmail
      O365_MCP_SERVER_URL: emailEnabled ? office365Connector!.outputs.mcpEndpointUrl : ''
      O365_MCP_CLIENT_ID: o365McpClientId
      ENABLE_MULTIPLATFORM_BUILD: 'true'
    }, reasoningAppSettings)
  }
}

module storage 'br/public:avm/res/storage/storage-account:0.8.3' = {
  name: 'storage'
  scope: rg
  params: {
    name: '${abbrs.storageStorageAccounts}${resourceToken}'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    dnsEndpointType: 'Standard'
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    blobServices: {
      containers: [{ name: deploymentStorageContainerName }]
    }
    minimumTlsVersion: 'TLS1_2'
    location: location
    tags: tags
  }
}

module rbac './app/rbac.bicep' = {
  name: 'rbacAssignments'
  scope: rg
  params: {
    storageAccountName: storage.outputs.name
    appInsightsName: monitoring.outputs.name
    managedIdentityPrincipalId: apiUserAssignedIdentity.outputs.principalId
    deployerPrincipalId: deployerPrincipalId
  }
}

module sessionPool './app/session-pool.bicep' = {
  name: 'sessionPool'
  scope: rg
  params: {
    sessionPoolName: sessionPoolName
    location: location
    tags: tags
  }
}

module sessionPoolRbac './app/session-pool-rbac.bicep' = {
  name: 'sessionPoolRbac'
  scope: rg
  dependsOn: [sessionPool]
  params: {
    sessionPoolName: sessionPoolName
    managedIdentityPrincipalId: apiUserAssignedIdentity.outputs.principalId
    userPrincipalId: deployerPrincipalId
  }
}

module logAnalytics 'br/public:avm/res/operational-insights/workspace:0.7.0' = {
  name: '${uniqueString(deployment().name, location)}-loganalytics'
  scope: rg
  params: {
    name: '${abbrs.operationalInsightsWorkspaces}${resourceToken}'
    location: location
    tags: tags
    dataRetention: 30
  }
}

module monitoring 'br/public:avm/res/insights/component:0.4.1' = {
  name: '${uniqueString(deployment().name, location)}-appinsights'
  scope: rg
  params: {
    name: '${abbrs.insightsComponents}${resourceToken}'
    location: location
    tags: tags
    workspaceResourceId: logAnalytics.outputs.resourceId
    disableLocalAuth: true
  }
}

output AZURE_LOCATION string = location
output AZURE_FUNCTION_NAME string = api.outputs.SERVICE_API_NAME
output FOUNDRY_PROJECT_ENDPOINT string = foundry.outputs.projectEndpoint
output FOUNDRY_MODEL string = foundry.outputs.modelDeploymentName
output ACA_SESSION_POOL_ENDPOINT string = sessionPool.outputs.poolManagementEndpoint
output TO_EMAIL string = toEmail
output O365_CONNECTOR_GATEWAY_NAME string = emailEnabled ? office365Connector!.outputs.connectorGatewayName : ''
output O365_CONNECTION_ID string = emailEnabled ? office365Connector!.outputs.connectionId : ''
output O365_MCP_SERVER_URL string = emailEnabled ? office365Connector!.outputs.mcpEndpointUrl : ''
