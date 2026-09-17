# Current evidence and final status

Agree artifact location, ownership, retention, and deletion before writing. Do not
silently select a permanent customer directory. Keep records inside the processing grant.

## Bind each result to its inputs

Record plan revision, packet/checkpoint, project/function scope, source and uncommitted
change identity, built artifact, effective configuration, SDK/dependency graph, OS,
architecture, tool/runtime/emulator versions, service setup, fixture, and test definition.
Use reproducible fingerprints for permitted inputs, not secret values or secret hashes.
Preserve commands, cwd, exit status, duration, redacted logs, diff, and cleanup.
Bind [requirement IDs](requirements.md) and their proofs to the same artifact.

A source link needs date, applicable version, supporting extract/conclusion, and
uncertainty. Use actual resolved dependency evidence as well as docs. Investigations
record repository, target release/tag, commit, file, complete compatibility branch,
and conclusion. Do not extrapolate a `main` fragment to another release.

When an input changes, invalidate dependent evidence unless the planner records why the
change cannot affect that check. TFM/model/worker/build-SDK changes need new build, host,
and applicable behavior checks. Old evidence remains history, not proof for the candidate.
Check this again on resume.

## Two separate result fields

`achievedLevel` describes the highest fully evidenced level for the current artifact
and accepted scope. It can be absent; Level 0 does not mean "not assessed."

| Level | Evidence |
| --- | --- |
| 0: Assessed | Inventory, current support, route, permissions, risks |
| 1: Builds | Approved restore/build at the accepted checkpoint |
| 2: Local host indexed | Level 1, host starts, expected functions indexed |
| 3: Local behavior checked | Level 2 and selected original-behavior checks pass |
| 4: Azure integration checked | Selected real service contracts pass in approved sandbox |
| 5: Customer accepted | Required customer/manual acceptance conditions pass |

Show status for each level and each required function/environment check. Levels 4/5
do not imply that omitted local/sandbox checks passed. For multiple apps, report each
app; do not let one successful function hide required gaps elsewhere.

`overallStatus` uses these rules in order:

1. `failed_cleanup`: Required cleanup failed; name its owner.
2. `failed`: A required gate has an unresolved failure or migration regression.
3. `acceptance_blocked`: A required condition lacks evidence due to permission,
   environment, inaccessible sources, or inconclusive results.
4. `in_progress`: Approved work remains and can proceed.
5. `complete`: Final target and scope pass all required conditions, handoff, and cleanup.

For migration, those conditions include executed E2E for the agreed business scenarios
and review of applicable current best practices. Pending executable E2E is work in
progress; at final acceptance, missing proof blocks completion. Use the status rules
above for failures and cleanup. A finished assessment is not a completed migration.

An expected temporary diagnostic failure inside an open conversion checkpoint is
progress, not a failed acceptance gate. It becomes a failure when its gate fails or
the accepted repair limit is exhausted.

For example, report `Level 2 achieved / Acceptance blocked` if required cloud behavior
cannot be tested. Name reason, owner, needed environment/permission, and acceptance
method prominently. If .NET 8 passed but the .NET 10 candidate build fails, report the
current failure separately from the last accepted .NET 8 checkpoint.

## Delivery

Include final/last accepted tuples, changes, per-check evidence, failures/blockers,
required migration changes versus optional improvements, residual risk, resume/rollback
point, ownership, and cleanup. Scope reduction needs user approval and stays visible.
Never label a near-EOS intermediate or blocked important behavior as migration completion.
Local-only acceptance does not need Azure if no required contract depends on it.
A local E2E witness must still exercise the agreed path and business result.
