# Authoring Mode (R1 / R2 writes)

Read [core/ARM-CORE.md](core/ARM-CORE.md) and [core/COMMON-CLI.md](core/COMMON-CLI.md) first.
For code deployment also read [core/SCM-CORE.md](core/SCM-CORE.md).

## Write protocol (every change)

1. Resolve the app and classify its plan (ARM-CORE).
2. Read the current state with the matching Inspection request.
3. Present: target resource ID, plan, risk tier, a before/after diff (secrets as `***`), side
   effects (for example "changing app settings restarts the app"), and the rollback step.
4. Wait for explicit approval of that exact change. R2 also needs the impact statement.
5. Make the call. Handle `202` per ARM-CORE.
6. Read back and show the verified result. If verification differs, say so; do not retry blindly.

## App settings (R1; R2 when removing or replacing values)

Use the tool. It reads the full collection, merges, writes it once, verifies, and never prints values:

```bash
node <skill-dir>/scripts/functions-app.mjs settings set --app <app> --set MODE=blue                       # plan (exit 5)
node <skill-dir>/scripts/functions-app.mjs settings set --app <app> --set MODE=blue --approve
node <skill-dir>/scripts/functions-app.mjs settings set --app <app> --name DB_PASSWORD --value-file - --approve   # secret via stdin
node <skill-dir>/scripts/functions-app.mjs settings set --app <app> --name DB --value "@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/<name>)" --approve
node <skill-dir>/scripts/functions-app.mjs settings delete --app <app> --name MODE --approve
```

- Add `--slot <name>` for a slot. Any app setting change restarts the app.
- New Key Vault references are checked; an unresolved one is reported as
  `KeyVaultReferenceUnresolved` (grant the app identity "Key Vault Secrets User", separate approval).
- Prefer identity-based connections (`<Prefix>__accountName`, `<Prefix>__credential`,
  `<Prefix>__clientId`) and Key Vault references over secrets. If the user supplies a raw secret,
  offer a Key Vault reference first.
- On Flex Consumption the tool rejects settings that the plan does not use
  (`WEBSITE_RUN_FROM_PACKAGE`, `WEBSITE_CONTENTSHARE`, `FUNCTIONS_WORKER_RUNTIME`, and others).

REST fallback (only if the tool exits 3 or 1): `POST {site}/config/appsettings/list?{av}` →
merge only the requested changes → `PUT {site}/config/appsettings?{av}` with
`{"properties": { <full merged map> }}`. The PUT replaces every setting; never send only the
changed keys. The list response is unredacted; never print it.

- Slot-sticky names (R2, replaces the whole object): `GET {site}/config/slotConfigNames?{av}`,
  then `PUT {site}/config/slotConfigNames?{av}` with the full merged object. Keep every returned
  collection, including `appSettingNames`, `connectionStringNames`, and `azureStorageConfigNames`:
  `{"properties":{"appSettingNames":[...],"connectionStringNames":[...],"azureStorageConfigNames":[...]}}`.
  `slotConfigNames` belongs to the production site, not the slot.

## Connection strings (R1)

`settings set --app <app> --connection-string --name <n> --value-file - --type SQLAzure --approve`
and `settings delete ... --connection-string`. Types: Custom, SQLAzure, SQLServer, MySql,
PostgreSQL, RedisCache, DocDb, ServiceBus, EventHub, NotificationHub, ApiHub. REST fallback is
the same pattern with `config/connectionstrings` and `{"<name>":{"value":"...","type":"Custom"}}`
entries. Prefer app settings with identity-based connections for Functions bindings.

## Enable or disable one function (R1)

`settings set --app <app> --set AzureWebJobs.<FunctionName>.Disabled=true --approve` (disable);
`settings delete --app <app> --name AzureWebJobs.<FunctionName>.Disabled --approve` (enable).
This restarts the app. Verify with `functions list` → `isDisabled`.

## Site configuration and CORS (R1)

`PATCH {site}/config/web?{av}` with only the changed properties, for example:

```json
{ "properties": { "cors": { "allowedOrigins": ["https://contoso.example"], "supportCredentials": false } } }
```

- `cors.allowedOrigins` is replaced as a whole list: read, merge, then send the full list.
- Other common properties: `minTlsVersion`, `ftpsState`, `http20Enabled`, `healthCheckPath`,
  `alwaysOn` (Dedicated only), `functionAppScaleLimit`, `minimumElasticInstanceCount` (Premium).
