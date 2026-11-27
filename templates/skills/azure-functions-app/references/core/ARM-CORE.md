# ARM Core

REST rules for Azure Resource Manager calls made by `azure-functions-app`.
CLI translation (bash and PowerShell) is in [COMMON-CLI.md](COMMON-CLI.md).

## Endpoint and api-version

- Base URL: `https://management.azure.com`
- `Microsoft.Web` (sites, slots, plans, functions, keys, config, detectors): **`api-version=2024-11-01`**.
  Use this version for every `Microsoft.Web` call. Do not mix versions within one task.
- Other providers used by this skill:

| Provider | api-version |
| --- | --- |
| `Microsoft.ResourceGraph/resources` | `2022-10-01` |
| `Microsoft.ResourceHealth/availabilityStatuses` | `2022-10-01` |
| `Microsoft.Insights/metrics` | `2023-10-01` |
| `Microsoft.Insights/eventtypes/management/values` (Activity Log) | `2015-04-01` |
| `Microsoft.Resources/deployments` | `2024-03-01` |

Abbreviations used in every reference:

- `{site}` = `/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{app}`
- `{slotSite}` = `{site}/slots/{slot}`. Every site-level path below also works under `{slotSite}`
  unless a reference says otherwise.
- `{av}` = `api-version=2024-11-01`

## Authentication

- Use the signed-in Azure CLI identity. `az rest` attaches the ARM token automatically.
- For `curl`, get a token with `az account get-access-token --resource https://management.azure.com`.
- Never print tokens. Never write them to files in the repository.
- On 401, ask the user to run `az login` (or `az login --tenant <tenant>`). Do not retry silently.
- On 403, report the missing permission (for example `Microsoft.Web/sites/config/list/action`)
  and the user's need for a role such as Website Contributor. Do not try another identity.

## Resolve the target app (always first)

1. If the user gave a full resource ID, use it after one GET to confirm it exists and is a
   Function App (`kind` contains `functionapp`).
2. Otherwise, query Azure Resource Graph across all accessible subscriptions:

```http
POST https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01
Content-Type: application/json

{
  "query": "Resources | where type =~ 'microsoft.web/sites' and kind contains 'functionapp' and name =~ '<app-name>' | project id, name, resourceGroup, subscriptionId, location, kind, sku=properties.sku, state=properties.state"
}
```

3. Exactly one result: use it. Zero results: report it and ask for the subscription or exact name.
   More than one result: show the candidates and ask the user to choose. Never pick one.
4. To list apps without a name, drop the `name =~` filter and add `| order by name asc | take 50`.
5. Escape single quotes in names by doubling them. Reject names containing characters outside
   `[A-Za-z0-9-]` before inserting them into a query.

Record the resolved `subscriptionId`, `resourceGroup`, `name`, and `id`; reuse them for every call.

## Plan detection

Read `{site}` and its `properties.serverFarmId` plan. Classify:

| Signal | Plan |
| --- | --- |
| `properties.functionAppConfig` present, or plan `sku.name` = `FC1` | Flex Consumption |
| plan `sku.tier` = `Dynamic` (`Y1`) | Consumption (legacy) |
| plan `sku.tier` = `ElasticPremium` (`EP1`-`EP3`) | Premium |
| `properties.managedEnvironmentId` present | Azure Container Apps hosting |
| anything else | Dedicated (App Service) |

`kind` containing `linux` means Linux. Several operations differ by plan; references say where.

## Long-running operations

- `200`/`201`/`204`: done. Read the resource back to verify.
- `202 Accepted`: poll `Azure-AsyncOperation` if present, otherwise `Location`, with GET every
  `Retry-After` seconds (default 10). Stop at a terminal status (`Succeeded`, `Failed`, `Canceled`)
  or after 15 minutes, and report the last state. `az rest` does not poll for you.

## Retries and errors

- Reads (`GET`, and `POST .../list*` or query calls): retry `429`, `500`, `502`, `503`, `504`,
  at most 3 times, honoring `Retry-After`.
- Writes: retry automatically only on `429` (the request was not processed). After a `5xx` or a
  timeout the write may have succeeded. Re-read the state first; if the change is not there, get
  approval again before repeating it. Never auto-repeat non-idempotent actions (swap, restart,
  stop, key regeneration, function run, deploy).
- Never retry a write that returned `4xx` other than `429`. Report `error.code` and `error.message`.
- `409 Conflict` on a site often means another operation is in progress. Wait and re-read state,
  then ask before retrying the write.
- `404` on `{site}`: re-run resolution; the app may be in another subscription or deleted.

## Write discipline

- `PUT .../config/appsettings` and `PUT .../config/connectionstrings` **replace the whole
  collection**. Always: list (POST `.../list`) → merge the change → PUT the full collection.
- Prefer `PATCH {site}` and `PATCH {site}/config/web` with only the changed properties.
- For JSON bodies, write the body to a temporary file outside the repository and pass it with
  `--body @<file>`. Delete the file after the call; it may contain secrets.
- After every write, GET the resource again and show the verified value (redacted when secret).
