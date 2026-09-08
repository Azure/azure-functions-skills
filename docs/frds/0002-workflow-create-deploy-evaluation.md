# FRD-0002: Workflow create/deploy evaluation

| Metadata | Value |
| --- | --- |
| Status | Finalized |
| Revision | 3 |
| Created | 2026-09-07 |
| Updated | 2026-09-07 |
| Author | GitHub Copilot, with requirements from Tsuyoshi Ushio |
| Depends on | [FRD-0001: Local workflow runner](0001-workflow-runner.md) |
| Related | [Existing Vally evaluation](../../evals/README.md), [F21: Template Apply](../prd-docs/f21-template-apply-cli-library.md) |

## 1. Summary

After building the runner, create runnable comparison samples for
`azure-functions-create` and `azure-functions-deploy`, execute the approved
experiments including real Azure deployment, and deliver a reproducible report
of token usage, turns, correctness, failures, and resource cleanup. The first
configuration is TypeScript, HTTP trigger, and Flex Consumption (FC1). Sample
creation or mocked execution alone does not complete this FRD.

## 2. Motivation / problem

Fewer tool calls visible to an agent do not necessarily mean fewer total tokens.
Plan generation, extra instructions, discovery, and recovery can offset savings.
An existing template CLI or a simple script may provide most of the benefit
without a DAG.

Existing create evaluations cover routing and guidance, with an execution case
for Go. The TypeScript comparison needs actual generated files, a build, and a
local request. Existing live deploy evaluation provides a pinned TypeScript FC1
fixture, reviewer gate, identity, and resource lifecycle, but its command regex
does not observe commands running inside a new runner.

Measure realistic outcomes without weakening skill delegation, security,
approval, or output quality just to obtain a lower token count.

## 3. Goals / non-goals

### Requirements and acceptance criteria

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| WE-001 | Runnable TypeScript HTTP create sample | Generated files build and pass an independent local GET check |
| WE-002 | Runnable real FC1 deploy sample | Azure app/resources exist with expected configuration; authenticated GET returns expected response |
| WE-003 | Fair baseline and runner comparison | Same requests, pinned environment, fresh sessions/workspaces, documented treatment difference |
| WE-004 | Account for full agent token usage | Actual host usage includes planning through final response; missing usage is not zero |
| WE-005 | Distinguish DAG benefit from scripting | Create includes a no-runner deterministic-script/CLI control using equivalent helpers |
| WE-006 | Demonstrate recovery safely | Local failure fixtures show bounded retry, replan, successful reuse, and no unknown replay |
| WE-007 | Authorize and clean up real resources | Reviewed code, reviewer gate, approved budget/target, trial ownership, and deletion evidence |
| WE-008 | Deliver measured, reproducible report | Per-trial sanitized data, comparisons, failures, limitations, and an adoption recommendation |

### Non-goals

Multiple languages/triggers/models in the initial experiment; a new LLM
evaluation service; fleet execution; automatic nightly benchmark rollout;
modification of existing create/deploy default routes; intentional live-cloud
failures; a guaranteed positive reduction percentage.

## 4. Proposed design

### Samples and controls

Use `samples/workflow-runner/` for a README, create/deploy inputs, plan examples,
and small shared helpers. Do not commit generated applications, actual
credentials/configuration, or raw run logs.

| Arm | Behavior | Purpose |
| --- | --- | --- |
| A | Current skill without runner guidance | Existing user-experience baseline |
| B | Same requirement with explicit workflow opt-in for already-decided operations | End-to-end runner benefit |
| C, create only | Equivalent deterministic helper/CLI without a DAG | Separate file-materialization/script benefit from runner benefit |

The proposed initial sample size is three trials per arm: create A/B/C and deploy
A/B, one fixed model. Confirm the count and model before execution; record any
budget-driven change before observing results. A deploy script control is a later
option requiring its own execution authorization.

Each trial gets a fresh workspace and agent session. Each deploy trial gets a
unique owned resource group and azd environment. Deploy starts from an identical
pinned deploy-ready fixture, not a successful create trial, to separate the
measurements.

Pin and record the host/SDK, model, Functions Skills, Azure Skills, MCP, template,
and CLI/runtime versions. Alternate A/B ordering and align cache warmup. Keep the
user request identical; B adds only explicit runner-use guidance.

