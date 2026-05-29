import { app, HttpRequest, HttpResponseInit, InvocationContext, output } from "@azure/functions";

const cosmosOutput = output.cosmosDB({
  databaseName: "mydb",
  containerName: "results",
  connection: "CosmosDBConnection",
  createIfNotExists: true,
});

export async function processAndStore(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const body = await request.json() as any;

  // BAD: CQ-008 — Using output binding for critical data write without error handling
  // Output bindings silently fail or throw at the framework level; there's no way to
  // handle a Cosmos DB conflict, throttle, or write failure gracefully
  // Should use SDK directly for operations that need error handling
  context.extraOutputs.set(cosmosOutput, {
    id: body.id,
    data: body.data,
    processedAt: new Date().toISOString(),
  });

  // BAD: CQ-007 — Assumes the output binding succeeded; returns success immediately
  // No validation, no retry strategy, no compensation
  return {
    jsonBody: { status: "stored", id: body.id },
  };
}

app.http("processAndStore", {
  methods: ["POST"],
  authLevel: "function",
  handler: processAndStore,
  extraOutputs: [cosmosOutput],
});
