# Definition of Done

Use these stable IDs in the plan, checkpoints, final review, and evaluation. At delivery, check
every ID against current artifacts and results; do not replace them with step summaries.
Record `pass`, `fail`, `blocked`, or `not-applicable`, with proof and applicability reason.
Future checks may be pending during work. Missing/stale required proof is blocked at delivery.
External test-gate `not-verified` also maps to blocked. N/A requires the condition below,
not missing tools, permission, time, or access.

| ID | Required condition | Evidence and applicability |
| --- | --- | --- |
| HSM-01 | Approved source steps and expected business outputs are explicit. | File revisions or user-approved summary of selected chat/agent/instruction input, required steps, conflicts, input fixtures/specification, output fields and destination; a general goal is insufficient. |
| HSM-02 | Required transitive skills and scripts have resolved sources. | Graph with source locations/revisions and parent links, including conditional dependencies used by the scenario; missing/ambiguous sources are blocked. N/A only when the approved inventory proves no required skills or scripts. |
| HSM-03 | Retained required operations have supported, user-selected conversion contracts. | Connector/customer MCP/Python options, recommendation and pros/cons, user choice, input/output, scope, authentication, and dated service/API evidence. No retained `unverified`/`out-of-scope` row; keep removed rows with HSM-04 approval. |
| HSM-04 | Changes to goal, steps, behavior, names, or identity have approval. | Decisions linked to exact changed rows/mappings; narrowed scope is not reported as equivalent migration. |
| HSM-05 | Trigger and result handling implement the approved contract. | Effective `src/<name>.agent.md`, trigger arguments/settings, input fields, output destination, confirmation path, and deferred pattern for long synchronous work. |
| HSM-06 | Service-identity and caller-data boundaries are explicit for every selected tool. | Connector account, MCP or Python identity, purpose, scope, tenant, caller model; no shared identity acts as each caller. Account/private-data subchecks are N/A only with proof that the respective surface is absent. |
| HSM-07 | Original files and the approved source baseline are preserved. | Current hashes/revisions/diffs for source files, plus the retained approved summary for non-file input; compare with step 1. Do not require a fabricated source file or export of the full chat. |
| HSM-08 | App derives from the official `ai-hosted-skills-python` template. | Manifest/release/ref, retrieval result and target files; recorded fallback follows Hosted Skills rules. |
| HSM-09 | Retained reusable skills and dependencies are runtime-discovered Markdown skills. | Approved agent/skill/code mapping, `src/skills/<name>/SKILL.md` inventory, valid name/description, unique names and discovery evidence; N/A only when the approved mapping has no reusable skills. Do not force chat/agent instructions into skill files. |
| HSM-10 | Shared dependencies, collisions, and cycles are resolved. | Matching shared copy, approved renames with callers updated, terminating design/test for retained runtime cycles; N/A only when inventory proves none exist. |
| HSM-11 | Links/assets and skill access resolve without local-only paths/loaders. | Each relative link, asset, parent/dependent instruction, and skill filter checked; non-Markdown assets have approved input/storage handling. N/A only when the approved mapping has no links, assets, or reusable skills. |
| HSM-12 | Required scripts and selected custom operations have Python implementations outside `src/skills/`. | Source-script/selected-operation-to-Python mapping; service access follows the approved Connector/MCP/Python contract. N/A only with no required scripts or custom operations. |
| HSM-13 | Selected Python tools run in the Hosted runtime. | `src/tools/` contract, typed schema, JSON-serializable result, working imports, exact discovered names, successful call; service tools also prove scoped destinations, deployed auth, timeouts and explicit errors. N/A only with no Python tools. |
| HSM-14 | Runtime packages and configuration support the app. | Effective Python version, `requirements.txt`, successful dependency/import checks and required settings; test-only packages remain separate. |
| HSM-15 | Python outputs/errors match approved script and service contracts. | Actual representative/empty/invalid/boundary tests, expected fields/order/dates/precision/encoding/formats and applicable service denial/timeout/pagination cases; syntax alone is insufficient. N/A only with no required Python processing or tools. |
| HSM-16 | Excluded/obsolete runtime calls and unused sample actions are absent. | Inspect all instructions/code/config and filters for Git/PR/build/deploy, shell/subprocess, stdio, direct Work IQ, unsupported API/SDK bypass, local loaders, and unapproved template actions. |
| HSM-17 | Remote MCP transport/settings/authentication work when deployed. | Effective `src/mcp.json`, resolved settings, token audience/identity, initialize and safe runtime call; developer-only access is insufficient. N/A only with no remote MCP. |
| HSM-18 | Exposed MCP tools/schemas match the approved set. | Current `tools/list`, exact names, required/nested/dynamic schemas and filters; no extra operations. N/A only with no MCP tools. |
| HSM-19 | Connector IaC/publication matches authoritative metadata. | Validated Bicep resources/access/settings, target-region auth metadata and complete registration payload; no guessed schemas or secret literals. N/A only with no Connector. |
| HSM-20 | Selected service tools have verified authorization and scoped runtime access. | For Connectors: human consent when required, `overallStatus == Connected`, intended account and deployed access policy. For customer MCP/Python clients: deployed principal or approved secret-reference configuration, least-privilege service access and controlled-call evidence. Resource creation/developer access is insufficient. N/A only with no service access. |
| HSM-21 | Live work has the required target, cost, test, write, and cleanup approvals. | Separate target/budget/repetition/cleanup decisions and write-test targets; generation approval does not authorize live work. |
| HSM-22 | Current artifact is deployed with intended identity/configuration. | Deployment result/revision, effective settings/identity, model access and endpoint wiring with secrets redacted; plans/old deployments are insufficient. |
| HSM-23 | Runtime starts with expected agents/functions and triggers. | Expected versus loaded inventory, required listeners/trigger config and logs without unresolved startup/indexing/import errors; HTTP 200 is insufficient. |
| HSM-24 | Actual Hosted scenarios produce expected business results. | Trigger/admin input, current revision/environment, workflow/tools and any retained skills used, actual versus expected output and downstream result; copies/standalone tests are insufficient. |
| HSM-25 | Applicable invalid/empty/service-failure/access-denial cases behave correctly. | Actual controlled tests, approved fixtures/mocks or test identity; no silent omission, false success or broader credentials. N/A per absent surface; never alter production permissions/services without approval. |
| HSM-26 | Required writes obey confirmation and reach the intended destination. | Approved bounded test, confirmation, downstream result, cleanup/reversal or approved retention; no uncertain retry. N/A only when goal has no writes. |
| HSM-27 | Target/package and evidence do not expose secrets or unapproved content. | Diff/package checks exclude committed credentials/local settings; redacted logs and approved telemetry settings. No customer source/prompts/tools/connection values in plugin telemetry. |
| HSM-28 | Automation activates only after required checks pass and user approval. | Check results/timestamps, activation decision and actual schedule/event state; deferred activation stays disabled. Unsafe existing activation is blocked. N/A only with no scheduled/event-driven business execution. |

Evaluate per used surface. One dependency without scripts does not make HSM-12 N/A when
another has scripts. Generation-only work leaves live checks blocked; do not run them without
approval. Generation can pass its applicable artifact checks but is not a completed migration.

## Evidence and repair

| ID/surface | Status | Artifact/revision and proof | N/A reason or blocker | Repair step |
| --- | --- | --- | --- | --- |
| Exact HSM ID | Use the statuses above | Actual file/result, without secrets | Required for N/A/blocked | Earliest affected step |

Fix missed/incorrect work within existing approval, then mark affected proof stale and repeat
dependent checks. Ask before changing scope, data/identity, permissions, spending, side effects,
cleanup, or activation. Do not retry uncertain writes, delete shared resources, or roll back
deployments automatically. If automation is already unsafe, report it and seek approved containment.
Recheck the full ID list after repair; report remaining blockers and a resume point.
Optional improvements do not expand these required checks.

Authoring cases are in the repository at
`templates/skills/azure-functions-hosted-skills-migrate/evals/evals.json`, not the installed payload.
They are proposed cases, not passing evidence. Run agent evaluations only on reviewed, trusted
inputs in an isolated workspace with target/budget/repetition/cleanup approval, never PR-triggered CI.
