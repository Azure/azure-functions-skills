param accountName string
param projectName string
param location string = resourceGroup().location
param tags object = {}
param modelDeploymentName string = 'gpt-4.1'
param modelName string = 'gpt-4.1'
param modelVersion string = '2025-04-14'
param deploymentCapacity int = 50
param managedIdentityPrincipalId string
param deployerPrincipalId string = ''

var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var cognitiveServicesOpenAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-10-01-preview' = {
  name: accountName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  tags: tags
  properties: {
    allowProjectManagement: true
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
  }
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-10-01-preview' = {
  parent: foundryAccount
  name: projectName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: projectName
    description: 'Serverless agents quickstart project'
  }
}

resource foundryModelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: modelDeploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: deploymentCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

resource foundryCognitiveServicesUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, managedIdentityPrincipalId, cognitiveServicesUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryOpenAiUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, managedIdentityPrincipalId, cognitiveServicesOpenAiUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAiUserRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryDeployerCognitiveServicesUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(foundryAccount.id, deployerPrincipalId, cognitiveServicesUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

resource foundryDeployerOpenAiUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(foundryAccount.id, deployerPrincipalId, cognitiveServicesOpenAiUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAiUserRoleId)
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

output accountName string = foundryAccount.name
output projectName string = foundryProject.name
output projectEndpoint string = '${foundryAccount.properties.endpoints['AI Foundry API']}api/projects/${foundryProject.name}'
output modelDeploymentName string = foundryModelDeployment.name