Make the same pinned `azure-prepare`, `azure-validate`, and `azure-deploy` available
in both arms. Record their delegation/validation evidence. Neither the harness
nor the runner may silently bypass these steps. If a pinned upstream skill does
not permit batching a particular operation, leave it agent-owned in both arms
and report that limitation rather than patching upstream instructions to force
a favorable benchmark.

Create can batch known MCP retrieval, artifact-to-helper handoff, dependency
installation, build, and finite verification. Keep template choices, best-practice
interpretation, and unfamiliar errors with the agent. Prefer existing template
apply when it meets the same output requirements; otherwise a narrowly scoped
sample helper can materialize MCP results and must be available to C as well.
Test path safety, overwrite policy, and secret handling for that helper.

Deploy can batch only finite operations approved within the Azure Skills
workflow, including established preflight, execution, and post-deploy commands.
If normal deployment is already one `azd up` call, low or negative runner benefit
is a valid result.

A finite harness/helper owns local `func start`, readiness, GET, and shutdown of
its own process. Do not turn the runner into a daemon manager.

### Reuse the existing evaluation infrastructure

| Asset | Use / adaptation |
| --- | --- |
| `evals/azure-functions-create/eval.yaml` | Preserve MCP-first and output expectations; add isolated execution comparisons |
| `evals/azure-functions-deploy/eval.yaml` | Reuse pinned TS FC1 fixture; add independent resource/HTTP evidence beyond command regex |
| `.vally.yaml` and Vally executor | Dedicated manually selected benchmark suite, usage, and trajectories |
| `skill-evaluation-azure-live-deploy.yml` | Reuse reviewer-gated environment, OIDC, step-scoped token, and artifact handling |
| `cleanup-azure-live-eval-resources.yml` | Retain the tagged-resource safety net; do not assume it runs without approval |

Use dedicated benchmark specs/selectors so new trials do not enter smoke, full,
or the existing nightly live suite accidentally. Preserve the current workflow
default behavior. The existing live workflow provisions one RG/env per workflow
run, so add explicit trial-level ownership rather than running multiple trials
against that same environment.

The per-node receipts defined in FRD-0001 record which planned operations the
runner attempted, their outcomes, and reuse provenance; independent probes
establish effects. Neither receipts alone, a final answer containing a hostname,
nor a transcript mentioning `azd up` is sufficient deployment evidence.

### Measurement contract

The measurement window runs from initial task context through the final answer,
including skill loading, discovery, DAG authoring, retries, and replan. Do not
report only the runner's LLM-free execution interval.

| Metric | Source and interpretation |
| --- | --- |
| Input/output/cache tokens | Actual Vally/host usage; document whether cache counts are included in input and avoid double counting |
| Model calls/turns | Usage and trajectory events; distinguish these from tool-call counts |
| Host-visible output bytes | Intermediate MCP/exec payload versus runner reports; disk bytes are separate |
| Correctness | Independent file/build/HTTP and Azure state checks with equal criteria for all arms |
| Attempts/reuse | Runner receipts, fixture counters, and artifact provenance |
| Time and cost | Elapsed and available billing data; distinguish from token usage and resource retention |

First confirm that the executor exposes complete usage for a small approved
trial. If necessary, add a thin collector over existing executor events, not a
new model execution framework. Missing data remains missing and blocks token
effectiveness conclusions; do not estimate tokens from character counts.

Use the same build/HTTP assertions for all arms. Obtain any function key inside
the harness without sending it to the agent or report. Do not weaken managed
identity, authentication, or deployment settings to make an arm pass.

Run deliberate recovery scenarios only with safe local fixtures: large MCP
output, one known transient failure, a revised DAG importing success, and a lost
response/timeout. Do not interrupt live deployments or manipulate live
permissions to simulate errors.

Report each trial, success/failure, medians, ranges, and aggregate usage including
failures. For comparable successful pairs, reduction is `(A - B) / A`. A failed,
cheap early exit is not a saving. Small sample sizes do not establish broad
statistical significance. Explain environmental failures and ordering/cache
effects.

Before observing results, record an adoption rubric with the human: minimum
useful token reduction, acceptable correctness/failure behavior, and how the
script control changes the recommendation. Missing data or a correctness/security
regression precludes a positive adoption claim regardless of token savings.
Do not invent a favorable threshold after the experiment.

Record grader-model usage separately from the evaluated agent. Separate sample
development effort from per-run operational cost. Include the extra files and
maintenance burden in the adoption recommendation.

### Execution authorization, resource ownership, and cleanup

