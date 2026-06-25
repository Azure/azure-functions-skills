# Connector Triggers

Use this reference when a Connector Namespace event should start an agent, such as new email,
Teams messages, or SharePoint/OneDrive changes when supported by the connector operation.

Connector triggers use the Azure Functions Connector Extension. For Python and other non-.NET
languages, the extension is included in the preview extension bundle. No Python `connectors` extra
is required for an agent that receives the raw trigger payload.

## host.json

Use this `host.json` bundle when an app has a connector-triggered agent:

```json
{
  "version": "2.0",
  "functionTimeout": "00:30:00",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle.Preview",
    "version": "[4.42.0, 5.0.0)"
  }
}
```

The Connector Extension is in the latest preview bundle. Connector-triggered agents are background
work, so set the agent runtime timeout to `1800` seconds by default and keep `host.json`
`functionTimeout` at least as long.

## Agent Frontmatter

The current sample pattern uses `generic_trigger` and passes the connector binding type through
`trigger.args`:

```yaml
trigger:
  type: generic_trigger
  args:
    type: connectorTrigger
```

The runtime also accepts `connector_trigger` when the installed Azure Functions package exposes a
native decorator, but `generic_trigger` with `type: connectorTrigger` matches the current Outlook
reply sample and works with the preview bundle.

## Deployment Flow

Connector trigger setup is two-phase:

1. Deploy the function app with the connector-triggered agent and preview extension bundle.
2. Get the `connector_extension` system key after the host starts.
3. Create the Connector Namespace trigger config with a callback URL that includes the function
   name and key.

Get the key:

```bash
key=$(az functionapp keys list \
  -g rg-$(azd env get-value AZURE_ENV_NAME) \
  -n "$(azd env get-value AZURE_FUNCTION_NAME)" \
  --query "systemKeys.connector_extension" -o tsv)
```

Callback URL shape:

```text
https://<function-app-name>.azurewebsites.net/runtime/webhooks/connector?functionName=<agent-function-name>&code=<connector_extension_key>
```

Create a trigger config with the scaffolded `trigger-config.bicep` asset:

```bash
az deployment group create \
  -g rg-$(azd env get-value AZURE_ENV_NAME) \
  --template-file infra/app/trigger-config.bicep \
  --parameters \
    connectorGatewayName="$(azd env get-value O365_CONNECTOR_GATEWAY_NAME)" \
    connectionName=office365-outlook \
    triggerConfigName=Office-365-Outlook-on-new-email \
    triggerOperationName=OnNewEmailV3 \
    folderPath=Inbox \
    callbackUrl="https://$(azd env get-value AZURE_FUNCTION_NAME).azurewebsites.net/runtime/webhooks/connector?functionName=OnNewEmail&code=${key}"
```

The callback URL contains a system key. Do not print or log full trigger config resources or
callback URLs.

## Discover Connector Trigger Operations

Use the Azure Functions Connector Extension operation mapping for trigger operation names and raw
payload guidance:

```text
https://github.com/Azure/azure-functions-connector-extension/blob/main/docs/operations-functions-match.md
```

You can also query managed API operation metadata. This is useful for finding operation names such
as `OnNewEmailV3`, `OnUpcomingEventsV3`, and Teams trigger names:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
LOCATION="westcentralus"
CONNECTOR_NAME="office365"

az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Web/locations/$LOCATION/managedApis/$CONNECTOR_NAME/apiOperations?api-version=2016-06-01" \
  --query "value[?properties.trigger != null].{name:name,summary:properties.summary,trigger:properties.trigger,visibility:properties.visibility}" \
  --output table
```

The managed API operation list helps choose `triggerOperationName` for `trigger-config.bicep`.
For operation-specific trigger config parameters, such as `folderPath` for `OnNewEmailV3`, inspect
the exported Swagger first with `managedApis/<connector>?export=true`. If the exported Swagger
references `x-ms-dynamic-values` or `x-ms-dynamic-schema`, use `dynamicInvoke` on an authorized
Connector Namespace connection to resolve those dynamic fields for the selected values. See
[connector-schemas.md](./connector-schemas.md) for exported Swagger and `dynamicInvoke` commands.

The ARM operation metadata is not a full trigger configuration schema. In testing,
`apiOperations/{operationName}` returned the operation name, summary, trigger type, docs URL, and
metadata, but not the trigger config parameter definitions. The older `listSwagger` action for
managed APIs can be blocked for this resource provider surface. Use the managed API operation list
to avoid hardcoding operation names, then use `export=true` and `dynamicInvoke` to determine
operation-specific parameters. Fall back to connector docs, existing trigger configs, or the portal
only when those API surfaces do not expose enough schema.

When a trigger config already exists, you can inspect the parameter names safely without printing
the callback URL:

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/connectorGateways/$CONNECTOR_GATEWAY/triggerconfigs/$TRIGGER_CONFIG_NAME?api-version=$API_VERSION" \
  --query "properties.{operationName:operationName,connectionDetails:connectionDetails,parameters:parameters,metadata:metadata,notificationMethod:notificationDetails.httpMethod,hasCallback:notificationDetails.callbackUrl != null}" \
  --output jsonc
```
