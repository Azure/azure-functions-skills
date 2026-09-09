# Local skill evaluation: implementation and agent handoff

Status: proposed, revision 5, 2026-09-09. No framework implementation or experiment
has started. This handoff is for another model to implement and test after the
required approvals; it is not an instruction to execute the plan now.

## 1. Read first and respect gates

Read [AGENTS.md](../../AGENTS.md), the [FRD index](../frds/README.md),
[FRD-0001 revision 5](../frds/0001-local-skill-evaluation.md), and the
[technical design](skill-evaluation-design.md), then scoped TypeScript/testing/CLI/
skill instructions before modifying those areas. The FRD governs requirements;
this plan owns dependency order, scenarios and execution checkpoints.

This documentation layer starts at PR #245 HEAD
`5e08b49d32cbbff102559427792d4ed715415af9`. Governance PR #244 is merged
(`a430a5b8ef28b58ec59fe2fb7456d253b557e2d5`); its rules remain binding.
FRD-0001 stays **Draft**. Obtain separate architecture review and explicit human
sign-off of the identified revision before setting it Finalized and implementing.
The Finalized revision's approval must explicitly identify the M0/M1 implementation
scope; deferred transport/catalog/live choices remain unapproved until their gates.
Design agreement is not paid-run, deployment, upload or publication authorization.

Use one primary implementer and a separate reviewer at meaningful checkpoints.
Preserve unrelated work, use canonical templates only if separately authorized,
and do not change skill behavior, rename skills, add sessions or build another
evaluation engine. Append decisions and link evidence to SE requirement IDs.
Existing Vally evals must not run on unreviewed PR code; obtain maintainer-defined
reviewer-gate evidence for local runs, not an invented local waiver.

## 2. First outcome and dependency order

The first usable result is **one installed/uninstalled pair** for
`create-ts-http`, one supported explicit Copilot model/effort, real generated
files/build/host readiness/localhost HTTP/clean shutdown, durable per-attempt JSONL
and a small local static A/B HTML page. It is a wiring smoke, not a quality claim.
No model catalog, private analysis, telemetry, Workbook, Azure deployment, Pages
publishing or scheduled job is required to reach it.

M1 completion means reference-app health and actual model task execution/output
exercise trustworthy measurement, grading, persistence, reporting and cleanup.
Neither arm must pass the task: installed or baseline task failures are valid
results, not reasons to retry until success. Build failures legitimately prevent
later HTTP checks; label those checks not executed. A pair producing only auth or
measurement-infrastructure errors is retained but does not prove real-model
generated-artifact E2E. Report exactly which runtime checks actually executed.

| Gate | Depends on | Scope and non-goals | Acceptance / stop point |
| --- | --- | --- | --- |
| M0. Feasibility | Core design review/approval for implementation; separate authorization for any paid probe | Time-box container, auth, normal-install parity, Vally fields/cancellation, minimal fixture routing and separate grader feasibility; no broad framework | Capability table with source/version evidence, approved image/profile and required supported controls; stop unsupported, never fall back to unisolated host |
| M1. Walking skeleton | M0 | Minimal pair runner, trusted build/HTTP checks, measurements, saved artifacts and static HTML; no later framework modules | Offline fixtures pass, then separately authorized two-trial container E2E; all attempts visible and report regenerates with no model |
| M2. Repetitions and expansion | M1 usable and reviewed | First three repeats per arm for the same scenario/configuration; add scenarios then models one at a time | Counts/ranges, failure evidence, compatible controls and bounded costs; every expansion separately authorized |
| M3. Improvement analysis | M1 saved-artifact contract; M2 evidence where comparisons needed | Five deterministic detectors and private improvement report; no automatic rewriting/LLM judge | Positive/negative/insufficient-evidence fixtures, cautious findings, maintainer dispositions |
| M4. History/publication | M1 artifact/privacy contract; M3 only for finding-count export | Supported Azure Monitor transport, explicit upload, Workbook and optional Pages publication | Fake transport/projection tests, then separately approved destination/retention/pilot; local output unaffected if unavailable |
| M5. Hosted-skills stages | M2 lessons and approved scenario inputs | New-app retrieval, fixed-app modification, later live deployment, then composed cases | Each stage reports its own coverage, not inferred deployed success |
| M6. Scheduled CI | Stable authorized local lane and approved CI contract | Same image digest/manifest/entrypoint; change only triggering, secret injection and artifact storage | Reviewer-gated parity and cleanup/artifact evidence; schedules may await approval |

