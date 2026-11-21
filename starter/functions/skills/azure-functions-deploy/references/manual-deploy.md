# Manual deployment steps

Use these steps when the deployment script cannot run or does not support the project. They follow the Azure Functions documentation:

- [Deployment technologies in Azure Functions](https://learn.microsoft.com/azure/azure-functions/functions-deployment-technologies)
- [Create and manage function apps in a Flex Consumption plan](https://learn.microsoft.com/azure/azure-functions/flex-consumption-how-to)

Rules for every path:

- Ask the user to approve before any command that creates, changes, or deploys to an Azure resource.
- Do not choose a subscription, region, or resource name for the user.
- Do not print connection strings, keys, or tokens. Do not read function keys to test an endpoint unless the user asks.
- Test HTTP triggers with GET, not HEAD.

## Choose a path

| Situation | Path |
| --- | --- |
| The project has `azure.yaml` and `infra/` | [A. azd project](#a-azd-project) |
| A function app already exists and only the code changes | [B. Publish code to an existing app](#b-publish-code-to-an-existing-app) |
| No infrastructure files and no function app | [C. Create a Flex Consumption app with the Azure CLI](#c-create-a-flex-consumption-app-with-the-azure-cli) |
| Premium, Dedicated, Container Apps, deployment slots, CI/CD pipelines | Follow the linked documentation. These are outside this skill. |

## A. azd project

Use this path when the script failed for a reason that is not in the project, or when Node is not available.

1. Check the sign-in state.

   ```bash
   azd auth login --check-status
   ```

2. Create the environment. Skip this when `.azure/<environment>/.env` exists.

   ```bash
   azd env new <environment> --subscription <subscription-id> --location <region>
   ```

3. Set each input that `infra/main.parameters.json` references as `${NAME}` and that has no default. The official quickstart templates need `VNET_ENABLED`.

   ```bash
   azd env set VNET_ENABLED false -e <environment>
   ```

4. Provision and deploy.

   ```bash
   azd provision -e <environment> --no-prompt
   azd deploy -e <environment> --no-prompt
   ```

   `--no-prompt` makes azd fail when a value is missing instead of waiting for input. Read the error, set the value, and run the command again.

5. Verify with [Verify](#verify).

## B. Publish code to an existing app

Run from the project root, the folder that contains `host.json`.

```bash
func azure functionapp publish <APP_NAME>
```

Core Tools requests a remote build for Python apps. For an azd project, use `azd deploy -e <environment> --no-prompt` instead.

## C. Create a Flex Consumption app with the Azure CLI

1. List the regions that support Flex Consumption and let the user choose.

   ```bash
   az functionapp list-flexconsumption-locations --query "sort_by(@, &name)[].{Region:name}" -o table
   ```

2. Create the resource group and the storage account.

   ```bash
   az group create --name <RESOURCE_GROUP> --location <REGION>
   az storage account create --name <STORAGE_NAME> --location <REGION> --resource-group <RESOURCE_GROUP> --sku Standard_LRS --allow-blob-public-access false
   ```

3. Create the function app. Set `--runtime` and `--runtime-version` to match the project.

   ```bash
   az functionapp create --resource-group <RESOURCE_GROUP> --name <APP_NAME> --storage-account <STORAGE_NAME> --flexconsumption-location <REGION> --runtime <RUNTIME> --runtime-version <VERSION>
   ```

   | Language | `--runtime` |
   | --- | --- |
   | C# (isolated worker) | `dotnet-isolated` |
   | JavaScript, TypeScript | `node` |
   | Python | `python` |
   | Java | `java` |
   | PowerShell | `powershell` |
   | Go (preview) | `go`, with `--runtime-version 1.0 --functions-version 4` |

4. Publish the code with [path B](#b-publish-code-to-an-existing-app).

The documentation recommends a managed identity for the storage connection in production. Follow the Flex Consumption article for those steps.

## Go apps

Go is in public preview. Confirm that the user accepts preview status before a production deployment.

- Go apps run only on the Flex Consumption plan and only on Linux.
- `FUNCTIONS_WORKER_RUNTIME` must be `native`.
- Core Tools 4.12 or later builds and packages the app. Azure CLI 2.87.0 or later is required to create resources or deploy packages.

| Command | What it does |
| --- | --- |
| `func azure functionapp publish <APP_NAME>` | Builds, packages, and deploys to an existing function app. |
| `func pack` | Builds for Linux x64 and writes a zip with the binary at the package root as `app`. Deploy it with `az functionapp deployment source config-zip`. Do not request a remote build for this package. |

Do not assemble the archive by hand. Some tools, such as Windows `Compress-Archive`, drop the Unix executable permission, and the platform then cannot start the binary.

Reference: https://learn.microsoft.com/azure/azure-functions/functions-reference-go

## Verify

```bash
az functionapp show --name <APP_NAME> --resource-group <RESOURCE_GROUP> --query "{state:state, host:defaultHostName}" -o json
az functionapp function list --name <APP_NAME> --resource-group <RESOURCE_GROUP> --query "[].{name:name, url:invokeUrlTemplate}" -o table
```

The function list can be empty for a minute after a deployment. Check again before you report a failure. Send one GET request to each anonymous HTTP trigger.

## When azd shows no progress

`azd` draws progress with a spinner that agent terminals may not capture. Do not stop the command because the output looks stuck. Check the deployment from another terminal:

```bash
az deployment sub list --query "[].{name:name, state:properties.provisioningState}" -o table
az functionapp list --resource-group <RESOURCE_GROUP> --query "[].{name:name, state:state}" -o table
```
