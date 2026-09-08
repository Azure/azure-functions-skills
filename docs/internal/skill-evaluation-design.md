# Local skill evaluation: technical design

Status: proposed, revision 3, 2026-09-08. Requirements:
[FRD-0001](../frds/0001-local-skill-evaluation.md). Staged implementation and
skill-specific evaluation scenarios are defined in the implementation plan.
This document and all commands/types below describe future contracts, not existing
functionality. FRDs take precedence; incompatible changes require renewed review.

## 1. Baseline and architecture

Repository baseline: `4bfa24af92ee735dcd5fed377f27ee73ba9fa69b`.
`package-lock.json` pins Vally CLI/core `0.7.0` and Copilot SDK `1.0.5`.
`evals/README.md` describes Node 22+ for Vally, existing specs and JSONL results.
Recheck engine constraints of the locked tools before choosing a supported LTS;
do not raise the published CLI's runtime minimum solely for development tooling.

```text
Matrix + existing Vally specs + reviewed fixture revisions
  -> dry plan and authorization checks
  -> Vally adapter -> isolated Copilot CLI/SDK trials
  -> local normalized trials.jsonl + metadata events + optional private content
       -> aggregate -> public-summary.json -> standalone index.html
       -> deterministic detectors -> findings.json + improvement.md (private)
       -> explicit upload -> Application Insights -> Workbook
```

Keep model execution, normalization, reporting, analysis and sending separate.
Do not modify setup/chat commands or hook telemetry. Do not introduce a server,
database, queue service or collector. Existing Vally reporting/trajectory APIs
are the first choice; wrap missing capabilities only after inspecting pinned
source/types and tests. Do not parse decorated console output or App UI logs.

Proposed implementation ownership:

| Location | Responsibility |
| --- | --- |
| `src/benchmark/cli.ts` | Development entry point and command validation |
| `src/benchmark/contracts.ts` | Versioned manifest, result, event, finding and public-export contracts |
| `src/benchmark/vally-adapter.ts` | Vally integration and capability/field mapping |
| `src/benchmark/runner.ts`, `storage.ts` | Trial lifecycle, isolation, bounded execution and durable artifacts |
| `src/benchmark/aggregate.ts`, `report.ts` | Comparable groups, public projection and HTML rendering |
| `src/benchmark/analyze.ts` | Deterministic, versioned findings |
| `src/benchmark/upload.ts` | Explicit allowlisted telemetry, delivery state and flush |
| `tests/benchmark-*.test.ts`, `tests/fixtures/benchmark/` | Existing Vitest runner and synthetic/sanitized fixtures |
| `evals/benchmark/` | Matrix manifest, runbook and benchmark-specific fixtures/checks |

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
names and aliases, scenario complexity, capability-tier catalog, explicit
executor/model IDs and reasoning settings, spec/stimulus references, fixture and
skill-bundle revisions, variants, repetition count, deterministic order,
concurrency (1 in v1), tool/MCP allowlist, timeout and limits. It references Vally
prompts/graders instead of creating a competing prompt DSL. Unknown selectors,
automatic model aliases, unsupported effort, duplicate trials and unsupported
executors fail preflight.

The pilot catalog has eight model/effort configurations:

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
batch with task failures, `2` configuration/compatibility/storage/transport failure,
`3` interruption or budget/timeout cancellation of the batch. Per-trial timeouts
can coexist with a completed batch and return `1`. Always print artifact location
and completion state. Offline reports on an incomplete run may return `0` when
rendering succeeded but must prominently label incompleteness.

## 3. Isolation and lifecycle

Create a new session and disposable workspace for each trial. Place trial
workspaces in an evaluation-owned root outside the source repository and its
ancestors so normal parent walking cannot discover the checkout's `AGENTS.md`,
`.github` plugins/instructions, or canonical `templates/skills`. Create a fresh
evaluation-owned `COPILOT_HOME` (or a runtime profile proven to be equivalent)
for each run, separate from the user's normal home. Populate it only with the
approved settings, plugin and skill bundle. Explicitly control every skill/plugin
discovery root, MCP server, instruction source and memory source; merely changing
cwd, setting one environment variable, or using a worktree is insufficient.
Reuse legitimate Copilot authentication through the supported credential path
without copying credentials into the evaluation home or workspace.

Before paid execution, enumerate the effective plugin/skill inventory and all
user/project discovery roots, resolve each approved skill to its canonical source
and content hash, and store safe inventory evidence. Fail closed on unexpected copies,
duplicate names, hash mismatches, personal instructions/memory, or a baseline that
can rediscover the removed bundle. The isolation acceptance test deliberately
provides a conflicting user-level Azure Functions Skills version and a conflicting
project-level copy/instruction tree while the evaluation home contains the
reviewed version; only the latter may activate.
Snapshot the user configuration tree before and after and prove it is unchanged.

