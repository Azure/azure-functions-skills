# Local skill evaluation: technical design

Status: proposed, revision 5, 2026-09-09. Requirements:
[FRD-0001](../frds/0001-local-skill-evaluation.md). Staged implementation and
skill-specific evaluation scenarios are defined in the implementation plan.
This document and all commands/types below describe future contracts, not existing
functionality. FRDs take precedence; incompatible changes require renewed review.

## 1. Baseline and architecture

Original inspection baseline: `4bfa24af92ee735dcd5fed377f27ee73ba9fa69b`.
Revision 5 documentation starts at parent PR #245 HEAD
`5e08b49d32cbbff102559427792d4ed715415af9`.
`package-lock.json` currently pins Vally CLI/core `0.7.0` and Copilot SDK `1.0.5`.
`evals/README.md` describes Node 22+ for Vally, existing specs and JSONL results;
the root README requires Node 24+ for Copilot CLI. M0 must resolve the combined
engine constraints rather than infer container compatibility from either alone.
Treat these as the reproducible inspection baseline, not a requirement to retain
Vally `0.7.0`. A Vally upgrade is acceptable after reviewing its changelog/source
for material breaking changes and running targeted existing-suite regressions.
Pin the approved version. Recheck engine constraints before choosing a supported
LTS; do not raise the published CLI's runtime minimum solely for development tooling.

```text
Minimal pair manifest + reviewed Vally spec + versioned retrieval fixtures
  -> dry plan and authorization checks
  -> Vally adapter -> fresh digest-pinned Linux container per Copilot trial
  -> separate trusted build/HTTP grading context (no agent credentials)
  -> local normalized trials.jsonl + metadata events + optional private content
       -> aggregate -> public-summary.json -> standalone index.html
       -> later: deterministic detectors -> findings.json + improvement.md
       -> later: explicit upload -> Application Insights -> Workbook
```

Keep model execution, normalization, reporting, analysis and sending separate.
Do not modify setup/chat commands or hook telemetry. Do not introduce a server,
database, queue service or collector. Existing Vally reporting/trajectory APIs
are the first choice; wrap missing capabilities only after inspecting pinned
source/types and tests. Do not parse decorated console output or App UI logs.

Proposed implementation ownership (not a requirement to build all modules first):

| Location | Responsibility |
| --- | --- |
| `src/benchmark/cli.ts` | Development entry point and command validation |
| `src/benchmark/contracts.ts` | Start with minimal pair/result/public contracts; add findings/catalog schemas only at their gates |
| `src/benchmark/vally-adapter.ts` | Vally integration and capability/field mapping |
| `src/benchmark/runner.ts`, `storage.ts` | Trial lifecycle, isolation, bounded execution and durable artifacts |
| `src/benchmark/aggregate.ts`, `report.ts` | Comparable groups, public projection and HTML rendering |
| `src/benchmark/analyze.ts` | M3: deterministic, versioned findings |
| `src/benchmark/upload.ts` | M4: explicit allowlisted telemetry, delivery state and flush |
| `tests/benchmark-*.test.ts`, `tests/fixtures/benchmark/` | Existing Vitest runner and synthetic/sanitized fixtures |
| `evals/benchmark/` | Minimal manifest/spec, image definition, locked tool/dependency inputs, response fixtures, trusted checks and runbook |

Search existing helpers before adding new ones. Evaluation-only dependencies
remain development dependencies. Do not add package exports; since the package
currently includes `lib/`, explicitly decide/test whether compiled benchmark
files are excluded from the packed package without changing existing exports.

## 2. Commands and matrix

Add one proposed npm script, `benchmark`, pointing to `node lib/benchmark/cli.js`.
Compile using the existing `npm run compile`. Command examples use PowerShell:

```powershell
npm run benchmark -- plan --manifest evals\benchmark\pilot.json --out results\benchmarks\pilot-plan
npm run benchmark -- run --plan results\benchmarks\pilot-plan\plan.json --authorization C:\approved\pilot-authorization.json
npm run benchmark -- report --run results\benchmarks\<run-id>
npm run benchmark -- analyze --run results\benchmarks\<run-id> --baseline results\benchmarks\<previous-run-id>
npm run benchmark -- upload --run results\benchmarks\<run-id> --destination <approved-resource-id>
```

Paths and resource IDs are placeholders. These commands do not exist yet.
`plan`, `report` and `analyze` make no model or Azure calls. `run` never uploads or
publishes. `upload` never runs a model. Missing commands/fields fail with actionable
messages, not fallback to unrelated existing eval suites.