M3/M4 are not dependencies of M2 or the first hosted controlled scenarios.
No stage auto-authorizes another. Completing M1 does not make the whole FRD
Implemented. Keep all unimplemented requirements open.

## 3. M0: time-boxed feasibility before infrastructure

Proposed time box: one focused engineering day, no paid calls by default. If it
expires without evidence, report blockers/options rather than expand scope.
If a paid capability probe is necessary, obtain a separate bounded authorization;
do not consume the M1 pair invisibly.

| Inspect / prove | Evidence required before M1 |
| --- | --- |
| Baseline and reuse | Record current HEAD/lockfile, Vally CLI/core `0.7.0`, SDK `1.0.5`, package engines and existing specs/workflows; map actual source fields rather than assume upstream main |
| Version compatibility | Reconcile Vally Node 22+ docs with root README Copilot Node 24+ requirements. Select exact compatible Node/npm/Copilot/Core Tools/Vally versions and pin an image digest; no invented version or floating `@latest` |
| Canonical profile | Initial proposed `linux-amd64-2cpu-8g-v1`: Linux amd64, 2 vCPU, 8 GiB memory, concurrency 1. Validate sufficiency, record host/container engine/virtualization/network and image digest; changed profile requires reviewed revision |
| Copilot authentication | Inspect supported minimal runtime injection; existing workflow maps its secret to `COPILOT_GITHUB_TOKEN`, but container support must be proven. No host authenticated-home mount, image/artifact credential, Azure or telemetry credentials |
| Normal installation | Reproduce pinned full Copilot marketplace plugin installation in a disposable container using a supported path. Record package/plugin source SHA, payload hashes, normal resulting layout, all skill inventory and applicable generated config/instructions |
| Discovery and state | Enumerate effective user/project/plugin/instruction/memory roots. Fresh container/session/HOME/COPILOT_HOME/workspace/tmp/writable caches per trial; no host home/.git/ancestor discovery/user-plugin/Docker-socket mounts |
| Tool parity / retrieval | Verify identical effective external tool schemas/access in both variants without duplicate plugin MCP registration; route only the small versioned template/manifest/MCP response fixture set through supported contracts |
| Adapter limits and capture | Map model/effort identity, usage/cache/cost, calls, turns, timing, activation, subagents, cancellation and content capture to pinned fields. Label optional missing metrics unavailable; required isolation/cleanup unsupported blocks |
| Trusted grading | Agent cannot reach graders, answers or authoritative results. Authoritative build/HTTP checks execute generated scripts in a credential-free disposable compartment, observed by separate trusted grading code; cwd-only separation is insufficient |
| Policy and no-send | Maintainer confirms local reviewer gate. Both arms use documented telemetry opt-outs; verify no plugin/MCP send, not just absent Azure credentials |