Never delete, rename, edit, disable in place, or temporarily move the user's
plugin/configuration. If the pinned runtime reads an unavoidable user discovery
root, use a disposable OS user/profile or container that still meets authentication
and execution policy. If neither mechanism is proven, block the run.

Keep deterministic graders and expected answers outside agent-writable roots;
grade artifacts using trusted runner code, not the agent's self-reported success.
Fresh workspace state includes public fixtures, not scorer source or answers.
Use least-privilege tool and network allowlists. Explicitly pin executable/MCP
versions; forbid unrelated personal tools and ARM writes in the pilot.
Workspace isolation is a reproducibility measure, not an OS security boundary.
Only reviewed code may execute, under the repository's evaluation gate.

Persist the plan and a `running` marker, then append terminal results as trials
finish; atomically finalize batch metadata. On crash, preserve complete lines and
report pending/running trials as interrupted using the plan. A malformed complete
record is an error, not skipped input. A truncated final line may be quarantined
with an explicit diagnostic and incomplete status; never silently count it.

Do not resume agent sessions or silently retry failed trials in v1. Additional
attempts require a new authorized plan/run ID. Retry of telemetry retains the
original IDs. Output roots must be new or owned by the same run; reject accidental
overwrite, path escape and symlink traversal. Stop only owned child PIDs; record
cleanup failures and manual remediation, never delete unrelated directories.

Set wall-clock and model-call limits for every trial. Enforce the batch budget
before starting subsequent trials; record actual consumption where available.
Provider usage can arrive late, so a spend ceiling is a soft operational limit,
not a guaranteed hard cap. If monetary/credit usage is unavailable, require explicit
authorization of count/time limits instead; never claim currency enforcement.
Flush partial observations on cancellation when possible.

## 4. Local artifact contracts

```text
results\benchmarks\<run-id>\
  plan.json
  run.json
  trials.jsonl
  events\<trial-id>.jsonl
  findings.json
  improvement.md
  private\                         # only with explicit content-capture opt-in
  upload-state.json
  public\
    public-summary.json
    index.html
```

`results/` is already ignored. Never publish the parent directory. Preserve
normalized data as the source of truth; raw Vally trajectories may contain
content and must follow private-capture policy, including temporary files.

| Contract | Required information |
| --- | --- |
| Run | Schema version, run/plan identity, UTC timestamps, lifecycle state, expected/finished counts, exact versions, external trial-root and isolated-home/profile evidence, effective user/project inventory hashes, OS/runtime/tool profile, policy/authorization references, detector config/version and capability coverage |
| Trial | Run/trial ID, scenario/version/complexity, stable/canonical/display skill identity and aliases, actual enabled bundle/hash, executor, capability tier, requested and observed models, reasoning settings, variant, repetition/order, status, grader outcomes, metrics and coverage |
| Observation | Stable event ID, trial/session/parent/call IDs when available, monotonic sequence, timestamp, phase, event type, controlled tool/skill identifiers, duration/status and nullable usage values |
| Finding | Detector ID/version, trial/event references, measured evidence, hypothesis, confidence, suggestion, validation criterion, affected metric and optional comparison trial |
| Public summary | Explicit projection of approved benchmark labels, versions/date, scenario criteria, counts/statuses, metric summaries/coverage, comparison deltas and limitations |

Trial status is one of `passed`, `failed`, `error`, `timeout`, `skipped`,
`cancelled`, `interrupted`. Do not infer task success from a completed process.
Treat malformed/version-unsupported inputs as errors. Schema adapters must be
explicit; no structural casts that silently accept a newer upstream format.

Each nullable measurement has `coverage: complete | partial | unavailable` and
a machine-readable reason. Observed zero is distinct from unavailable.
Keep integer token/call counts and milliseconds. Preserve provider cost in
its native unit with source/version; serialize large integers losslessly.
No freeform provider field is trusted as a currency label.

Default metadata evidence must exclude prompt/response text, raw arguments,
outputs, absolute paths and untrusted freeform error strings. For repeated
operations, generate run-scoped keyed fingerprints of normalized arguments and
file state in memory, not unsalted hashes of potentially secret inputs.
Keep read range, revision relationship and status only where safe and available.
When obtaining this metadata would require unsupported instrumentation, expose
the detector as unavailable rather than retaining raw content by default.

Optional `--capture-content` on `run` requires explicit approval and captures only
needed fields into `private/`. Apply redaction, restrictive access and a recorded
retention deadline. Redaction is defense-in-depth, not permission to publish.
Do not retain model hidden reasoning. Reports include only observed actions.

## 5. Metric semantics and comparison

