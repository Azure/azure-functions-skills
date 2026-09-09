# Local skill evaluation: implementation and agent handoff

Status: proposed, 2026-09-08. No feature implementation or experiment has started.
This plan can be followed by another coding agent without the originating chat.

## 1. Read first and respect gates

Read [AGENTS.md](../../AGENTS.md), the [FRD index](../frds/README.md),
[FRD-0001](../frds/0001-local-skill-evaluation.md),
and the [technical design](skill-evaluation-design.md).
Read scoped TypeScript/testing/CLI/skill instructions before editing those areas.
Check git status and preserve unrelated work.

The user requested planning/design files, not execution. FRD-0001 is Draft.
Do not implement until the FRD is Finalized with explicit human approval
of a commit SHA or content hash. Do not treat approval of this plan or an earlier
conversation as approval of an unwritten/changed contract.

Before merging these documents with governance PR #244, retain its full process,
merge the provisional index rows, check FRD number collisions, and update all
links/statuses together. Do not modify historical F1-F21 numbering.
Do not set FRD-0001 to Finalized before PR #244 is merged and its final
governance text has been rechecked.

Use one primary implementer, not a fleet. A separate reviewer should inspect
contracts and output boundaries. At each checkpoint report requirement IDs
completed, actual evidence, blockers and changed decisions; append decisions
instead of overwriting earlier ones. Return changed contracts to review.

## 2. Pre-implementation design closure

These activities are source/document inspection, not permission for paid probes:

| Task | Deliverable / exit condition |
| --- | --- |
| Recheck repository baseline | Record HEAD, lockfile versions, current eval specs and relevant helper locations; design baseline is `4bfa24af92ee735dcd5fed377f27ee73ba9fa69b` |
| Inspect Vally/SDK compatibility | Field/capability map with pinned source references for usage, calls, tool status, timing, content capture, all user/project discovery roots and parent walking, isolated homes/profiles, explicit model/effort, account-wide comparable billing metadata and cancellation; compare the current pin with candidate Vally releases; label unavailable vs unverified |
| Resolve compatibility gaps | Choose supported adapter paths or a reviewed Vally upgrade; inspect changelog/source for material breaking changes, run targeted existing-suite regressions, and pin the selected version; do not start a second engine or assume upstream main matches a released version |
| Resolve local authorization policy | Maintainer explains how the existing reviewer-gated policy applies to local execution; no PR-code evals or implicit waiver |
| Resolve telemetry transport | Supported Azure Monitor Node integration, auth, event mapping, sampling and flush semantics; keep new telemetry separate from legacy hooks |
| Independent architecture review | Review the FRD, design, and staged plan; document findings/resolutions; leave human approval pending |
| Human sign-off | Record approver, date, scope, revision hash and reference; only then set corresponding FRD/index status to Finalized |

If paid evidence is needed to resolve a capability, pause and obtain separate
probe authorization for reviewed code, exact targets, trial count and budget.
Do not install dependencies for this documentation phase merely to inspect types;
use locked package/source references first.

## 3. Implementation slices

All test filenames and npm benchmark commands below are proposed. Create code
tests first using existing Vitest. Tests use fake executors/transports unless an
experiment is explicitly authorized. Do not change canonical skill behavior as
a side effect of building evaluation infrastructure.

