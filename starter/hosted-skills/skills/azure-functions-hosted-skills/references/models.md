# Foundry Models

Scaffold with Microsoft Foundry. Keep `gpt-4.1` as the safe Bicep default because it is broadly
available and does not require reasoning settings. Before provisioning, try to choose the best
deployable GPT model for the user's subscription and region.

## Default Scaffold

Bicep defaults:

```bicep
param foundryModel string = 'gpt-4.1'
param foundryModelName string = 'gpt-4.1'
param foundryModelVersion string = '2025-04-14'
```

App settings:

```json
{
  "AZURE_FUNCTIONS_AGENTS_PROVIDER": "foundry",
  "FOUNDRY_PROJECT_ENDPOINT": "",
  "FOUNDRY_MODEL": "gpt-4.1"
}
```

Do not configure `AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT` or
`AZURE_FUNCTIONS_AGENTS_REASONING_SUMMARY` for `gpt-4.1`.

## Selection Policy

Use this model selection flow for new apps:

1. Check the target region supports the `AIServices` `S0` account SKU.
2. List GPT model catalog entries in the target region.
3. Check quota/usage for candidate `GlobalStandard` usage names.
4. Check the Azure OpenAI reasoning models documentation to confirm which candidates support
  reasoning settings.
5. Choose a deployment capacity that leaves headroom for the selected model and expected workload.
6. Recommend the newest deployable GPT reasoning model with remaining quota.
7. Ask the user to choose if multiple good options are available or if there are clear tradeoffs.
8. Fall back to `gpt-4.1` when no reasoning-capable model has quota, when model/quota discovery
  cannot determine what the user can deploy, or when the user wants the safest broadly available
  option.

Default recommendation order:

- newest full GPT reasoning model with `GlobalStandard` quota,
- then latest suitable `mini` model when cost/latency matters,
- then `gpt-4.1` without reasoning settings as the safe fallback.

If the CLI/API checks fail, return incomplete data, or cannot be run in the user's environment,
use `gpt-4.1` and do not set reasoning settings.

Do not choose a model only because it appears in `model list`. A catalog-visible model with quota
`0`, such as `gpt-5.5` in some subscriptions, is not deployable for that subscription/SKU.

Reasoning settings:

- Check reasoning support in the Azure OpenAI reasoning models docs before setting reasoning
  environment variables:
  `https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning`
- If the Learn page uses tabs, collapsed tables, or dynamic content that is hard to inspect, fetch
  the raw MicrosoftDocs markdown source from GitHub. For the reasoning models page, use:
  `https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/refs/heads/main/articles/foundry/openai/how-to/reasoning.md`
- Use `AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT=medium` for supported reasoning models by default.
- Offer `high` and increased `FOUNDRY_DEPLOYMENT_CAPACITY` when the task needs deeper planning,
  the deployed agent is underthinking, or smoke tests show shallow reasoning.
- Use `xhigh` only when the selected model supports it and the user explicitly wants maximum
  reasoning with possible latency/cost tradeoffs.
- Use `AZURE_FUNCTIONS_AGENTS_REASONING_SUMMARY=concise`.
- Do not set reasoning settings for older/non-reasoning models.

The docs and CLI answer different questions: the Learn page tells you which model families and
versions support reasoning features; `az cognitiveservices model list` and
`az cognitiveservices usage list` tell you what this subscription can deploy in a region and with
what quota.

## Check Region and Model Availability

Azure CLI can query model availability for a specific subscription and region before you try a
Bicep deployment.

First confirm the target region supports the Foundry/Azure AI Services account SKU used by the
scaffold:

```bash
SUBSCRIPTION_ID="<subscription-id>"
REGION="eastus2"

az cognitiveservices account list-skus \
  --subscription "$SUBSCRIPTION_ID" \
  --kind AIServices \
  --location "$REGION" \
  --query "[].{name:name,tier:tier}" \
  --output table
```

The scaffold uses `S0`. If `S0` is not listed, choose another region before checking models.

List candidate GPT models in one region:

```bash
az cognitiveservices model list \
  --subscription "$SUBSCRIPTION_ID" \
  --location "$REGION" \
  --query "[?model.format=='OpenAI' && starts_with(model.name, 'gpt')].{name:model.name,version:model.version,lifecycle:model.lifecycleStatus,skus:join(',', model.skus[].name),usageNames:join(',', model.skus[].usageName)}" \
  --output table
```

