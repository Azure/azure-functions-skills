# Turn a requirement into checked evidence

Keep one compact record in the approved plan artifact. This is a planning review method,
not an implemented automatic validator. Use it to catch requirements that were read
but never applied. Add rows for actual obligations, not every sentence in a guide.

| Field | Required content |
| --- | --- |
| ID and class | User contract, supported-target requirement, or best-practice recommendation |
| Authority | User decision, original test/behavior, or versioned official source with date |
| Applicability | Observed code/configuration and target facts that make it apply |
| Expected result | A concrete outcome established before the change |
| Implementation | Actual declaration/configuration/code locations and affected consumers |
| Work | Packet/checkpoint and intended change, or reason no change is needed |
| Proof | Check/fixture, artifact identity, environment, and actual result |
| Disposition | Verified, pending, failed, blocked, not applicable with evidence, or deferred recommendation with owner |

For example, **if** the approved target requires the new Functions build SDK, link that
requirement to the project declaration or `global.json`, the resolved project SDK,
the generated host-extension graph, and the selected build/indexing evidence.
A documentation fetch or package-name mention does not close the row.
Do not declare every old SDK a defect without applicable support or plan evidence.

A business contract might link an HTTP field/enum requirement to the old accepted
fixture, serialization configuration, changed handler, and final response comparison.
Use [contract probes](contract-probes.md) to select evidence from observed risks.

## Closure check

Before a checkpoint starts, check that its required IDs have target locations,
expected results, and approved checks. A final check that cannot run stays open; use
the [deferral rule](workflow.md) instead of blocking independent local work.
Resolve domain decisions in planning. Include required conclusions in the execution
plan even when the planner executes it.

At each checkpoint, inspect actual diffs and outputs against its rows. Report a missing
implementation, missing proof, or contradictory evidence explicitly. For each material
change with no row, explain it or remove it within the approved scope. Check shared
consumers and conditional configuration, not only the main project file.

Before acceptance, close every required row with valid evidence. "Not selected" cannot
close a required contract. "Not applicable" needs a target-specific reason, not a desire
to pass. Final acceptance requires E2E under [result rules](evidence.md).
When inputs change, invalidate affected proofs and rows together.

## Best practices without hidden scope expansion

Review current applicable Functions recommendations for the selected target.
Record adoption, existing compliance, or a justified exception for each material item.
Apply an approved recommendation with its checks; ask if it exceeds the change scope.
A recommendation needed for support or an agreed contract is a required row.
Other recommendations can be deferred with reason and owner, but do not claim full
best-practice conformity while material gaps remain.

Do not invent defects from older examples, a different OS/SKU, or one source branch.
The reviewer must cite the applicable requirement and actual app evidence.
