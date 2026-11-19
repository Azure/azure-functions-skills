// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

param name string
param location string = resourceGroup().location
param tags object = {}
param databaseName string
param productsContainerName string
param leasesContainerName string
param managedIdentityPrincipalId string
@description('Optional user principal (the deployer) that adds and updates products with the demo script.')
param userPrincipalId string = ''

// Built-in Cosmos DB data-plane roles. These are not Azure RBAC roles; they are assigned
// with sqlRoleAssignments and work only because local (key) auth is disabled for everyone.
var dataReaderRoleId = '00000000-0000-0000-0000-000000000001'
var dataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      { name: 'EnableServerless' }
    ]
    disableLocalAuth: true
    disableKeyBasedMetadataWriteAccess: true
    publicNetworkAccess: 'Enabled'
    minimalTlsVersion: 'Tls12'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: account
  name: databaseName
  properties: {
    resource: { id: databaseName }
  }
}

// Monitored by the hosted skill's change feed trigger. The app can only read it.
resource productsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: productsContainerName
  properties: {
    resource: {
      id: productsContainerName
      partitionKey: { paths: [ '/id' ], kind: 'Hash' }
    }
  }
}

// Change feed checkpoints. Data-plane RBAC cannot create containers, so the trigger uses
// create_lease_container_if_not_exists: false and this container is provisioned here.
resource leasesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: leasesContainerName
  properties: {
    resource: {
      id: leasesContainerName
      partitionKey: { paths: [ '/id' ], kind: 'Hash' }
    }
  }
}

var containerScope = '${account.id}/dbs/${databaseName}/colls'

// Least privilege for the app: read-only on the monitored container, so the skill can never
// write back to it and start a trigger loop; read/write on the leases container.
var appAssignments = [
  { container: productsContainerName, role: dataReaderRoleId }
  { container: leasesContainerName, role: dataContributorRoleId }
]

// Cosmos DB processes role assignment writes on an account one at a time.
@batchSize(1)
resource appRoleAssignments 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = [for a in appAssignments: {
  parent: account
  name: guid(account.id, managedIdentityPrincipalId, a.container, a.role)
  properties: {
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/${a.role}'
    principalId: managedIdentityPrincipalId
    scope: '${containerScope}/${a.container}'
  }
  dependsOn: [
    productsContainer
    leasesContainer
  ]
}]

resource userRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = if (!empty(userPrincipalId)) {
  parent: account
  name: guid(account.id, userPrincipalId, dataContributorRoleId)
  properties: {
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/${dataContributorRoleId}'
    principalId: userPrincipalId
    scope: account.id
  }
  dependsOn: [
    appRoleAssignments
  ]
}

output name string = account.name
output endpoint string = account.properties.documentEndpoint
