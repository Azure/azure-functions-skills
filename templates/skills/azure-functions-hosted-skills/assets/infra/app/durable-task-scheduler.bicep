@description('Name of the new scheduler dedicated to this approved app/environment.')
@minLength(3)
@maxLength(64)
param schedulerName string

param location string = resourceGroup().location
param tags object = {}

@description('Task hub isolated from other apps and environments.')
@minLength(3)
@maxLength(64)
param taskHubName string = 'workflows'

@allowed([
  'Consumption'
  'Dedicated'
])
param schedulerSku string = 'Consumption'

param managedIdentityPrincipalId string
param managedIdentityClientId string

@description('Optional user object ID for approved local Azure runs and dashboard access.')
param deployerPrincipalId string = ''

var contributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0ad04412-c4d5-4796-b79c-f76d14c8d402'
)

resource scheduler 'Microsoft.DurableTask/schedulers@2026-02-01' = {
  name: schedulerName
  location: location
  tags: tags
  properties: {
    publicNetworkAccess: 'Enabled'
    ipAllowlist: []
    sku: union({
      name: schedulerSku
    }, schedulerSku == 'Dedicated' ? { capacity: 1 } : {})
  }
}

resource taskHub 'Microsoft.DurableTask/schedulers/taskHubs@2026-02-01' = {
  parent: scheduler
  name: taskHubName
  properties: {}
}

resource appContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(taskHub.id, managedIdentityPrincipalId, contributorRoleDefinitionId)
  scope: taskHub
  properties: {
    roleDefinitionId: contributorRoleDefinitionId
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(taskHub.id, deployerPrincipalId, contributorRoleDefinitionId)
  scope: taskHub
  properties: {
    roleDefinitionId: contributorRoleDefinitionId
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

output appSettings object = {
  DURABLE_TASK_SCHEDULER_CONNECTION_STRING: 'Endpoint=${scheduler.properties.endpoint};Authentication=ManagedIdentity;ClientID=${managedIdentityClientId}'
  TASKHUB_NAME: taskHub.name
}
output schedulerEndpoint string = scheduler.properties.endpoint
output hubName string = taskHub.name
output dashboardUrl string = 'https://dashboard.durabletask.io/?endpoint=${uriComponent(scheduler.properties.endpoint)}&taskhub=${uriComponent(taskHub.name)}'
