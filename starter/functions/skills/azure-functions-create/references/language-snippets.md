# Language Snippets — Azure Functions

Minimal starter patterns for HTTP triggers. Use these only as a last-resort fallback when the Azure MCP tools are unavailable **and** `func new` does not produce the desired shape. Prefer the `functions list or get template` Azure MCP tool whenever possible — it returns maintained, complete templates.

**Go is the exception.** The Azure MCP tools and the templates manifest do not include Go, so the Go snippet below is the primary starting point rather than a fallback. See Path C in the skill for the full Go workflow.

## TypeScript (Node.js v4 model)

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

## Python (v2 programming model)

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

## C# (.NET isolated worker)

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

## Java (Maven)

```java
@FunctionName("HttpTrigger")
public HttpResponseMessage run(
        @HttpTrigger(
            name = "req",
            methods = {HttpMethod.GET, HttpMethod.POST},
            authLevel = AuthorizationLevel.FUNCTION)
            HttpRequestMessage<Optional<String>> request,
        final ExecutionContext context) {
    context.getLogger().info("Java HTTP trigger processed a request.");
    final String name = request.getQueryParameters().getOrDefault("name", "world");
    return request.createResponseBuilder(HttpStatusCode.OK)
        .body("Hello, " + name + "!")
        .build();
}
```

## Go (preview)

Go uses worker-driven indexing — there is no `function.json`. Register the function in code and start the worker. The module path is lowercase (`github.com/azure/...`) even though the repository is `Azure/...`.

```go
package main

import (
	"fmt"
	"net/http"

	"github.com/azure/azure-functions-golang-worker/sdk"
	"github.com/azure/azure-functions-golang-worker/worker"
)

func hello(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "world"
	}
	fmt.Fprintf(w, "Hello, %s!", name)
}

func main() {
	app := sdk.FunctionApp()

	app.HTTP("hello", hello,
		sdk.WithMethods("GET", "POST"),
		sdk.WithAuth("function"),
	)

	worker.Start(app)
}
```

Set `"FUNCTIONS_WORKER_RUNTIME": "native"` in `local.settings.json` — not `go` or `golang`.

## Notes

- HTTP triggers default to `authLevel: 'function'`. Use `'anonymous'` only for explicitly public endpoints.
- For non-HTTP triggers (Timer, Blob, Queue, Service Bus, Cosmos DB, Event Hub, etc.), always prefer the `functions list or get template` Azure MCP tool — binding configuration is error-prone to write by hand. Go is the exception: it has no MCP templates, so use the trigger table in Path C of the skill.
