#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 -a <app-name> [-s <subscription-id-or-name>] [-g <resource-group>]" >&2
}

APP_NAME=""
SUBSCRIPTION_ID=""
RESOURCE_GROUP=""

while getopts ":a:s:g:h" opt; do
  case "$opt" in
    a) APP_NAME="$OPTARG" ;;
    s) SUBSCRIPTION_ID="$OPTARG" ;;
    g) RESOURCE_GROUP="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

if [[ -z "$APP_NAME" ]]; then
  usage
  exit 2
fi

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import json' >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$PYTHON_BIN" ]] || ! "$PYTHON_BIN" -c 'import json' >/dev/null 2>&1; then
  echo "A working python3 or python executable is required for JSON shaping" >&2
  exit 2
fi

az_json() {
  az "$@" -o json 2>/dev/null || true
}

json_get() {
  "$PYTHON_BIN" -c 'import json,sys; data=json.load(sys.stdin); path=sys.argv[1].split("."); cur=data
for p in path:
    if cur in (None, ""):
        cur=None; break
    cur = cur[int(p)] if isinstance(cur, list) else cur.get(p)
print("" if cur is None else cur)' "$1"
}

if [[ -n "$SUBSCRIPTION_ID" ]]; then
  az account set --subscription "$SUBSCRIPTION_ID" >/dev/null
fi

az config set extension.use_dynamic_install=yes_without_prompt >/dev/null 2>&1 || true
az extension add --name resource-graph --upgrade --only-show-errors >/dev/null 2>&1 || true

WHERE="type =~ 'microsoft.web/sites' and name =~ '$APP_NAME'"
if [[ -n "$RESOURCE_GROUP" ]]; then
  WHERE="$WHERE and resourceGroup =~ '$RESOURCE_GROUP'"
fi
QUERY="Resources | where $WHERE | project name, id, resourceGroup, subscriptionId, location, kind, properties | take 1"
GRAPH_JSON="$(az_json graph query -q "$QUERY")"
RESOURCE_JSON="$(printf '%s' "$GRAPH_JSON" | "$PYTHON_BIN" -c 'import json,sys; data=json.load(sys.stdin) if not sys.stdin.isatty() else {}; rows=data.get("data") or []; print(json.dumps(rows[0] if rows else None))' 2>/dev/null || echo null)"

if [[ "$RESOURCE_JSON" == "null" || -z "$RESOURCE_JSON" ]]; then
  if [[ -n "$SUBSCRIPTION_ID" ]]; then
    LIST_JSON="$(az_json resource list --name "$APP_NAME" --resource-type Microsoft.Web/sites)"
    RESOURCE_JSON="$(printf '%s' "$LIST_JSON" | "$PYTHON_BIN" -c 'import json,sys; rows=json.load(sys.stdin); print(json.dumps(rows[0] if rows else None))' 2>/dev/null || echo null)"
  fi
fi

if [[ "$RESOURCE_JSON" == "null" || -z "$RESOURCE_JSON" ]]; then
  "$PYTHON_BIN" -c 'import json,sys; print(json.dumps({"error":"Function App not found","appName":sys.argv[1]}, indent=2))' "$APP_NAME"
  exit 1
fi

SUBSCRIPTION_ID="$(printf '%s' "$RESOURCE_JSON" | json_get subscriptionId)"
RESOURCE_GROUP="$(printf '%s' "$RESOURCE_JSON" | json_get resourceGroup)"
RESOURCE_ID="$(printf '%s' "$RESOURCE_JSON" | json_get id)"
az account set --subscription "$SUBSCRIPTION_ID" >/dev/null

SITE_JSON="$(az_json rest --method get --url "https://management.azure.com${RESOURCE_ID}?api-version=2023-12-01")"
if [[ -z "$SITE_JSON" || "$SITE_JSON" == "null" ]]; then
  SITE_JSON="$(az_json functionapp show -g "$RESOURCE_GROUP" -n "$APP_NAME")"
fi
PLAN_ID="$(printf '%s' "$SITE_JSON" | "$PYTHON_BIN" -c 'import json,sys; s=json.load(sys.stdin); print((s.get("properties") or {}).get("serverFarmId") or s.get("serverFarmId") or "")')"
PLAN_JSON="null"
if [[ -n "$PLAN_ID" ]]; then
  PLAN_JSON="$(az_json rest --method get --url "https://management.azure.com${PLAN_ID}?api-version=2023-12-01")"
fi
WEB_CONFIG_JSON="$(az_json rest --method get --url "https://management.azure.com${RESOURCE_ID}/config/web?api-version=2023-12-01")"
SETTINGS_JSON="$(az_json functionapp config appsettings list -g "$RESOURCE_GROUP" -n "$APP_NAME")"
FUNCS_JSON="$(az_json functionapp function list -g "$RESOURCE_GROUP" -n "$APP_NAME")"
VNET_JSON="$(az_json webapp vnet-integration list -g "$RESOURCE_GROUP" -n "$APP_NAME")"
PRIVATE_ENDPOINTS_JSON="$(az_json network private-endpoint-connection list -g "$RESOURCE_GROUP" -n "$APP_NAME" --type Microsoft.Web/sites)"
RELATED_JSON="$(az_json resource list -g "$RESOURCE_GROUP" --query '[].{name:name,type:type,location:location,sku:sku.name}')"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
printf '%s' "$SITE_JSON" > "$TMP_DIR/site.json"
printf '%s' "$PLAN_JSON" > "$TMP_DIR/plan.json"
printf '%s' "$WEB_CONFIG_JSON" > "$TMP_DIR/webConfig.json"
printf '%s' "$SETTINGS_JSON" > "$TMP_DIR/settings.json"
printf '%s' "$FUNCS_JSON" > "$TMP_DIR/functions.json"
printf '%s' "$VNET_JSON" > "$TMP_DIR/vnet.json"
printf '%s' "$PRIVATE_ENDPOINTS_JSON" > "$TMP_DIR/privateEndpoints.json"
printf '%s' "$RELATED_JSON" > "$TMP_DIR/related.json"

