// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

param name string
param location string = resourceGroup().location
param tags object = {}
param storageAccountName string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource systemTopic 'Microsoft.EventGrid/systemTopics@2022-06-15' = {
  name: name
  location: location
  tags: tags
  properties: {
    source: storageAccount.id
    topicType: 'Microsoft.Storage.StorageAccounts'
  }
}

output name string = systemTopic.name