| Slice | Requirements | Work and deliverables | Exit evidence / checkpoint |
| --- | --- | --- | --- |
| A. Contracts and saved artifacts | SE-002, SE-003, SE-004, SE-010 | Versioned contracts/validators; sanitized pinned-format fixtures; normalization, coverage, durable plan/results, protected public projection | Storage/normalize tests cover malformed/missing/partial usage, duplicate/nested counts and interrupted files; reviewer accepts field semantics |
| B. Matrix and isolated execution | SE-001, SE-002, SE-011, SE-014 | Matrix selector and dry plan; Vally adapter; explicit auth gate and limits; trial root outside checkout; isolated evaluation home/profile, session/workspace/tools/user/project discovery roots; effective inventory/hash evidence; statuses and owned-process cleanup | Fake-executor plus conflicting user/project install tests prove the approved hash is loaded and user config is unchanged; unauthorized, contaminated or unsupported runs stop before model calls |
| C. Quality, model suitability and comparison | SE-004, SE-005, SE-013 | Mandatory task checks independent of activation; scenario complexity/model tier/effort catalog; four fit labels; attempted/scored/coverage denominators; shared Copilot billing unit and cost per success; matched A/B/history grouping and censored durations | Aggregation tests cover failures, unavailable models, effort mismatch, no common cost basis, unstarted trials, zero baseline, incompatible environments and small samples |
| D. Two reports and analysis | SE-006, SE-007, SE-008, SE-010 | Standalone public HTML/JSON; five deterministic detector types; private Markdown/findings/dispositions | Fixture reports expose coverage and evidence; benign lookalikes suppressed; hostile HTML/content cannot cross projections; independent review |
| E. Telemetry and history | SE-009, SE-010 | Approved transport; explicit upload and opt-outs; frozen projection/retry state; Workbook with dedup/coverage | Fake transport covers ambiguous delivery/flush failure; query fixtures show unique counts; no live send without pilot approval |
| F. Commands and maintainer docs | SE-011, SE-012 | Proposed npm entry point, runbook, `docs/development.md` command documentation, existing helper integration, packaging decision, fixture-only end-to-end flow | Existing eval/hooks/exports remain unchanged; reviewer maps evidence to all SE IDs; infrastructure completion does not authorize paid evaluation |

Prefer the proposed `src/benchmark/` boundary; search before adding helpers.
Add no production exports and no npm lifecycle script. Use supported existing
Node/TypeScript tooling, and keep evaluation-only dependencies development-only.
If adding new compiled paths changes npm package contents, explicitly inspect
the pack file list and preserve the current package contract.

Expected targeted validation during implementation:

```powershell
npm test -- tests\benchmark-storage.test.ts tests\benchmark-normalize.test.ts tests\benchmark-model-catalog.test.ts tests\benchmark-isolation.test.ts tests\benchmark-runner.test.ts tests\benchmark-aggregate.test.ts tests\benchmark-report.test.ts tests\benchmark-analyze.test.ts tests\benchmark-upload.test.ts tests\benchmark-cli.test.ts
npm run lint
npm run typecheck
```

Run selectors only after their tests exist. Expand validation when affected
existing behavior warrants it and follow all repository before-commit rules.
If modifying published CLI commands despite the intended scope, obtain contract
approval and perform the required isolated-workspace CLI E2E flow.
Do not execute existing paid `eval:smoke`/`eval:full` commands as ordinary tests.
Template changes, if separately approved, must use canonical generation and
payload verification; never hand-edit generated payloads.

## 4. Staged rollout and evaluation execution

Do not start a milestone solely because the preceding implementation or experiment
completed. Each milestone has its own reviewed inputs, execution limits, evidence,
and explicit authorization.

| Milestone | Scope | Exit condition |
| --- | --- | --- |
| M1. Evaluation infrastructure | Contracts, isolated fake executor, fixture reports, deterministic analysis, fake telemetry transport, maintainer docs | SE-001 through SE-014 have synthetic/test evidence and output-boundary review; no claim of real model quality |
| M2. Create pilot | Evaluate `azure-functions-create` across the approved model catalog and three scenario complexities | Reviewed public/private reports, authorized history evidence, actual cost/coverage, isolation proof, and dispositions are recorded |
| M3. Hosted-agents pilot | After M2 lessons, evaluate `azure-functions-agents` (planned name `azure-functions-hosted-skills`) | Same evidence class as M2, with stable identity/rename mapping and no live connector side effects |

Later doctor, diagnostics, setup, and help evaluations are revisions to this plan
and its scenario catalog. A separate FRD is needed only when they introduce a new
user-facing capability or change FRD-0001 requirements.

