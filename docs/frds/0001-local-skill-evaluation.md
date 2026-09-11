# FRD-0001: Local skill evaluation, model suitability, and improvement reporting

| Metadata | Value |
| --- | --- |
| Status | Draft |
| Revision | 5 |
| Created | 2026-09-08 |
| Updated | 2026-09-09 |
| Author | GitHub Copilot, agent proposal based on maintainer discussion |
| Governance | [FRD governance PR #244](https://github.com/Azure/azure-functions-skills/pull/244), merged as `a430a5b8ef28b58ec59fe2fb7456d253b557e2d5`; no outstanding feature dependency |
| Component | Skill evaluation capability |

## 1. Summary

Propose a small, local-first evaluation workflow using the existing Vally and
GitHub Copilot SDK integration. Persist reproducible trial results, determine the
least capable model tier that demonstrates correct behavior for each scenario,
produce a public static HTML performance summary and a separate private Markdown
improvement report, and optionally send allowlisted measurements to a designated
Application Insights resource for historical analysis. This one FRD owns the
capability and its acceptance criteria. First prove container feasibility, then
deliver one usable installed/uninstalled TypeScript HTTP-create pair with real
model execution, build, localhost HTTP checks, JSONL and small static HTML.
Analysis, telemetry, model catalogs, hosted-skills expansion and scheduled CI
are independently gated later stages, not prerequisites for that walking skeleton.
Scenario additions stay in this FRD's implementation plan.

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
| SE-001 | Run declared trials through Vally in a canonical Linux container | A digest-pinned image and declared architecture/resource profile start a fresh container/session/home/workspace/cache per trial; the first authorized smoke uses one scenario, explicit model/effort and installed/uninstalled pair; unsupported isolation/auth stops execution |
| SE-002 | Preserve versioned local results independently of reporting and Azure | Each planned trial has a terminal or interrupted record; reports and upload can run from saved results without another model call; interrupted batches are visibly incomplete |
| SE-003 | Measure consumption, latency, and agent activity with explicit semantics | Record input/output tokens, turns, model/tool calls, agent duration, and available cache, activation and subagent measurements; separate install/startup from task accounting; missing/partial values are not zero or complete totals |
| SE-004 | Separate task correctness, cause diagnosis, operational completion, invocation and coverage | Trusted checks evaluate real build/readiness/HTTP/cleanup; a started task missing required outcomes by its deadline normally fails even with unknown cause. Exclude only evidenced unevaluable infra/provider failures, external cancellation/interruption, or never-started tasks; show per-arm operational/overall/conditional denominators and exclusions, not pooled quality as A/B |
| SE-005 | Measure the net user effect of a normal full installation | Installed arm includes the entire reviewed normal payload and applicable install-generated instructions/config; uninstalled arm lacks that installation. User task, common harness instructions, tools/MCP, fixtures, model/effort, limits and graders match; installation-derived catalog/instructions/token overhead intentionally differ and are not subtracted. Pair all attempts; show quality, tokens, latency, turns, sample count/range even without savings |
| SE-006 | Generate a safe public static HTML summary | Local file and Pages-hosted views work without an API/backend; filter by skill/scenario/model/variant; show versions, dates, limitations, activity and quality metrics; export only an allowlisted public schema |
| SE-007 | Generate a separate evidence-based improvement report | Markdown findings identify trial/event evidence, observed behavior, hypothesis, suggested skill change, and a re-evaluation check; no finding asserts causality or guaranteed savings |
| SE-008 | Detect a small set of inefficiency candidates deterministically | Versioned repeated-read, repeated-failure, search-without-progress, input-growth, and matched-regression rules have positive, negative, and insufficient-evidence fixtures |
| SE-009 | Send optional evaluation telemetry and support a history Workbook | An explicit upload reads saved results, validates destination/configuration, sends one event per trial, flushes, reports failures, and supports retry; a Workbook deduplicates trial events and separates missing data |
| SE-010 | Separate temporary task processing from persistent private evidence and public outputs | Prompts/generated apps may be processed in bounded private ephemeral execution/grading storage, cleaned on all exit paths; unnecessary raw transcript files are suppressed by default. Persistent raw evidence requires capture opt-in; default saved metadata contains no raw content/credentials; fixtures prove lifecycle cleanup, public/telemetry allowlisting and HTML escaping |
| SE-011 | Preserve existing behavior and leave a small extension boundary | Existing eval commands, specs, hooks, package exports, and normal invocation telemetry retain their contracts; common results identify the executor but do not require a second executor implementation |
| SE-012 | Produce an incremental, reproducible maintainer handoff | M0 precedes M1; reference health and real model outputs exercise measurement/grading/storage/report/cleanup even if either arm fails the task. Auth/measurement-only errors do not prove generated-artifact E2E. Offline fixtures differ from paid E2E; later stages do not block local JSONL/HTML; CI reuses image/manifest/entrypoint/gate |
| SE-013 | Show which model capability/cost level is sufficient for each skill scenario | The manifest supports named capability tiers and reasoning settings; reports show scenario complexity, per-configuration quality/cost, and the lowest-cost observed-fit configuration only when one Copilot billing unit is available across all compared configurations |
| SE-014 | Isolate evaluation from user/project installs and separate grading from agent execution | No host home, source checkout/.git/ancestor discovery, Docker socket or user plugin mount; per-trial HOME/COPILOT_HOME and writable/cache state are disposable. Effective full inventory/content lineage matches the plan and baseline has zero target inventory; competing host installs remain unchanged. Graders execute in a separate trusted context, not merely outside the workspace |

### Non-goals

No new evaluation CI in the initial delivery, scheduling service, database server, frontend framework,
OTel collector service, automatic skill rewriting, default LLM judge/analyzer,
or per-skill feature documents for ordinary scenario additions. No Codex/Claude
Code executor in v1. No App-session scraping,
claim of identical App/CLI behavior, per-file attribution of all token costs,
or vendor API-price multiplication presented as a Copilot invoice.
No live Azure deployment, infrastructure provisioning, telemetry upload or Pages
publication in M0/M1, and no real measurements in this documentation change.
Later live integration/deployment and scheduled CI are gated extensions, not
implicitly authorized by this design. No claim that controlled model runs are
fully offline, outputs identical, or Docker safe for arbitrary unreviewed code.

## 4. Proposed design

The [technical design](../internal/skill-evaluation-design.md) defines the proposed
contracts. Add a development-only `benchmark` entry point around Vally:
`plan`, `run`, `report`, `analyze`, and `upload`. These commands are proposed,
not currently available, and do not extend the published setup/chat CLI.
Use Vally specs for prompts and supported environment contracts, with trusted
grading outside the agent execution context. Begin with a minimal one-pair
manifest; general selection and model-catalog expansion come later.

Data flows from isolated trials to versioned JSONL and optional private evidence.
Deterministic aggregation feeds standalone public HTML; rule-based analysis feeds
private Markdown/JSON findings. A separate uploader exports numeric measurements,
controlled identifiers, and finding counts to Application Insights. Use the same
trial IDs for upload retries and deduplicate in Workbook queries. Model reruns
receive new attempt IDs linked to the original pair; never replace bad results.

The adapter must start from the repository-pinned Vally/SDK versions and prove
compatibility with the selected versions. A Vally upgrade is allowed when source
and changelog review finds no material breaking change for existing suites and
targeted regression tests pass; pin the approved version and record the decision.
Do not assume upstream main's optional usage or billing fields exist in `0.7.0`.
A remaining capability gap must result in an explicit unsupported/partial
measurement or a reviewed adapter/version decision, not invented numbers or a
replacement engine.
Resolve supported Azure Monitor instrumentation only at the later telemetry gate,
rather than expanding the existing invocation sender or blocking the first pair.

Trust boundaries include reviewed skill code, allowed tools, disposable execution
workspaces, private local evidence, explicit telemetry export, and explicit public
publication. A worktree alone is not a security sandbox. Existing restrictions on
unreviewed PR evaluation remain in force. The runner must not infer permission
from design approval.

Model comparison is a later first-class use case, not just a provenance field. Define a
reviewed catalog of lightweight, versatile, and powerful configurations. A
configuration includes the exact model ID and reasoning effort, because changing
effort changes quality, latency, and consumption. Evaluate scenarios labeled by
reviewed complexity and report whether each configuration demonstrated all
mandatory behavior. Resolve availability and current cost metadata at planning time; never substitute
a model silently. A cross-provider "lowest-cost" result requires the same
Copilot-account billing unit and semantics for every compared configuration.
Otherwise show the lowest observed-fit capability tier and within-provider/native
costs, with cross-provider cost marked not comparable.

The canonical environment is a Linux container pinned by digest, not a host-profile
fallback. Initial proposed profile: `linux/amd64`, 2 vCPU, 8 GiB memory,
concurrency 1. M0 must validate that profile and pin actual compatible tool/image
versions; these are proposed resource limits, not proven sufficient capacity.
Every trial starts a fresh container, session, HOME, COPILOT_HOME, writable
workspace and cache state. Admit only reviewed versioned input copies and minimal
supported Copilot credential injection; never put credentials in images/artifacts.
No Azure or telemetry credentials enter the initial agent environment. Never
mutate a maintainer's user installation. Verify discovery/inventory and separate
trusted grading from the agent's writable execution context; placing graders
outside cwd alone does not protect them from shell tools.

Two lanes share results and runner contracts. The controlled benchmark uses a
real Copilot model and real generated files/build/localhost HTTP, but limited,
versioned template/manifest/MCP response fixtures. Fixture responses sit at the
retrieval-tool contract so agents still choose tools and retrieve templates; an
empty-workspace task is not given a finished answer. Unknown requests fail
explicitly. Pin build dependency inputs/cache policy; log residual registry/network
limitations. The later live lane uses current external MCP/templates and eventually
explicitly authorized deployment. Fixture-only harness tests invoke no model or
network. Controlled conditions do not remove hardware/network/model variance.

The primary treatment is normal full installation, not a skill-favorable subset.
Resolve the normal Copilot plugin installation path against the reviewed payload;
include all its skill metadata and applicable generated instructions/config.
Hold external tools constant for both arms, record common instruction hashes
separately from installation-derived differences, and retain their entire token
overhead. Do not require resultant system prompts to be byte-identical or name a
skill in the task prompt. Attribute effects to scenario plus installation, not to
one skill's causal contribution. Target-bundle comparisons are later diagnostics.

### Delivery checkpoints

One primary implementer follows independently gated milestones:

1. M0: time-boxed container/auth/adapter/retrieval feasibility;
2. M1: one TypeScript HTTP-create pair, durable measurements and local HTML;
3. M2: bounded repetitions and scenario/model expansion;
4. M3: deterministic private improvement analysis;
5. M4: optional telemetry/history and reviewed publication;
6. M5: hosted-skills stage-isolated scenarios, then live and composed cases;
7. M6: scheduled CI parity after local stability.

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
| Can container auth, full normal installation, discovery isolation and separate grading be implemented through supported Vally/SDK paths? | First time-boxed M0 gate; static evidence before relevant contract approval, separately authorized probes if needed; stop unsupported rather than use an unisolated host |
| Which supported Azure Monitor SDK/exporter and authentication mode will the uploader use? | Deferred M4 contract; review and human approval before implementing upload, not a dependency of M1 |
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
| D-010 | Keep Vally `0.7.0` fixed vs permit an upgrade | Permit a reviewed upgrade when it introduces no material breaking change for existing suites and targeted regressions pass; the lockfile remains the reproducible source of the selected version | GitHub Copilot (agent proposal, reflecting maintainer feedback) | 2026-09-08 |
| D-011 | Host isolation with container fallback vs canonical container | Supersedes D-008 mechanism: per-trial digest-pinned Linux containers and separate trusted grading; preserve no-user-mutation rule and prove compatibility first | Maintainer design direction, recorded by GitHub Copilot; revision approval pending | 2026-09-09 |
| D-012 | Target bundle vs normal full installation | Primary A/B measures net installation effect, including catalog/instruction overhead; target bundles remain optional diagnostic comparisons | Maintainer design direction, recorded by GitHub Copilot; revision approval pending | 2026-09-09 |
| D-013 | Broad framework first vs walking skeleton | Supersedes D-009 delivery granularity: M0 then one real HTTP pair/JSONL/HTML before catalogs, analysis, telemetry and hosted expansion; retain D-007 tiers for M2 | Maintainer design direction, recorded by GitHub Copilot; revision approval pending | 2026-09-09 |
| D-014 | Fully live benchmark vs controlled then live lanes | Real model/build with minimal versioned retrieval fixtures first; current external integration and deploy later, same schema; fixture-only tests remain distinct | Maintainer design direction, recorded by GitHub Copilot; revision approval pending | 2026-09-09 |
| D-015 | Combined agent workflow vs stage-isolated hosted scenarios | New app from empty workspace, modification from fixed app, later live deployment from fixed deployable app, then composed cases; no mailbox/Teams side effects initially | Maintainer design direction, recorded by GitHub Copilot; revision approval pending | 2026-09-09 |
| D-016 | Separate CI engine vs local/CI parity | Later CI uses identical image digest/manifest/entrypoint; only trigger, secret injection and artifact storage change, reviewer gate retained | Maintainer design direction, recorded by GitHub Copilot; revision approval pending | 2026-09-09 |

## 6. Test plan

Test names below are planned, not existing evidence. Use Vitest, strict TypeScript,
and repository validation commands. No new test framework.

| Requirement | Test / fixture / experiment | Expected evidence |
| --- | --- | --- |
| SE-001, SE-011 | `benchmark-runner.test.ts`: fake executor and isolation configuration | Exact matrix, independent session/workspace per trial, no personal tools, explicit model failure instead of fallback |
| SE-002 | `benchmark-storage.test.ts`: termination, duplicate IDs, truncated line, unsupported schema | Durable partial results; explicit recovery/error; no silent loss or overwritten trials |
| SE-003 | `benchmark-normalize.test.ts`: real-schema sanitized fixtures, nested usage, absent fields | No double-counting, correct units and timing boundaries, missing/partial coverage surfaced |
| SE-004, SE-005 | `benchmark-aggregate.test.ts`: unknown-cause deadline misses versus evidenced provider outage, partial usage, cancellation and common-vs-installation hashes | Deadline misses remain failures in each arm's quality denominator; justified exclusions explicit; pooled quality not presented as A/B; full-install overhead and all attempts retained |
| SE-006, SE-010 | `benchmark-report.test.ts` and lifecycle fixtures: hostile labels/paths/transcripts, ephemeral task files and capture opt-in | Temporary prompt/app processing allowed; unnecessary transcript files suppressed, private task files cleaned on all exits, raw evidence persistence opt-in; escaped public allowlist excludes all raw content |
| SE-007, SE-008 | `benchmark-analyze.test.ts`: each detector and benign lookalikes | Stable evidence IDs and suggestions; rereads after writes and unknown progress do not become proven waste |
| SE-009, SE-010 | `benchmark-upload.test.ts`: fake transport, flush timeout, ambiguous delivery, dedup fixture | Explicit opt-in, no credentials in artifacts, retry-safe IDs, truthful failure, correct unique-trial query results |
| SE-011, SE-012 | `benchmark-cli.test.ts`: fixture-only subprocess flow and existing regression tests | M1 saved fixture to local HTML; M3 adds private report and M4 mocked telemetry independently; existing commands unchanged |
| SE-013 | `benchmark-model-catalog.test.ts`: tier, effort, unavailable model, cost coverage and fit-label fixtures | Exact configuration identity; no fallback; lowest-cost observed-fit output only when quality and cost coverage permit it |
| SE-001, SE-014 | `benchmark-isolation.test.ts`: container configuration, conflicting host/project installs, cross-trial sentinels, inventory/hash mismatch, credential leaks and grader tampering | Fresh state per trial; full installed inventory vs zero target inventory; no forbidden mounts/discovery; user files unchanged; agent cannot modify trusted grader/results |
| SE-001, SE-004, SE-012 | Capability/response fixtures plus separately authorized M1 container E2E | Healthy reference plus actual model outputs through trusted build/readiness/HTTP checks as prerequisites allow; correctly reported task failures are valid, auth/measurement-only errors are not E2E proof; interruption/cleanup and offline replay; one pair proves wiring only |

Actual LLM runs and Azure ingestion/Workbook observations belong to the staged
execution milestones in the implementation plan. Fixtures do not establish those
results.

## 7. Docs impact

Create/update `docs/internal/skill-evaluation-design.md`,
`docs/internal/skill-evaluation-implementation-plan.md`, this FRD, its index, and
`evals/README.md`. Implementation adds `evals/benchmark/README.md` for runnable
instructions in M1 and `docs/internal/skill-evaluation-workbook.json` for the
Workbook in M4.
Document proposed npm commands in `docs/development.md` when implemented.
No canonical skill behavior changes, generated plugin edits, or changes to
`templates/agents/AGENTS.md` are required. Public reports are generated artifacts,
reviewed for disclosure before publication, not automatically committed raw logs.

## 8. Status & sign-off

| Item | Evidence |
| --- | --- |
| Independent architecture review | GPT-6 Astra in the parent planning session confirmed all three revision 5 corrections on 2026-09-09. See [review record and snapshot hashes](../internal/skill-evaluation-design.md#9-independent-architecture-review-record); earlier revision 2 review remains historical |
| Human approval | Pending |
| Approved revision and scope | Pending; record commit SHA or content hash |
| Approval reference and date | Pending |
| Implementation reference | Not started |
| Acceptance evidence | Not collected; test plan is prospective |

Status remains Draft. General agreement in the originating discussion is not
approval of this identified FRD revision. No feature implementation before
Finalized; no paid runs, telemetry delivery, or publication without a separate
milestone execution authorization.