"$PYTHON_BIN" - "$TMP_DIR" "$APP_NAME" "$RESOURCE_GROUP" "$SUBSCRIPTION_ID" "$RESOURCE_ID" <<'PY'
import json, os, re, sys

base, app_name, resource_group, subscription_id, resource_id = sys.argv[1:6]

def load(name, default=None):
    path = os.path.join(base, name)
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read().strip()
        return json.loads(text) if text else default
    except Exception:
        return default

site = load("site.json", {}) or {}
plan = load("plan.json", None)
web = load("webConfig.json", {}) or {}
settings_raw = load("settings.json", []) or []
funcs = load("functions.json", []) or []
vnet = load("vnet.json", None)
private_endpoints = load("privateEndpoints.json", []) or []
related = load("related.json", []) or []

wanted = {
    "FUNCTIONS_EXTENSION_VERSION", "FUNCTIONS_WORKER_RUNTIME",
    "APPLICATIONINSIGHTS_CONNECTION_STRING", "APPINSIGHTS_INSTRUMENTATIONKEY",
    "AzureWebJobsStorage", "AzureWebJobsStorage__accountName", "AzureWebJobsStorage__credential",
    "WEBSITE_RUN_FROM_PACKAGE", "WEBSITE_CONTENTSHARE", "WEBSITE_CONTENTAZUREFILECONNECTIONSTRING",
}
secret_re = re.compile(r"CONNECTION|Storage|KEY|SECRET|INSIGHTS|TOKEN|PASSWORD|SAS|ACCOUNT", re.I)
settings = []
for item in settings_raw:
    name = item.get("name")
    if name not in wanted:
        continue
    value = item.get("value")
    settings.append({
        "name": name,
        "hasValue": value not in (None, ""),
        "value": "***redacted***" if secret_re.search(name or "") else value,
    })

functions = []
for func in funcs:
    bindings = ((func.get("config") or {}).get("bindings") or [])
    binding = next((b for b in bindings if b.get("direction") == "In"), {})
    functions.append({
        "function": (func.get("name") or "").split("/")[-1],
        "trigger": binding.get("type"),
        "disabled": func.get("isDisabled"),
    })

counts = {}
for func in functions:
    key = (func.get("trigger"), func.get("disabled"))
    counts[key] = counts.get(key, 0) + 1
trigger_counts = [
    {"trigger": trigger, "disabled": disabled, "count": count}
    for (trigger, disabled), count in sorted(counts.items(), key=lambda x: (str(x[0][0]), str(x[0][1])))
]

props = site.get("properties") or {}
web_props = web.get("properties") or {}
plan_props = (plan or {}).get("properties") or {}
output = {
    "resource": {
        "id": resource_id,
        "name": app_name,
        "resourceGroup": resource_group,
        "subscriptionId": subscription_id,
        "location": site.get("location"),
        "kind": site.get("kind"),
        "defaultHostName": props.get("defaultHostName"),
        "hostNames": props.get("hostNames"),
    },
    "app": {
        "enabled": props.get("enabled"),
        "state": props.get("state"),
        "sku": props.get("sku"),
        "functionAppConfig": props.get("functionAppConfig"),
        "lastModifiedTimeUtc": props.get("lastModifiedTimeUtc"),
    },
    "plan": None if not plan else {
        "id": plan.get("id"),
        "name": plan.get("name"),
        "sku": plan.get("sku"),
        "status": plan_props.get("status"),
        "location": plan.get("location"),
        "reserved": plan_props.get("reserved"),
        "zoneRedundant": plan_props.get("zoneRedundant"),
    },
    "network": {
        "virtualNetworkSubnetId": props.get("virtualNetworkSubnetId"),
        "publicNetworkAccess": props.get("publicNetworkAccess"),
        "httpsOnly": props.get("httpsOnly"),
        "minTlsVersion": web_props.get("minTlsVersion"),
        "ftpsState": web_props.get("ftpsState"),
        "vnetRouteAllEnabled": props.get("vnetRouteAllEnabled"),
        "vnetContentShareEnabled": props.get("vnetContentShareEnabled"),
        "vnetImagePullEnabled": props.get("vnetImagePullEnabled"),
        "vnetIntegration": vnet,
        "privateEndpointConnectionCount": len(private_endpoints) if isinstance(private_endpoints, list) else 0,
    },
    "identity": site.get("identity"),
    "selectedSettings": settings,
    "triggers": {"counts": trigger_counts, "functions": functions},
    "relatedResources": related,
}
print(json.dumps(output, indent=2))
PY