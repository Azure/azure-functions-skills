# Select probes from code and accepted contracts

Use only relevant rows. These are proposed test-selection rules. Establish expected
results from the baseline, existing tests, or user confirmation before changing code.
Record each choice in [the requirement record](requirements.md).

| Observed signal | Possible regression | Smallest useful probe |
| --- | --- | --- |
| Custom JSON settings, converters, enums, null handling, HTTP integration change | Response or message schema changes despite a successful build | Accepted fixture with relevant enum/null/date fields; compare semantic output and headers through the selected handler/host path |
| Explicit HTTP route, authorization level, status or error handling | Endpoint or error contract changes | Valid and invalid requests to the original route; compare expected status/body/headers. Local host tests do not prove deployed auth enforcement |
| Message batch flag, settlement calls, lock/session use, custom retry/error handling | Batch shape, completion, retry, or duplicate behavior changes | Controlled success and failure messages; observe business output and the selected broker's settlement/redelivery behavior |
| Event Hubs checkpoint or partition logic | Events are lost, replayed, or assigned differently | Bounded event sequence with IDs and a controlled restart; compare accepted outputs/checkpoint effects, not only listener logs |
| Timer schedule or time-zone configuration | Work runs at the wrong time | Verify schedule/configuration semantics; invoke the business path with controlled time/input. Invocation alone does not prove platform scheduling |
| Durable orchestrator/entity or serializer change | Existing history cannot resume or replay correctly | Approved synthetic history for supported baseline/target versions; separate new-instance execution from history-resume acceptance |
| Custom extension registration or generated build helper | Functions/bindings are omitted at indexing | Compare expected function/binding inventory with the selected SDK/host's actual indexing and registration evidence |
| Shared-library signature or TFM change | Another consumer breaks | Build/test identified consumers and their relevant contract boundary; report inaccessible consumers |

Do not force a synthetic restart, duplicate, or failure into a live customer service.
Choose local, emulator, approved Azure, or customer/manual checks with
[validation boundaries](validation.md). Unsupported emulator features remain unproved.
For example, an Event Hubs emulator restart that loses its data cannot prove production
retention/checkpoint behavior; select a suitable approved environment.

## Final E2E witness

For each agreed business scenario, record input/trigger, path through the migrated app,
selected dependencies, expected business output, observation method, and artifact.
Execute the selected path and inspect the output. A unit call, successful host start,
or function list alone is not that witness.

Local/emulator E2E can close local contracts it actually covers. Required real-service
delivery, deployed identity, or platform scheduling needs the corresponding environment.
A fake narrows the evidence; it cannot close the real-service contract.
If execution is unavailable, report the reached level and missing acceptance. Do not
rename a weaker test E2E to declare the migration complete.

When the user cannot state an expectation, show observed baseline examples and ask
for confirmation. If a baseline failure prevents observation, use the explicit
conditional-baseline process. LLM judgment is not a substitute for execution evidence.
