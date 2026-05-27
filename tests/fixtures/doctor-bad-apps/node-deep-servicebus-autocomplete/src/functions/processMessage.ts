import { app, InvocationContext, ServiceBusMessage } from "@azure/functions";

export async function processMessage(message: ServiceBusMessage, context: InvocationContext): Promise<void> {
  context.log(`Processing message: ${message.messageId}`);

  const body = message.body as { orderId: string; action: string };

  try {
    const result = await fetch(`https://api.orders.example.com/${body.orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: body.action }),
    });

    if (!result.ok) {
      // BAD: autoComplete conflict — host.json has autoCompleteMessages: true
      // but code tries to manually manage message completion by throwing
      // This conflict means the message may be completed AND retried
      throw new Error(`Order update failed: ${result.statusText}`);
    }
  } catch (error) {
    // BAD: EH-003 — No dead-letter / poison message strategy
    // Message will just be retried maxDeliveryCount times then auto-deadlettered
    // without any alerting, logging of the dead-letter reason, or recovery plan
    context.log(`Error processing message ${message.messageId}: ${error}`);
    throw error;
  }
}

app.serviceBusQueue("processMessage", {
  // BAD: DP-004 — Connection name doesn't match local.settings.json
  // local.settings has "ServiceBusConn" but binding references "ServiceBusConnection"
  connection: "ServiceBusConnection",
  queueName: "orders",
  handler: processMessage,
});