Use this list to identify candidate model names and versions, then check quota for the exact
usage names that match the deployment SKU you plan to use.

For the scaffolded `GlobalStandard` SKU, extract candidate GPT models and their Global Standard
usage names:

```bash
az cognitiveservices model list \
  --subscription "$SUBSCRIPTION_ID" \
  --location "$REGION" \
  --query "[?model.format=='OpenAI' && starts_with(model.name, 'gpt') && contains(model.skus[].name, 'GlobalStandard')].{name:model.name,version:model.version,lifecycle:model.lifecycleStatus,usageNames:join(',', model.skus[?name=='GlobalStandard'].usageName)}" \
  --output table
```

Check one exact model, version, and deployment SKU:

```bash
MODEL_NAME="gpt-5.4"
MODEL_VERSION="2026-03-05"
DEPLOYMENT_SKU="GlobalStandard"

az cognitiveservices model list \
  --subscription "$SUBSCRIPTION_ID" \
  --location "$REGION" \
  --query "[?model.name=='$MODEL_NAME' && model.version=='$MODEL_VERSION' && contains(model.skus[].name, '$DEPLOYMENT_SKU')].{name:model.name,version:model.version,lifecycle:model.lifecycleStatus,skus:join(',', model.skus[].name),usageNames:join(',', model.skus[].usageName)}" \
  --output table
```

If this returns at least one row and the desired SKU is present, the model is advertised for that
subscription and region. The command can return duplicate identical rows; treat one or more rows
as catalog-visible.

Check multiple candidate regions:

```bash
for region_name in centralus eastus eastus2 northcentralus southcentralus westus; do
  printf '\n%s\n' "$region_name"
  az cognitiveservices model list \
    --subscription "$SUBSCRIPTION_ID" \
    --location "$region_name" \
    --query "[?model.name=='gpt-4.1' || model.name=='gpt-5.4'].{name:model.name,version:model.version,lifecycle:model.lifecycleStatus,skus:join(',', model.skus[].name),usageNames:join(',', model.skus[].usageName)}" \
    --output table
done
```

## Check Quota

Availability does not guarantee quota. Use the `usageName` values returned from the model list to
check regional quota and current usage:

```bash
az cognitiveservices usage list \
  --subscription "$SUBSCRIPTION_ID" \
  --location "$REGION" \
  --query "[?name.value=='OpenAI.GlobalStandard.gpt-5.4' || name.value=='OpenAI.GlobalStandard.gpt4.1'].{usage:name.value,limit:limit,current:currentValue,unit:unit,scope:scopeId}" \
  --output table
```

To scan all Global Standard GPT quota entries:

```bash
az cognitiveservices usage list \
  --subscription "$SUBSCRIPTION_ID" \
  --location "$REGION" \
  --query "[?starts_with(name.value, 'OpenAI.GlobalStandard.gpt')].{usage:name.value,limit:limit,current:currentValue,remaining:limit-currentValue,unit:unit,scope:scopeId}" \
  --output table
```

For the scaffolded Bicep default SKU, look for the `GlobalStandard` usage name. For `gpt-4.1`,
the Global Standard usage name currently uses `gpt4.1` without the hyphen. For `gpt-5.4`, it uses
`gpt-5.4`.

If `currentValue` is close to `limit`, choose another region/SKU/model or ask the user to request
quota before deploying.

Choose deployment capacity deliberately. The scaffold default is
`FOUNDRY_DEPLOYMENT_CAPACITY=200` because reasoning-capable models such as `gpt-5.4` can make
multiple model calls and use many tokens per call. Before provisioning, compare the requested
capacity with remaining quota for the selected model/SKU/region. If remaining quota is below 200,
dial `FOUNDRY_DEPLOYMENT_CAPACITY` down to what the subscription can support or choose another
region/SKU/model. Use more than 200 for heavy scheduled workflows, multi-step agents, web/code
execution, or connector summaries when quota allows it. Never set capacity higher than remaining
quota.

Treat quota as the deployability signal:

- `model list` row exists and desired SKU exists: the model is catalog-visible in that region.
- Matching `usage list` record has `limit > currentValue`: the subscription has remaining quota.
- Matching `usage list` record has `limit == 0`: the model/SKU is visible but not deployable for
  this subscription/region/scope.