- Runtime version on non-Flex Linux apps is `linuxFxVersion` (for example `Python|3.12`); on Windows
  apps it is language specific (`netFrameworkVersion`, `powerShellVersion`, or app setting
  `WEBSITE_NODE_DEFAULT_VERSION`). On Flex Consumption it is `functionAppConfig.runtime` (below).
  A runtime change is R2: show the code compatibility risk.

## Flex Consumption scale and runtime (R1)

1. `GET {site}?{av}` → copy the full `properties.functionAppConfig` object.
2. Change only the requested fields:
   - `scaleAndConcurrency.maximumInstanceCount`
   - `scaleAndConcurrency.instanceMemoryMB` (`512`, `2048`, or `4096`)
   - `scaleAndConcurrency.alwaysReady` (array of `{"name":"http"|"function:<name>"|"blob"|"durable","instanceCount":N}`)
   - `scaleAndConcurrency.triggers.http.perInstanceConcurrency`
   - `runtime.version` (R2)
3. `PATCH {site}?{av}` with `{"properties":{"functionAppConfig": <full modified object>}}`.

Always-ready instances are billed continuously; state that cost impact before approval.

## Premium and Dedicated scale (R1)

- Premium maximum burst: `PATCH <serverFarmId>?{av}` with `{"properties":{"maximumElasticWorkerCount":N}}`.
- Premium always-ready per app: `PATCH {site}/config/web?{av}` with `minimumElasticInstanceCount`.
- Dedicated instance count: `PATCH <serverFarmId>?{av}` with `{"sku":{"capacity":N}}` (cost impact).

## Managed identity (R1)

1. `GET {site}?{av}` → current `identity`.
2. Build the new `identity` keeping existing parts. Types: `SystemAssigned`, `UserAssigned`,
   `SystemAssigned, UserAssigned`, `None`. User-assigned identities go in
   `userAssignedIdentities` as `{"<uami resource id>": {}}`.
3. `PATCH {site}?{av}` with `{"identity": { ... }}`. Removing an identity is R2.

Role assignments for that identity are a separate Azure RBAC change. Describe the exact role,
scope, and principal, and get separate approval before you create one with
`PUT {scope}/providers/Microsoft.Authorization/roleAssignments/{new GUID}?api-version=2022-04-01`
and body `{"properties":{"roleDefinitionId":"<full role definition id>","principalId":"<principal id>","principalType":"ServicePrincipal"}}`.

## Keys (R2 for rotation or deletion)

| Action | Request |
| --- | --- |
| Create or regenerate a function key | `PUT {site}/functions/{functionName}/keys/{keyName}?{av}` body `{"name":"<keyName>"}` (no `properties` envelope; the service generates the value) |
| Delete a function key | `DELETE {site}/functions/{functionName}/keys/{keyName}?{av}` |
| Create or regenerate a host function key | `PUT {site}/host/default/functionKeys/{keyName}?{av}` body `{"name":"<keyName>"}` |
| Delete a host function key | `DELETE {site}/host/default/functionKeys/{keyName}?{av}` |

- Regenerating a key breaks every caller that uses the old value. Ask who uses it first.
- Do not supply key values yourself unless the user provides one; then send it as top-level
  `"value"` next to `"name"`. Never echo the new value; tell
  the user how to read it (Inspection "Functions, triggers, and keys").
- Master key and system key rotation are not supported by this skill.

## Deployment slots (R1 create, R2 delete)

Flex Consumption and Linux Consumption do not support slots. Check the plan first.

- Create: `PUT {site}/slots/{slot}?{av}` with `{"location":"<app location>","properties":{"serverFarmId":"<app serverFarmId>"}}`.
  Then copy needed app settings to the slot with the app settings procedure on `{slotSite}`.
- Delete: `DELETE {site}/slots/{slot}?{av}` (R2).
- Swap is Operations mode.

## Deploy code (R1 to a slot, R2 to production)

1. Build the package for the language (for example `dotnet publish`, `npm ci && npm run build`,
   `pip install --target .python_packages/lib/site-packages -r requirements.txt` for non-remote
   builds). If the project uses Core Tools, `func pack` creates the package.
2. Zip the **contents** of the output folder so `host.json` is at the zip root. Do not include
   `local.settings.json`, `.env`, `.git`, or test folders.
3. Deploy by plan (SCM-CORE endpoints):

