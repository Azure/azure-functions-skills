param sessionPoolName string
param managedIdentityPrincipalId string
param userPrincipalId string = ''

var sessionExecutorRoleId = '0fb8eba5-a2bb-4abe-b1c1-49dfad359bb0'

resource sessionPool 'Microsoft.App/sessionPools@2025-01-01' existing = {
  name: sessionPoolName
}

resource sessionPoolRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(sessionPool.id, managedIdentityPrincipalId, sessionExecutorRoleId)
  scope: sessionPool
  properties: {
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', sessionExecutorRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource sessionPoolUserRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(userPrincipalId)) {
  name: guid(sessionPool.id, userPrincipalId, sessionExecutorRoleId)
  scope: sessionPool
  properties: {
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', sessionExecutorRoleId)
    principalId: userPrincipalId
    principalType: 'User'
  }
}
