# Migration Record and Test Gates

Keep this record in session state or a user-approved target-project file. Do not write migration
notes into the source skill directory. Keep secrets and sensitive sample data out of the record.
Use the same record for all handoffs. On resume, read it and check changes to source and target
before repeating completed actions.

## Plan and approval record

Record:

- Source and target locations; source name and version or revision when available.
- Original goal, required steps, representative inputs, and expected outputs.
- Approved goal changes, removed steps, and replacements.
- Functions trigger, input source, output destination, and approval path for side effects.
- Connection account purpose, tenant boundary, data scope, and intended runtime identity.
- Code-generation decision and required packages.
- Source scripts, language, Python tool/helper mapping, approved contract changes, and test fixtures.
- Required dependency graph, source locations/revisions, source-to-target names, shared reuse,
  approved renames, cycle decisions, and owning skills for operation rows.
- Template source/version, files to change, and required resources.
- Target, budget, repetition count, write-test approval, cleanup, and activation decisions.
- Completed steps, evidence, blockers, and next required action.
- Definition of Done item statuses, applicability reasons, current evidence, repair actions,
  and downstream checks made stale by a repair.
  Use exact HSM IDs, not a single status for each step. At delivery, missing required proof is
  `blocked`; test-gate `not-verified` is not a passing HSM result.

Show this table before target generation. Use one row per operation.

| Source operation | Required input/output and scope | Candidate operation/tool | Status | Evidence/date | Behavior or identity change | User decision |
| --- | --- | --- | --- | --- | --- | --- |
| Fill from the source | Include required fields and side effects | Use exact metadata or mark unknown | Use the support reference | Do not infer support | Explain the effect on the goal | Pending until approved |

Use `supported`, `change-required`, `unverified`, or `out-of-scope` for status.
An approved replacement still needs evidence for its revised contract. Approval does not turn
an unknown operation into a supported one.

## Test gates

Use `pass`, `fail`, or `not-verified`. Each required gate needs evidence, not only a status.

| Gate | Required proof |
| --- | --- |
| Source goal | Each approved required step has an implementation and an observable result. |
| Files | Source files are unchanged; Hosted skill name/frontmatter and relative Markdown links are valid; runtime discovers and uses the migrated skill. |
| Dependent skills | Every required transitive dependency has a checked source and target. Names and links resolve, shared copies are consistent, and filters allow required access. Parent-to-dependency-to-tool tests pass. Retained cycles terminate; unresolved required dependencies block completion. |
| Runtime boundary | No obsolete local paths, CLI/MCP launch commands, or calls to unavailable local skills remain. No excluded Git, PR, deployment, or shell tools are exposed. |
| Input/output | Representative input produces the required fields, format, destination, and data scope. Empty results and failures are explicit, not success-shaped defaults. |
| Script conversion | Required supported processing is converted to Python outside `src/skills/`. Service access uses approved Connector/MCP operations, not direct SDK or shell calls. Tests cover normal, empty, invalid, and boundary inputs. Imports and tool discovery work, dependencies resolve, callers use the converted tools, and the Hosted result matches trusted expected behavior. |
| Authentication | The deployed identity can access each integration. The downstream connector account matches the approved purpose and data scope. Local developer success is insufficient. |
| Connector contract | Connector validation passes status, identity, initialization, exact tool allowlist, full schemas, and safe business-operation tests. |
| Remote MCP contract | Deployed runtime initializes the server, finds only allowed tools, calls a safe representative operation, and handles its result with supported authentication. |
| Identity isolation | Private data is not read through another user's shared connection. Denied access does not switch to broader credentials. |
| Side effects | Approved test action occurs once at the intended destination. Verify downstream, not only function or transport success. Required confirmation is enforced before the action. |
| Trigger | The intended trigger or documented background admin-invoke path starts the correct agent. A sample app/chat agent is not a substitute. |
| Operations | Logs show useful failures without tokens, keys, customer content, or endpoint secrets. Required cleanup is complete. |

Use synthetic data and approved test accounts. Do not run a live write without separate approval
for its target, verification, and cleanup. Do not retry a write when its result is uncertain.
Do not enable production schedules/events until all required gates pass and activation is approved.

If a required gate cannot run, mark it `not-verified` and report the blocker. State separately
whether generation, deployment, and live validation are complete.
Use [completion-check.md](./completion-check.md) to repair missed or incorrect steps and recheck
affected gates before the final report. Do not treat skipped required work as non-applicable.

## Authoring evaluation cases

The bundled `evals/evals.json` contains review cases, not evidence that this skill passed.
Run agent-based evaluations only on reviewed, trusted inputs in an isolated workspace, after
approval of the target, budget, repetition count, and cleanup policy. Do not run them in
PR-triggered CI. Use the skill-creator review workflow when such evaluation is approved.
