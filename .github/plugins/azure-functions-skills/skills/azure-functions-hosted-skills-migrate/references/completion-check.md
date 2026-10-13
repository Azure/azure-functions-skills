# Completion Check and Repair

Use the Definition of Done after each step and again before reporting completion. This check is
an evidence-based review of the result, not a count of completed actions.

## Record evidence

Use one row per completion item. Split items when only part of a step applies.

| Step/item | Required? | Status | Evidence and current revision/state | Gap | Repair step or next decision |
| --- | --- | --- | --- | --- | --- |
| Use the Definition of Done item | Yes, or no with a reason | `pass`, `fail`, or `not-verified` for required items | Files, approved decisions, metadata, or test results | State the missing or incorrect result | Name the earliest affected step |

A required item passes only when its evidence matches the current source, target, configuration,
identity, and deployed state. Do not use old test results after changing the behavior they tested.
Do not put tokens, keys, customer content, or secret endpoint values in evidence.

Use `fail` for an observed mismatch and `not-verified` for missing or stale proof. Do not infer
success from a command being listed, a file existing, deployment success, or a developer-only test.
The migration-record test gates define the required business and runtime evidence.

## Handle applicability

Connector work does not apply when the approved design has no Connector. Python conversion does
not apply when no required script processing exists. Dependent-skill tests do not apply when
the source has no required dependent skills. Record these facts instead of creating unused work.

Do not mark a required item non-applicable because it is difficult, excluded, skipped, or failed.
For a generation-only request, deployment and live tests remain required for migration completion
but are `not-verified`. Report generation as complete only when its applicable items pass.
Do not deploy or run paid tests to satisfy the checklist without approval.

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
5. Update the migration record. Mark affected prior evidence `not-verified`. Keep unaffected
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
