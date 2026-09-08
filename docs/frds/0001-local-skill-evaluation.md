# FRD-0001: Local skill evaluation, model suitability, and improvement reporting

| Metadata | Value |
| --- | --- |
| Status | Draft |
| Revision | 3 |
| Created | 2026-09-08 |
| Updated | 2026-09-08 |
| Author | GitHub Copilot, agent proposal based on maintainer discussion |
| Depends on | [FRD governance PR #244](https://github.com/Azure/azure-functions-skills/pull/244), revision `aff24690ae7dae787ad521b4bce718121647ffa7` |
| Component | Skill evaluation capability |

## 1. Summary

Propose a small, local-first evaluation workflow using the existing Vally and
GitHub Copilot SDK integration. Persist reproducible trial results, determine the
least capable model tier that demonstrates correct behavior for each scenario,
produce a public static HTML performance summary and a separate private Markdown
improvement report, and optionally send allowlisted measurements to a designated
Application Insights resource for historical analysis. This one FRD owns the
capability and its acceptance criteria. Infrastructure delivery, the
`azure-functions-create` pilot, and the hosted-agents pilot are sequential
milestones in the implementation plan, not separate features or FRDs.

## 2. Motivation / problem

Users need evidence of skill quality, latency, and consumption under representative
models and scenarios. Maintainers also need to explain regressions: extra model
calls, repeated reads, repeated failures, and excessive context accumulation.
A single success score or aggregate token count cannot identify these behaviors.

The repository already has [Vally configuration](../../.vally.yaml),
[skill eval specifications](../../evals/README.md), and
[invocation telemetry](../../src/telemetry/sender.ts). Reuse the evaluation engine,
not a new scheduler or agent framework. Existing invocation telemetry has a
different purpose and does not establish benchmark quality or cost.
GitHub Copilot App can initiate the local workflow, but its interactive session
history is not the measurement source. Reports identify Copilot CLI/SDK as the
measured agent.

## 3. Goals / non-goals

### Requirements and acceptance criteria

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| SE-001 | Run a declared skill/scenario/model/variant/repetition matrix through Vally, locally | A plan enumerates every trial before execution; an isolated test executor demonstrates fresh workspaces, fresh sessions, explicit models, bounded execution, and no inherited unrelated skills/MCP servers |
| SE-002 | Preserve versioned local results independently of reporting and Azure | Each planned trial has a terminal or interrupted record; reports and upload can run from saved results without another model call; interrupted batches are visibly incomplete |
| SE-003 | Measure consumption, latency, and agent activity with explicit semantics | Record input/output tokens, model calls, tool calls, agent duration, and available cache, skill-activation, and subagent measurements; missing/partial values are not zero or complete totals |
| SE-004 | Separate correctness from skill invocation and measurement coverage | Mandatory deterministic checks determine task success; invocation is a separate metric; failures, skips, timeouts, and coverage denominators are visible |
| SE-005 | Support fair baseline and historical comparisons | Compare matched controls; show sample count, success count, median and range; incompatible histories and zero-denominator percentage deltas are labeled rather than silently compared |
| SE-006 | Generate a safe public static HTML summary | Local file and Pages-hosted views work without an API/backend; filter by skill/scenario/model/variant; show versions, dates, limitations, activity and quality metrics; export only an allowlisted public schema |
| SE-007 | Generate a separate evidence-based improvement report | Markdown findings identify trial/event evidence, observed behavior, hypothesis, suggested skill change, and a re-evaluation check; no finding asserts causality or guaranteed savings |
| SE-008 | Detect a small set of inefficiency candidates deterministically | Versioned repeated-read, repeated-failure, search-without-progress, input-growth, and matched-regression rules have positive, negative, and insufficient-evidence fixtures |
| SE-009 | Send optional evaluation telemetry and support a history Workbook | An explicit upload reads saved results, validates destination/configuration, sends one event per trial, flushes, reports failures, and supports retry; a Workbook deduplicates trial events and separates missing data |
| SE-010 | Keep private execution evidence out of public and telemetry outputs | Content capture is opt-in; default evidence contains no raw prompts, code, arguments, outputs, absolute paths, or credentials; adversarial fixtures prove public/telemetry allowlisting and HTML escaping |
| SE-011 | Preserve existing behavior and leave a small extension boundary | Existing eval commands, specs, hooks, package exports, and normal invocation telemetry retain their contracts; common results identify the executor but do not require a second executor implementation |
| SE-012 | Produce a reproducible maintainer handoff | Documentation defines commands, schema, setup, authorization, failure recovery, publication, and tests; a fixture-only end-to-end flow demonstrates all artifacts without LLM/Azure access |
| SE-013 | Show which model capability/cost level is sufficient for each skill scenario | The manifest supports named capability tiers and reasoning settings; reports show scenario complexity, per-configuration quality/cost, and the lowest-cost observed-fit configuration only when one Copilot billing unit is available across all compared configurations |
| SE-014 | Isolate evaluation from user- and project-level skills, plugins, instructions, and memory | Trial workspaces live outside the source repository, use an evaluation-owned home/profile and explicit discovery roots; preflight/result evidence prove the target hash/bundle and reject conflicting user/project Azure Functions Skills installations without modifying user files |

### Non-goals

No new evaluation CI, scheduling service, database server, frontend framework,
OTel collector service, automatic skill rewriting, default LLM judge/analyzer,
or per-skill feature documents for ordinary scenario additions. No Codex/Claude
Code executor in v1. No App-session scraping,
claim of identical App/CLI behavior, per-file attribution of all token costs,
or vendor API-price multiplication presented as a Copilot invoice.
No live Azure deployment scenarios, infrastructure provisioning, automatic upload,
automatic Pages publishing, or real measurements in this documentation change.

## 4. Proposed design

The [technical design](../internal/skill-evaluation-design.md) defines the proposed
contracts. Add a development-only `benchmark` entry point around Vally:
`plan`, `run`, `report`, `analyze`, and `upload`. These commands are proposed,
not currently available, and do not extend the published setup/chat CLI.
Use Vally specs for prompts, environments, and graders; use a small matrix
manifest for selection, versions, variants, and repetitions.

Data flows from isolated trials to versioned JSONL and optional private evidence.
Deterministic aggregation feeds standalone public HTML; rule-based analysis feeds
private Markdown/JSON findings. A separate uploader exports numeric measurements,
controlled identifiers, and finding counts to Application Insights. Use the same
trial IDs for retries and deduplicate in Workbook queries.

The adapter must prove compatibility with the repository-pinned Vally/SDK versions.
Do not assume upstream main's optional usage or billing fields exist in `0.7.0`.
A capability gap must result in an explicit unsupported/partial measurement or a
reviewed adapter/version decision, not invented numbers or a replacement engine.
Use supported Azure Monitor instrumentation for new evaluation telemetry rather
than expanding the existing legacy invocation sender's contract.

Trust boundaries include reviewed skill code, allowed tools, disposable execution
workspaces, private local evidence, explicit telemetry export, and explicit public
publication. A worktree alone is not a security sandbox. Existing restrictions on
unreviewed PR evaluation remain in force. The runner must not infer permission
from design approval.

Model comparison is a first-class use case, not just a provenance field. Define a
reviewed catalog of lightweight, versatile, and powerful configurations. A
configuration includes the exact model ID and reasoning effort, because changing
effort changes quality, latency, and consumption. Evaluate scenarios labeled by
reviewed complexity and report whether each configuration demonstrated all
mandatory behavior. Resolve availability and current cost metadata at planning time; never substitute
a model silently. A cross-provider "lowest-cost" result requires the same
Copilot-account billing unit and semantics for every compared configuration.
Otherwise show the lowest observed-fit capability tier and within-provider/native
costs, with cross-provider cost marked not comparable.

Use an evaluation-owned `COPILOT_HOME` or an equivalently proven isolated runtime
profile. Place each trial workspace outside the repository/source checkout so
parent-walk discovery cannot load project instructions or generated plugins.
Populate only the reviewed skills/plugins/configuration required by the plan and
verify user- and project-level discovery roots, effective inventory, and target
content hash before execution. Do not temporarily delete, rename, or edit a
maintainer's user-level plugin.
If the pinned runtime cannot isolate every discovery source, use a disposable OS
profile/container or block the run until an approved isolation mechanism exists.

### Delivery checkpoints

One primary implementer delivers three independently gated milestones:

1. evaluation infrastructure and fixture-only validation;
2. the `azure-functions-create` pilot and reviewed public/history outputs;
3. the hosted-agents pilot after incorporating lessons from the create pilot.

Each milestone may be implemented and reviewed without authorizing the next one.
Obtain independent review at contract and output-boundary checkpoints. Follow the
[implementation plan](../internal/skill-evaluation-implementation-plan.md), which
owns scenario catalogs, trial counts, budgets, run-specific authorization, and
later skill rollout order.

### Open questions

| Question | Owner / gate |
| --- | --- |
| Does the pinned Vally/SDK expose reliable per-call usage, end-of-agent timing, tool status, and isolation controls? | Implementer performs source/type inspection before finalizing adapter contracts; choose a compatible adapter or reviewed upgrade and append the decision |
| How does a locally initiated paid run satisfy the existing reviewer-gated evaluation policy? | Repository maintainer must resolve before Finalized status; this FRD does not create a local bypass |
| Which supported Azure Monitor SDK/exporter and authentication mode will the uploader use? | Implementer proposes the smallest supported Node-compatible option after source/docs inspection; architecture reviewer and human approve before Finalized |
| Which exact model IDs are available for each approved capability-tier label, and what billing metadata is exposed? | Pilot owner resolves the catalog through the approved account at planning time; missing candidates remain visibly not evaluated |
| Which budget, destination, retention, and Pages target apply to each run? | Evaluation owner; resolve in the milestone execution record, not implementation defaults |

## 5. Decisions log

| ID | Decision / options | Choice and rationale | Decided by | Date |
| --- | --- | --- | --- | --- |
| D-001 | Reuse Vally vs write a runner/agent engine from scratch | Propose a thin Vally adapter; existing specs and graders already express the core evaluation | GitHub Copilot (agent proposal) | 2026-09-08 |
| D-002 | Cloud-first vs local result authority | Propose JSONL as the local source of truth; reporting/retry must not consume more model calls | GitHub Copilot (agent proposal) | 2026-09-08 |
| D-003 | One report vs separate audiences | Propose public HTML and private improvement Markdown; disclosure needs and purposes differ | GitHub Copilot (agent proposal, reflecting maintainer preference) | 2026-09-08 |
| D-004 | Always-on LLM analysis vs deterministic rules | Propose five bounded rule types with evidence and cautious suggestions; defer optional LLM analysis | GitHub Copilot (agent proposal) | 2026-09-08 |
| D-005 | Reuse normal invocation events vs separate evaluation schema | Propose separate evaluation events and explicit destination; preserve current hook behavior | GitHub Copilot (agent proposal) | 2026-09-08 |
| D-006 | Separate pilot FRDs vs one feature FRD with staged execution | Keep requirements in this FRD and place skill-specific scenarios, budgets, and execution gates in the implementation plan; adding a scenario does not create a new feature | GitHub Copilot (agent proposal, reflecting maintainer feedback) | 2026-09-08 |
| D-007 | Two representative models vs capability-tier catalog | Replace the two-model proposal with lightweight, versatile, and powerful configurations, including separate Astra effort levels, so users can identify the least expensive observed-fit option per scenario | GitHub Copilot (agent proposal, reflecting maintainer feedback) | 2026-09-08 |
| D-008 | Temporarily remove user plugins vs isolate evaluation state | Use an evaluation-owned home/profile, an external trial root, explicit user/project discovery roots, inventory/hash checks, and a disposable-profile fallback; never mutate user-level installations | GitHub Copilot (agent proposal, reflecting maintainer feedback) | 2026-09-08 |
| D-009 | One broad run vs staged skill milestones | Run `azure-functions-create` first, then hosted agents under separate execution approvals; add doctor, diagnostics, setup, and help later through plan revisions based on evidence and usage priority | GitHub Copilot (agent proposal, reflecting maintainer feedback) | 2026-09-08 |

## 6. Test plan

Test names below are planned, not existing evidence. Use Vitest, strict TypeScript,
and repository validation commands. No new test framework.

| Requirement | Test / fixture / experiment | Expected evidence |
| --- | --- | --- |
| SE-001, SE-011 | `benchmark-runner.test.ts`: fake executor and isolation configuration | Exact matrix, independent session/workspace per trial, no personal tools, explicit model failure instead of fallback |
| SE-002 | `benchmark-storage.test.ts`: termination, duplicate IDs, truncated line, unsupported schema | Durable partial results; explicit recovery/error; no silent loss or overwritten trials |
| SE-003 | `benchmark-normalize.test.ts`: real-schema sanitized fixtures, nested usage, absent fields | No double-counting, correct units and timing boundaries, missing/partial coverage surfaced |
| SE-004, SE-005 | `benchmark-aggregate.test.ts`: mixed status, mandatory failures, incompatible controls | Correct denominators and medians, no false skill uplift or invented percentages |
| SE-006, SE-010 | `benchmark-report.test.ts`: hostile labels, paths, transcript fields | Standalone escaped HTML, exact public allowlist, no private content; browser walkthrough recorded |
| SE-007, SE-008 | `benchmark-analyze.test.ts`: each detector and benign lookalikes | Stable evidence IDs and suggestions; rereads after writes and unknown progress do not become proven waste |
| SE-009, SE-010 | `benchmark-upload.test.ts`: fake transport, flush timeout, ambiguous delivery, dedup fixture | Explicit opt-in, no credentials in artifacts, retry-safe IDs, truthful failure, correct unique-trial query results |
| SE-011, SE-012 | `benchmark-cli.test.ts`: fixture-only subprocess flow and existing regression tests | Saved fixture to both reports and mocked telemetry; existing commands unchanged |
| SE-013 | `benchmark-model-catalog.test.ts`: tier, effort, unavailable model, cost coverage and fit-label fixtures | Exact configuration identity; no fallback; lowest-cost observed-fit output only when quality and cost coverage permit it |
| SE-014 | `benchmark-isolation.test.ts`: worktree plus external trial root, conflicting user/project/evaluation installs, duplicate names, personal/project instructions and target hash mismatch | Only approved roots load; conflicting user and checkout copies cannot affect output; mismatch fails before paid execution; user files remain byte-for-byte unchanged |

Actual LLM runs and Azure ingestion/Workbook observations belong to the staged
execution milestones in the implementation plan. Fixtures do not establish those
results.

## 7. Docs impact

Create/update `docs/internal/skill-evaluation-design.md`,
`docs/internal/skill-evaluation-implementation-plan.md`, this FRD, its index, and
`evals/README.md`. Implementation adds `evals/benchmark/README.md` for runnable
instructions and `docs/internal/skill-evaluation-workbook.json` for the Workbook.
Document proposed npm commands in `docs/development.md` when implemented.
No canonical skill behavior changes, generated plugin edits, or changes to
`templates/agents/AGENTS.md` are required. Public reports are generated artifacts,
reviewed for disclosure before publication, not automatically committed raw logs.

## 8. Status & sign-off

| Item | Evidence |
| --- | --- |
| Independent architecture review | Underlying revision 2 content reviewed on 2026-09-08 by Claude Opus 4.8 with no blockers; revision 3 consolidates the reviewed pilot content into this FRD and the implementation plan |
| Human approval | Pending |
| Approved revision and scope | Pending; record commit SHA or content hash |
| Approval reference and date | Pending |
| Implementation reference | Not started |
| Acceptance evidence | Not collected; test plan is prospective |

Status remains Draft. General agreement in the originating discussion is not
approval of this identified FRD revision. No feature implementation before
Finalized; no paid runs, telemetry delivery, or publication without a separate
milestone execution authorization.
