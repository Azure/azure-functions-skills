# Plan, execution instructions, and results

Use these forms within the workflow in [SKILL.md](../SKILL.md).
Keep one compact artifact when sufficient. YAML and separate files are not required.
Agree location, owner, processing boundary, retention, and cleanup before writing.

## Plan contents

Record revision, selected apps, source/working-tree identity, observed baseline,
proposed and confirmed targets, original contracts, checkpoints, permissions, limits,
requirement rows, evidence, risks, owners, and open decisions.
The initial plan can hold unknowns; an execution instruction cannot leave a decision
to an executor that was supposed to be resolved in planning.

| Phase | Exit condition |
| --- | --- |
| Intake | Explicit skill request, target and processing scope accepted; initial plan created |
| Preflight/inventory | Facts, unknowns, dependencies, and scope recorded |
| Route and baseline | Destination proposed and confirmed; baseline evidenced or conditional baseline accepted |
| Resolution | Candidate changes/restore approved; actual SDK and graphs confirm the target |
| Execution approval | Checkpoints, instructions, effects, limits, and final checks accepted |
| Conversion | Coherent checkpoint passes its build, tests, and selected contract/host gates |
| Local/Azure validation | Each selected path has actual evidence or an explicit gap |
| Delivery | Required conditions, artifact handoff, and cleanup evaluated |

These are review boundaries, not mandatory separate meetings or files.
Baseline permission precedes baseline commands; resolution permission precedes restore.
Unknown support cannot be replaced with a guessed version or fabricated graph.

## Requirement-to-change-to-proof rows

Add rows for actual obligations, not every sentence in a guide.

| Field | Content |
| --- | --- |
| ID and class | User contract, supported-target requirement, or recommendation |
| Authority | User decision, original behavior/test, or versioned official source and date |
| Applicability | Observed code/configuration and target facts |
| Expected result | Concrete outcome established before the change |
| Implementation | Declaration/configuration/code locations and affected consumers |
| Work | Checkpoint and intended change, or evidence that no change is needed |
| Proof | Check/fixture, artifact, environment, actual result |
| Disposition | Verified, pending, failed, blocked, not applicable with evidence, or deferred recommendation with owner |

For example, if the accepted target requires a new Functions build SDK, connect the
requirement to its project or `global.json` declaration, resolved SDK, extension graph,
and actual build/indexing result. A guide fetch or package-name mention is not closure.
An HTTP contract can connect an original fixture to serializer settings and the final
response comparison. Select relevant probes from [validation](validation.md).

Before execution, check target locations, expected results, and approved checks for
affected IDs. A final check that cannot run stays open under the workflow's deferral rule.
At each checkpoint, compare actual diffs and outputs with the rows, including shared
consumers and conditional configuration. Explain or remove an unplanned change within
the approved scope. Report missing implementation, missing proof, and contradictions.

Close required rows before acceptance. "Not selected" cannot close a required contract;
"not applicable" needs target evidence. A recommendation required for support or an
agreed contract is mandatory. Other recommendations can be deferred with reason and owner.
When inputs change, invalidate dependent proofs and rows together.

## Self-contained execution packet

Create one packet per bounded assignment, not per reference document. Include relevant
facts, rule excerpts, and source conclusions; do not copy the entire library.
The same agent can prepare and execute it. An optional weaker executor must not need
external-document lookup or repeated research during normal execution.
It still reads the named code and inspects results. Mark unused fields as not applicable
without repeating empty forms.

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

A resolution packet can contain candidate ranges and return actual versions.
A conversion packet needs those versions confirmed.
Prevent concurrent shared-file writes. Review actual changes and evidence, not only an
executor's summary. Subagent processing, tools, cost, and retention must fit the grants.
Do not promise budget enforcement or permissions that the runner cannot provide.

## Evidence and resume record

Bind each result to plan revision, packet/checkpoint, project/function scope, source and
uncommitted changes, built artifact, effective configuration, SDK/dependency graph,
OS, architecture, tool/runtime/emulator versions, service setup, fixture, and test.
Use reproducible fingerprints of permitted inputs, not secret values or secret hashes.
Record commands, cwd, exit status, duration, redacted logs, diff, cleanup, and requirement IDs.

For sources, retain URL, applicable version, source/update/access dates, supporting
extract or conclusion, and uncertainty. An implementation investigation also records
repository, release/tag, commit, file, and the complete compatibility branch.
Use actual resolved dependency evidence as well as documentation.

Invalidate dependent evidence after input changes unless the planner explains why a
change cannot affect that check. TFM/model/worker/build-SDK changes need new build,
host, and applicable behavior checks. Old evidence remains history, not current proof.
Recheck this on resume.

For a stop, record `needs_decision`, `needs_permission`, `blocked_environment`,
`blocked_product`, `investigating`, `resumable_stop`, or `failed_cleanup`, plus cause,
hypothesis, affected work, last accepted checkpoint, owner, and next decision.
An exhausted repair limit, changed contract/version/scope, unexpected failure, or failed
cleanup returns dependent work to planning. A material revision invalidates old packets.

## Achieved level and overall status

Report both fields. `achievedLevel` describes fully evidenced results for the current
artifact and accepted scope. It can be absent: Level 0 does not mean "not assessed."

| Level | Evidence |
| --- | --- |
| 0: Assessed | Inventory, current support, route, permissions, risks |
| 1: Builds | Approved restore/build at the accepted checkpoint |
| 2: Local host indexed | Level 1, host starts, expected functions indexed |
| 3: Local behavior checked | Level 2 and selected original-behavior checks pass |
| 4: Azure integration checked | Selected real service contracts pass in approved sandbox |
| 5: Customer accepted | Required customer/manual acceptance conditions pass |

Show each level and required function/environment check separately. Levels 4/5 do not
imply omitted local/sandbox checks passed. Report every in-scope app; one successful
function must not hide gaps elsewhere.

Apply `overallStatus` in this order:

1. `failed_cleanup`: Required cleanup failed; identify its owner.
2. `failed`: A required gate has an unresolved failure or migration regression.
3. `acceptance_blocked`: A required condition lacks evidence because permission,
   environment, sources, or results are unavailable or inconclusive.
4. `in_progress`: Approved work remains and can proceed.
5. `complete`: Final target and scope pass required conditions, handoff, and cleanup.

Migration requires executed E2E for agreed business scenarios and applicable current
best-practice review. Pending executable E2E is work in progress; at final acceptance,
missing proof blocks completion. A completed assessment is not a completed migration.
Expected temporary diagnostic failures inside an open checkpoint are progress, not a
failed acceptance gate, until its gate fails or the accepted repair limit is exhausted.

For example: `Level 2 achieved / Acceptance blocked` when required cloud behavior
cannot be tested. State reason, owner, needed environment/permission, and acceptance
method. If .NET 8 passed but the .NET 10 candidate fails, separate that current failure
from the last accepted .NET 8 checkpoint.

Deliver final/last accepted targets, changes, per-check proof, blockers, required versus
optional changes, risks, resume/rollback point, ownership, and cleanup. Scope reduction
needs approval and stays visible. Do not call a near-EOS intermediate final completion.