The manifest has a schema version, benchmark ID, stable skill ID, canonical/display
names and aliases, scenario complexity, explicit
executor/model IDs and reasoning settings, spec/stimulus references, fixture and
full-install payload revisions, installation route, lane, image digest,
architecture/resource profile, dependency/cache policy, variants, pair IDs,
repetition count, deterministic order, common-instruction and expected-installation
hashes, concurrency (1 initially), tool/MCP allowlist, timeout and limits.
M1 requires one explicit model/effort, not a catalog implementation. It references Vally
prompts/graders instead of creating a competing prompt DSL. Unknown selectors,
automatic model aliases, unsupported effort, duplicate trials and unsupported
executors fail preflight.

The deferred M2 catalog preserves eight requested model/effort configurations:

| Tier | Configurations |
| --- | --- |
| Powerful | GPT-6 Astra (`medium`), GPT-6 Astra (`low`), GPT-5.6 Sol, Claude Opus 5 |
| Versatile | Claude Sonnet 5, GPT-5.6 Terra |
| Lightweight | GPT-5.6 Luna, MAI-Code-1-Flash |

These are versioned benchmark labels, not permanent rankings. Resolve exact model
IDs, supported efforts, availability, and native billing metadata through the
approved Copilot account before plan authorization. Preserve unavailable catalog
slots as `not-evaluated`; do not substitute. Treat reasoning effort as part of
configuration identity. Scenario complexity (`simple`, `moderate`, `complex`) is
also reviewed/versioned catalog data.

The plan resolves all references and stores hashes, a unique run ID, unique
trial IDs, output root, and expected trial count before executing any trial.
An authorization record binds the plan hash, reviewed code/skill/fixture revisions,
reviewer-gate evidence, identity reference, exact models, limits and owner.
It must not contain tokens or connection strings. It is evidence of an external
human approval, not self-authorization by the runner or an editable JSON flag.
Stop when approval cannot be established; local reviewer-gate mechanics are an
explicit FRD blocker.

Exit codes: `0` command completed without failed trials/delivery, `1` completed
batch with unsuccessful task outcomes, `2` configuration/compatibility/storage/transport failure,
`3` interruption or budget/timeout cancellation of the batch. Per-trial timeouts
can coexist with a completed batch and return `1`. Always print artifact location
and completion state. Offline reports on an incomplete run may return `0` when
rendering succeeded but must prominently label incompleteness.

## 3. Isolation and lifecycle

### 3.1 Canonical environment and feasibility gate

Use a Linux evaluation image pinned by digest for every trial, locally and later
in CI. Initial proposed resource profile `linux-amd64-2cpu-8g-v1` means
`linux/amd64`, 2 vCPU, 8 GiB memory and concurrency 1. M0 validates feasibility,
records host CPU/container engine/virtualization/network conditions, and resolves
actual image/tool versions before execution approval. No concrete image digest or
unverified compatible version is implied here. A changed profile is a new
comparison group. CPU limits do not make unlike host processors equally fast.

Each trial, including retries, starts a fresh container, session, HOME,
COPILOT_HOME, writable workspace, temporary state and writable caches. Mount no
host home, source repository, `.git`, ancestor instruction tree, user plugins or
Docker socket. Copy only reviewed versioned inputs; use an evaluation-owned
external storage root, not a worktree-as-sandbox. The container image contains
tools, not a preinstalled target plugin that would contaminate the baseline.
Explicitly constrain all discovery, memory, tools and network sources. Read-only
mounting a host checkout would still expose unintended instructions and is forbidden.

Verify supported minimal runtime Copilot credential injection with the selected
Vally/SDK. The existing CI mapping to `COPILOT_GITHUB_TOKEN` is a candidate to
inspect, not proof of container support. Never bake credentials into the image,
plan, workspace or artifacts or mount the user's authenticated home. No Azure or
telemetry credentials enter the initial agent; grader/report processes receive
none. Disable normal plugin/MCP telemetry through documented opt-outs in both
arms and verify no send; disclose this controlled condition without stripping
the installed hook payload.

Before paid execution, enumerate the effective plugin/skill inventory and all
user/project discovery roots, resolve each approved skill to its canonical source
and content hash, and store safe inventory evidence. Fail closed on unexpected copies,
duplicate names, hash mismatches, personal instructions/memory, or a baseline that
can rediscover any part of the absent installation. The isolation acceptance test deliberately
provides a conflicting user-level Azure Functions Skills version and a conflicting
project-level copy/instruction tree on the host while the installed-arm container
contains the full reviewed installation; only the latter may activate. Baseline
target inventory is empty. Compare approved, non-secret user-install metadata/
file fingerprints before and after; do not copy credential/configuration content
into evidence or alter the real user's installation to create a test condition.

