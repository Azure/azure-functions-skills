#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 -a <app-name> [-s <subscription-id-or-name>] [-g <resource-group>] [-H <hours>]" >&2
}

APP_NAME=""
SUBSCRIPTION_ID=""
RESOURCE_GROUP=""
HOURS="24"

while getopts ":a:s:g:H:h" opt; do
  case "$opt" in
    a) APP_NAME="$OPTARG" ;;
    s) SUBSCRIPTION_ID="$OPTARG" ;;
    g) RESOURCE_GROUP="$OPTARG" ;;
    H) HOURS="$OPTARG" ;;
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

log_analytics_query() {
  local workspace_id="$1"
  local kql="$2"
  if [[ -z "$workspace_id" ]]; then
    echo "null"
    return
  fi
  local body
  body="$(mktemp)"
  "$PYTHON_BIN" -c 'import json,sys; open(sys.argv[1],"w",encoding="utf-8").write(json.dumps({"query":sys.argv[2]}))' "$body" "$kql"
  local result
  result="$(az rest --method post --url "https://api.loganalytics.io/v1/workspaces/${workspace_id}/query" --body "@$body" --headers "Content-Type=application/json" -o json 2>/dev/null || true)"
  rm -f "$body"
  if [[ -z "$result" ]]; then
    echo "null"
    return
  fi
  printf '%s' "$result" | "$PYTHON_BIN" -c 'import json,sys; data=json.load(sys.stdin); tables=data.get("tables") or []; print(json.dumps((tables[0].get("rows") if tables else None)))' 2>/dev/null || echo "null"
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
HEALTH_JSON="$(az_json rest --method get --url "https://management.azure.com${RESOURCE_ID}/providers/Microsoft.ResourceHealth/availabilityStatuses/current?api-version=2022-10-01")"
FUNCS_JSON="$(az_json functionapp function list -g "$RESOURCE_GROUP" -n "$APP_NAME")"
METRICS_JSON="$(az_json monitor metrics list --resource "$RESOURCE_ID" --metric "InstanceCount,CpuPercentage,AverageMemoryWorkingSet,OnDemandFunctionExecutionCount,OnDemandFunctionExecutionUnits,AlwaysReadyFunctionExecutionCount,AlwaysReadyFunctionExecutionUnits,AlwaysReadyUnits" --interval PT1H --aggregation Average Total)"
ACTIVITY_JSON="$(az_json monitor activity-log list --resource-id "$RESOURCE_ID" --offset "${HOURS}h" --max-events 20)"

AI_RESOURCE_ID="$(printf '%s' "$SITE_JSON" | "$PYTHON_BIN" -c 'import json,sys; s=json.load(sys.stdin); print((s.get("tags") or {}).get("hidden-link: /app-insights-resource-id") or "")')"
WORKSPACE_RESOURCE_ID=""
WORKSPACE_CUSTOMER_ID=""
if [[ -n "$AI_RESOURCE_ID" ]]; then
  AI_JSON="$(az_json resource show --ids "$AI_RESOURCE_ID")"
  WORKSPACE_RESOURCE_ID="$(printf '%s' "$AI_JSON" | "$PYTHON_BIN" -c 'import json,sys; a=json.load(sys.stdin); p=a.get("properties") or {}; print(p.get("WorkspaceResourceId") or p.get("workspaceResourceId") or "")' 2>/dev/null || true)"
  if [[ -n "$WORKSPACE_RESOURCE_ID" ]]; then
    WORKSPACE_JSON="$(az_json monitor log-analytics workspace show --ids "$WORKSPACE_RESOURCE_ID")"
    WORKSPACE_CUSTOMER_ID="$(printf '%s' "$WORKSPACE_JSON" | "$PYTHON_BIN" -c 'import json,sys; print((json.load(sys.stdin) or {}).get("customerId") or "")' 2>/dev/null || true)"
  fi
fi

TABLE_COUNTS_JSON="$(log_analytics_query "$WORKSPACE_CUSTOMER_ID" "union withsource=TableName AppRequests, AppExceptions, AppTraces, AppDependencies | where TimeGenerated > ago(7d) | summarize Count=count(), Latest=max(TimeGenerated) by TableName | order by TableName")"
REQUESTS_JSON="$(log_analytics_query "$WORKSPACE_CUSTOMER_ID" "AppRequests | where TimeGenerated > ago(${HOURS}h) | summarize Count=count(), Failed=countif(Success == false), AvgDurationMs=avg(DurationMs), P95DurationMs=percentile(DurationMs,95), Latest=max(TimeGenerated) by OperationName | order by Count desc | take 30")"
EXCEPTIONS_JSON="$(log_analytics_query "$WORKSPACE_CUSTOMER_ID" "AppExceptions | where TimeGenerated > ago(${HOURS}h) | summarize Count=count(), Latest=max(TimeGenerated) by OperationName, ProblemId, Type, OuterMessage | order by Count desc | take 20")"
ERROR_TRACES_JSON="$(log_analytics_query "$WORKSPACE_CUSTOMER_ID" "AppTraces | where TimeGenerated > ago(${HOURS}h) | where SeverityLevel >= 2 | summarize Count=count(), Latest=max(TimeGenerated) by SeverityLevel, Message | order by Count desc | take 20")"
DEPENDENCIES_JSON="$(log_analytics_query "$WORKSPACE_CUSTOMER_ID" "AppDependencies | where TimeGenerated > ago(${HOURS}h) | summarize Count=count(), Failed=countif(Success == false), AvgDurationMs=avg(DurationMs), P95DurationMs=percentile(DurationMs,95), Latest=max(TimeGenerated) by Type, Target, Name | order by Failed desc, Count desc | take 20")"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
printf '%s' "$SITE_JSON" > "$TMP_DIR/site.json"
printf '%s' "$PLAN_JSON" > "$TMP_DIR/plan.json"
printf '%s' "$HEALTH_JSON" > "$TMP_DIR/health.json"
printf '%s' "$FUNCS_JSON" > "$TMP_DIR/functions.json"
printf '%s' "$METRICS_JSON" > "$TMP_DIR/metricsRaw.json"
printf '%s' "$ACTIVITY_JSON" > "$TMP_DIR/activityRaw.json"
printf '%s' "$TABLE_COUNTS_JSON" > "$TMP_DIR/tableCounts.json"
printf '%s' "$REQUESTS_JSON" > "$TMP_DIR/requests.json"
printf '%s' "$EXCEPTIONS_JSON" > "$TMP_DIR/exceptions.json"
printf '%s' "$ERROR_TRACES_JSON" > "$TMP_DIR/errorTraces.json"
printf '%s' "$DEPENDENCIES_JSON" > "$TMP_DIR/dependencies.json"

"$PYTHON_BIN" - "$TMP_DIR" "$APP_NAME" "$RESOURCE_GROUP" "$SUBSCRIPTION_ID" "$RESOURCE_ID" "$WORKSPACE_RESOURCE_ID" "$WORKSPACE_CUSTOMER_ID" <<'PY'
import json, os, sys

base, app_name, resource_group, subscription_id, resource_id, workspace_resource_id, workspace_customer_id = sys.argv[1:8]

def load(name, default=None):
    path = os.path.join(base, name)
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read().strip()
        return json.loads(text) if text else default
    except Exception:
        return default

site = load("site.json", {}) or {}
plan = load("plan.json", {}) or {}
health = load("health.json", None)
funcs = load("functions.json", []) or []
metrics_raw = load("metricsRaw.json", {}) or {}
activity_raw = load("activityRaw.json", []) or []

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

metrics = []
for metric in metrics_raw.get("value") or []:
    totals, averages = [], []
    for series in metric.get("timeseries") or []:
        for point in series.get("data") or []:
            if point.get("total") is not None:
                totals.append(float(point["total"]))
            if point.get("average") is not None:
                averages.append(float(point["average"]))
    metrics.append({
        "name": (metric.get("name") or {}).get("value"),
        "unit": metric.get("unit"),
        "totalSum": sum(totals) if totals else None,
        "averageMax": max(averages) if averages else None,
        "nonZeroTotalBucketCount": len([x for x in totals if x != 0]),
        "nonZeroAverageBucketCount": len([x for x in averages if x != 0]),
    })

activity = [{
    "time": item.get("eventTimestamp"),
    "operation": (item.get("operationName") or {}).get("value"),
    "status": (item.get("status") or {}).get("value"),
    "caller": item.get("caller"),
    "level": item.get("level"),
    "correlationId": item.get("correlationId"),
} for item in activity_raw]

telemetry = None
if workspace_customer_id:
    telemetry = {
        "workspaceResourceId": workspace_resource_id or None,
        "tableCounts7d": load("tableCounts.json", None),
        "requests": load("requests.json", None),
        "exceptions": load("exceptions.json", None),
        "errorTraces": load("errorTraces.json", None),
        "dependencies": load("dependencies.json", None),
    }

props = site.get("properties") or {}
plan_props = plan.get("properties") or {}
health_props = (health or {}).get("properties") or {}
output = {
    "resource": {
        "id": resource_id,
        "name": app_name,
        "resourceGroup": resource_group,
        "subscriptionId": subscription_id,
        "location": site.get("location"),
        "kind": site.get("kind"),
    },
    "currentStatus": {
        "enabled": props.get("enabled"),
        "state": props.get("state"),
        "availabilityState": props.get("availabilityState"),
        "runtimeAvailabilityState": props.get("runtimeAvailabilityState"),
        "planStatus": plan_props.get("status"),
    },
    "resourceHealth": None if not health else {
        "availabilityState": health_props.get("availabilityState"),
        "summary": health_props.get("summary"),
        "reasonType": health_props.get("reasonType"),
        "reportedTime": health_props.get("reportedTime"),
        "title": health_props.get("title"),
    },
    "triggers": {"counts": trigger_counts, "functions": functions},
    "metrics": metrics,
    "applicationInsights": telemetry,
    "activityLog": activity,
    "gaps": {
        "applicationInsightsResourceFound": bool((site.get("tags") or {}).get("hidden-link: /app-insights-resource-id")),
        "workspaceFound": bool(workspace_customer_id),
        "resourceHealthReturned": bool(health),
    },
}
print(json.dumps(output, indent=2))
PY