# F7: azure-functions-observability — Monitoring

**Status:** 📋 Proposed  
**Draft Spec Section:** 4.2, 6, 8  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

Azure Functions apps in production without monitoring are flying blind. Developers deploy successfully but don't configure Application Insights, structured logging, or alerting. When issues arise, they lack the telemetry to diagnose them. Setting up observability for Functions involves multiple configuration points (host.json, app settings, Application Insights resource, alert rules) that are easy to miss.

## Feature

`azure-functions-observability` guides the developer through setting up comprehensive monitoring for their Azure Functions app:

1. **Application Insights** — connection, sampling, live metrics
2. **Structured logging** — host.json log levels, custom telemetry
3. **Alerting** — failure rate, execution duration, queue depth
4. **Dashboards** — key metrics at a glance
5. **Distributed tracing** — correlation across function chains

## Checks & Recommendations

| Area | Check | Action if Missing |
|------|-------|------------------|
| App Insights connection | `APPLICATIONINSIGHTS_CONNECTION_STRING` in app settings | Guide creation + key configuration |
| Sampling | `host.json` → `logging.applicationInsights.samplingSettings` | Recommend appropriate sampling rate |
| Log levels | `host.json` → `logging.logLevel` | Recommend `Information` for Functions, `Warning` for Host |
| Custom metrics | Language-specific telemetry SDK | Guide SDK setup for custom events |
| Alerts | Azure Monitor alert rules | Recommend failure rate + duration alerts |
| Availability | Availability test configuration | Recommend URL ping test for HTTP triggers |

## host.json Configuration

Recommended baseline for production:

```json
{
  "version": "2.0",
  "logging": {
    "logLevel": {
      "default": "Information",
      "Host.Results": "Error",
      "Function": "Information",
      "Host.Aggregator": "Trace"
    },
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "maxTelemetryItemsPerSecond": 20,
        "excludedTypes": "Request"
      },
      "enableLiveMetrics": true,
      "httpAutoCollectionOptions": {
        "enableHttpTriggerExtendedInfoCollection": true,
        "enableW3CDistributedTracing": true,
        "enableResponseHeaderInjection": true
      }
    }
  }
}
```

## Skill Metadata

```yaml
id: azure-functions-observability
title: Azure Functions Observability
intent:
  - set_up_monitoring
  - configure_application_insights
  - add_alerting
  - debug_production_issue
completion_signals:
  - application_insights_configured
  - logging_configured
  - alerts_created
suggestions:
  on_success:
    - target: azure-functions-feedback
      reason: "Monitoring is set up. Share your experience to improve these skills."
      priority: 60
  on_failure:
    - target: azure-functions-help
      reason: "If observability setup failed, get general guidance."
      priority: 80
entry_conditions:
  - project_deployed
  - monitoring_missing
```

## Language-Specific Guidance

### Python

```python
import logging
import azure.functions as func

app = func.FunctionApp()

@app.function_name(name="HttpTrigger")
@app.route(route="hello")
def hello(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('Python HTTP trigger function processed a request.')
    # Custom telemetry via OpenTelemetry or Application Insights SDK
    return func.HttpResponse("Hello!")
```

### Node.js

```typescript
import { app, InvocationContext } from "@azure/functions";

export async function httpTrigger(request: Request, context: InvocationContext): Promise<Response> {
    context.log('HTTP trigger function processed a request.');
    // context.trace, context.warn, context.error for structured logging
    return new Response("Hello!");
}

app.http('httpTrigger', { methods: ['GET'], handler: httpTrigger });
```

### .NET

```csharp
public class HttpTrigger
{
    private readonly ILogger<HttpTrigger> _logger;

    public HttpTrigger(ILogger<HttpTrigger> logger)
    {
        _logger = logger;
    }

    [Function("HttpTrigger")]
    public HttpResponseData Run([HttpTrigger(AuthorizationLevel.Function)] HttpRequestData req)
    {
        _logger.LogInformation("C# HTTP trigger function processed a request.");
        return req.CreateResponse(HttpStatusCode.OK);
    }
}
```

## Key Kusto Queries

Common queries for monitoring Functions in Application Insights:

```kql
// Function execution failures (last 24h)
requests
| where timestamp > ago(24h)
| where success == false
| summarize count() by name, resultCode
| order by count_ desc

// Execution duration percentiles
requests
| where timestamp > ago(24h)
| summarize percentiles(duration, 50, 95, 99) by name
| order by percentile_duration_95 desc

// Dependency failures
dependencies
| where timestamp > ago(24h)
| where success == false
| summarize count() by type, target, resultCode
```

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill verifies config, suggests fixes, provides query templates |
| Claude Code | Skill with config file editing and Azure CLI commands |
| Codex | Agent instruction with monitoring setup steps |
| Repo Template | Monitoring checklist in `copilot-instructions.md` |