- No matching `usage list` record: do not assume access; verify with a different SKU/region or a
  deployment validation/provision attempt.

For example, a subscription can see `gpt-5.5` in `az cognitiveservices model list` while
`az cognitiveservices usage list` returns `OpenAI.GlobalStandard.gpt-5.5` with `limit` equal to
`0`. In that case, prefer a model with nonzero quota, such as `gpt-5.4` if it has remaining
quota.

## Existing Account Check

If a Foundry/Azure AI Services account already exists, list models available to that account. The
account-level command returns model fields at the top level, not under `model`:

```bash
ACCOUNT_NAME="<account-name>"
RESOURCE_GROUP="<resource-group>"

az cognitiveservices account list-models \
  --subscription "$SUBSCRIPTION_ID" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACCOUNT_NAME" \
  --query "[?name=='gpt-4.1' || name=='gpt-5.4'].{name:name,version:version,lifecycle:lifecycleStatus,skus:join(',', skus[].name),usageNames:join(',', skus[].usageName)}" \
  --output table
```

Use the region-level `model list` command when choosing where to deploy a new account. Use the
account-level `account list-models` command when deciding what to deploy into an existing account.
Both are catalog signals; still check quota with `usage list`.

## REST APIs Behind the CLI

If Azure CLI output is not enough, call the management APIs directly with `az rest`.

Regional model catalog:

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.CognitiveServices/locations/$REGION/models?api-version=2026-01-15-preview"
```

The response is paged. Follow `nextLink` if present.

Regional quota and usage:

```bash
az rest --method get \
  --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.CognitiveServices/locations/$REGION/usages?api-version=2026-01-15-preview" \
  --query "value[?contains(name.value, 'gpt-5.4') || contains(name.value, 'gpt-5.5')].{usage:name.value,limit:limit,current:currentValue,scope:scopeId}" \
  --output table
```

Use the usage API, not the catalog API, to distinguish "listed" from "actually has quota".

## Upgrade Path

Offer an upgrade when:

- the user asks for a newer or stronger model,
- the deployed agent is underperforming,
- the task needs deeper planning or reasoning,
- the subscription and region are known to support a newer model and have quota.

For example, selecting `gpt-5.4`:

```bash
azd env set FOUNDRY_MODEL gpt-5.4
azd env set FOUNDRY_MODEL_NAME gpt-5.4
azd env set FOUNDRY_MODEL_VERSION 2026-03-05
azd env set FOUNDRY_DEPLOYMENT_CAPACITY 200
azd env set AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT medium
azd env set AZURE_FUNCTIONS_AGENTS_REASONING_SUMMARY concise
azd provision
```

If the deployed agent is not thinking deeply enough, increase effort and capacity together when
quota allows:

```bash
azd env set AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT high
azd env set FOUNDRY_DEPLOYMENT_CAPACITY <higher-capacity-within-quota>
azd provision
```

Use `xhigh` instead of `high` only when the selected model supports it and the user explicitly
wants maximum reasoning and accepts the potential latency/cost tradeoff.

## Reasoning Settings Warning

Reasoning settings are model-specific. Older models can fail when these app settings are present.
The scaffolded Bicep only emits reasoning app settings when `reasoningEffort` is non-empty.

If an upgraded deployment fails, roll back:

```bash
azd env set FOUNDRY_MODEL gpt-4.1
azd env set FOUNDRY_MODEL_NAME gpt-4.1
azd env set FOUNDRY_MODEL_VERSION 2025-04-14
azd env set FOUNDRY_DEPLOYMENT_CAPACITY 200
azd env set AZURE_FUNCTIONS_AGENTS_REASONING_EFFORT ""
azd env set AZURE_FUNCTIONS_AGENTS_REASONING_SUMMARY ""
azd provision
```

Confirm with `azd env get-values` after rollback.

## Practical Access Probe

Do not guess model availability from the model name alone. Availability depends on subscription,
region, quota, and rollout state.

The reliable probe is a small infrastructure-only attempt:

1. Set the candidate model env vars.
2. Run `azd provision`.
3. If Foundry deployment fails, restore `gpt-4.1` values and provision again.

Keep this as an explicit user-visible upgrade step after a working baseline exists.