FRD sign-off authorizes implementation of the samples, not paid execution.
Before any live experiment, confirm:

- Reviewed immutable code/skill/harness revisions and the existing environment's approval.
- Subscription, tenant/identity, region, FC1 availability/quota, and permissions.
- Model, trial count, budget ceiling, timeout bounds, and resource limits.
- Unique RG/env ownership tags, deletion policy, and any explicitly approved retention.

Do not run Vally on unreviewed PR code or bypass an unavailable reviewer gate with
a local/alternate workflow. Do not auto-grant missing permissions. Use only the
resources owned by the trial, not shared user applications.

The harness owns cleanup in finally/`always()`, including failed trials. Record
all created RGs in a manifest and verify deletion, not just acceptance of
`az group delete --no-wait`. Do not start another trial if cleanup, authorization,
or budget conditions fail. Report remaining resources and remediation clearly.

The existing scheduled cleanup also uses a reviewer-gated environment; it can
wait for approval and is not a guarantee of automatic deletion. Azure cost data
and alerts can lag, so enforce count/resource/timeout limits too. Debug retention
requires specific approval for that run.

### Report and delivery checkpoints

Deliver reproducible sample/eval inputs, sanitized per-trial JSON, a Markdown
comparison, HTML, and approved execution links. Store the reviewed English
conclusion at `docs/reports/workflow-runner-evaluation.md`; keep JSON/HTML run
artifacts under `results/workflow-runner/`. Provide a Japanese explanation in
session artifacts for the requesting user.
Commit the reviewed report, not run artifacts: `results/` remains git-ignored.
Share sanitized JSON/HTML through approved artifacts and link them from the report.

Include versions/methodology, create A/B/C and deploy A/B results, failures,
token/turn/quality comparisons, recovery evidence, deployment/GET evidence,
resource disposition, limitations, and a recommendation: adopt selectively,
prefer a script/template CLI, extract, or remove.

Sanitize shared artifacts; do not publish credentials, environment values, keys,
or raw sensitive trajectories. Keep needed raw evidence access-controlled.
Reuse existing report generation patterns rather than adding a UI framework.

Finalize this FRD after the runner checkpoint, build samples and collectors,
review their immutable revisions, obtain separate live-experiment authorization,
execute trials, verify cleanup, then deliver the report. Zero or negative savings
is a valid completed result. Missing execution, usage, or required cleanup is
explicitly incomplete/blocked.

### Open questions

| Item | Owner / resolution gate |
| --- | --- |
| Stable template/MCP versions and helper equivalence | Pin the exact resolved versions in each experiment manifest before any trial; compare identical materialization helpers |
| Vally usage normalization | Preserve source input/output/cache fields with explicit cache accounting metadata; reject missing token/turn/elapsed evidence instead of estimating; validate against executor fixtures before trials |
| Pre-registered adoption rubric and minimum useful reduction | Human/reviewer before live-run authorization and before observing comparative results |
| Model, repetitions, Azure identity/target, budget, retention | Human run authorization after sample review; not authorization granted by this draft |

## 5. Decisions log

| ID | Decision / options | Choice and rationale | Decided by | Date |
| --- | --- | --- | --- | --- |
| D-001 | Samples only or actual results | Build samples, execute, and report; include actual Azure deployment | Tsuyoshi Ushio, user requirement/confirmation | 2026-09-07 |
| D-002 | Initial workload breadth | TypeScript HTTP FC1 only; create/deploy measured separately | Tsuyoshi Ushio, planning confirmation | 2026-09-07 |
| D-003 | Azure execution permission | Confirm target, budget, and deletion before the experiment | Tsuyoshi Ushio, planning confirmation | 2026-09-07 |
| D-004 | Existing or new evaluation framework | Reuse Vally and the existing reviewer-gated environment | GitHub Copilot, proposal pending FRD approval | 2026-09-07 |
| D-005 | Controls and sample size | A/B, create C, proposed three trials/arm; count remains subject to run approval | GitHub Copilot, proposal pending FRD approval | 2026-09-07 |
| D-006 | Success definition | Independent effects/HTTP, full usage, failures and cleanup; no required positive savings | GitHub Copilot, proposal pending FRD approval | 2026-09-07 |
| D-007 | Review gaps in evidence and adoption | Use FRD-0001 receipts plus independent probes; git-ignore trial artifacts; pre-register the human adoption rubric | GitHub Copilot, revision 2 after independent review; pending human approval | 2026-09-07 |
| D-008 | Implementation authorization | Build samples and measurement tooling under the repeated implementation directive; no live execution authorization inferred | User instruction at 2026-09-07T13:46:30-07:00 | 2026-09-07 |
| D-009 | Measurement implementation details | Observe raw events through a thin existing-executor wrapper; run a paid, gated readiness preflight before Azure provisioning; use default Vally file output. Retain later measurement gaps as incomplete records. | GitHub Copilot, implementation correction following independent Vally integration review | 2026-09-07 |
| D-010 | Host versus Functions runtime | Pin the Copilot host to Node 24+ and the local/cloud Functions worker to Node 22 separately; inspect the actual deployed runtime. Read approved SHA from reviewer-maintained environment configuration. | GitHub Copilot, implementation correction within the approved workload and authorization boundaries | 2026-09-07 |
| D-011 | Accounting completeness and hidden trial retries | Disable Vally whole-trial retries, load the built-in executor through the actual staging-plugin API, merge matching persisted shutdown totals with live usage capture, and preserve partial observed costs without claiming complete totals. Pair only equal observed models/accounting sources. | GitHub Copilot, integration fixes following the focused independent review | 2026-09-07 |