Never delete, rename, edit, disable in place, or temporarily move the user's
plugin/configuration. Container/auth/discovery compatibility is the first
time-boxed gate, not an assumption or fallback. If any required source cannot be
isolated or normal installation cannot be reproduced, block with evidence; do not
silently switch to host execution, a smaller skill bundle or another engine.

### 3.2 Separate trusted grading

The agent cannot write the orchestration code, authoritative results, graders or
expected answers. A path outside its workspace alone is insufficient if its shell
can access that path. Run grading in a separate trusted execution context with
reviewed read-only grader code and bounded artifact copies; no agent container
mount or tool exposes the grader or its expected outputs.
For authoritative grading, run agent-authored build scripts/apps only in a
disposable, credential-free execution compartment; the trusted controller observes exit status, host
readiness and real localhost HTTP from outside that compartment and records
results itself. Do not run generated scripts directly on the maintainer host or
give them a mount containing the graders/results. Close owned hosts, ports and
containers and record cleanup failures. This separation is required even for
reviewed prompts. Fresh task workspaces contain task inputs, not scorer answers.
Use least-privilege tool and network allowlists. Explicitly pin executable/MCP
versions; forbid unrelated personal tools and ARM writes in the pilot.
Containers improve controlled execution; they are not sufficient protection for
arbitrary unreviewed code. Only reviewed inputs execute under the repository gate.

### 3.3 Durable lifecycle and failure evidence

Before agent work, validate auth, requested model/effort and required tools.
Use a deterministic reference application to test the same pinned dependency,
build, host readiness, HTTP and shutdown path in a separate clean compartment.
The reference is never a starting answer in the agent's empty workspace. Preflight
failure blocks the batch and records every planned ID; a paid model capability
probe, if needed, requires its own explicit count/budget authorization.

Persist the plan and a `running` marker, then append terminal results as trials
finish; atomically finalize batch metadata. On crash, preserve complete lines and
report pending/running trials as interrupted using the plan. A malformed complete
record is an error, not skipped input. A truncated final line may be quarantined
with an explicit diagnostic and incomplete status; never silently count it.

Do not resume agent sessions or silently retry failed trials in v1. Additional
attempts require a new authorized plan/run ID and `retryOfAttemptId`/pair lineage.
Rerun both arms as a new pair rather than selectively repair the worse arm; retain
all original attempts, costs and outcomes. Retry of telemetry retains the
original IDs. Output roots must be new or owned by the same run; reject accidental
overwrite, path escape and symlink traversal. Stop only owned child PIDs; record
cleanup failures and manual remediation, never delete unrelated directories.

Set wall-clock, turn, model-call and output-size limits for every trial, including
readiness/HTTP/shutdown deadlines. Predeclare noninteractive answers in the prompt;
use symmetric scripted responses only if the runtime supports them. Otherwise
mark an interactive-only scenario unsupported/block it, rather than hang or
force the baseline through skill-specific steps. Enforce the batch budget
before starting subsequent trials; record actual consumption where available.
Provider usage can arrive late, so a spend ceiling is a soft operational limit,
not a guaranteed hard cap. If monetary/credit usage is unavailable, require explicit
authorization of count/time limits instead; never claim currency enforcement.
Flush partial observations on cancellation when possible.

### 3.4 Controlled versus live inputs

The controlled benchmark uses the real Copilot model, generated files, dependency
installation/build and localhost HTTP. Model/auth network access remains live:
this is not a fully offline benchmark. Fixture-only harness tests use no model or
network and cannot establish runtime capability or quality.

Provide a small reviewed set of versioned Functions tool schemas and matching
template/manifest/MCP responses at the retrieval-tool boundary. Both arms see the
same tool surface and must decide whether/how to retrieve. Do not preload a
finished project or answer in the new-project workspace, force tool invocation,
or implement a mock Azure platform. Unknown requests return an explicit fixture
contract error and are logged; no canned all-success response or live fallback.
Record whether the request is outside declared scenario support (unsupported),
an agent's incorrect request (task failure), or unclassified pending review.

Pin fixture archives, dependency manifests/lockfiles, package-manager and tool
inputs. Begin with an immutable reviewed package-cache seed copied into fresh
writable cache state per trial; no reuse of trial-mutated cache. Use integrity
checked package artifacts/approved registries and record cache misses, resolved
versions and network failures. Do not rewrite a generated answer to make it build.
No floating `@latest` in canonical inputs; unresolved/generated floating
dependencies or an unsupported resolution make repeatability limited/invalid,
not magically hermetic. The later live lane resolves current external MCP and
templates, records observed versions/content, and is never pooled with controlled
results; deployment is a further explicit gate.

