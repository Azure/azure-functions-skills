# Task packet

Create one packet per bounded assignment, not per reference document. Keep the relevant
facts and source conclusions here; do not copy the whole research library.
This is an executable part of the plan, not a requirement to delegate. The same agent
can create and execute it. Design it so that even a weaker model can perform the normal
work without opening external documentation or repeating migration research.

Before execution, apply [requirement closure](requirements.md) to the affected IDs.
Each needs observed facts, a selected change, and an expected proof. Missing decisions
stay in planning. The executor still reads named code and inspects actual tool results.
Include needed rule and contract excerpts with their IDs, not only links to the shared
record. Keep source links for provenance, not as missing execution instructions.

Keep this information in the approved plan/evidence location. YAML is optional; a
compact section in the plan is sufficient. Mark non-applicable fields without repeating
unused placeholders:

```yaml
packet: <packet-id>
planRevision: <revision>
checkpoint: <checkpoint-id>
objective: <bounded-result>
input:
  artifact: <revision-and-working-tree-identity>
  prerequisites: <accepted-checkpoints-or-investigation-state>
  current: <host-model-tfm-sdk-worker-extensions-os-sku>
  target: <candidate-or-confirmed-tuple>
  evidence: <source-conclusions-dates-versions-and-unknowns>
scope:
  read: <approved-files-and-processor>
  write: <approved-files-and-artifacts>
  excluded: <files-and-contracts-that-must-not-change>
  contracts: <original-business-and-interface-expectations>
  requirementIds: <affected-ids-with-required-rules-changes-and-proof>
actions:
  work: <ordered-task-specific-changes>
  commands: <commands-cwd-effects-and-expected-results>
  network: <destinations-and-permitted-data>
  credentials: <approved-identity-reference-or-none>
  grants: <scope-duration-and-path-permissions>
gates:
  expectedTemporaryFailures: <cause-and-remaining-repair-or-none>
  checks: <checkpoint-and-final-acceptance-conditions>
  limits: <time-retries-data-and-approved-cost-limits>
  escalation: <stop-conditions-and-planning-owner>
output:
  artifact: <resulting-revision-and-diff>
  results: <per-check-status-evidence-and-blockers>
  cleanup: <owned-items-and-required-disposition>
```

Mark unknown values; do not fill them with guessed support or package versions.
For example, a resolution packet can hold a candidate Worker range and report the
resolved version as its output. A conversion packet requires that version to be known.

## Return control

With one agent, this means stop execution and return to planning. With a subagent,
return the unresolved decision to the planner. New research can then update the plan.

Stop dependent actions when versions, bindings, shared-project users, target platforms,
permissions, or required contracts differ from the packet. Also stop for an unexpected
failure, an exhausted repair limit, or failed cleanup.
Do not select a new target, rewrite business expectations, weaken TLS, add a broad
refactor, or reach an unapproved service.

Return command, working directory, exit status, duration, relevant redacted log, diff,
last accepted checkpoint, failure classification, hypothesis, and needed decision.
Capture blocked checks even if other checks passed.

## Acceptance review

Check the actual diff and evidence, not only an executor summary. Separate expected
temporary failures from checkpoint gate failures. Prevent concurrent shared-file writes.
Reconcile each requirement ID with its change and result; a guide fetch is not proof.
After a material plan revision, invalidate affected old packets before resuming.
Any optional subagent's processing, tools, cost, and retention must fit the grants.
Do not promise budget enforcement or permissions that the runner cannot provide.
