param sessionPoolName string
param location string
param tags object = {}

resource sessionPool 'Microsoft.App/sessionPools@2025-01-01' = {
  name: sessionPoolName
  location: location
  tags: tags
  properties: {
    containerType: 'PythonLTS'
    poolManagementType: 'Dynamic'
    dynamicPoolConfiguration: {
      lifecycleConfiguration: {
        lifecycleType: 'Timed'
        cooldownPeriodInSeconds: 300
      }
    }
    scaleConfiguration: {
      maxConcurrentSessions: 100
      readySessionInstances: 0
    }
    sessionNetworkConfiguration: {
      status: 'EgressEnabled'
    }
  }
}

output sessionPoolId string = sessionPool.id
output poolManagementEndpoint string = sessionPool.properties.poolManagementEndpoint