## 4. Local artifact contracts

```text
results\benchmarks\<run-id>\
  plan.json
  run.json
  trials.jsonl
  events\<attempt-id>.jsonl
  findings.json                    # M3+
  improvement.md                   # M3+
  private\                         # only with explicit content-capture opt-in
  upload-state.json                # M4+
  public\
    public-summary.json
    index.html
```

`results/` is already ignored. Never publish the parent directory. Preserve
normalized metadata as the persistent source of truth. Execution necessarily
handles the task prompt and generated application: keep them in isolated, private,
size/time-bounded ephemeral memory/files only as long as execution and trusted
grading require. Clean up task copies on success, failure, cancellation and crash
recovery; report cleanup failures. These temporary inputs/artifacts do not require
evidence-capture opt-in and must never enter the public projection.
Suppress unnecessary raw Vally transcript/trajectory files by default. Required
runtime temporary content follows the same bounded private lifecycle, not
unrestricted log retention. Persisting transcripts or generated code as evidence
beyond that lifecycle is a separate `--capture-content` opt-in.

| Contract | Required information |
| --- | --- |
| Run | Schema version, run/plan identity, UTC timestamps, lifecycle state, planned/attempted/terminal counts, exact versions, lane, image digest, resource/host profile, dependency/cache policy, safe isolation/inventory evidence, policy/authorization references and capability coverage; detector config only in M3+ |
| Trial | Run/trial/pair/attempt IDs, retry lineage, scenario/version, installation route/revision and full inventory hash, common/installation instruction hashes, executor, requested/observed model and effort, variant/repetition/order, started flag, lifecycle/status, failure class/evidence, task outcome, grader checks, cleanup outcome, metrics and coverage |
| Observation | Stable event ID, trial/attempt/session/parent/call IDs when available, monotonic sequence, timestamp, phase, event type, controlled tool/skill identifiers, duration/status and nullable usage values |
| Finding | Detector ID/version, trial/event references, measured evidence, hypothesis, confidence, suggestion, validation criterion, affected metric and optional comparison trial |
| Public summary | Explicit projection of approved benchmark labels, versions/date, scenario criteria, counts/statuses, metric summaries/coverage, comparison deltas and limitations |

Trial status is one of `passed`, `failed`, `error`, `timeout`, `skipped`,
`cancelled`, `interrupted`. Also record `failureClass` as `none`, `task`,
`infrastructure`, `provider`, `unclassified`, or `cancellation`, with a controlled
reason and safe evidence reference. Status and cause are different axes:
timeout is not automatically infrastructure. Invalid agent code/URLs remain task
failures; classify infrastructure/provider failures only with independent
evidence (reference health, tool/provider diagnostics), otherwise unclassified.
`taskOutcome` is `pass`, `fail`, or `not-scorable`, independent of cause diagnosis.
A started task that misses required outcomes within its declared deadline is
normally `fail`, even with `status: timeout` and `failureClass: unclassified`.
Reserve `not-scorable` for independently evidenced infrastructure/provider
failures that prevent evaluation, external cancellation/interruption that makes
the outcome unevaluable, or never-started tasks; record the exclusion reason and
evidence. Unknown cause alone is not an exclusion. Missing mandatory outcomes
cannot pass; missing observations because grading infrastructure failed require
explicit evidence, not an automatic task pass/fail. Do not infer task success
from a completed process.
Treat malformed/version-unsupported inputs as errors. Schema adapters must be
explicit; no structural casts that silently accept a newer upstream format.

Each nullable measurement has `coverage: complete | partial | unavailable` and
a machine-readable reason. Observed zero is distinct from unavailable.
Keep integer token/call counts and milliseconds. Preserve provider cost in
its native unit with source/version; serialize large integers losslessly.
No freeform provider field is trusted as a currency label.

Default persisted metadata evidence must exclude prompt/response text, raw arguments,
outputs, absolute paths and untrusted freeform error strings. For repeated
operations, generate run-scoped keyed fingerprints of normalized arguments and
file state in memory, not unsalted hashes of potentially secret inputs.
Keep read range, revision relationship and status only where safe and available.
When obtaining this metadata would require unsupported instrumentation, expose
the detector as unavailable rather than retaining raw content by default.

Optional `--capture-content` on `run` requires explicit approval to retain selected
transcripts/generated code as evidence in `private/`, distinct from temporary task
processing. Apply redaction, restrictive access and a recorded
retention deadline. Redaction is defense-in-depth, not permission to publish.
Do not retain model hidden reasoning. Reports include only observed actions.

