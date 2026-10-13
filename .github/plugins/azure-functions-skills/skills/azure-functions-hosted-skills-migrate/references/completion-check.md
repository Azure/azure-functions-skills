# Completion Check and Repair

Use the Definition of Done after each step and again before reporting completion. This check is
an evidence-based review of the result, not a count of completed actions.

## Record evidence

Use every stable `HSM-01` through `HSM-28` ID from `SKILL.md`. Do not combine IDs into a
step summary. Split evidence per used surface when only part of an ID applies.

| ID/surface | Required? | Status | Evidence and current revision/state | Gap | Repair step or next decision |
| --- | --- | --- | --- | --- | --- |
| Use the exact HSM ID | Yes, or no under the ID's stated N/A condition | `pass`, `fail`, `blocked`, or `not-applicable` | Files, approved decisions, metadata, or actual test results | State the missing or incorrect result | Name the earliest affected step |

A required item passes only when its evidence matches the current source, target, configuration,
identity, and deployed state. Do not use old test results after changing the behavior they tested.
Do not put tokens, keys, customer content, or secret endpoint values in evidence.

Use `fail` for an observed mismatch and `blocked` for missing or stale required proof at delivery.
During execution, future checks can be pending; they are not passing. Existing test-gate
`not-verified` becomes `blocked` in the final ID table. Do not infer
success from a command being listed, a file existing, deployment success, or a developer-only test.
The migration-record test gates define the required business and runtime evidence.

## Handle applicability

Connector work does not apply when the approved design has no Connector. Python conversion does
not apply when no required script processing exists. Dependent-skill tests do not apply when
the source has no required dependent skills. Record these facts instead of creating unused work.

Do not mark a required item non-applicable because it is difficult, excluded, skipped, or failed.
For a generation-only request, deployment and live tests remain required for migration completion
but are `not-verified`. Report generation as complete only when its applicable items pass.
Mark those missing required proofs `blocked` in the final Definition of Done table.
Do not deploy or run paid tests to satisfy the checklist without approval.

## Step review mapping

Use these IDs at the relevant step, then revisit all 28 IDs at delivery. A later ID can become
stale when an earlier artifact or decision changes.

| Step | Checks to review |
| --- | --- |
| 1 | HSM-01, HSM-02, baseline for HSM-07 |
| 2 | HSM-03, HSM-06, required processing for HSM-12 |
| 3 | HSM-04, blockers from HSM-02/03/10 |
| 4 | HSM-05, HSM-06, HSM-04 decisions |
| 5 | HSM-12/13/14/15 design and test fixtures; implementation proof is still pending |
| 6 | HSM-07/08/09/10/11 artifact checks; runtime discovery still needs live proof |
| 7 | HSM-12/13/14/15/16 and HSM-17/18 configuration; deployed checks remain pending |
| 8 | HSM-19 planning/validation and HSM-20 consent/access plan; no live provisioning before step 9 approval |
| 9 | HSM-21/22/23, deployed HSM-17/18/20, and pre-activation HSM-28 state |
| 10 | Actual HSM-09/10/13/15/24/25/26/27/28 results, then all HSM IDs on the current artifact |

## Repair gaps

1. Compare the approved goal and dependency graph with generated artifacts and current test
   evidence. Find missing source files, scripts, dependent skills, approvals, configuration, or
   runtime results.
2. Identify the earliest affected step and list affected downstream items. Stop dependent work.
   Keep automation disabled while required release gates remain open.
3. Fix bounded omissions within the existing approval. Examples are a missing relative link,
   a missed Python caller update, or an incorrectly applied approved tool filter.
4. Ask for a new decision if the fix changes the goal, identity, data scope, permissions, write
   behavior, cost, cleanup, or activation. An excluded operation is not a repair option.
5. Update the migration record. Mark affected prior evidence `not-verified` in test gates and
   `blocked` in the final ID table until new proof is available. Keep unaffected
   evidence when its source, target, and runtime assumptions still hold.
6. Run the affected checks in dependency order. Local file fixes need local checks; tool changes
   also need contract and Hosted tests; identity changes need authorization and access gates.
   Deployment repairs need current deployed-state evidence. Paid tests and writes still need
   their existing approval, repetition budget, safe targets, and cleanup.
7. Repeat the final completion check. If a gap remains, record the blocker and report incomplete
   work instead of repeating the same failed action without new evidence.

Do not automatically repeat an uncertain send, post, create, or other write. Inspect the
downstream result before proposing another attempt. Do not delete shared resources, recreate
connections, or roll back a deployment as an unapproved repair.

If production automation was already enabled when a gap is found, report that state and seek an
approved containment action. Do not silently alter live schedules or triggers. Keep migration
completion blocked until the required checks and activation decision are valid.
