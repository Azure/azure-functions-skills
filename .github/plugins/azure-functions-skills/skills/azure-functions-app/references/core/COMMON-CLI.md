# CLI Translation

How to execute the REST requests in the other references. Only `az rest`, `az account
get-access-token`, `curl`, and `jq` (or PowerShell `ConvertFrom-Json`) are allowed for Azure calls.

## Prerequisites

- Azure CLI signed in: `az account show`. If it fails, ask the user to run `az login`.
- No Azure CLI extensions and no `az functionapp` / `az webapp` / `az monitor` subcommands.

## ARM requests

bash:

```bash
SITE="/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP"
AV="api-version=2024-11-01"

# GET
az rest --method get --url "https://management.azure.com$SITE?$AV"

# POST with no body (for example list app settings)
az rest --method post --url "https://management.azure.com$SITE/config/appsettings/list?$AV"

# PUT/PATCH with a JSON body from a temp file outside the repo
BODY="$(mktemp)"
# write the JSON body to "$BODY" with jq, never by string concatenation of untrusted values
az rest --method patch --url "https://management.azure.com$SITE/config/web?$AV" \
  --headers "Content-Type=application/json" --body "@$BODY"
rm -f "$BODY"
```

PowerShell:

```powershell
$Site = "/subscriptions/$Sub/resourceGroups/$Rg/providers/Microsoft.Web/sites/$App"
$Av = 'api-version=2024-11-01'

az rest --method get --url "https://management.azure.com$Site`?$Av"

$Body = New-TemporaryFile
$payload | ConvertTo-Json -Depth 20 -Compress | Set-Content -Path $Body -Encoding utf8NoBOM
az rest --method patch --url "https://management.azure.com$Site/config/web`?$Av" `
  --headers "Content-Type=application/json" --body "@$Body"
Remove-Item $Body
```

Notes:

- In PowerShell, escape `?` after a variable as `` `? `` or use `"${Site}?$Av"`.
- Always use `--body @file` on Windows. Inline JSON quoting breaks across shells.
- Use `--query` (JMESPath) or `jq` to project fields and to redact before printing. On Windows,
  `az` runs through `az.cmd`, which can split JMESPath containing `{`, `,`, `|`, or `(` even
  when quoted in PowerShell. Keep `--query` to simple paths there, or use `--output-file` and
  parse the file with `ConvertFrom-Json`.
- `az rest` does not poll long-running operations. Follow ARM-CORE for `202`.
- To see status codes and headers for polling, add `--verbose` and read the response headers, or
  use `curl -i` with a token.

## Data-plane requests (SCM, host admin, Log Analytics)

bash:

```bash
SCM_TOKEN="$(az account get-access-token --resource https://appservice.azure.com --query accessToken -o tsv)"
curl -sS -X POST "https://$SCM_HOST/api/publish?RemoteBuild=false&Deployer=azure_functions_skills" \
  -H "Authorization: Bearer $SCM_TOKEN" -H "Content-Type: application/zip" \
  --data-binary "@package.zip"
unset SCM_TOKEN
```

PowerShell:

```powershell
$ScmToken = az account get-access-token --resource https://appservice.azure.com --query accessToken -o tsv
Invoke-RestMethod -Method Get -Uri "https://$ScmHost/api/deployments/latest" `
  -Headers @{ Authorization = "Bearer $ScmToken" }
Remove-Variable ScmToken
```

Log Analytics query (works with `az rest` when you pass the resource):

```bash
az rest --method post --resource "https://api.loganalytics.io" \
  --url "https://api.loganalytics.io/v1/workspaces/$WORKSPACE_ID/query" \
  --headers "Content-Type=application/json" --body "@$BODY"
```

## Redaction helpers

Mask a value when its **name** or its **value** looks secret. Key Vault references
(`@Microsoft.KeyVault(...)`) are safe to show.

bash (app settings):

```bash
az rest --method post --url "https://management.azure.com$SITE/config/appsettings/list?$AV" \
  | jq '.properties | with_entries(.value = (
      if ((.value // "") | test("^@Microsoft\\.KeyVault\\("; "i")) then .value
      elif ((.key | test("KEY|SECRET|PASSWORD|PWD|TOKEN|CONNECTION|SAS|Storage$"; "i"))
            or ((.value // "") | test("AccountKey=|SharedAccessKey=|SharedAccessSignature|sig=|Password=|Pwd=|InstrumentationKey="; "i")))
      then "***" else .value end))'
```

bash (connection strings: always mask the value, show only name and type):

```bash
az rest --method post --url "https://management.azure.com$SITE/config/connectionstrings/list?$AV" \
  | jq '.properties | with_entries(.value = {type: .value.type, value: "***"})'
```

PowerShell (app settings):

```powershell
$s = az rest --method post --url "https://management.azure.com$Site/config/appsettings/list`?$Av" | ConvertFrom-Json
$namePattern  = 'KEY|SECRET|PASSWORD|PWD|TOKEN|CONNECTION|SAS|Storage$'
$valuePattern = 'AccountKey=|SharedAccessKey=|SharedAccessSignature|sig=|Password=|Pwd=|InstrumentationKey='
$s.properties.PSObject.Properties | ForEach-Object {
  $raw = [string]$_.Value
  $v = if ($raw -match '^@Microsoft\.KeyVault\(') { $raw }
       elseif ($_.Name -match $namePattern -or $raw -match $valuePattern) { '***' }
       else { $raw }
  [pscustomobject]@{ name = $_.Name; value = $v }
}
```