## 5. Metric semantics and comparison

| Metric | Definition and caveats |
| --- | --- |
| Input/output tokens | Sum deduplicated per-model-call reported usage during agent execution; distinguish partial observations |
| Cache read/write tokens | Separate provider-reported fields; do not add to input tokens without proving the provider semantics |
| Model calls | Count uniquely identified inference calls, not user prompts or tool calls; if only usage events are available, label as observed usage-call count |
| Turns | Runtime-defined agent turns with source/definition recorded; not interchangeable with model calls or task prompts; unsupported counters are unavailable |
| Tool calls | Count actual tool invocations; parallel tools remain separate calls; expose failed calls separately |
| Agent duration | Monotonic elapsed time from submitting the prompt to terminal agent completion/cancellation; excludes setup, trusted grading, reporting and telemetry; includes tools and agent-run builds |
| Other durations | Install, runtime startup, trusted grading/build/HTTP, reporting and later upload are separate; never substitute Vally total time for agent duration; record installation/startup usage separately if exposed |
| Skill activation | Observed target skill loading; not inferred from output mentioning the name |
| Subagent consumption | Included exactly once if the executor reports it; optional disjoint breakdown by parent/session; do not add nested totals to an already inclusive total |
| Copilot cost | One account-wide Copilot billing unit selected in the authorized plan and reported with identical semantics across configurations; native/provider units remain secondary; unknown is not free and token count times vendor API price is not Copilot billing |

If the provider has only cumulative session totals, do not sum snapshots as
per-call usage. Choose a documented final total or deltas and report unavailable
call-level attribution. Do not mix summary RPC totals with the same event totals.
Requested and observed model mismatch is a protocol error, not a valid comparison.

Show three explicit denominators for each arm first: operational completion (attempts reaching
normal agent termination and completed grading/cleanup, even when task checks
fail, divided by started attempts), overall task success (mandatory passes /
started attempts), and conditional task quality (passes / task-scorable attempts).
Task-scorable includes ordinary task-deadline misses as failures even when the
cause is unknown. Only the explicit `not-scorable` conditions above may exclude
an attempt; never infer an exclusion from an unclassified cause or timeout alone.
Report excluded counts and evidence by arm alongside conditional quality. Overall
success retains all started attempts, including excluded ones; show planned and
never-started counts separately. Zero scorable attempts means unavailable quality,
not 0% or 100%. Pooled counts are supplementary batch accounting, never a
substitute for installed/uninstalled denominators or an A/B quality metric. Activation
rate uses trials with observable activation data and displays that denominator;
never count missing activation telemetry as a failure to activate.
Missing quality checks cannot produce a pass. Partial mandatory failures cannot
be hidden by a weighted average from the original Vally grader.

Aggregate by stable skill ID and installation content lineage, installation route, scenario
version/complexity, capability tier, executor/model/effort, variant and environment
profile and lane. Show n, passed/attempted, planned/unattempted, missing/partial counts,
median and min/max of complete observations. Show complete-observation statistics
for all attempted trials and a separately labeled successful-only view; label
timeout durations as censored, not completed execution latencies. No p95 in a
three-repeat scenario/configuration group.

M1 wiring acceptance is not both arms passing the task. Reference-app health,
real model task execution/output reaching trusted checks, correct measurement/
grading/storage/reporting and cleanup establish a valid pair even when either
arm fails the task. A failed build is recorded as a task failure with downstream
HTTP checks not executed, not a reason to rerun until green. A pair containing
only authentication or measurement-infrastructure errors is retained as evidence
but does not demonstrate real-model-generated application E2E. Distinguish
harness acceptance from observed task quality and never claim an unexecuted
generated-app HTTP check succeeded.

One valid pair is a wiring smoke, not a model-suitability result. With three approved
repetitions per arm (M2), publish one of these descriptive labels:

| Label | Rule |
| --- | --- |
| `observed-fit` | All three authorized repetitions pass every mandatory check with no critical safety/error condition |
| `mixed` | One or two repetitions pass every mandatory check |
| `not-demonstrated` | No repetition passes every mandatory check |
| `not-evaluated` | No valid evaluation because model/effort, execution or capability is unavailable/unauthorized; retain attempted operational evidence |

An interrupted three-repeat batch is labeled incomplete, not assigned a completed
three-repeat fit label. Call these small-sample outcomes, not recommendations,
statistical significance or model guarantees. Identify
the lowest capability tier with an observed-fit configuration. Identify the
lowest-cost observed-fit configuration only when the same Copilot account-wide
billing metric (for example, the runtime's AI-credit or premium-request consumption
under the active billing model) covers every compared configuration with identical
semantics. Show median/range of that metric and cost per successful trial alongside
quality, latency, tokens and calls. Native/provider units are diagnostics. If no
common unit exists, show lowest adequate tier and within-provider/native costs,
mark cross-provider cost not comparable, and do not infer it from tier labels or
external API token pricing.