Inspect [`.vally.yaml`](../../.vally.yaml), [package.json](../../package.json),
[create evals](../../evals/azure-functions-create/eval.yaml),
[existing workflow](../../.github/workflows/skill-evaluation-offline.yml) and
[normal install documentation](../../README.md#quick-start). Existing create specs
load a selected skill bundle and `@azure/mcp@latest`; they are prior art, **not**
the primary full-install benchmark. Existing weighted invocation graders are not
task-success criteria. Do not modify those suites to create this new lane.

The README distinguishes marketplace plugins from `install --local` (skill
bodies, MCP and hooks only, no instruction/routing/agent/prompt copies).
Use actual normal layout, not an invented hybrid. Prefer the full normal
Copilot plugin route; if its pinned reproduction is unsupported, stop for a
reviewed alternative route decision. Do not silently use only create/common/setup.
External tools remain common controls even if installed config normally registers
them: document supported fixture routing/registration and telemetry opt-out.

A Vally upgrade is permitted after source/changelog compatibility review and
targeted existing-suite regressions, then lock the selected version. Record gaps
as supported, unavailable or unverified. Do not replace Vally, install speculative
dependencies or claim unavailable billing/turn fields are supported.

## 4. M1: implement one vertical slice

All paths/commands below are proposed, not present runnable interfaces. Follow TDD
using existing Vitest: implement each smallest slice only after its deterministic
tests. Use strict TypeScript/ESM and existing helpers. Add no frontend framework,
database, scheduler, new package exports or npm lifecycle scripts. Inspect packed
contents if adding compiled files under `lib/`; keep tooling development-only.

| Order | Likely paths | Concrete deliverable | Acceptance gate |
| --- | --- | --- | --- |
| 1. Minimal contracts and offline report | `src/benchmark/contracts.ts`, `storage.ts`, `aggregate.ts`, `report.ts`; `tests/benchmark-storage.test.ts`, `benchmark-normalize.test.ts`, `benchmark-aggregate.test.ts`, `benchmark-report.test.ts` | One pair manifest, durable JSONL, public allowlist and escaped single-file A/B table from synthetic records | Missing/partial usage, failures, cancellation, truncated final record, complete malformed record, duplicate IDs, hostile HTML and zero baseline covered; no model/network |
| 2. Container and retrieval adapter | `evals/benchmark/` image/tool inputs and fixtures; `src/benchmark/vally-adapter.ts`, `runner.ts`; `tests/benchmark-isolation.test.ts`, `benchmark-runner.test.ts` | Thin supported Vally adapter, independent tool configuration, bounded fresh trial lifecycle and safe inventory evidence | Unknown fixture requests fail, no live fallback; required unsupported capability stops; cross-trial state/credential/grader isolation fixtures |
| 3. Real task grading | `evals/benchmark/` reviewed reference app, response fixtures, trusted checks; `tests/benchmark-graders.test.ts` | Clean reference-app build/host/HTTP/shutdown preflight, followed by same trusted outcome checks against agent artifacts | Passing, bad code/route, wrong body, unavailable tool, deadline and cleanup cases; scripts cannot tamper with expected results |
| 4. Wire entrypoint and runbook | `src/benchmark/cli.ts`, `tests/benchmark-cli.test.ts`, `evals/benchmark/README.md`, `docs/development.md` | Minimal `plan`, `run`, `report`; exact dry plan and authorization gates, bounded lifecycle, metadata normalization | Fixture-only subprocess flow completes/replays local report without model/network; existing CLI/evals/hooks/exports unchanged |
| 5. Authorized real pair | Same entrypoint/image, reviewed immutable input revisions | One real model attempt per arm with actual generated files/build/HTTP and full-install overhead | M1 E2E checklist below, local JSONL/HTML and cleanup evidence; no quality or savings threshold |

Do not implement `analyze`, `upload`, generic model catalog selection or all
detector metadata before the first pair. Reserve extension fields only where
already needed, rather than build a general execution/manifest framework.

### 4.1 One complete noninteractive task

Proposed `create-ts-http` stimulus (both arms receive identical text):

> Create a new Azure Functions TypeScript application in the empty workspace.
> Add an anonymous HTTP GET endpoint at /api/hello that accepts a name query
> parameter and returns HTTP 200 with JSON {"message":"Hello, <name>!"}; when
> omitted, use "world". Include the files and npm scripts needed to install,
> build and run locally using the available toolchain. Do not deploy or create
> Azure resources. Use these choices without asking follow-up questions.

Use one explicitly selected supported model/effort; no implicit default, alias
substitution or model-tier lookup. Set numeric turn, model-call, wall-time,
output, host-readiness and cleanup caps in the approved manifest. The prompt
defines outcome, not invocation of a named skill or a required skill workflow.
Tool selection and retrieval remain real. Baseline may solve the task differently.
Trusted graders verify registration/route, real build and host readiness, real
HTTP for named/default inputs and clean shutdown, not output prose or invocation.

The task workspace starts empty in both arms, except identical declared harness
inputs and intentional installation metadata. Do not copy a finished template
app into it. Fixtures answer a limited reviewed retrieval contract; unknown
requests fail explicitly, not a canned all-success platform. Pin returned
template archives/manifests/dependency locks. A fixed immutable cache seed is
copied to each fresh writable cache; record package resolution/network misses.
Do not assume this makes model or dependency access fully offline.

### 4.2 Small artifact/schema contract

Use `plan.json`, `run.json`, `trials.jsonl`, optional safe metadata
`events/<attempt-id>.jsonl`, and `public/public-summary.json` plus
`public/index.html`. Keep private data outside the public directory. Authoritative
JSONL is written by the trusted controller, never the agent.

The task prompt and generated app may exist while needed for execution/grading in
isolated, private, size/time-bounded ephemeral storage. This is not persistent
evidence capture. Suppress unnecessary raw Vally transcripts by default; clean up
required temporary task files on completion, failure, cancellation and crash
recovery, with explicit cleanup-failure evidence. Persisting transcripts/generated
code needs separate approved `--capture-content`, private retention and redaction.
No raw temporary or captured content enters the public metadata projection.

| Record | Minimum fields / semantics |
| --- | --- |
| Plan | `schemaVersion`, `runId`, scenario/spec/fixture/grader revisions, image digest/profile, installation route/full payload hash, common instruction/tool hashes and expected installation differences, exact model/effort, lane, cache policy, pairs/order/caps, authorization reference |
| Pair | `pairId`, repetition, ordered installed/uninstalled trial IDs, common controls hash; enumeration before model execution |
| Attempt/result | `runId`, `pairId`, `trialId`, `attemptId`, nullable `retryOfAttemptId`, variant, started flag, timestamps, status, failure class/reason/evidence, task outcome, mandatory checks, cleanup, inventory/content lineage and measurements |
| Measurement | Nullable value, unit, source and `coverage: complete / partial / unavailable` with reason; tokens, turns, model/tool calls, agent duration and install/startup/grading durations; cost/cache/activation/subagents when exposed |
| Run finalization | All planned IDs accounted for; terminal/interrupted/never-started counts, completion state, cleanup failures and all-attempt time/cost/coverage; flush observations durably |

Example pair semantics, **synthetic, not measurements**:
`pair-01` plans `trial-i-01/attempt-i-01` then `trial-u-01/attempt-u-01`.
Installed passes build/HTTP with complete task tokens; uninstalled times out with
partial usage and unknown cause after missing required outcomes by the deadline.
Its `taskOutcome` is `fail` and `failureClass` remains `unclassified`.
Both rows remain: installed overall/conditional success is 1/1, uninstalled is
0/1; pooled success is 1/2 for supplementary accounting only. In contrast, if
independent evidence proves a provider outage prevented evaluation, uninstalled
is `not-scorable`: its overall success stays 0/1, conditional quality is
unavailable (0 scorable, 1 excluded with evidence). Installed stays 1/1; a pooled
conditional 1/1 must not appear as an A/B quality metric. Operational completion
in this example is installed 1/1 and uninstalled 0/1.
Show the timeout's observed elapsed time as censored and partial consumption as
partial; do not compute a complete token delta from it. Installation overhead
remains in the installed row. Retrying requires a new authorized pair with both
arms and new IDs linked to these attempts; original costs/outcomes remain visible.

The small HTML page shows pair rows and A/B totals: scenario/model/effort, lane,
image/profile, installation revision/inventory, status/failure class, operational
completion, overall task success, conditional task quality with per-arm denominators
and explicit exclusions (pooled accounting secondary, not the A/B metric),
tokens, latency, turns/calls, install/startup cost, coverage and cleanup.
Use complete-observation median/range with n; show all-attempt and successful-only
views separately. Missing usage is never zero. One pair is labeled smoke; three
per arm is small-sample descriptive evidence, not statistical uplift. Higher
tokens or unchanged quality are valid results, not failures of the benchmark.

### 4.3 Failure/recovery contract

Preflight checks auth/model/tool availability and the independent reference app
before starting the task. Use status plus evidence-based cause: task,
infrastructure, provider, unclassified, cancellation (or none). Timeouts are
statuses, not automatic infrastructure diagnoses; incorrect agent URLs/code are
task failures. Separate observed `taskOutcome` from cause diagnosis: a started task
missing required outcomes by its deadline normally fails, even if cause remains
unclassified. `not-scorable` is restricted to independently evidenced infra/provider
failures preventing evaluation, external cancellation/interruption making the
outcome unevaluable, or never-started tasks. Unknown cause alone never excludes a
deadline miss. Distinguish interrupted/not-started trials from completed attempts.
Keep operational completion, overall success and conditional quality separate;
never hide expensive failures by publishing only task-scorable or successful rows.

Persist the plan first, running markers before calls, and terminal records as
attempts finish. On crash, recover planned/pending IDs as visibly interrupted/
not-started, preserve complete records, diagnose a truncated tail explicitly and
reject corrupt complete records. No silent retries or resumed agent/cache state.
Record output truncation, late usage, elapsed/censored times and cleanup failures.
Enforce budget before subsequent trials; unknown spend requires explicitly
approved count/time-only limits, never a claim of a hard monetary ceiling.
Stop only owned process/container IDs and clean their ports/workspaces.
Use predeclared symmetric responses only if supported; interactive-only requests
without a supported response mechanism block the scenario instead of hanging.

## 5. Tests and separately authorized container E2E

| Evidence lane | What it proves | Authorization boundary |
| --- | --- | --- |
| Offline unit/integration | Synthetic capability/result fixtures, no model/network; fake executor, reference/grader fixtures with preinstalled pinned dependencies, storage/report replay | Code approval and ordinary local test policy; not quality/runtime-auth proof |
| Controlled container E2E | Real Copilot model/auth, generated files, build/readiness/HTTP/shutdown with versioned retrieval fixtures | Reviewed code/inputs plus explicit paid authorization; not fully offline |
| Live integration (later) | Current external MCP/templates, then separately scoped deployment | Separate network/target/identity/budget/resource-cleanup approvals |

Before paid E2E, reviewer verifies: exact supported model ID/effort; reviewed runner,
skill/package and fixture SHAs; image digest/profile; local reviewer-gate evidence;
one pair = two task attempts; any additional probes/failure-path trials separately
enumerated; numeric budget and time/turn/call/output limits (or explicitly approved
count/time-only mode if cost unavailable); allowed endpoints/tools; supported
credential source reference; owned-container/process/root cleanup; retention and
no-cloud/no-upload/no-publish scope. Store references, never credentials.

Required E2E checklist, with synthetic fault injection where stated:

| Requirement | Acceptance evidence |
| --- | --- |
| SE-001, SE-014: competing install | Host has a competing old user install (or an evaluation-owned simulated host profile for fixtures); fingerprint approved non-secret install files before/after; no real-user mutation, mounts or inherited instructions. Actual-host acceptance remains unproven if only simulated |
| SE-005, SE-014: treatment | Full normal installed inventory/content lineage vs zero target inventory; identical user/common instructions/tools/fixtures, expected catalog/generated-instruction differences recorded; no skill-named prompt or removed overhead |
| SE-001, SE-014: fresh state | First trial's sentinel files/memory/cache are absent from next fresh container/session/HOME/COPILOT_HOME; no Docker socket/checkout/home mount |
| SE-004: real outcome | Reference app demonstrates healthy build/readiness/named/default HTTP/shutdown; real model outputs reach trusted checks, which attempt build/start/HTTP as prerequisites allow and label downstream checks not executed after task failures. Either arm may fail the task; auth/measurement-only error pairs do not prove generated-artifact E2E |
| SE-010, SE-014: trust/privacy | No secret in image/artifacts/logs or telemetry send; agent cannot modify graders/results; authoritative grading runs without credentials. Temporary prompt/app processing works without capture opt-in, unnecessary transcript files are suppressed, bounded private task files are cleaned on all exit paths, and persistent raw evidence requires opt-in |
| SE-002, SE-003, SE-004: failures | Offline fixtures keep unknown-cause deadline misses in each arm's quality denominator, exclude only evidenced unevaluable cases, and cover partial usage, task failure vs auth/measurement-only pairs, cancellation/interruption and cleanup; authorized E2E confirms real runtime cancellation/cleanup mechanics within separately enumerated limits |
| SE-002, SE-006, SE-012: replay | Remove credentials/disable model access, regenerate HTML from saved JSONL, same measurements and clear incomplete/coverage flags; no model or network call |

Do not claim simulated isolation/failure tests prove paid runtime behavior.
If required failure-path E2E exceeds two task attempts, request an explicit
additional allocation, not an invisible retry. Run only tests that have been
implemented, using the existing runner, for example:

```powershell
npm test -- tests\benchmark-storage.test.ts tests\benchmark-normalize.test.ts tests\benchmark-aggregate.test.ts tests\benchmark-report.test.ts tests\benchmark-isolation.test.ts tests\benchmark-runner.test.ts tests\benchmark-graders.test.ts tests\benchmark-cli.test.ts
npm run lint
npm run typecheck
```

Follow all repository before-commit gates and relevant existing regressions.
Never run paid `eval:smoke`/`eval:full` as ordinary tests. No new test tool.
If published CLI behavior changes, obtain separate scope approval and isolated
CLI E2E; the planned benchmark entrypoint is development-only.

Proposed command contracts (not available yet):

```powershell
npm run benchmark -- plan --manifest evals\benchmark\pilot.json --out results\benchmarks\pilot-plan
npm run benchmark -- run --plan results\benchmarks\pilot-plan\plan.json --authorization C:\approved\pilot-authorization.json
npm run benchmark -- report --run results\benchmarks\<run-id>
```

`plan` resolves reviewed inputs without model/network; `run` alone invokes models
and never uploads/publishes; `report` and later `analyze` replay saved artifacts.
Later `upload` only sends reviewed projections and never runs models.
Implement invocation details only through M0-proven Vally APIs, not guessed flags.

## 6. Later stages retain the full-framework goals

### M2: repeat, then expand scenarios and models

After one pair satisfies M1 harness acceptance (not necessarily task success),
authorize e.g. three repetitions per arm (six trials total),
concurrency 1 and alternating pair order, with the same cold writable state.
Retain n, range, missing/partial and failure counts. Do not treat 1/1 or 3/3 as a
general quality guarantee. Expand one axis at a time with reviewed manifests.

| Complexity | Scenario | Mandatory task evidence |
| --- | --- | --- |
| Simple | `create-ts-http`, empty workspace | Build, host readiness, real localhost HTTP, clean shutdown |
| Moderate | `add-ts-http`, fixed existing app | Preserve existing behavior/files except allowed edits; build and HTTP |
| Complex | `create-go-http`, empty workspace | Native-worker/module conventions, no authored `function.json`, real `go build`; additional runtime checks require explicit scope |

Preserve requested future model candidates, without claiming availability:

| Tier | Candidate configurations |
| --- | --- |
| Powerful | GPT-6 Astra (`medium`), GPT-6 Astra (`low`), GPT-5.6 Sol, Claude Opus 5 |
| Versatile | Claude Sonnet 5, GPT-5.6 Terra |
| Lightweight | GPT-5.6 Luna, MAI-Code-1-Flash |

Resolve exact IDs and supported efforts before each authorization; never substitute.
The earlier `3 scenarios x 8 configurations x 3 repetitions = 72` installed
trials plus `3 x 3 representative configurations x 3 = 27` controls is retained as
a **deferred capacity-planning example**, not the MVP budget or a fully paired
catalog. Only 27 installed observations would have those matched controls.
A primary paired eight-configuration matrix would require 72 per arm = 144,
separately reviewed/authorized; do not compare unmatched catalog slots as A/B.
Report fit labels and lowest-cost observations only under the design's sample/
coverage rules and shared Copilot billing semantics, never vendor API pricing.

### M3/M4: analysis, history and publication

Retain SE-007/008's five detectors (repeated-read, repeated-failure,
search-without-progress, input-growth, matched-regression), private Markdown
evidence/hypotheses/recommendations and maintainer dispositions. Use positive,
negative and insufficient-evidence fixtures; do not assert one file caused all
tokens or promise savings. They run only on stored artifacts.