## 6. Test plan

| Requirements | Test / fixture / experiment | Expected evidence |
| --- | --- | --- |
| WE-001, WE-005 | Isolated create samples and helper unit tests | Equivalent usable apps; build and GET; safe file materialization |
| WE-002, WE-003 | Reviewed live A/B trials | Distinct owned RGs, delegation, app settings, real GET |
| WE-003, WE-004 | `tests/workflow-benchmark.test.ts`, `tests/workflow-usage-executor.test.ts`, `tests/workflow-benchmark-cli.test.ts` | Correct token accounting, missing-field detection, raw capture, preflight and no cache double count |
| WE-006 | `tests/workflow.test.ts`, `tests/workflow-mcp.test.ts`, `tests/workflow-evidence.test.ts`, recovery sample | Bounded recovery, no success replay, explicit unknown outcome, imported attempts not double-counted |
| WE-007 | `tests/workflow-benchmark-probes.test.ts` | Only owned IDs are deleted; failure blocks subsequent trials |
| WE-008 | `tests/workflow-benchmark-cli.test.ts` and actual run artifacts (pending) | Per-trial data reconciles with summaries; no hidden failed trials or leaked secrets |

Use existing Vitest for helper/collector/report code and Vally lint for specs.
Use reviewed code and the existing environment gate for LLM/live execution.
Do not claim that mock or static checks fulfill WE-002, WE-004, or WE-008.

## 7. Docs impact

Add sample instructions, benchmark spec documentation, and the measured report.
Document reproducibility, consent, budgets, secret handling, ownership, and
cleanup. Update eval/CI documentation only for the opt-in benchmark path; retain
normal skill routing and existing scheduled-run behavior.

The root development `AGENTS.md` and FRD process require evidence before marking
this FRD Implemented. Do not change `templates/agents/AGENTS.md`.

## 8. Status & sign-off

| Item | Evidence |
| --- | --- |
| Independent architecture review | 2026-09-07: separate Claude Opus 5 review; receipt dependency, artifact policy, and pre-registered adoption rubric clarified in revision 2 |
| Human approval | User explicitly directed implementation after the approval gate was explained |
| Approved revision and scope | Revision 2 implementation scope; revision 3 records fail-closed measurement requirements |
| Approval reference and date | Session instruction at 2026-09-07T13:46:30-07:00: "stop planning and start implementing" and "make good decisions" |
| Implementation reference | `src/workflow-evaluation/`, `samples/workflow-runner/`, dedicated manual workflow and matching tests, submitted together with this FRD; runner implementation complete |
| Execution authorization | User consent to execute and report received at 2026-09-07T17:41:09-07:00. Dispatch still requires reviewed default-branch publication, reviewer-maintained approved SHA, concrete target/model/count/budget settings and Environment approval. No Azure resources or model trials were started. |
| Acceptance evidence | Deterministic collector/probe/report and generated-spec checks pass. No real-agent usage preflight, create/deploy comparison, measured report or adoption recommendation exists yet. This FRD remains Finalized, not Implemented. |

Implementation and execution consent are recorded separately above. Execution
consent does not bypass the protected Environment or establish an unspecified
spending limit. Actual run settings and results must still be recorded.