### 5.1 Primary A/B: net normal-install effect

The primary question is what a user gains or loses by normally installing Azure
Functions Skills, not whether a handpicked bundle beats a stripped control.
Use the full reviewed payload from the selected normal installation route,
including all skill bodies, catalog/descriptions, hooks and applicable
install-generated instructions/config. The root README currently distinguishes
Copilot marketplace plugin installation from companion `install --local`; the
latter copies skill bodies/MCP/hooks, not agent/instruction/routing/prompt files.
Do not mix those routes or invent generated instructions. M0 must reproduce and
record the selected route's layout using a supported pinned/offline install path.
The initial preferred route is the normal Copilot marketplace plugin; if its
pinned reproduction is unsupported, stop for a reviewed route decision instead
of silently selecting a subset. Installation execution is setup, not agent task.

Both arms receive the same complete user task (no named skill invocation), common
harness instructions, tool schemas/MCP responses, fixtures, model/effort, limits,
grader rules and starting application state. Expose external tools independently
of the plugin installation in both arms, with one identical effective registration;
avoid duplicating a plugin-provided MCP tool in the installed arm. Record this
tool-access control and any supported fixture routing as benchmark conditions.
If tool parity cannot be achieved without dropping required installed content,
block for review. No Azure tool credentials or live deployment capability in M1.

Hash the common instructions separately from expected installation-generated
instruction/config/catalog differences. Do not demand full resultant system prompt
byte equality; runtime-generated prompts may not even be exposed. Verify effective
discovery and capture coverage instead. Installation-caused metadata and unused
skill overhead are intentional treatment costs, never subtracted. Runtime task
tokens include that overhead; separately expose install/startup duration and
usage where supported. Show quality, tokens, latency, turns and all-attempt costs
even if quality is unchanged or installed tokens are higher; savings are not a
pass criterion. Attribute the comparison to scenario plus installation, not
single-skill causality. Optional target-bundle mode is a labeled later diagnostic.

Enumerate pair IDs and retain both arms and every attempt, including incomplete
pairs. Predeclare alternating order and identical per-trial cold writable state;
no selective retries or stale-session continuation. Compare history only with
compatible controls, lane and resource profiles, allowing the declared content
revision to differ. Record changed instructions/tools/models/graders and suppress
incompatible regression claims. A zero baseline supports an absolute delta, not
a percentage. Host hardware/network/provider nondeterminism remains even with the
same image; latency comparison requires compatible profiles, not identical outputs.

## 6. Improvement analysis

Deferred to M3; not a dependency of the first usable JSONL/HTML pair.

`analyze` is deterministic and offline in v1. It can run without `--baseline`;
only matched-regression detection then reports unavailable. Store thresholds in
run metadata and a versioned detector config. Proposed defaults are investigation
heuristics, not product quality gates:

| Detector | Candidate condition | Suppression / evidence requirement | Suggested direction |
| --- | --- | --- | --- |
| repeated-read | Same target/range and unchanged revision read at least 3 times in a trial | Require known file-state identity; suppress rereads after mutation; report unknown revision as insufficient evidence | Clarify reference order and scope; avoid redundant navigation |
| repeated-failure | Same operation fingerprint and normalized failure category at least 3 consecutive times | Separate transient retryable failures; unknown category/state change prevents a strong claim | Document prerequisites or error-specific recovery |
| search-without-progress | At least 5 consecutive search/list operations | Candidate only; absence of a subsequent material action/completion must be observable; research tasks may legitimately search | Add a direct reference or decision table |
| input-growth | Adjacent comparable model calls increase input by at least 50% and 4,000 tokens | Require complete per-call data, same model/context lineage, no unexplained compaction; do not claim a specific file caused growth | Narrow read ranges, reduce tool verbosity or split long references |
| matched-regression | Matched group median model calls or input tokens increases by at least 25%, with at least 3 complete trials per side | Compare only compatible groups; show absolute delta, spread and quality changes; zero baseline has no percentage | Inspect added trajectory segments before modifying skill guidance |

Confidence describes evidence completeness, not statistical certainty. Every
finding separates observation, hypothesis and proposed remediation, includes
stable trial/event evidence references, and ends with a concrete re-evaluation
criterion (for example, fewer repeat reads without reduced task success).
Do not allocate all later input tokens to one read, claim guaranteed savings,
or label deliberate verification as proven waste.

