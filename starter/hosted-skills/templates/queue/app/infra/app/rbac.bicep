// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

param storageAccountName string
param appInsightsName string
param managedIdentityPrincipalId string
param userPrincipalId string = ''

var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

var appStorageRoles = [
  storageBlobDataOwnerRoleId
  storageQueueDataContributorRoleId
  storageTableDataContributorRoleId
]

// The deployer sends sample messages and reads recommendations with the demo script.
var userStorageRoles = [
  storageBlobDataContributorRoleId
  storageQueueDataContributorRoleId
]

resource storageAccount 'Microsoft.Storage/storageAccounts@2022-09-01' existing = {
  name: storageAccountName
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource appStorageRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for roleId in appStorageRoles: {
  name: guid(storageAccount.id, managedIdentityPrincipalId, roleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}]

resource userStorageRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for roleId in userStorageRoles: if (!empty(userPrincipalId)) {
  name: guid(storageAccount.id, userPrincipalId, roleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
    principalId: userPrincipalId
    principalType: 'User'
  }
}]

resource appInsightsRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(applicationInsights.id, managedIdentityPrincipalId, monitoringMetricsPublisherRoleId)
  scope: applicationInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}
