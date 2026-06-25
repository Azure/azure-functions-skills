param connectorGatewayName string
param connectionName string = 'office365-outlook'
param mcpServerConfigName string = 'o365-outlook-send-email-only'
param location string = resourceGroup().location
param tags object = {}
param managedIdentityPrincipalId string
param deployerPrincipalId string
param tenantId string

#disable-next-line BCP081
resource connectorGateway 'Microsoft.Web/connectorGateways@2026-05-01-preview' = {
  name: connectorGatewayName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {}
}

#disable-next-line BCP081
resource office365Connection 'Microsoft.Web/connectorGateways/connections@2026-05-01-preview' = {
  parent: connectorGateway
  name: connectionName
  properties: {
    connectorName: 'office365'
    displayName: 'Office 365 Outlook Connection'
  }
}

#disable-next-line BCP081
resource office365ConnectionAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = {
  parent: office365Connection
  name: managedIdentityPrincipalId
  properties: {
    principal: {
      type: 'ActiveDirectory'
      identity: {
        objectId: managedIdentityPrincipalId
        tenantId: tenantId
      }
    }
  }
}

#disable-next-line BCP081
resource office365ConnectionDeployerAccessPolicy 'Microsoft.Web/connectorGateways/connections/accessPolicies@2026-05-01-preview' = {
  parent: office365Connection
  name: deployerPrincipalId
  properties: {
    principal: {
      type: 'ActiveDirectory'
      identity: {
        objectId: deployerPrincipalId
        tenantId: tenantId
      }
    }
  }
}

#disable-next-line BCP081
resource office365McpServerConfig 'Microsoft.Web/connectorGateways/mcpserverconfigs@2026-05-01-preview' = {
  parent: connectorGateway
  name: mcpServerConfigName
  properties: {
    state: 'Enabled'
    description: 'Office 365 Outlook send-email action for the serverless agents quickstart.'
    connectors: [
      {
        name: 'office365'
        connectionName: office365Connection.name
        displayName: 'Office 365 Outlook'
        description: ''
        operations: [
          {
            name: 'SendEmailV2'
            displayName: 'Send an email'
            description: 'This operation sends an email message.'
            userParameters: []
            agentParameters: [
              {
                name: 'emailMessage'
                schema: {
                  type: 'object'
                  properties: {
                    To: {
                      type: 'string'
                      format: 'email'
                      description: 'Specify email addresses separated by semicolons like someone@contoso.com'
                      required: true
                    }
                    Subject: {
                      type: 'string'
                      description: 'Specify the subject of the mail'
                      required: true
                    }
                    Body: {
                      type: 'string'
                      format: 'html'
                      description: 'Specify the body of the mail'
                      required: true
                    }
                  }
                }
              }
            ]
          }
        ]
      }
    ]
    policies: []
    settings: {
      textOnlyContent: true
    }
  }
}

output connectorGatewayName string = connectorGateway.name
output connectionId string = office365Connection.id
output connectionAccessPolicyId string = office365ConnectionAccessPolicy.id
output deployerConnectionAccessPolicyId string = office365ConnectionDeployerAccessPolicy.id
output mcpEndpointUrl string = office365McpServerConfig.properties.mcpEndpointUrl
