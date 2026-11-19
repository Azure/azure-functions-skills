// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

param namespaceName string
param queueName string
param location string = resourceGroup().location
param tags object = {}
param managedIdentityPrincipalId string
param userPrincipalId string = ''

var serviceBusDataReceiverRoleId = '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'
var serviceBusDataSenderRoleId = '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'

resource namespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: namespaceName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
  }
}

resource queue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: namespace
  name: queueName
  properties: {
    // Hosted skill runs can take minutes; the Functions host renews the lock while it runs.
    lockDuration: 'PT5M'
    maxDeliveryCount: 5
    deadLetteringOnMessageExpiration: true
  }
}

resource appReceiverRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(namespace.id, managedIdentityPrincipalId, serviceBusDataReceiverRoleId)
  scope: namespace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataReceiverRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource userSenderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(userPrincipalId)) {
  name: guid(namespace.id, userPrincipalId, serviceBusDataSenderRoleId)
  scope: namespace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataSenderRoleId)
    principalId: userPrincipalId
    principalType: 'User'
  }
}

resource userReceiverRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(userPrincipalId)) {
  name: guid(namespace.id, userPrincipalId, serviceBusDataReceiverRoleId)
  scope: namespace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataReceiverRoleId)
    principalId: userPrincipalId
    principalType: 'User'
  }
}

output fullyQualifiedNamespace string = '${namespace.name}.servicebus.windows.net'
