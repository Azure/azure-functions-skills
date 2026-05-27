import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { OrchestrationContext, OrchestrationHandler } from "durable-functions";

// BAD: Durable orchestrator with non-deterministic operations
const orchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
  const input = context.df.getInput() as { items: string[] };

  // GOOD: This is correct — calling an activity
  const validated = yield context.df.callActivity("validateItems", input.items);

  // BAD: Date.now() is non-deterministic in orchestrator
  // Should use context.df.currentUtcDateTime
  const timestamp = Date.now();

  // BAD: Math.random() is non-deterministic in orchestrator
  const batchId = `batch-${Math.random().toString(36).substring(7)}`;

  // BAD: Direct HTTP fetch in orchestrator — should use context.df.callHttp or callActivity
  const response = yield fetch(`https://api.example.com/batches/${batchId}`);
  const batchConfig = yield (response as Response).json();

  // BAD: setTimeout / timer without using context.df.createTimer
  yield new Promise(resolve => setTimeout(resolve, 5000));

  for (const item of validated) {
    yield context.df.callActivity("processItem", { item, batchId, timestamp, config: batchConfig });
  }

  return { batchId, processedCount: validated.length };
};

df.app.orchestration("processItemsOrchestrator", orchestrator);

// Activity function (correct)
df.app.activity("validateItems", { handler: (input: string[]) => input.filter(i => i.length > 0) });
df.app.activity("processItem", { handler: (input: any) => ({ ...input, processed: true }) });

// HTTP starter (correct)
app.http("startOrchestrator", {
  methods: ["POST"],
  authLevel: "function",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const client = df.getClient(context);
    const body = await request.json();
    const instanceId = await client.startNew("processItemsOrchestrator", { input: body });
    return client.createCheckStatusResponse(request, instanceId);
  },
  extraInputs: [df.input.durableClient()],
});
