# F9: Language Skills (af-python, af-node, af-dotnet)

**Status:** 📋 Proposed  
**仮スペック Section:** 4.2, 6  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

Azure Functions supports multiple languages, each with its own programming model, SDK patterns, best practices, and common pitfalls. Generic Functions guidance doesn't cover language-specific concerns like:

- Python v2 model decorator patterns vs. v1 function.json
- Node.js v4 model `app.http()` registration vs. v3 `function.json`
- .NET isolated worker vs. in-process (deprecated)
- Async patterns per language
- Dependency management quirks

## Feature

Three language-specific skills that provide deep, idiomatic guidance:

### af-python

Python-specific patterns for Azure Functions v2 programming model.

### af-node

Node.js/TypeScript-specific patterns for Azure Functions v4 programming model.

### af-dotnet

.NET-specific patterns for Azure Functions isolated worker model.

---

## af-python

### Key Topics

| Topic | Coverage |
|-------|----------|
| v2 programming model | `@app.route()`, `@app.queue_trigger()`, `@app.blob_trigger()` decorators |
| Async functions | `async def` support, when to use sync vs. async |
| Dependencies | `requirements.txt`, remote build, package management |
| Local development | `venv` setup, `func start` with Python |
| Common errors | Module import issues, cold start optimization, memory limits |
| Testing | pytest patterns for Functions, mocking bindings |

### Skill Metadata

```yaml
id: af-python
title: Azure Functions Python
intent:
  - python_functions_help
  - python_patterns
  - python_debugging
completion_signals:
  - python_code_written
  - python_issue_resolved
suggestions:
  on_success:
    - target: af-deploy
      reason: "Python function is ready. Deploy to Azure."
      priority: 90
    - target: af-observability
      reason: "Set up Python-specific logging and monitoring."
      priority: 70
  on_failure:
    - target: af-setup
      reason: "Python issue may be caused by environment configuration."
      priority: 60
entry_conditions:
  - python_project_detected
  - python_question_asked
```

### Example Patterns

```python
# v2 model — HTTP trigger with input binding
import azure.functions as func
import logging

app = func.FunctionApp()

@app.route(route="items/{id}", methods=["GET"])
@app.cosmos_db_input(arg_name="item",
                      database_name="mydb",
                      container_name="items",
                      id="{id}",
                      partition_key="{id}",
                      connection="CosmosDBConnection")
def get_item(req: func.HttpRequest, item: func.DocumentList) -> func.HttpResponse:
    if not item:
        return func.HttpResponse("Item not found", status_code=404)
    return func.HttpResponse(item[0].to_json(), mimetype="application/json")
```

---

## af-node

### Key Topics

| Topic | Coverage |
|-------|----------|
| v4 programming model | `app.http()`, `app.timer()`, `app.storageQueue()` registration |
| TypeScript | `tsconfig.json` setup, type-safe bindings, build configuration |
| ESM vs. CJS | Module format configuration, `"type": "module"` implications |
| Async patterns | Promise handling, streaming responses |
| Dependencies | `package.json` management, `node_modules` deployment |
| Testing | Jest/Vitest patterns, mocking `InvocationContext` |

### Skill Metadata

```yaml
id: af-node
title: Azure Functions Node.js/TypeScript
intent:
  - node_functions_help
  - typescript_functions
  - node_patterns
completion_signals:
  - node_code_written
  - node_issue_resolved
suggestions:
  on_success:
    - target: af-deploy
      reason: "Node.js function is ready. Deploy to Azure."
      priority: 90
    - target: af-observability
      reason: "Set up Node.js logging and tracing."
      priority: 70
  on_failure:
    - target: af-setup
      reason: "Node.js issue may be caused by version or npm configuration."
      priority: 60
entry_conditions:
  - node_project_detected
  - node_question_asked
```

### Example Patterns

```typescript
// v4 model — HTTP trigger with timer
import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from "@azure/functions";

export async function httpTrigger(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);
    const name = request.query.get('name') || await request.text() || 'world';
    return { body: `Hello, ${name}!` };
}

export async function timerTrigger(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('Timer function ran at', new Date().toISOString());
    if (myTimer.isPastDue) {
        context.log('Timer is past due!');
    }
}

app.http('httpTrigger', { methods: ['GET', 'POST'], authLevel: 'anonymous', handler: httpTrigger });
app.timer('timerTrigger', { schedule: '0 */5 * * * *', handler: timerTrigger });
```

---

## af-dotnet

### Key Topics

| Topic | Coverage |
|-------|----------|
| Isolated worker model | `HostBuilder`, dependency injection, middleware |
| In-process migration | Migration guide from in-process to isolated |
| Bindings | Attribute-based bindings, custom binding extensions |
| Dependency injection | `IServiceCollection` registration, scoped vs. singleton |
| Testing | xUnit/NUnit patterns, mocking `FunctionContext` |
| Performance | AOT compilation, startup optimization |

### Skill Metadata

```yaml
id: af-dotnet
title: Azure Functions .NET
intent:
  - dotnet_functions_help
  - dotnet_isolated_patterns
  - csharp_functions
completion_signals:
  - dotnet_code_written
  - dotnet_issue_resolved
suggestions:
  on_success:
    - target: af-deploy
      reason: ".NET function is ready. Deploy to Azure."
      priority: 90
    - target: af-observability
      reason: "Set up .NET logging with ILogger and Application Insights."
      priority: 70
  on_failure:
    - target: af-setup
      reason: ".NET issue may be caused by SDK version or project configuration."
      priority: 60
entry_conditions:
  - dotnet_project_detected
  - dotnet_question_asked
```

### Example Patterns

```csharp
// Isolated worker model with DI
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddHttpClient();
        services.AddSingleton<IMyService, MyService>();
    })
    .Build();

host.Run();
```

```csharp
// HTTP trigger with DI
public class HttpTrigger
{
    private readonly IMyService _service;
    private readonly ILogger<HttpTrigger> _logger;

    public HttpTrigger(IMyService service, ILogger<HttpTrigger> logger)
    {
        _service = service;
        _logger = logger;
    }

    [Function("GetItems")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequestData req)
    {
        _logger.LogInformation("Processing GetItems request");
        var items = await _service.GetItemsAsync();
        var response = req.CreateResponse(HttpStatusCode.OK);
        await response.WriteAsJsonAsync(items);
        return response;
    }
}
```

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Language-specific skill activated by project detection or explicit invocation |
| Claude Code | Skill file with language-specific patterns and anti-patterns |
| Codex | Agent instruction with language-focused code generation rules |
| Repo Template | Language-specific guidance in `copilot-instructions.md` |