`improvement.md` contains scope/control metadata, metric deltas, coverage,
findings ordered by observed impact, limitations, and maintainer disposition
fields (`accepted`, `false-positive`, `needs-evidence`, `deferred`). A no-finding
report distinguishes "no candidates in observed data" from unavailable detectors.
Stable finding IDs allow a separate disposition file to survive regeneration.
Private evidence links are local and never copied into public HTML.

## 7. Public HTML and telemetry

Produce a self-contained HTML file from the public projection, using escaped
text and safe JSON serialization (including script-closing payloads). No CDN,
external chart library, API queries or live App Insights credentials. Filtering
uses bundled data so `file://` works. Display stable skill/display name,
capability tier, model/effort, scenario/complexity and variant filters, four-state
fit labels, counts, accuracy, activation, comparable Copilot consumption,
provider-native diagnostics, agent/tool activity, median/range and coverage, with
measured environment and limitations. Do not embed freeform raw findings or
transcript excerpts. Public labels/criteria are reviewed catalog text, not
arbitrary model output.

Publication is manual in v1: generate, review the exact public directory and hash,
then publish only that artifact to the authorized Pages repository/path using
the repository's permitted static-site mechanism. Preserve an immutable
run-specific page; update a latest link only deliberately. Existing Pages
deployment plumbing is acceptable; no new evaluation workflow is in scope.
Record artifact hash and URL. No automatic git push or publication command.
M1 produces only the small local summary; richer catalog filters, publication,
telemetry and Workbook delivery are later gates and cannot block it.

Proposed telemetry event: `SkillEvaluationCompleted` (also used for failed trials,
with explicit status). One event carries `schemaVersion`, run/trial ID, controlled
benchmark/stable-skill/scenario/complexity/tier/model/effort/executor/variant
identifiers, revisions, status, coverage and rule version, with complete numeric
measurements, the plan-selected comparable Copilot billing unit, provider-native
diagnostics and per-rule counts.
Include `attempted` and duration-censoring indicators for truthful queries.
Do not send error text, argument fingerprints, transcripts, local paths, prompts,
code, model reasoning, or authentication/account identifiers.

Use a dedicated evaluation destination configured at upload time. Keep connection
or credential material in the process environment/approved credential provider,
never in reports or manifests; remove it from child agent environments. Read and
honor applicable telemetry opt-outs. Explicit invocation does not override an
opt-out silently. Do not reuse the package's build-time telemetry placeholder.
The supported Azure Monitor transport/authentication choice is pending FRD review.
The existing sender uses the legacy Classic `applicationinsights@1.8.10` API;
its presence is not evidence of a suitable transport for this new component.
Evaluate a currently supported Azure Monitor integration without migrating the
unrelated invocation sender as a side effect.

Uploader sends only fixed-schema projections. Fail invalid destination/payload
before sending; flush and return explicit failure on timeout. Track per-trial
delivery attempts and payload hashes locally. Ambiguous delivery can be retried,
but has at-least-once semantics, not exactly-once. For v1, once uploading starts,
freeze the telemetry projection (including rule version); changed projections
require an explicit future revision contract, not silently different duplicate IDs.

Workbook queries select the event name/schema, deduplicate by run ID + trial ID,
then aggregate by stable skill ID/content lineage, comparable
scenario/complexity/tier/model/effort/variant/revision/time. Keep numerator,
attempted/planned counts and metric coverage distinct. Export no sampled trial
events; confirm ingestion sampling settings before the pilot. Any sampling or
missing data must be visible, not interpreted as zero. Set retention explicitly.
The Workbook provides model suitability/economics, outcome,
consumption/latency/activity trends, detector counts and data-quality views. Its
exact table/column mapping must follow the approved transport and be verified
during the pilot, not guessed from legacy SDK examples.

## 8. Compatibility evidence and unresolved gates

Before implementation approval, inspect the installed/locked Vally and SDK types
and record the source fields for tokens, cache, billing, call identity, tool
status, activation and agent end time. Distinguish static inspection from a
paid capability probe. Inspect how Vally isolates homes/skills, chooses models,
allows tools and captures transcripts; enumerate every user/project/plugin/skill/
instruction/memory discovery source and validate the canonical container design.
Verify bounded ephemeral task processing/cleanup separately from opt-in persistent
capture, and suppress unnecessary transcript files by default. Unsupported required
capabilities block the plan or require a reviewed version/adapter decision. A
Vally upgrade may be that decision when existing suite configuration, grader
behavior, result schemas, and CLI contracts have no material unmitigated breaking
change and targeted regression tests pass.

