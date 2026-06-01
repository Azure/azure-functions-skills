param connectorGatewayName string
param connectionName string = 'office365-outlook'
param triggerConfigName string = 'Office-365-Outlook-on-new-email'
@secure()
param callbackUrl string
param triggerOperationName string = 'OnNewEmailV3'
param folderPath string = ''
param recipientFilterEmail string = ''
param recurrenceFrequency string = ''
param recurrenceInterval string = ''

var triggerParameters = concat(
  empty(folderPath) ? [] : [
    {
      name: 'folderPath'
      value: folderPath
    }
  ],
  empty(recipientFilterEmail) ? [] : [
    {
      name: 'to'
      value: recipientFilterEmail
    }
  ]
)

var triggerMetadata = empty(recurrenceFrequency) || empty(recurrenceInterval) ? {} : {
  metadata: {
    recurrenceFrequency: recurrenceFrequency
    recurrenceInterval: recurrenceInterval
  }
}

#disable-next-line BCP081
resource connectorGateway 'Microsoft.Web/connectorGateways@2026-05-01-preview' existing = {
  name: connectorGatewayName
}

#disable-next-line BCP081
resource connectorTriggerConfig 'Microsoft.Web/connectorGateways/triggerconfigs@2026-05-01-preview' = {
  parent: connectorGateway
  name: triggerConfigName
  properties: union({
    state: 'Enabled'
    description: 'Invokes an Azure Function when a connector event arrives.'
    connectionDetails: {
      connectorName: 'office365'
      connectionName: connectionName
    }
    operationName: triggerOperationName
    parameters: triggerParameters
    notificationDetails: {
      callbackUrl: callbackUrl
      httpMethod: 'POST'
    }
  }, triggerMetadata)
}

output triggerConfigId string = connectorTriggerConfig.id