| Metric | Definition and caveats |
| --- | --- |
| Input/output tokens | Sum deduplicated per-model-call reported usage during agent execution; distinguish partial observations |
| Cache read/write tokens | Separate provider-reported fields; do not add to input tokens without proving the provider semantics |
| Model calls | Count uniquely identified inference calls, not user prompts or tool calls; if only usage events are available, label as observed usage-call count |
| Tool calls | Count actual tool invocations; parallel tools remain separate calls; expose failed calls separately |
| Agent duration | Monotonic elapsed time from submitting the prompt to terminal agent completion/cancellation; excludes setup, trusted grading, reporting and telemetry; includes tools and agent-run builds |
| Other durations | Setup, grading, reporting and upload tracked separately; never substitute Vally total trial time for agent duration without proving boundaries |
| Skill activation | Observed target skill loading; not inferred from output mentioning the name |
| Subagent consumption | Included exactly once if the executor reports it; optional disjoint breakdown by parent/session; do not add nested totals to an already inclusive total |
| Copilot cost | One account-wide Copilot billing unit selected in the authorized plan and reported with identical semantics across configurations; native/provider units remain secondary; unknown is not free and token count times vendor API price is not Copilot billing |

If the provider has only cumulative session totals, do not sum snapshots as
per-call usage. Choose a documented final total or deltas and report unavailable
call-level attribution. Do not mix summary RPC totals with the same event totals.
Requested and observed model mismatch is a protocol error, not a valid comparison.

Accuracy is the number of trials satisfying all mandatory quality checks divided
by attempted trials. Attempted includes passed/failed/error/timeout and started
cancelled/interrupted trials; exclude never-started trials but show planned and
unattempted counts. Show scored-only outcomes separately when useful. Activation
rate uses trials with observable activation data and displays that denominator;
never count missing activation telemetry as a failure to activate.
Missing quality checks cannot produce a pass. Partial mandatory failures cannot
be hidden by a weighted average from the original Vally grader.

Aggregate by stable skill ID and content lineage, skill bundle, scenario
version/complexity, capability tier, executor/model/effort, variant and environment
profile. Show n, passed/attempted, planned/unattempted, missing/partial counts,
median and min/max of complete observations. Show complete-observation statistics
for all attempted trials and a separately labeled successful-only view; label
timeout durations as censored, not completed execution latencies. No p95 in a
three-repeat scenario/configuration group.

For each scenario/configuration, publish one of:

| Label | Rule |
| --- | --- |
| `observed-fit` | All three authorized repetitions pass every mandatory check with no critical safety/error condition |
| `mixed` | One or two repetitions pass every mandatory check |
| `not-demonstrated` | No repetition passes every mandatory check |
| `not-evaluated` | The model/effort, execution, or required capability is unavailable/unauthorized |

Call these measured outcomes, not recommendations or model guarantees. Identify
the lowest capability tier with an observed-fit configuration. Identify the
lowest-cost observed-fit configuration only when the same Copilot account-wide
billing metric (for example, the runtime's AI-credit or premium-request consumption
under the active billing model) covers every compared configuration with identical
semantics. Show median/range of that metric and cost per successful trial alongside
quality, latency, tokens and calls. Native/provider units are diagnostics. If no
common unit exists, show lowest adequate tier and within-provider/native costs,
mark cross-provider cost not comparable, and do not infer it from tier labels or
external API token pricing.

Match A/B on all controls except the declared skill bundle. Match historical
comparisons on the same controls while allowing the explicitly compared skill
revision to differ. Record changed controls (including tool/model/grader updates)
and suppress direct regression claims when incompatible. Alternate A/B execution
order to reduce warming/order bias. A zero baseline supports an absolute delta
but not a percentage. Report association, not causal proof.

## 6. Improvement analysis

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
instruction/memory discovery source and prove the isolated-home design. Default
content policy must hold even for temporary files. Unsupported required
capabilities block the plan or require a reviewed version/adapter decision.

Current upstream references are discovery aids, not proof of locked-version support:

- [Vally](https://aka.ms/vally)
- [Copilot SDK usage/billing](https://github.com/github/copilot-sdk/blob/main/docs/features/usage-and-billing.md)
- [Copilot SDK authentication](https://github.com/github/copilot-sdk/blob/main/docs/auth/authenticate.md)
- [Copilot SDK OpenTelemetry](https://github.com/github/copilot-sdk/blob/main/docs/observability/opentelemetry.md)
- [Azure Monitor Workbooks](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-overview)

Do not run evals, upgrade dependencies, provision Azure or publish as part of
resolving this documentation task. Execution policy, adapter feasibility and
supported telemetry transport are unresolved FRD gates, not permission to improvise.

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