Current upstream references are discovery aids, not proof of locked-version support:

- [Vally](https://aka.ms/vally)
- [Copilot SDK usage/billing](https://github.com/github/copilot-sdk/blob/main/docs/features/usage-and-billing.md)
- [Copilot SDK authentication](https://github.com/github/copilot-sdk/blob/main/docs/auth/authenticate.md)
- [Copilot SDK OpenTelemetry](https://github.com/github/copilot-sdk/blob/main/docs/observability/opentelemetry.md)
- [Azure Monitor Workbooks](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-overview)

Do not run evals, upgrade dependencies, provision Azure or publish as part of
resolving this documentation task. Execution policy and adapter/container
feasibility gate M0/M1; supported telemetry transport gates M4 only. Open later
choices do not authorize their implementation or block the approved core slice.

Future M6 CI runs the same image digest, manifest and entrypoint as the approved
local run; only trigger, secret injection and artifact storage differ. Record the
CI host/resource profile and compare latency only when compatible. Retain the
reviewer-gated policy for all evaluation code; scheduled jobs may await approval.
Do not introduce a benchmark workflow in this documentation change or M1.

## 9. Independent architecture review record

On 2026-09-08, a separate Claude Opus 4.8 agent performed a read-only architecture
review of revision 1 of the first two FRDs, the provisional index, this design, the
implementation plan, and the evals README introduction. It reported no blocking
findings, confirmed the eight-section governance structure and the distinction
between proposed capabilities, human approval and experiment authorization.
The author applied these suggested clarifications after review:

| Finding | Resolution |
| --- | --- |
| Governance merge gate was implicit | Index and handoff explicitly require merged PR #244, final-policy recheck and ID deconfliction before Finalized |
| Legacy telemetry transport context could be clearer | Section 7 names the locked Classic SDK and requires a supported evaluation transport decision without migrating unrelated hooks |
| General HTML filter list omitted skill | Section 7 now includes the skill filter required by SE-006 |
| Development-command documentation must remain in delivery scope | Implementation slice F explicitly includes `docs/development.md` |

This review does not resolve the open capability, local execution-policy or
telemetry-transport decisions. Those require evidence and further review before
human sign-off.

On the same date, a separate Claude Opus 4.8 agent reviewed revision 2 and the
create and hosted-agents pilot proposals. It reported no blockers and identified
three important clarifications:
trial workspaces must also avoid checkout-level discovery, cross-provider
"cheapest" requires a common Copilot billing unit, and rename history should use
an opaque stable ID. Those changes are incorporated in the FRD, design, and
implementation plan. FRD-0001 remains Draft; no implementation, paid-run,
publication or telemetry
authorization was granted.

Revision 5 changes the primary treatment, environment and milestone order.
Earlier reviews are historical evidence only. On 2026-09-09 the parent planning
session independently reviewed revision 5 (pre-correction FRD SHA256
`DE247ECF29A65BE5B5351BA5E03BAB062E4C6F36A0E0236618F206CB46FDD91E`).
It accepted the M0/M1 separation, full-install A/B, per-trial isolation and staged
expansion, and requested the following corrections before committing:

| Finding | Author's correction |
| --- | --- |
| Excluding unknown-cause task timeouts biases conditional quality | Deadline misses normally fail regardless of cause diagnosis; only evidenced unevaluable cases are excluded; per-arm denominators are primary, with paired synthetic examples |
| "Pair works" could require both tasks to succeed or accept infrastructure-only errors as E2E | M1 validates the harness and real model artifact checks, not universal task success; task failures remain valid, auth/measurement-only errors do not prove generated-artifact E2E |
| Temporary content policy could prevent real application execution | Bounded private ephemeral prompt/app processing is distinct from opt-in persistent raw evidence; suppress unnecessary transcripts and clean task copies on all exit paths |

On 2026-09-09, independent reviewer GPT-6 Astra (parent app session
`72f498f5-7c8a-475c-af0a-888603398c9d`) confirmed all three corrections in these
pre-review-record snapshots:

| Document | SHA256 |
| --- | --- |
| FRD-0001 | `9397D96EF93FF4165C17E1D1855A5BEA56A0A415C2B9ED351BBE8E41B120241E` |
| Technical design | `48C11072E7E5D0BFDBDAB309D4D9A714312EDE573031F4476D1CF97E6B0E8BD8` |
| Implementation plan | `A56958D959B391E74E0118F1EB6F262A2D643A5CEF5280883E507C9DD966571E` |

Independent review is complete. Human sign-off is still pending and status
remains Draft. Documentation commit/PR authorization does not authorize framework
implementation or paid execution. No experiment has occurred.
