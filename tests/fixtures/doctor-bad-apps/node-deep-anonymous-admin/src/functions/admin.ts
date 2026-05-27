import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

// BAD: CQ-003 — CPU-heavy synchronous computation in request path
function computeHash(data: string): string {
  let hash = 0;
  for (let round = 0; round < 100000; round++) {
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char + round;
      hash |= 0;
    }
  }
  return hash.toString(16);
}

export async function adminDeleteUser(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  // BAD: SC-009 — Using user input directly without validation
  const userId = request.query.get("userId");
  const action = request.query.get("action");

  // BAD: SC-009 — SQL injection via string concatenation
  const query = `DELETE FROM users WHERE id = '${userId}' AND action = '${action}'`;
  context.log(`Executing: ${query}`);

  // BAD: CQ-003 — Blocking CPU-intensive work
  const auditHash = computeHash(userId + action + Date.now().toString());

  // Simulated admin operations
  context.log(`User ${userId} deleted. Audit hash: ${auditHash}`);

  return { jsonBody: { deleted: userId, auditHash } };
}

// BAD: SC-002 — Anonymous auth on admin/sensitive endpoint
app.http("adminDeleteUser", {
  methods: ["GET", "DELETE"],
  authLevel: "anonymous",
  handler: adminDeleteUser,
});
