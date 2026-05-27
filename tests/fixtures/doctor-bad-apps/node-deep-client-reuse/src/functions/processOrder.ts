import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CosmosClient } from "@azure/cosmos";

export async function processOrder(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  // BAD: CQ-001 / JS-006 — Creating CosmosClient per invocation instead of reusing
  const client = new CosmosClient(process.env.COSMOS_CONNECTION!);
  const database = client.database("orders");
  const container = database.container("items");

  const body = await request.json() as any;

  // BAD: CQ-004 — Fire-and-forget promise, no await
  container.items.create({
    id: body.orderId,
    product: body.product,
    quantity: body.quantity,
    timestamp: new Date().toISOString(),
  });

  // BAD: CQ-007 — No error handling around external calls
  const response = await fetch(`https://api.shipping.example.com/rates?weight=${body.weight}`);
  const rates = await response.json();

  return { jsonBody: { status: "accepted", rates } };
}

app.http("processOrder", {
  methods: ["POST"],
  authLevel: "function",
  handler: processOrder,
});
