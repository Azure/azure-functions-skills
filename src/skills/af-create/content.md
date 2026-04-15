> **Language**: Always respond in the same language the user is using.

# af-create — Create Azure Functions App

Guide the user through creating a new Azure Functions project.

## Prerequisites

Ensure `func` (Azure Functions Core Tools v4) is installed. If not, suggest running **af-setup** first.

## Workflow

### 1. Gather Requirements

Ask the user (or detect from context):

- **Language**: Node.js/TypeScript (default) | Python | .NET (isolated) | Java
- **Trigger**: HTTP (default) | Timer | Blob | Queue | Cosmos DB | Event Hub
- **Project name**: directory name

### 2. Scaffold with Core Tools

```bash
# Create project
func init <project-name> --typescript

# Add a function
cd <project-name>
func new --name <FunctionName> --template "HTTP trigger"
```

### 3. Language-Specific Patterns

#### Node.js / TypeScript (v4 model)

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function httpTrigger(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);
    const name = request.query.get('name') || await request.text() || 'world';
    return { body: `Hello, ${name}!` };
}

app.http('httpTrigger', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
    handler: httpTrigger
});
```

#### Python (v2 model)

```python
import azure.functions as func
import logging

app = func.FunctionApp()

@app.route(route="hello")
def http_trigger(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('Python HTTP trigger function processed a request.')
    name = req.params.get('name') or 'world'
    return func.HttpResponse(f"Hello, {name}!")
```

#### .NET (isolated worker)

```csharp
[Function("HttpTrigger")]
public HttpResponseData Run(
    [HttpTrigger(AuthorizationLevel.Function, "get", "post")] HttpRequestData req)
{
    _logger.LogInformation("C# HTTP trigger function processed a request.");
    var response = req.CreateResponse(HttpStatusCode.OK);
    response.WriteString("Hello, world!");
    return response;
}
```

### 4. Verify

```bash
func start
# Visit http://localhost:7071/api/<FunctionName>
```

### 5. Adding Functions to Existing Projects

If `host.json` already exists, use `func new` to add functions:

```bash
func new --name MyTimer --template "Timer trigger"
```

## After Creation

> ✅ Your project is scaffolded! Next: use **af-deploy** to deploy to Azure.