| Plan | Steps |
| --- | --- |
| Flex Consumption | `POST https://<scm-host>/api/publish?RemoteBuild=<true for Python source, else false>&Deployer=azure_functions_skills` |
| Premium, Dedicated, Windows Consumption | Ensure app setting `WEBSITE_RUN_FROM_PACKAGE=1` (app settings procedure, separate approval if missing), then `POST https://<scm-host>/api/zipdeploy?isAsync=true&Deployer=azure_functions_skills` |
| Linux Consumption (legacy) | Not supported by this skill. Recommend migrating to Flex Consumption. |
| Container Apps hosting | Not code deployment. Out of scope for this skill. |

4. Poll until this upload's deployment is complete (SCM-CORE "Track the deployment").
5. Verify: `GET {site}/functions?{av}` lists the expected functions, and Inspection "Health"
   host status is `Running`. If functions are missing, run Operations "Sync triggers" once
   (approval required), then check the deployment log.

If the project already has `azure.yaml` and the user prefers azd, `azd deploy` / `azd up` is an
acceptable alternative. Follow the telemetry rule in `SKILL.md` after a successful `azd up` or
`azd provision`.

## Create a new Function App (R1, cost impact)

Create infrastructure with an ARM deployment through REST. Do not hand-assemble individual
storage, plan, site, and role PUTs.

1. Get a template:
   - Preferred: the project's existing `infra/` Bicep or ARM template.
   - Otherwise: an official Azure Functions sample template that matches the language and plan
     (Flex Consumption by default), for example from the `Azure-Samples` Functions quickstart
     repositories. Tell the user which template you used.
   - Compile Bicep locally to ARM JSON with `bicep build <file> --stdout` or `az bicep build`.
2. Pick the deployment scope from the template's `$schema`:

| `$schema` ends with | Scope `{scope}` | Body | Resource group |
| --- | --- | --- | --- |
| `deploymentTemplate.json` | `/subscriptions/{sub}/resourcegroups/{rg}` | `{"properties":{...}}` | Create first if needed: `PUT /subscriptions/{sub}/resourcegroups/{rg}?api-version=2024-03-01` with `{"location":"<region>"}` |
| `subscriptionDeploymentTemplate.json` (Bicep `targetScope = 'subscription'`, used by the azd quickstarts) | `/subscriptions/{sub}` | `{"location":"<region>","properties":{...}}`; top-level `location` is required | Created by the template; do not pre-create it |

   `properties` is `{"mode":"Incremental","template":<json>,"parameters":{"<name>":{"value":...}}}`.
   azd quickstarts usually need `environmentName`, `location`, and `principalId` (the signed-in
   user's object ID: `GET https://graph.microsoft.com/v1.0/me?$select=id`). Set `vnetEnabled`
   explicitly when the template has it and tell the user the cost difference.
3. Validate: `POST {scope}/providers/Microsoft.Resources/deployments/{deploymentName}/validate?api-version=2024-03-01`.
4. Preview: `POST {scope}/providers/Microsoft.Resources/deployments/{deploymentName}/whatIf?api-version=2024-03-01`
   with the same body. Show created/modified/deleted resources and estimated cost drivers. Get
   approval.
5. Deploy: `PUT {scope}/providers/Microsoft.Resources/deployments/{deploymentName}?api-version=2024-03-01`
   with the same body. Poll `GET` on the same URL until `properties.provisioningState` is
   terminal.
6. Read `properties.outputs`, resolve the new app, then deploy code as above. ARM may change the
   case of output names (for example `AZURE_FUNCTION_NAME` returns as `azurE_FUNCTION_NAME`);
   match output names case-insensitively.

`validate` and `whatIf` usually return `202` with an empty body and a `Location` header.
`az rest` does not follow it: capture the header (`--verbose` prints response headers) and poll
it per ARM-CORE until it returns `200`. Results can be hundreds of KB (the template is echoed
back), so write them with `--output-file` and parse the file rather than printing them.

Never use `"mode":"Complete"`; it deletes resources that are not in the template.

## Delete a Function App (R2)

`DELETE {site}?{av}&deleteMetrics=false&deleteEmptyServerFarm=false`. Always send
`deleteEmptyServerFarm=false`: the service default deletes the plan when it becomes empty. State
that code, settings, keys, and slots are deleted and that the plan, storage account, and
Application Insights remain. Deleting the plan is a separate R2 request with its own approval.
Require the user to type the app name to confirm.
