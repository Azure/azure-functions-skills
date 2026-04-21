# Language Snippets — Azure Functions

Minimal starter patterns for HTTP triggers. Use these only as a last-resort fallback when the `azure-functions-templates` MCP server is unavailable **and** `func new` does not produce the desired shape. Prefer the MCP `get_azure_functions_template` tool whenever possible — it ships maintained, complete templates.

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

## Notes

- HTTP triggers default to `authLevel: 'function'`. Use `'anonymous'` only for explicitly public endpoints.
- For non-HTTP triggers (Timer, Blob, Queue, Service Bus, Cosmos DB, Event Hub, etc.), always prefer the MCP `get_azure_functions_template` tool — binding configuration is error-prone to write by hand.
