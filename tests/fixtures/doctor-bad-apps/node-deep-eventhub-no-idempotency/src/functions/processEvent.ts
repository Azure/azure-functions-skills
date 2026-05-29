import { app, InvocationContext } from "@azure/functions";

interface PaymentEvent {
  orderId: string;
  amount: number;
  currency: string;
  customerId: string;
}

export async function processPaymentEvent(event: PaymentEvent, context: InvocationContext): Promise<void> {
  context.log(`Processing payment event for order ${event.orderId}`);

  // BAD: CQ-005 / EH-005 — No idempotency check before calling payment API
  // If this event is replayed (at-least-once delivery), the payment will be charged again
  const paymentResult = await fetch("https://api.payment.example.com/charge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: event.orderId,
      amount: event.amount,
      currency: event.currency,
    }),
  });

  if (!paymentResult.ok) {
    // BAD: EH-004 — Throwing causes retry and delays checkpoint for the entire batch
    // In Event Hubs, this blocks ALL events in the batch, not just this one
    throw new Error(`Payment failed for order ${event.orderId}: ${paymentResult.statusText}`);
  }

  // BAD: CQ-005 — Irreversible side effect (email) before any state update
  await fetch("https://api.email.example.com/send", {
    method: "POST",
    body: JSON.stringify({
      to: event.customerId,
      subject: `Payment confirmed for order ${event.orderId}`,
      body: `Amount: ${event.amount} ${event.currency}`,
    }),
  });

  context.log(`Payment processed for order ${event.orderId}`);
}

app.eventHub("processPaymentEvent", {
  connection: "EventHubConnection",
  eventHubName: "payments",
  cardinality: "one",
  handler: processPaymentEvent,
});
