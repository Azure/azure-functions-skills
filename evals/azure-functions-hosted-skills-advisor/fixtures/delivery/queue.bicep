param namespaceName string

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' existing = {
  name: namespaceName
}

resource ingestion 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = {
  parent: serviceBus
  name: 'data-ingestion'
  properties: {
    maxDeliveryCount: 3
  }
}