### 4.1 Shared model and result contract

The initial catalog is:

| Capability tier | Candidate configurations |
| --- | --- |
| Powerful | GPT-6 Astra (`medium`), GPT-6 Astra (`low`), GPT-5.6 Sol, Claude Opus 5 |
| Versatile | Claude Sonnet 5, GPT-5.6 Terra |
| Lightweight | GPT-5.6 Luna, MAI-Code-1-Flash |

Resolve exact model IDs, supported effort, availability, runtime version, and
billing metadata in each authorized plan. Do not substitute unavailable models.
For every configuration/scenario, classify three repetitions as `observed-fit`
(3/3 mandatory passes), `mixed` (1/3 or 2/3), `not-demonstrated` (0/3), or
`not-evaluated` (unavailable, unauthorized, or unsupported). These are measured
observations, not universal recommendations.

### 4.2 M2: `azure-functions-create` scenario catalog

The enabled bundle is `azure-functions-create`, `azure-functions-common`, and
`azure-functions-setup`. The without-skill control removes only that bundle while
holding the exact user task instruction, runtime/system instructions, fixtures,
tools, MCP endpoints, model/effort, limits, environment profile, and graders
constant. Store matching instruction-set hashes for both variants and fail the
comparison if the baseline rediscovers any removed skill.

| Complexity | Scenario ID | Task | Mandatory evidence |
| --- | --- | --- | --- |
| Simple | create-ts-http | Create a new TypeScript HTTP function | Correct registration/route, successful build, host readiness, and real localhost HTTP response |
| Moderate | add-ts-http | Add an HTTP function to an existing TypeScript project without reinitializing it | Existing files preserved except permitted additions, successful build, and real HTTP response |
| Complex | create-go-http | Create a Go HTTP function using the supported native worker path | Correct module/runtime conventions, no authored `function.json`, and successful `go build` |

With all candidates available, suitability uses
`3 scenarios x 8 configurations x 3 repetitions = 72` trials. Without-skill
controls use one predeclared representative per tier:
`3 scenarios x 3 representatives x 3 repetitions = 27`, for a maximum of 99.

### 4.3 M3: hosted-agents scenario catalog

Use opaque stable skill ID `afs-skill-0002` provisionally, separate from canonical
and display names. Finalize it only after reviewing the rename work. Store the
current `azure-functions-agents` name, planned `azure-functions-hosted-skills`
name, aliases, and content hash separately so a rename does not split history.
The initial enabled-bundle candidate is `azure-functions-agents`,
`azure-functions-common`, and `azure-functions-deploy`; resolve the actual
dependency graph before authorization.

| Complexity | Scenario ID | Task | Mandatory evidence |
| --- | --- | --- | --- |
| Simple | built-in-mcp-session | Expose an agent as a built-in MCP tool and explain chat session IDs | Correct endpoint configuration and route/session semantics; no unrelated surface |
| Moderate | scheduled-teams-briefing | Create a weekday email-to-Teams briefing agent without a chat surface | Correct timer/background configuration, connector/MCP files and timeouts; interactive endpoints omitted; static checks pass |
| Complex | outlook-trigger-drafts | Add an Outlook connector-triggered agent that drafts replies | Correct Connector Namespace resources, trigger schema, MCP config, draft-only safety, and second-step guidance; no live side effect |

Use the same maximum 99-trial shape as M2 unless M2 evidence leads to an approved
plan revision. Do not provision Azure, read private mail, or send email/Teams
messages. A rename or content change during a batch requires freezing one revision
or restarting under a new authorized plan.

### 4.4 Per-milestone execution gates

