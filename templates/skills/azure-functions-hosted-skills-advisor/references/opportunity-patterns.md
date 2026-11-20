# Opportunity signals and counterexamples

Read the enclosing handler and its downstream behavior before accepting a candidate.
Describe the specific semantic ambiguity or diagnostic task, not just a syntax match.

| Signal | Evidence needed | Possible hosted skill task | Keep deterministic |
| --- | --- | --- | --- |
| Log and return, empty catch, dropped event | What is lost, who acknowledges it, whether another consumer recovers it | Diagnose the failed record and propose an evidenced repair or escalation | Durable capture, settlement, validation, audit |
| Poison queue or DLQ with no visible recovery | Failure reason, delivery policy, inspected consumers, available schema/context | Separate exception-path investigation and bounded repair | Transient retries, known schema mappings, idempotency, quarantine |
| Fixed retries of an unchanged payload | Repeated failure whose cause depends on payload meaning or external context | Diagnose before another attempt; suggest a validated payload correction | Backoff for timeouts, throttling, and service outages |
| Long branch chain, regex, lookup table | Examples where meaning changes the correct route and rules miss it | Classify intent, extract context, suggest routing or priority | Exact routing IDs, allowlists, permissions, financial thresholds |
| Unstructured or inconsistent input | Email/document/free-text formats and evidence needed to resolve ambiguity | Extract a structured draft with evidence and uncertainty | Schema checks, required fields, arithmetic, Document Intelligence/OCR when sufficient |
| TODO for manual review | The judgment requested and information a reviewer would need | Prepare a recommendation or review summary | Required human approvals; never infer permission to automate |
| Direct LLM SDK call | Actual model invocation, prompt/tools, history and response handling | Move an existing reasoning step to a configured hosted skill | App validation, response contract, provider-specific features if migration would lose them |

## Expense interpretation

In the [expense sample](https://github.com/Azure-Samples/hosted-skills-expense-processor),
an expense may arrive as JSON, key/value text, or an email. Amounts can be written
in words, and category meaning determines which policy document applies. These are
extraction and interpretation opportunities. A chain of exact USD limits alone is
not an opportunity. Do not let a model calculate limits, invent exchange rates,
waive mandatory review, or authorize payment. Use the model's structured proposal
as input to deterministic policy checks and route uncertainty to review.

## Delivery recovery

In the [delivery sample](https://github.com/greenie-msft/hosted-skills-delivery-recovery),
valid messages stay on the ordinary ingestion path. A separate DLQ skill consults a
schema and requeues a repaired message through the original validator.

Distinguish two recommendations:

- Known `recordId` to `record_id` renames and decimal-string conversion are cheaper
  deterministic fixes. Recommend these first when they cover the observed input.
- Varied partner formats with diagnostic context can justify a bounded reasoning
  fallback after known fixes fail. Never invent missing business values. Preserve
  the original record and require validation before any replay.

The sample uses a delivery limit of one and can complete a DLQ message after a normal
`REPAIR_FAILED` return. Do not copy that as production recovery. Specify durable
quarantine for unsuccessful repairs, acknowledgement rules, and a repair-attempt
limit enforced outside model instructions. Separate send acknowledgement from
confirmed ingestion. Use stable identities to prevent duplicates after ambiguous sends.

## Reject or constrain these candidates

- Plain CRUD, JSON decoding, schema validation, exact enum routing, arithmetic,
  and simple field normalization: keep code.
- Authentication, authorization, statutory or contractual limits, compliance
  decisions, payment execution, and required human approvals: keep authoritative
  deterministic checks. A model may prepare evidence for a reviewer.
- Hot paths or tight latency/throughput requirements: keep the fast path. Consider
  an asynchronous exception branch only if evidence shows a judgment task there.
- Network failures, rate limits, expired credentials, and infrastructure outages:
  use standard retry or operational remediation. A model cannot repair access rights.
- Existing well-scoped hosted skills or direct LLM code needing provider features
  the runtime does not support: explain why no migration is recommended.
- A catch that logs and rethrows or duplicate-message acknowledgement is not
  automatically swallowed failure. A DLQ is useful containment even without AI.

If throughput, error frequency, payload sensitivity, or latency limits are unknown,
list them as questions affecting adoption. Do not invent savings or traffic numbers.