Retain SE-009/010's explicit supported telemetry transport, fixed allowlisted
projection, opt-outs, flush/failure handling, at-least-once retry state and
Workbook deduplication. Use fake transport tests first. Resolve SDK/auth/sampling/
retention before implementing the uploader, not before M1. Actual upload and
Workbook observations need destination/budget approval. Publish only reviewed
public HTML/JSON under separate Pages authorization; private evidence stays private.
Unavailable cloud permissions never invalidate an otherwise usable local M1.

### M5: stage-isolated hosted-skills evaluation

At this parent SHA the actual canonical skill/eval name is
`azure-functions-hosted-skills`; earlier documents used `azure-functions-agents`.
Use a reviewed stable opaque identity (proposed `afs-skill-0002`) with aliases,
actual canonical name and content lineage separate. Do not perform rename edits
or read another worktree. Freeze revisions for a batch; later renames do not
silently combine changed content histories.

| Stage | Starting state and task | Coverage / boundaries |
| --- | --- | --- |
| H1. Retrieval/new app | Empty workspace; retrieve reviewed template and create a small hosted-skills app, e.g. built-in MCP session surface | Controlled retrieval/configuration and build/local checks only where supported; no pre-supplied finished app |
| H2. Configuration change | Fixed existing app; change endpoint/session/background settings without rebuilding the project from scratch | Static config/preservation tests; scheduled Teams briefing and Outlook draft-only cases remain configuration-only, no mailbox access or message sending |
| H3. Deployment | Fixed reviewed deployable app, independent of H1 output; explicit live lane | Actual deploy/runtime checks only after Azure target/identity/budget/owned-resource cleanup approval; never label static checks deployed success |
| H4. Composed cases | Small new-app-to-modification-to-deployment examples only after H1-H3 stabilize | Separate composed label and stage evidence; no inference that isolated passes guarantee full integration |

