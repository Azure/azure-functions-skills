# Plan-controlled workflow

Planning and execution are roles, not separate required agents. The same agent can
perform both for any migration. Subagents are an option, not the goal.
The planning role owns research, route, acceptance, and plan revisions. Use
[intake](intake.md) to confirm scope, behavior, and the destination after research.

## States and approvals

| Phase | Exit condition |
| --- | --- |
| Intake and processing gate | Target, processor, selected content, and initial assessment permissions accepted |
| Preflight and inventory | Current facts, unknowns, dependencies, and scope recorded |
| Baseline approval | Commands, original behavior, endpoints, data, and effects approved |
| Baseline | Evidence collected, or a conditional baseline accepted |
| Provisional route | User confirms the proposed supported destination, assumptions, and stage rationale |
| Resolution approval | Candidate versions, project changes, restore feeds, hooks, and paths approved |
| Target resolution | Actual SDK and dependency graphs confirm the candidate |
| Plan approval | User accepts checkpoints, packets, permissions, and required final checks |
| Execution and validation | Complete checkpoint passes its gates |
| Acceptance and delivery | Required final conditions, artifact handoff, and cleanup closed |

Candidate resolution can use an approved isolated copy; it does not authorize migration
or deployment. Do not require a graph before the operation that produces it. On a changed
candidate, revise the route and permissions. Repeat for each intermediate target.

Keep the plan in an approved persistent artifact location with revision, target,
checkpoints, original contracts, permissions, evidence references, risks, owners, and
open conditions. Agree retention and deletion; no universal path is assumed.
Use [requirement rows](requirements.md) to link obligations, changes, and results.
For a small update, one compact record and one execution packet suffice.
States need not create separate files, agents, or repeated approval prompts.

## Checkpoints

A checkpoint is an acceptance boundary, not one file edit or packet.
Project, startup, attributes, bindings, and test adapters can need changes together.
Expected temporary compile failures inside that conversion are not failed acceptance.
Specify them, their repair steps, and the repair/time limit in the packets.

At the boundary, require approved restore, a passing build, applicable tests, static
contract checks, and the host checks selected for that stage. Audit affected requirement IDs.
Never advance a dependent checkpoint with a failed target build or a known
migration-induced regression. Preserve an unchanged baseline test failure as an explicit
exception, not a pass.

If baseline fails, classify environment, pre-existing code, unsupported state, missing
dependency, or unknown. The user can approve a conditional baseline only with evidence,
a substitute behavior contract, scope, and residual risk. It does not waive the target
build gate. Unknown behavior without an accepted substitute remains blocked.

To defer an unavailable host or integration check, obtain approval for why dependent
work can proceed. Separate the stage gate from the still-required final condition.
Keep it visibly blocked; a deferral is not completion.

## Stop, research, resume

Use `needs_decision`, `needs_permission`, `blocked_environment`, `blocked_product`,
`investigating`, `resumable_stop`, or `failed_cleanup` as appropriate.
Stop only dependent work; denied cloud access need not stop local assessment.
For cloud acceptance, use [Azure handoff](azure-handoff.md) and return with evidence
before final acceptance.

On surprises, preserve the failure and diff, classify the cause, and inspect applicable
official guidance and release/tag source. Read complete compatibility branches and
feature flags, not a fragment from `main`. A minimal isolated prototype needs approval
for its code, data, tools, endpoints, cost, and cleanup. Do not repeat failed tool calls
without a new reason. Revise the plan and invalidate affected packets.

On resume, check working-tree state, permissions, support sources, tools, dependencies,
environment, resources, and cleanup. Recalculate [evidence validity](evidence.md).
Final acceptance needs the agreed E2E scenarios and an applicable best-practice review.
An incomplete report can be handed over without declaring migration completion.