| Step | Requirements | Action and evidence |
| --- | --- | --- |
| P1. Freeze milestone contract | SE-001, SE-004, SE-013 | Resolve scenarios, bundle/controls, catalog, mandatory graders, and stable identity; independently review an identified plan revision |
| P2. Author reviewed inputs | SE-004, SE-010, SE-013, SE-014 | Create deterministic graders/fixtures and conflicting user/project-install cases; lint statically; review exact revisions |
| P3. Authorize execution | SE-001, SE-009, SE-014 | Record account/policy, gate evidence, exact models/efforts, shared Copilot billing unit or non-comparability, trial count, numeric budget, time/call caps, external root, isolated profile ownership, retention, and cleanup |
| P4. Inspect dry plan | SE-001 through SE-005, SE-013, SE-014 | Account for every catalog slot; confirm trial arithmetic, concurrency 1, balanced order, identical with-skill/without-skill instruction-set hashes and controls, bundle/hash as the only treatment difference, external root, and isolation; hash the plan |
| P5. Execute bounded batch | SE-001 through SE-005, SE-013, SE-014 | Retain every unavailable/terminal/interrupted trial, actual usage/coverage, effective inventory/hash, and before/after user-state evidence; no invisible retries |
| P6. Review improvement report | SE-007, SE-008 | Resolve evidence links, distinguish missing telemetry from no findings, and record maintainer dispositions; do not automatically edit skills |
| P7. Approve and publish | SE-006, SE-010 | Review exact public artifact, fit/cost presentation, and disclosure; publish only public files; record URL/hash and rendered-page evidence |
| P8. Approve and send telemetry | SE-009, SE-010 | Approve tenant/resource/auth/retention, confirm sampling, upload/flush, inspect Workbook, and confirm replay does not inflate unique counts |
| P9. Close or record blockers | SE-001 through SE-014 | Map requirements to evidence, actual spend, unavailable models, user-state integrity, limitations, and resource disposition; keep incomplete milestones open |
| P10. Gate the next milestone | SE-012 | Incorporate prior findings, update shared contracts if needed, and independently approve the next plan revision and budget |

Required authorization record fields (values intentionally unset): human owner,
approval reference/date, FRD revision hash, reviewed runner and skill SHAs,
fixture/manifest/plan hashes, execution-gate reference, credential source reference,
exact model IDs, capability tiers and reasoning settings, a common account-wide
Copilot billing metric or explicit cross-provider non-comparability,
repetitions/trial count, numeric
credit/currency budget or explicitly approved count/time-only mode when spend is
unobservable, timeout/model-call/batch limits, approved tools/network endpoints,
external trial root, isolated home/profile and workspace/process ownership,
effective user/project discovery roots, user-state integrity and cleanup,
evidence retention/deletion date,
telemetry resource/identity/sampling/retention, and Pages repository/path.
No credentials belong in that record.

If the batch stops early, save a visibly incomplete report and account for all
planned IDs. A new attempt requires renewed scope/budget authorization. If Pages
or ingestion permissions are unavailable, keep the local artifacts and mark the
affected SE requirements blocked for that milestone, rather than claiming
publication or delivery.

## 5. Evidence and continuation protocol

Update the owning FRD sign-off table with implementation PR/commit references and
stable evidence paths/URLs. A fixture artifact is labeled synthetic; a benchmark
artifact identifies the measured revision. Private evidence stays in the approved
local/private store; link only safe references from committed documents.

Suggested completion record:

| Field | Required content |
| --- | --- |
| Scope | FRD ID, requirement IDs, approved revision and implementation commit |
| Evidence | Tests/fixtures or actual run ID, report hash/URL and Workbook observation |
| Coverage | Complete/partial/unavailable metrics and detector availability |
| Outcomes | Success/attempted/planned counts, limitations and maintainer findings |
| Cost and cleanup | Authorized vs observed consumption, owned-resource/process disposition |
| Remaining work | Blocked requirements, owner, next gate and append-only decision references |

Do not mark FRD-0001 Implemented from sample code, dry plans, or fixture reports.
Execute `azure-functions-create` before the hosted-agents milestone. After those
results, revise this plan to add doctor, diagnostics, setup, then help based on
observed usage and value. Do not add Codex/Claude Code, CI, LLM
analysis, automatic remediation, or broader scenarios without approved scope.