Doctor, diagnostics, setup and help follow usage/value evidence through revisions
to this same scenario plan, not new FRDs for ordinary scenario additions.
Other executors, LLM analysis and automatic remediation remain out of scope.

### M6: CI parity

Reuse the same approved image digest, manifest and entrypoint. CI changes only
triggering, secret injection and artifact storage; record runner hardware/resource
profile and avoid comparing incompatible latency. Keep existing reviewer-gated
unreviewed-PR policy, including scheduled jobs awaiting approval. A schedule is
not authorization to run arbitrary PR code; Docker alone is not a safe sandbox.
No new evaluation workflow in this documentation layer or initial MVP.

## 7. Review rubric, stop conditions and continuation

| Reviewer question | Required answer / requirement allocation |
| --- | --- |
| Is the first usable output independent of broad infrastructure? | M0/M1 deliver SE-001/002/003/004/005/006(local)/010/011/012/014; SE-013 catalog expansion M2, SE-007/008 M3, SE-009/history/publication M4 |
| Is A/B normal installation, not selected skills? | Full payload/layout/inventory, common tool/instruction hashes, intentional installation differences/overhead retained; all paired attempts and no required savings |
| Is controlled execution genuine? | Real model/build/HTTP, small retrieval fixtures, pinned image/dependencies/cache, separate grader; no claim of offline model, identical outputs or universal container safety |
| Can another model execute the handoff safely? | Ordered TDD slices, paths, schemas, failure evidence, replay contract, exact authorization record and E2E checklist; unsupported gates stop before paid work |
| Are downstream goals preserved without blocking M1? | M2 tiers, M3 private analysis, M4 history, M5 stage isolation and M6 CI traced above; deferred means not implemented/authorized |

Stop and report evidence when isolation/auth/normal-install parity or required
Vally controls are unsupported; reviewer or human approval is absent; a model/
effort is unavailable; secrets or grader boundaries leak; reference health fails;
budget/limits are reached; corrupt results or incomplete cleanup cannot be safely
resolved. Do not silently downgrade tools, change route/model, loosen graders,
retry only failing arms or fall back to a host session.

At each checkpoint report approved revision/SE IDs, files/implementation reference,
synthetic vs real evidence, all planned/attempted/completed counts, actual
consumption/coverage, limitations, cleanup/retention, changed decisions and the
next gate. Preserve unfinished requirement IDs explicitly. Do not mark FRD-0001
Implemented from fixture artifacts, one smoke pair, or an unexecuted plan.
