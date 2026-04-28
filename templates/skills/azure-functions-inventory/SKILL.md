# Azure Functions Inventory

Use this skill to collect the static specifications of an existing Azure Function App.

Write final answers in the user's language.

## Required interaction

Ask only for missing inputs that are needed to identify the app:

- Function App name (required unless already provided)
- Subscription ID or name (optional)
- Resource group (optional)

If subscription or resource group is unknown, discover them with Resource Graph. If multiple matching apps are found, ask the user to choose one.

## Fast path

1. Call Azure best practices for `azurefunctions` first when available.
2. Run the bundled inventory script for the current shell/OS:
   - `scripts/get-functionapp-inventory.ps1 -AppName <app-name>`
   - `scripts/get-functionapp-inventory.sh -a <app-name>` on macOS/Linux or Bash
   - Add `-SubscriptionId <sub>` and/or `-ResourceGroup <rg>` when known.
   - For Bash, use `-s <sub>` and/or `-g <resource-group>` when known.
   - Bash script requires Azure CLI plus a working `python3` or `python` executable for JSON shaping.
3. If bundled script execution is unavailable, use `references/inventory-commands.md`.
4. Report only inventory/specification data unless the user explicitly asks for health or telemetry.

If a caller needs runtime or trigger interpretation after inventory collection, use `../azure-functions-common/references/routing.md` on demand. Do not load shared language/extension references for plain inventory output.

## Scope boundary

This skill should collect:

- Resource identity: subscription, resource group, region, resource ID, host name
- Plan/SKU/runtime: plan name/SKU/status, OS, runtime stack/version, Functions runtime
- Flex config: deployment storage type/auth, memory, max instances, always-ready value, update strategy
- Network/security: VNet integration, public network access, HTTPS only, TLS, FTPS, private endpoint count if available
- Identity/settings: managed identity type and selected setting presence with secrets redacted
- Functions inventory: functions and trigger types, enabled/disabled counts
- Related resources in the resource group, summarized by resource type/name/SKU

Do not include metrics, Application Insights, exceptions, traces, dependencies, Activity Log, or Resource Health analysis. Use the health skill for those.

## Output template

```text
Target: <app> (<resource-group>, <subscription>, <region>)
Plan/Runtime: <plan sku>, <kind>, <runtime>, Functions <version>, memory <MB>, max <n>, alwaysReady <value>
Network/Identity: VNet <subnet>, publicAccess <value>, identity <type>
Settings: <selected setting names and presence only>
Triggers: enabled <n>, disabled <n>; trigger breakdown <summary>
Related resources: <short resource type/name summary>
Gaps: <unavailable metadata, if any>
```